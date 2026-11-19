import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createSession, answerSession, topics } from '../public/engine.js';
import { sessionContext, contextualNodes, respectsContext } from '../public/interview-context.js';
import { branchSession } from '../public/branch.js';
import { answerWithModel, summarizeSession, validateSummary, coachAnswer } from '../model.mjs';
import { mountSummary, summaryHTML, summaryText } from '../public/session-summary.js';
import { createServer } from '../server.mjs';
import { Store, studyProfile } from '../store.mjs';
const config={key:'test-placeholder',base:'https://example.invalid',model:'test'};
const reply=raw=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(raw)}}]});
const clarification='显示和输入主要参考了开源工程及课程驱动。我还没有能完整讲清的独立排查案例。可以围绕显示缓冲区如何刷新，考察我对代码的理解。';
const decision={action:'advance',question:'选一个显示缓冲区的刷新过程，说说数据怎样传到屏幕。',reason:'了解你对刚才提到的刷新过程的理解。',evidence:[]};
function fixture(){let s=answerSession(createSession('job','这是材料中的方案，不代表候选人的个人决策'),clarification);s=answerSession(s,'我没有做过系统的帧率和输入延迟测量，主要通过人工操作验证。');s.runtime='ai';s.completedAt=Date.now();return s;}
function summary(s){return {covered:[{text:'说明了参考已有驱动的经历',answerIndex:0,quote:'主要参考了开源工程及课程驱动'}],unverified:[{text:'本轮没有量化响应测试依据',answerIndex:1,quote:'没有做过系统的帧率和输入延迟测量'}],nextStep:{text:'画出显示刷新调用路径，逐个用代码核对函数与输入输出，再口述一次。',answerIndex:0,quote:'显示缓冲区如何刷新'}};}

test('clarifications persist from user answers, not source materials, interviewer claims or cached context',()=>{
  const s=fixture(),c=sessionContext(s);
  assert.equal(c.learningBased,true);assert.ok(c.facts.some(f=>f.kind==='noMetrics'));
  for(const fact of c.facts)assert.ok(s.turns[fact.answerIndex].text.includes(fact.quote));
  s.context={learningBased:false};s.messages.push({role:'assistant',text:'你已经独立完成所有选型'});
  assert.equal(sessionContext(s).learningBased,true);
  const clean=createSession('job','跟着视频做，没有自主选型');clean.context=c;
  assert.equal(sessionContext(clean).learningBased,false);
  assert.equal(sessionContext(createSession('job'),'我没有跟着视频做，而是独立实现').learningBased,false);
  assert.equal(sessionContext(createSession('job'),'主要参考了硬件手册，自己设计电路').learningBased,false);
  assert.equal(contextualNodes(topics.job.nodes,c,'job')[1].label,'理解与依据');
  assert.equal(contextualNodes(topics.academic.nodes,c,'academic'),topics.academic.nodes);
});

test('tutorial clarification changes next target and rejects the old attribution question before retry',async()=>{
  const s=createSession('job');let calls=0;
  const next=await answerWithModel(s,clarification,config,async(url,options)=>{
    const input=JSON.parse(JSON.parse(options.body).messages[1].content);
    assert.equal(input.userContext.learningBased,true);assert.match(input.nextTarget.target,/理解/);
    return reply(++calls===1?{...decision,question:'你选择了I2C OLED，当时为什么决定采用这套方案？'}:decision);
  });
  assert.equal(calls,2);assert.equal(next.current,1);assert.equal(next.messages.at(-1).text,decision.question);assert.equal(s.turns.length,0);
  assert.equal(next.context.learningBased,true);
  assert.equal(respectsContext('你怎么证明你的适配起到了关键作用？',next.context),false);
  assert.equal(respectsContext('如果让你选择另一种接口，会怎样考虑？',next.context),true);
  assert.equal(respectsContext('你为什么选择这个岗位？',next.context,'motivation'),true);
});

test('skip keeps learning-aware route; branch drops future boundaries and all summary state',async()=>{
  let s=await answerWithModel(createSession('job'),clarification,config,async()=>reply({...decision,action:'followup',question:'能说明一个模块的输入与输出吗？'}));
  s=await answerWithModel(s,'跳过',config,async()=>assert.fail('skip must not call model'));
  assert.match(s.messages.at(-1).text,/怎样工作/);s.summary={nextStep:{text:'未来建议'}};s.summaryError='old';
  const branch=branchSession(s,0,topics.job.nodes);
  assert.equal(branch.summary,undefined);assert.equal(branch.summaryError,undefined);assert.equal(branch.context.learningBased,false);
});

test('whole-session summary accepts only grounded citations and does not claim source code verification',async()=>{
  const s=fixture(),raw=summary(s);const original=structuredClone(s);
  const result=await summarizeSession(s,config,async(url,options)=>{
    const input=JSON.parse(JSON.parse(options.body).messages[1].content);
    assert.equal(input.answers.length,2);assert.equal(input.userContext.learningBased,true);assert.equal(input.background,undefined);return reply(raw);
  });
  assert.equal(result.version,1);assert.deepEqual(s,original);
  assert.throws(()=>validateSummary({...raw,nextStep:{...raw.nextStep,quote:'不在原话里的内容'}},s),/校验/);
  assert.throws(()=>validateSummary({...raw,nextStep:{...raw.nextStep,answerIndex:12}},s),/校验/);
  await assert.rejects(summarizeSession({...s,completedAt:null},config),{status:400});
  await assert.rejects(summarizeSession({...s,messages:s.messages.slice(0,1)},config),{status:400});
  const html=summaryHTML({...result,nextStep:{...result.nextStep,text:'<script>alert(1)</script>'}});assert.ok(!html.includes('<script>'));
  assert.match(summaryText(result),/下一次练习/);assert.match(summaryText(result),/依据：第1答/);
  assert.ok(studyProfile([{...s,summary:result}]).directions.includes(raw.nextStep.text));
});

test('summary repairs quote whitespace only within its cited answer',()=>{
  const s={turns:[{text:'我结合AI移植NWatch。'},{text:'我还没定位原因。'}]};
  const item={text:'说明项目来源',answerIndex:0,quote:'我结合 AI 移植 NWatch。'};
  const raw={covered:[item],unverified:[],nextStep:{...item,text:'用自己的话介绍项目来源'}};
  const result=validateSummary(raw,s);
  assert.equal(result.covered[0].quote,s.turns[0].text);
  assert.equal(result.nextStep.quote,s.turns[0].text);
  assert.notEqual(raw.covered[0].quote,s.turns[0].text);
  assert.throws(()=>validateSummary({...raw,covered:[{...item,answerIndex:1}]},s));
  assert.throws(()=>validateSummary({...raw,nextStep:{...item,quote:'我独立开发NWatch。'}},s));
  assert.throws(()=>validateSummary({...raw,nextStep:{...item,quote:'我结合AI移植NWatch！'}},s));
});

test('individual coaching receives later boundaries when reviewing an early overbroad claim',async()=>{
  const s=fixture();
  await coachAnswer(s,0,config,async(url,options)=>{
    const input=JSON.parse(JSON.parse(options.body).messages[1].content);assert.ok(input.userContext.facts.some(f=>f.kind==='noMetrics'));
    return reply({strengths:[],improvements:[],rewrite:clarification,missing:[],nextStep:'讲清一次刷新过程'});
  });
});

test('summary HTTP boundary rejects wrong account and unfinished sessions',async t=>{
  const s=fixture(),store=new Store(':memory:'),server=createServer(config,async()=>reply(summary(s)),store);server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{server.closeAllConnections();server.close();store.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(session,owner='guest',origin=base)=>fetch(base+'/api/interview/summary',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({session,owner})});
  assert.equal((await post(s)).status,200);assert.equal((await post({...s,completedAt:null})).status,400);assert.equal((await post(s,'other')).status,409);assert.equal((await post(s,'guest','https://other.invalid')).status,403);
});

test('summary generation survives leaving a report, deduplicates and caches the completed result',async t=>{
  const s=fixture();let calls=0,release,saves=0,busy=0;
  t.mock.method(globalThis,'fetch',async()=>{calls++;await new Promise(resolve=>release=resolve);return Response.json({summary:validateSummary(summary(s),s)});});
  const host=()=>({isConnected:true,innerHTML:'',querySelector:()=>assert.fail('no retry expected')});
  const options={owner:'guest',save:()=>saves++,onBusy:delta=>busy+=delta};
  const old=host();mountSummary(old,s,options);old.isConnected=false;
  const reopened=host();mountSummary(reopened,s,options);
  assert.equal(calls,1);assert.equal(busy,1);release();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(saves,1);assert.equal(busy,0);assert.match(reopened.innerHTML,/已经说明的内容/);
  mountSummary(host(),s,options);assert.equal(calls,1);
});

test('summary failure persists until explicit retry instead of repeating on every visit',async t=>{
  const s=fixture();let calls=0,retry,saves=0;
  t.mock.method(globalThis,'fetch',async()=>++calls===1?Response.json({error:'模型暂时繁忙'},{status:503}):Response.json({summary:validateSummary(summary(s),s)}));
  const host={isConnected:true,innerHTML:'',querySelector:()=>({addEventListener:(_,handler)=>retry=handler})};
  const options={owner:'retry-guest',save:()=>saves++,onBusy:()=>{}};
  mountSummary(host,s,options);await new Promise(resolve=>setImmediate(resolve));
  assert.match(s.summaryError,/繁忙/);mountSummary(host,s,options);assert.equal(calls,1);
  retry();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,2);assert.equal(s.summaryError,undefined);assert.ok(s.summary);assert.equal(saves,2);
});

test('account stores grounded summaries and rejects invalid answer citations',async()=>{
  const store=new Store(':memory:');try{
    const {user,token}=await store.authenticate('summary_user','test-pass-123',true,'summary-test');
    const s=fixture();s.summary=validateSummary(summary(s),s);store.save(user,[s],0);
    assert.deepEqual(store.state(store.user({headers:{cookie:`interview_session=${token}`}})).records[0].summary,s.summary);
    const invalid=structuredClone(s);invalid.summary.nextStep.quote='不存在的回答';
    assert.throws(()=>store.save(user,[invalid],1),/格式/);
  }finally{store.close();}
});
