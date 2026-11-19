import test from 'node:test';
import assert from 'node:assert/strict';
import { appendVoice, createDictation } from '../public/voice-input.js';

function fixture(value='已有草稿') {
  let recognition,usable=true;const states=[],writes=[];
  class Recognition {
    constructor(){recognition=this;}
    start(){this.onstart();}
    stop(){this.stopped=true;}
    abort(){this.aborted=true;}
  }
  const controller=createDictation({Recognition,getValue:()=>value,setValue:text=>{value=text;writes.push(text);},onState:state=>states.push(state),isUsable:()=>usable});
  const result=(text,final=true)=>Object.assign([{transcript:text}],{isFinal:final});
  return {controller,states,writes,result,get recognition(){return recognition;},get value(){return value;},disable(){usable=false;}};
}
test('dictation appends final text to drafts once and keeps interim recognition separate',()=>{
  const f=fixture();f.controller.start();assert.equal(f.recognition.lang,'zh-CN');
  f.recognition.onresult({resultIndex:0,results:[f.result('临时内容',false)]});assert.equal(f.value,'已有草稿');assert.equal(f.states.at(-1).interim,'临时内容');
  f.recognition.onresult({resultIndex:0,results:[f.result('进程拥有资源。')]});
  f.recognition.onresult({resultIndex:0,results:[f.result('进程拥有资源。'),f.result('线程共享地址空间。')]});
  assert.equal(f.value,'已有草稿\n进程拥有资源。\n线程共享地址空间。');assert.equal(f.writes.length,2);
  f.controller.stop();assert.equal(f.controller.active,true);assert.equal(f.recognition.stopped,true);
  f.recognition.onresult({resultIndex:2,results:[f.result('ignored'),f.result('ignored'),f.result('停止后的最后一句。')]});
  f.recognition.onend();assert.equal(f.controller.active,false);assert.ok(f.value.endsWith('停止后的最后一句。'));
});
test('cancelling on edits or navigation prevents late results from changing any draft',()=>{
  const f=fixture();f.controller.start();const old=f.recognition;
  f.controller.cancel();old.onresult({resultIndex:0,results:[f.result('过期识别')]});assert.equal(f.value,'已有草稿');assert.equal(old.aborted,true);
  f.controller.start();old.onend();assert.equal(f.controller.active,true);
  f.disable();f.recognition.onresult({resultIndex:0,results:[f.result('其他账号的迟到结果')]});assert.equal(f.value,'已有草稿');assert.equal(f.controller.active,false);
});
test('permissions and network failures retain confirmed text and allow explicit retry',()=>{
  const f=fixture();
  for(const error of ['not-allowed','network','audio-capture','no-speech']){
    f.controller.start();f.recognition.onerror({error});assert.equal(f.controller.active,false);assert.equal(f.value,'已有草稿');assert.match(f.states.at(-1).text,/保留/);
  }
  f.controller.start();f.recognition.onend();assert.equal(f.controller.active,false);
});
test('voice text respects answer limits without splitting emoji and stops recognition at the limit',()=>{
  assert.deepEqual(appendVoice('ab','😀',4),{value:'ab\n',truncated:true});
  const f=fixture('x'.repeat(4998));f.controller.start();f.recognition.onresult({resultIndex:0,results:[f.result('输入长度超过上限')]});
  assert.equal(f.value.length,5000);assert.equal(f.controller.active,false);assert.equal(f.recognition.aborted,true);
  f.controller.start();assert.equal(f.controller.active,false);assert.match(f.states.at(-1).text,/上限/);
});
test('recognition constructor and synchronous start failures are recoverable',()=>{
  for(const Recognition of [class{constructor(){throw Error('unsupported');}},class{start(){throw Error('denied');}abort(){}}]){
    const states=[];const c=createDictation({Recognition,getValue:()=>'',setValue:()=>assert.fail(),onState:s=>states.push(s)});
    c.start();assert.equal(c.active,false);assert.match(states.at(-1).text,/失败|无法/);
  }
});
test('a delayed start event cannot reopen a microphone session that is stopping',()=>{
  let recognition;const states=[];
  class Recognition{constructor(){recognition=this;}start(){}stop(){}abort(){}}
  const c=createDictation({Recognition,getValue:()=>'',setValue:()=>{},onState:s=>states.push(s)});
  c.start();c.stop();recognition.onstart();assert.equal(states.at(-1).phase,'stopping');recognition.onend();assert.equal(c.active,false);
});
