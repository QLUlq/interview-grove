import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { academicRanges, validAcademic } from '../public/academic.js';
import { startAcademicInterview, answerWithModel, validateSession } from '../model.mjs';
import { answerVerification, createVerification } from '../public/framework.js';
import { sessionNodes } from '../public/plan.js';
import { branchSession } from '../public/branch.js';
import { Store } from '../store.mjs';
import { createServer } from '../server.mjs';
const config={key:'test-only',base:'https://example.invalid',model:'test'};
const body=(range='cs408',runtime='demo',scope='')=>({academic:{major:'电子信息',range,scope},runtime,supplement:''});
const reply=raw=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(raw)}}]});
test('subject presets ask concrete questions across the selected range; skips complete all five',async()=>{
  for(const range of ['cs408','signals']) {
    let s=await startAcademicInterview(body(range),{},()=>assert.fail('demo must not call model'));
    assert.equal(validAcademic(s.academic),true);assert.equal(s.messages[0].text,s.academic.nodes[0].question);
    assert.deepEqual(sessionNodes(s).map(n=>n.label),academicRanges[range].areas);
    for(let i=0;i<5;i++) {s=answerVerification(s,'跳过');if(i<4)assert.ok(s.messages.at(-1).text.includes(s.academic.nodes[i+1].question));}
    assert.ok(s.completedAt);assert.equal(s.turns.length,5);
  }
});
test('custom scope reaches the planner; advances and skips use saved subject questions, branches retain scope',async()=>{
  const input=body('custom','ai','只练卷积，不考频域分析');
  const nodes=Array.from({length:5},(_,i)=>({label:`卷积练习${i+1}`,target:`理解卷积的第${i+1}个环节`,question:`关于卷积，你能解释第${i+1}种简单情形吗？`}));
  let s=await startAcademicInterview(input,config,async(url,options)=>{const p=JSON.parse(JSON.parse(options.body).messages[1].content);assert.equal(p.scope,input.academic.scope);assert.equal(p.major,'电子信息');assert.deepEqual(p.presetAreas,[]);return reply({nodes});});
  const source=structuredClone(s);
  s=await answerWithModel(s,'我理解卷积是在描述输入与系统响应的叠加。',config,async(url,options)=>{const p=JSON.parse(JSON.parse(options.body).messages[1].content);assert.equal(p.academicScope.scope,input.academic.scope);return reply({action:'advance',question:'',reason:'继续下一题',evidence:[]});});
  assert.equal(s.messages.at(-1).text,nodes[1].question);assert.deepEqual(source.turns,[]);
  const branch=branchSession(s,0,sessionNodes(s));assert.deepEqual(branch.academic,s.academic);validateSession(branch,'重新回答');
  s=await answerWithModel(s,'跳过',config,()=>assert.fail('skip must not call model'));assert.equal(s.messages.at(-1).text,nodes[2].question);
  const store=new Store(':memory:');try {const {user}=await store.authenticate('academic_test','test-only-password',true,'local');assert.equal(store.save(user,[s],0),1);assert.deepEqual(JSON.parse(store.db.prepare('SELECT records FROM users').get().records)[0].academic,s.academic);assert.throws(()=>store.save(user,[{...s,academic:{...s.academic,nodes:[]}}],1));}finally{store.close();}
});
test('invalid custom scopes fail without spending a model request; legacy knowledge-point records still work',async()=>{
  for(const input of [body('custom','ai',''),body('missing'),{...body(),academic:{...body().academic,major:''}},body('cs408','demo','只练操作系统')])await assert.rejects(startAcademicInterview(input,config,()=>assert.fail('invalid input must not call model')));
  const legacy=createVerification('academic','',{anchor:'TCP拥塞控制'});const next=answerVerification(legacy,'跳过');assert.equal(next.current,1);assert.equal(next.academic,undefined);assert.equal(sessionNodes(next)[1].id,'basis');
});
test('followup budget reserves all subjects and strips appended questions',async()=>{
  let s=await startAcademicInterview(body(),{}),calls=0;
  while(!s.completedAt) {
    s=await answerWithModel(s,'我还没有完全理解，想再从基础例子说起。',config,async(url,options)=>{
      const input=JSON.parse(JSON.parse(options.body).messages[1].content);calls++;
      return reply({action:input.allowedActions.includes('followup')?'followup':'advance',question:`你能解释第${calls}个简单例子吗？你准备怎样验证？`,reason:'澄清当前概念',evidence:[]});
    });
    if(s.followup)assert.equal((s.messages.at(-1).text.match(/？/g)||[]).length,1);
  }
  assert.equal(new Set(s.turns.map(t=>t.node)).size,5);assert.equal(s.turns.length,12);
});
test('academic start endpoint respects account and origin checks before planning',async t=>{
  const storage=new Store(':memory:'),server=createServer(config,()=>assert.fail('demo or rejection cannot call model'),storage);server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();storage.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(owner='guest',origin=base)=>fetch(base+'/api/interview/start',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({...body(),track:'academic',owner})});
  const r=await request();assert.equal(r.status,200);assert.equal((await r.json()).session.academic.range,'cs408');assert.equal((await request('other')).status,409);assert.equal((await request('guest','https://other.invalid')).status,403);
});
