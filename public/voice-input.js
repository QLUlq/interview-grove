import { createLocalDictation } from './local-voice.js';
const errors={
  'not-allowed':'未获得麦克风或语音识别权限，请在浏览器网站设置中检查权限。',
  'service-not-allowed':'浏览器未允许语音识别服务，可改用系统听写或键盘输入。',
  'audio-capture':'没有可用的麦克风，请检查设备连接和系统权限。',
  'network':'语音识别服务连接失败，可改用系统听写或键盘输入。',
  'no-speech':'没有识别到语音，可以重新开始。',
  'language-not-supported':'当前识别服务不支持中文，可改用系统听写。',
};
export function appendVoice(base,text,max=5000) {
  const combined=base+(base&&!/\s$/.test(base)?'\n':'')+text.trim();
  let value=combined.slice(0,max);
  if(/[\uD800-\uDBFF]$/.test(value))value=value.slice(0,-1);
  return {value,truncated:combined.length>max};
}
export function createDictation({Recognition,getValue,setValue,onState,isUsable=()=>true,maxLength=5000}) {
  let run=null;
  const status=(phase,text,interim='')=>onState({phase,text,interim});
  function finish(note,abort=false) {
    const previous=run;if(!previous)return;
    run=null;clearTimeout(previous.timer);
    if(abort)try{previous.recognition.abort();}catch{}
    status('idle',note);
  }
  const api={
    get active(){return !!run;},
    start(){
      if(run||!isUsable())return;
      if(getValue().length>=maxLength){status('idle','回答已达到字数上限，请先编辑文字。');return;}
      let recognition;try{recognition=new Recognition();}catch{status('idle','当前浏览器无法启动语音识别，可使用系统听写。');return;}
      const current={recognition,seen:new Set(),timer:null,stopping:false};run=current;
      const usable=()=>{if(run!==current)return false;if(!isUsable()){finish('语音输入已停止，已识别文字保留。',true);return false;}return true;};
      recognition.lang='zh-CN';recognition.continuous=true;recognition.interimResults=true;recognition.maxAlternatives=1;
      recognition.onstart=()=>{if(usable()&&!current.stopping){clearTimeout(current.timer);status('listening','正在听，请说出你的回答；说完后点击停止。');}};
      recognition.onresult=event=>{
        if(!usable())return;
        let interim='';
        for(let i=event.resultIndex;i<event.results.length;i++){
          const result=event.results[i],text=result[0]?.transcript||'';
          if(!result.isFinal){interim+=text;continue;}
          if(current.seen.has(i))continue;current.seen.add(i);
          if(!text.trim())continue;
          const appended=appendVoice(getValue(),text,maxLength);setValue(appended.value);
          if(appended.truncated||appended.value.length>=maxLength){finish('已达到字数上限，语音输入已停止；请检查文字。',true);return;}
        }
        status(current.stopping?'stopping':'listening',current.stopping?'正在结束识别，请稍候。':'正在听，识别文字会保存在草稿中。',interim);
      };
      recognition.onerror=event=>{if(run===current)finish((errors[event.error]||'语音识别已中断，可以重新开始。')+' 已识别文字保留。',true);};
      recognition.onend=()=>{if(run===current)finish('识别已结束，请核对技术词和英文缩写，再手动提交。');};
      status('starting','正在启动语音识别，请按浏览器提示允许使用麦克风。');
      current.timer=setTimeout(()=>{if(run===current)finish('语音识别启动超时，可重试或使用系统听写。',true);},15000);
      try{recognition.start();}catch{finish('语音识别启动失败，已有文字保留，可重试或使用系统听写。',true);}
    },
    stop(){
      if(!run||run.stopping)return;
      const current=run;current.stopping=true;clearTimeout(current.timer);
      status('stopping','正在结束识别，请稍候；检查文字后再提交。');
      current.timer=setTimeout(()=>{if(run===current)finish('识别已停止，已确认文字保留；请核对后提交。',true);},5000);
      try{current.recognition.stop();}catch{finish('识别已停止，请核对文字后提交。',true);}
    },
    cancel(note='语音输入已停止，已识别文字保留。'){finish(note,true);}
  };return api;
}

let active=null;
export async function mountVoiceInput(textarea) {
  if(!textarea||textarea.dataset.voiceMounted)return;
  textarea.dataset.voiceMounted='true';
  const doc=textarea.ownerDocument,view=doc.defaultView,Recognition=view.SpeechRecognition||view.webkitSpeechRecognition;
  const host=doc.createElement('div');host.className='voice-input';
  host.innerHTML='<div class="voice-controls"><button type="button" class="secondary-button" data-voice-toggle aria-pressed="false">语音输入</button><span class="field-note" data-voice-status role="status" aria-live="polite"></span></div><p class="voice-interim" data-voice-interim hidden></p><p class="field-note voice-note">中文识别；语音可能由浏览器在线服务处理。本应用只保存文字，不保存录音。停止后可编辑，确认后手动提交。<br>也可聚焦答题框使用系统听写（Windows：Win + H）。</p>';
  textarea.after(host);
  const button=host.querySelector('[data-voice-toggle]'),label=host.querySelector('[data-voice-status]'),interim=host.querySelector('[data-voice-interim]');
  button.disabled=true;label.textContent='正在检查本机语音识别…';
  let capability;try{const response=await view.fetch('/api/voice/status',{signal:view.AbortSignal.timeout(12000)});if(response.ok)capability=await response.json();}catch{}
  if(!textarea.isConnected)return;
  const local=capability?.available&&view.navigator.mediaDevices?.getUserMedia&&view.AudioContext&&view.AudioWorkletNode;
  if(!local&&!Recognition){button.disabled=true;label.textContent='当前环境没有可用的页面语音识别，可聚焦答题框按Win + H听写。';return;}
  if(local)host.querySelector('.voice-note').textContent='Windows中文离线识别：录音只在本机处理，不上传云端、不保存音频。每段最多60秒，停止后转成文字，可修改再手动提交。技术词可能识别有误；也可聚焦答题框按Win + H听写。';
  let writing=false;
  const options={Recognition,maxLength:textarea.maxLength>0?textarea.maxLength:5000,isUsable:()=>textarea.isConnected&&!textarea.disabled&&!doc.hidden,
    getValue:()=>textarea.value,setValue:value=>{writing=true;textarea.value=value;textarea.dispatchEvent(new view.Event('input',{bubbles:true}));writing=false;},
    onState:state=>{label.textContent=state.text;interim.textContent=state.interim?`正在识别（尚未保存）：${state.interim}`:'';interim.hidden=!state.interim;button.textContent=state.phase==='idle'?'语音输入':state.phase==='stopping'?'正在停止…':'停止语音输入';button.setAttribute('aria-pressed',String(state.phase!=='idle'));button.disabled=textarea.disabled||state.phase==='stopping';}
  };
  const controller=local?createLocalDictation({...options,view,owner:capability.owner,append:appendVoice}):createDictation(options);
  button.disabled=textarea.disabled;label.textContent=local?'已启用本机离线识别，点击录音，说完后停止。':'点击开始，说完后停止；识别结果可修改。';
  const edit=()=>{if(!writing)controller.cancel('已切换为文字编辑，语音输入已停止。');};
  const submit=event=>{if(controller.active){event.preventDefault();event.stopImmediatePropagation();controller.stop();}};
  const hide=()=>{if(doc.hidden)controller.cancel();},leave=()=>controller.cancel();
  button.addEventListener('click',()=>{if(controller.active)controller.stop();else{active?.cancel();active=controller;controller.start();}});
  textarea.addEventListener('input',edit);textarea.form?.addEventListener('submit',submit,true);
  doc.addEventListener('visibilitychange',hide);view.addEventListener('pagehide',leave);
  const form=textarea.form;
  const observer=new view.MutationObserver(()=>{
    if(!textarea.isConnected){controller.cancel();observer.disconnect();doc.removeEventListener('visibilitychange',hide);view.removeEventListener('pagehide',leave);form?.removeEventListener('submit',submit,true);if(active===controller)active=null;}
    else if(textarea.disabled){controller.cancel();if(!button.disabled)button.disabled=true;}
    else if(!controller.active&&button.disabled)button.disabled=false;
  });observer.observe(doc.body,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled']});
}
