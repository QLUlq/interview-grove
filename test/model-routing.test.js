import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { beginModelRequest, routingStatus, requestModelJSON } from '../model-routing.mjs';
import { modelConfig, answerWithModel } from '../model.mjs';
import { createVerification } from '../public/framework.js';
import { createServer } from '../server.mjs';
import { Store } from '../store.mjs';
const config=()=>({key:'test-key',base:'https://dashscope.aliyuncs.com/compatible-mode/v1',model:'qwen3.5-plus-2026-02-15',fallbackModels:['qwen-max'],visionModels:['qwen3.5-plus-2026-02-15']});
const reply=value=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]});
const quota=()=>Response.json({error:{code:'AllocationQuota.FreeTierOnly',message:'private-provider-details'}},{status:403});
const messages=[{role:'user',content:'Return JSON.'}];
const decision={action:'followup',question:'可以解释一个具体的处理环节吗？',reason:'了解实现过程',evidence:[]};

test('quota exhaustion switches once and later requests skip the exhausted model',async()=>{
  const base=config(), calls=[];
  const fetcher=async(_,options)=>{
    const body=JSON.parse(options.body);calls.push(body);
    if(body.model===base.model){assert.equal(body.enable_thinking,false);return quota();}
    assert.equal(body.enable_thinking,undefined);return reply({ok:true});
  };
  const first=beginModelRequest(base);
  assert.deepEqual(await requestModelJSON(first,messages,fetcher,v=>v),{ok:true});
  assert.equal(first.usage.model,'qwen-max');assert.equal(first.usage.switchedFrom,base.model);
  const second=beginModelRequest(base);await requestModelJSON(second,messages,fetcher,v=>v);
  assert.deepEqual(calls.map(c=>c.model),[base.model,'qwen-max','qwen-max']);
  assert.equal(second.usage.switchedFrom,undefined);assert.equal(routingStatus(base).model,'qwen-max');
  assert.ok(!JSON.stringify(routingStatus(base)).includes('test-key'));
});

test('all exhausted models stop with a useful message and leave the original answer untouched',async()=>{
  const base=config(), s=createVerification('job'), snapshot=structuredClone(s);let calls=0;
  await assert.rejects(answerWithModel(s,'我还不清楚具体流程',base,async()=>{calls++;return quota();}),/免费额度不足/);
  assert.equal(calls,2);assert.deepEqual(s,snapshot);
  await assert.rejects(answerWithModel(s,'我还不清楚具体流程',base,async()=>assert.fail('exhausted models must be skipped')),/免费额度不足/);
});

test('keys, generic access denial, arrears, missing models and ordinary rate limits do not rotate the free pool',async()=>{
  for(const [status,code,expected] of [[401,'invalid_api_key',1],[403,'Arrearage',1],[403,'AccessDenied',1],[404,'ModelNotFound',1],[429,'Throttling.RateQuota',2]]){
    const base=config(), calls=[];
    await assert.rejects(requestModelJSON(beginModelRequest(base),messages,async(_,options)=>{calls.push(JSON.parse(options.body).model);return Response.json({error:{code,message:'private-details'}},{status});},v=>v),e=>!e.message.includes('private-details'));
    assert.equal(calls.length,expected);assert.ok(calls.every(m=>m===base.model));assert.deepEqual(routingStatus(base).exhausted,[]);
  }
});

test('vision requests use their own allowlist and cannot fall back to a text-only model',async()=>{
  const base=config();base.visionModels=['vision-one','vision-two'];
  const image=[{role:'user',content:[{type:'text',text:'Return JSON'},{type:'image_url',image_url:{url:'data:image/png;base64,AA=='}}]}];
  const calls=[];await requestModelJSON(beginModelRequest(base),image,async(_,options)=>{const m=JSON.parse(options.body).model;calls.push(m);return m==='vision-one'?quota():reply({ok:true});},v=>v);
  assert.deepEqual(calls,['vision-one','vision-two']);
  await requestModelJSON(beginModelRequest(base),messages,async(_,options)=>{assert.equal(JSON.parse(options.body).model,base.model);return reply({ok:true});},v=>v);
});

test('a switched answer and HTTP status identify the model that actually answered',async t=>{
  const base=config(), store=new Store(':memory:');
  const server=createServer(base,async(_,options)=>JSON.parse(options.body).model===base.model?quota():reply(decision),store);
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();store.close();});
  const url=`http://127.0.0.1:${server.address().port}`;
  const response=await fetch(url+'/api/interview/answer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session:createVerification('job'),answer:'我还不清楚具体流程'})});
  assert.equal(response.status,200);const result=await response.json();
  assert.equal(result.session.model,'qwen-max');assert.equal(result.session.turns.length,1);assert.equal(result.modelUsage.switchedFrom,base.model);
  const status=await(await fetch(url+'/api/model/status')).json();assert.equal(status.model,'qwen-max');assert.ok(!JSON.stringify(status).includes(base.key));
});

test('concurrent text and image requests retain independent model attribution',async()=>{
  const base=config();base.visionModels=['vision-only'];let release;
  const first=beginModelRequest(base), second=beginModelRequest(base);
  const running=requestModelJSON(first,messages,async()=>{await new Promise(resolve=>release=resolve);return reply({ok:1});},v=>v);
  await requestModelJSON(second,[{role:'user',content:[{type:'image_url',image_url:{url:'data:image/png;base64,AA=='}}]}],async()=>reply({ok:2}),v=>v);
  release();await running;assert.equal(first.usage.model,base.model);assert.equal(second.usage.model,'vision-only');
});

test('model configuration deduplicates explicit candidates and does not discover or assume free balances',()=>{
  const c=modelConfig({INTERVIEW_MODEL:'primary',INTERVIEW_FALLBACK_MODELS:'primary,backup backup,third',INTERVIEW_VISION_MODELS:'vision'});
  assert.deepEqual(c.fallbackModels,['backup','third']);assert.deepEqual(c.visionModels,['vision']);
});
