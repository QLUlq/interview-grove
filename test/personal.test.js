import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Store, redact, studyProfile } from '../store.mjs';
import { createSession, answerSession, topics } from '../public/engine.js';
import { branchSession } from '../public/branch.js';
import { answerWithModel, extractMaterials } from '../model.mjs';
import { createServer } from '../server.mjs';
const config={key:'test-placeholder',base:'https://example.invalid',model:'test'};
const reply=raw=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(raw)}}]}));

test('historical edits discard future state, retain prefix and leave the source intact',()=>{
  let source=answerSession(createSession('job'), '我们做了项目');
  source=answerSession(source,'我负责实现缓存模块，使用Redis');
  source=answerSession(source,'因为运维成本更低，所以选择该方案');
  source.completedAt=Date.now();source.coaching={1:{rewrite:'旧建议'}};
  const snapshot=structuredClone(source), branch=branchSession(source,1,topics.job.nodes);
  assert.equal(branch.parentId,source.id);assert.equal(branch.rootId,source.id);assert.equal(branch.current,0);assert.equal(branch.followupCount,1);
  assert.equal(branch.turns.length,1);assert.equal(branch.messages.length,3);assert.equal(branch.draft,source.turns[1].text);
  assert.equal(branch.decisions.length,1);assert.equal(branch.completedAt,null);assert.equal(branch.coaching,undefined);
  assert.deepEqual(branch.evidence.ownership.samples,[source.turns[0].text]);assert.deepEqual(source,snapshot);
  const continued=answerSession(branch,'我亲自编写缓存读取和失效逻辑');
  assert.equal(continued.turns.length,2);assert.equal(source.turns.length,3);
  const child=branchSession(continued,0,topics.job.nodes);assert.equal(child.rootId,source.id);assert.equal(child.parentId,branch.id);assert.equal(child.turns.length,0);
});

test('account passwords, records, revisions, logout and opt-in aggregation remain isolated',async()=>{
  const store=new Store(':memory:');
  try{
    const users=[];
    for(let i=0;i<3;i++)users.push(await store.authenticate(`test_user_${i}`,'test-pass-123',true,`ip-${i}`));
    const s=answerSession(createSession('job','私人公司 user@example.com'), '我负责实现Redis缓存');
    s.turns[0].memory={tags:['Redis','私人公司'],focus:['方案取舍','user@example.com']};
    assert.equal(store.save(users[0].user,[s],0),1);assert.equal(store.save(users[0].user,[],0),null);
    const req={headers:{cookie:`interview_session=${users[0].token}`}};
    assert.equal(store.state(store.user(req)).records.length,1);
    assert.equal(store.state(users[1].user).records.length,0);
    assert.notEqual(users[0].user.password,'test-pass-123');
    await assert.rejects(store.authenticate('test_user_0','wrong-pass',false,'ip-login'),/不正确/);
    for(let i=1;i<3;i++)store.save(users[i].user,[{...structuredClone(s),id:`s-${i}`}],0);
    users.forEach(u=>store.share(u.user,true));
    assert.deepEqual(store.sharedHints(),[{theme:'Redis',focus:'方案取舍'}]);
    store.share(users[0].user,false);assert.deepEqual(store.sharedHints(),[]);
    store.logout(req);assert.equal(store.user(req),null);
    assert.throws(()=>store.save(users[1].user,[{...s,turns:[null]}],1),/格式/);
  }finally{store.close();}
});

test('material extraction removes common identifiers before text leaves the server and filters output',async()=>{
  const result=await extractMaterials({text:'姓名：小明\nemail user@example.com\n电话：13812345678\nRedis缓存\npassword=demo-secret'},config,async(url,options)=>{
    const content=JSON.parse(options.body).messages[1].content[0].text;
    assert.ok(!content.includes('user@example.com'));assert.ok(!content.includes('13812345678'));assert.ok(!content.includes('小明'));assert.ok(!content.includes('demo-secret'));
    return reply({summary:'用户负责Redis缓存，电话：13812345678',tags:['Redis','小明']});
  });
  assert.deepEqual(result.tags,['Redis']);assert.ok(!result.summary.includes('13812345678'));
  await assert.rejects(extractMaterials({image:'data:image/svg+xml;base64,AA'},config),{status:400});
  assert.equal(redact('token=12345 user@example.com').includes('12345'),false);
});

test('AI selects only fixed memory vocabulary and sees personal context plus mode',async()=>{
  const s=createSession('job','Redis项目');s.practice='full';
  const next=await answerWithModel(s,'我使用Redis实现了缓存', {...config,personal:{tags:['Redis'],directions:['解释失效边界']},shared:[{theme:'Redis',focus:'适用边界'}]},async(url,options)=>{
    const input=JSON.parse(JSON.parse(options.body).messages[1].content);
    assert.equal(input.practice,'full');assert.deepEqual(input.personalPractice.directions,['解释失效边界']);assert.equal(input.relatedTechnicalThemes[0].theme,'Redis');
    return reply({action:'followup',question:'缓存失效时会发生什么？',reason:'澄清失效边界',evidence:[],memory:{tags:['Redis','13812345678'],focus:['适用边界','个人身份']}});
  });
  assert.deepEqual(next.turns[0].memory,{tags:['Redis'],focus:['适用边界']});assert.deepEqual(studyProfile([next]).focus,['适用边界']);
});

test('HTTP login cookie scopes persistence, blocks anonymous writes and detects conflicts',async t=>{
  const store=new Store(':memory:'),server=createServer(config,async()=>reply({}),store);
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{server.closeAllConnections();server.close();store.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(route,body,cookie)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
  assert.equal((await post('/api/records',{records:[],revision:0})).status,401);
  const response=await post('/api/auth/register',{name:'http_user',password:'test-pass-123'}),header=response.headers.get('set-cookie'),cookie=header.split(';')[0];
  assert.match(header,/HttpOnly/);assert.match(header,/SameSite=Strict/);assert.equal((await response.json()).user.name,'http_user');
  const s=createSession('job');assert.equal((await post('/api/records',{owner:'http_user',records:[s],revision:0},cookie)).status,200);
  assert.equal((await post('/api/records',{owner:'http_user',records:[],revision:0},cookie)).status,409);
  assert.equal((await post('/api/records',{owner:'other_user',records:[s],revision:1},cookie)).status,409);
  assert.equal((await post('/api/sharing',{owner:'other_user',enabled:true},cookie)).status,409);
  assert.equal((await post('/api/interview/answer',{owner:'other_user',session:s,answer:'我的回答'},cookie)).status,409);
  assert.equal((await(await fetch(base+'/api/account',{headers:{Cookie:cookie}})).json()).records.length,1);
  assert.deepEqual(await(await fetch(base+'/api/account')).json(),{user:null});
  assert.equal((await post('/api/auth/logout',{owner:'other_user'},cookie)).status,409);
  await post('/api/auth/logout',{owner:'http_user'},cookie);assert.deepEqual(await(await fetch(base+'/api/account',{headers:{Cookie:cookie}})).json(),{user:null});
});
