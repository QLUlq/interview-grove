import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { encodeVoiceWav, createLocalDictation } from '../public/local-voice.js';
import { appendVoice } from '../public/voice-input.js';
import { createLocalSpeech, validateSpeechAudio } from '../local-speech.mjs';
import { createServer } from '../server.mjs';
import { Store } from '../store.mjs';
const audio=()=>Buffer.from(encodeVoiceWav([new Float32Array(16000)],16000)).toString('base64');
test('recording encoder produces bounded mono PCM WAV and rejects malformed or overlong uploads',()=>{
  const wav=encodeVoiceWav([new Float32Array(24000),new Float32Array(24000)],48000);
  assert.equal(wav.length,32044);assert.equal(validateSpeechAudio(Buffer.from(wav).toString('base64')).length,32044);
  for(const invalid of ['', 'bad','file:///secret',Buffer.from('not wav').toString('base64'),audio().slice(0,-4)])assert.throws(()=>validateSpeechAudio(invalid));
  const bad=Buffer.from(wav);bad.writeUInt16LE(2,22);assert.throws(()=>validateSpeechAudio(bad.toString('base64')));
  const long=encodeVoiceWav([new Float32Array(16000*61)],16000);assert.throws(()=>validateSpeechAudio(Buffer.from(long).toString('base64')));
});
test('offline recognizer caches capability, limits concurrency and recovers after failure',async()=>{
  let release,calls=0;
  const speech=createLocalSpeech({platform:'win32',run:async(input,probe)=>{calls++;if(probe)return {available:true};await new Promise(r=>release=r);throw Error('test failure');}});
  await Promise.all([speech.status(),speech.status()]);assert.equal(calls,1);
  const first=speech.transcribe(audio());await new Promise(r=>setImmediate(r));
  await assert.rejects(speech.transcribe(audio()),{status:429});release();await assert.rejects(first);
  const retry=speech.transcribe(audio());await new Promise(r=>setImmediate(r));release();await assert.rejects(retry);
  assert.equal((await createLocalSpeech({platform:'linux',run:()=>assert.fail()}).status()).available,false);
});
test('voice endpoint enforces owner and origin before passing audio to offline recognition',async t=>{
  let calls=0;const store=new Store(':memory:');const speech={status:async()=>({available:true}),transcribe:async()=>{calls++;return {text:'本机识别文字'};}};
  const server=createServer({},()=>assert.fail('No model calls'),store,speech);server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();store.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const status=await fetch(base+'/api/voice/status').then(r=>r.json());assert.equal(status.owner,'guest');
  const post=(owner,origin=base)=>fetch(base+'/api/voice/transcribe',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({owner,audio:audio()})});
  assert.equal((await post('someone-else')).status,409);assert.equal((await post('guest','https://foreign.invalid')).status,403);assert.equal(calls,0);
  assert.equal((await post('guest')).status,200);assert.equal(calls,1);
});
function recorderFixture({deferMicrophone=false,deferRecognition=false}={}) {
  let microphone,recognition,node,value='已有草稿';const states=[];const track={stop(){this.stopped=true;}};
  class Context {
    sampleRate=16000;audioWorklet={addModule:async()=>{}};
    createMediaStreamSource(){return {connect(){},disconnect(){}};}
    async resume(){}async close(){}
  }
  class Worklet{constructor(){node=this;this.port={};}connect(){}disconnect(){}}
  const stream={getTracks:()=>[track]};
  const view={AbortController,AudioContext:Context,AudioWorkletNode:Worklet,navigator:{mediaDevices:{getUserMedia:()=>deferMicrophone?new Promise(r=>microphone=r):Promise.resolve(stream)}},btoa:s=>Buffer.from(s,'binary').toString('base64'),fetch:async(path,options)=>{
    assert.equal(path,'/api/voice/transcribe');assert.equal(JSON.parse(options.body).owner,'qa');validateSpeechAudio(JSON.parse(options.body).audio);
    if(deferRecognition)await new Promise(r=>recognition=r);
    return Response.json({text:'本机识别文字'});
  }};
  const controller=createLocalDictation({view,owner:'qa',getValue:()=>value,setValue:s=>value=s,onState:s=>states.push(s),isUsable:()=>true,maxLength:5000,append:appendVoice});
  return {controller,states,track,get value(){return value;},audio(){node.port.onmessage({data:new Float32Array(16000)});},releaseMicrophone(){microphone(stream);},releaseRecognition(){recognition();}};
}
test('offline recording releases microphone before transcription and appends only after explicit stop',async()=>{
  const f=recorderFixture();await f.controller.start();f.audio();assert.equal(f.value,'已有草稿');assert.equal(f.track.stopped,undefined);
  await f.controller.stop();assert.equal(f.track.stopped,true);assert.equal(f.value,'已有草稿\n本机识别文字');assert.equal(f.controller.active,false);
});
test('late microphone permission and recognition responses cannot write into cancelled answers',async()=>{
  const f=recorderFixture({deferMicrophone:true});const starting=f.controller.start();f.controller.cancel();f.releaseMicrophone();await starting;assert.equal(f.track.stopped,true);assert.equal(f.value,'已有草稿');
  const g=recorderFixture({deferRecognition:true});await g.controller.start();g.audio();const stopping=g.controller.stop();g.controller.cancel();g.releaseRecognition();await stopping;assert.equal(g.value,'已有草稿');assert.equal(g.track.stopped,true);
});
