import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ModelError } from './model-routing.mjs';
const script=fileURLToPath(new URL('./scripts/local-speech.ps1',import.meta.url));
export function validateSpeechAudio(base64) {
  if(typeof base64!=='string'||base64.length>2600000||!base64.length||base64.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))throw new ModelError('录音格式无效或超过60秒限制。',400);
  const b=Buffer.from(base64,'base64');
  if(b.length<46||b.toString('ascii',0,4)!=='RIFF'||b.readUInt32LE(4)!==b.length-8||b.toString('ascii',8,12)!=='WAVE'||b.toString('ascii',12,16)!=='fmt '||b.readUInt32LE(16)!==16||b.readUInt16LE(20)!==1||b.readUInt16LE(22)!==1||b.readUInt32LE(24)!==16000||b.readUInt32LE(28)!==32000||b.readUInt16LE(32)!==2||b.readUInt16LE(34)!==16||b.toString('ascii',36,40)!=='data'||b.readUInt32LE(40)!==b.length-44||(b.length-44)%2||(b.length-44)>1920000)throw new ModelError('请使用页面录音，音频须为60秒以内的单声道PCM WAV。',400);
  return b;
}
function execute(input,probe=false,signal) {
  return new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',script,...(probe?['-Probe']:[])],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let output='',done=false;
    const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);child.kill();error?reject(error):resolve(result);};
    const abort=()=>finish(new ModelError('语音识别已取消。',499));
    const timer=setTimeout(()=>finish(new ModelError('本机语音识别超时，文字草稿仍保留。',504)),probe?10000:45000);
    signal?.addEventListener('abort',abort,{once:true});
    child.on('error',()=>finish(new ModelError('本机语音识别暂不可用，可使用Win + H听写。',503)));
    child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{output+=chunk;if(output.length>100000)finish(new ModelError('语音识别结果过长，请分段录音。',502));});
    child.stderr.resume();child.stdin.on('error',()=>{});
    child.on('close',code=>{try{const result=JSON.parse(output.trim());if(code||result.error)throw Error();finish(null,result);}catch{finish(new ModelError('本机语音识别失败，可重试或使用Win + H听写。',503));}});
    if(signal?.aborted){abort();return;}child.stdin.end(input);
  });
}
export function createLocalSpeech({platform=process.platform,run=execute}={}) {
  let capability,busy=false;
  return {
    status(){return capability??=(platform==='win32'?run('',true).then(r=>({available:r.available===true,engine:'windows-offline',maxSeconds:60})).catch(()=>({available:false})):Promise.resolve({available:false}));},
    async transcribe(audio,signal){
      validateSpeechAudio(audio);
      if(!(await this.status()).available)throw new ModelError('本机没有可用的中文离线识别引擎，可使用系统听写。',503);
      if(busy)throw new ModelError('本机正在识别另一段录音，请稍后重试。',429);
      busy=true;
      try{const result=await run(audio,false,signal);if(typeof result.text!=='string'||result.text.length>10000)throw new ModelError('语音识别结果无效，请缩短录音。');return {text:result.text,engine:'windows-offline'};}
      finally{busy=false;}
    }
  };
}
