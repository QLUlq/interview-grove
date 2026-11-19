export function encodeVoiceWav(chunks,sampleRate) {
  const samples=new Float32Array(chunks.reduce((n,c)=>n+c.length,0));let offset=0;
  for(const chunk of chunks){samples.set(chunk,offset);offset+=chunk.length;}
  const length=Math.floor(samples.length*16000/sampleRate),buffer=new ArrayBuffer(44+length*2),view=new DataView(buffer);
  const ascii=(at,text)=>{for(let i=0;i<text.length;i++)view.setUint8(at+i,text.charCodeAt(i));};
  ascii(0,'RIFF');view.setUint32(4,36+length*2,true);ascii(8,'WAVE');ascii(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);ascii(36,'data');view.setUint32(40,length*2,true);
  for(let i=0;i<length;i++){
    const start=Math.floor(i*sampleRate/16000),end=Math.min(samples.length,Math.max(start+1,Math.floor((i+1)*sampleRate/16000)));
    let sum=0;for(let j=start;j<end;j++)sum+=samples[j];
    const value=Math.max(-1,Math.min(1,sum/(end-start)));view.setInt16(44+i*2,value<0?value*32768:value*32767,true);
  }return new Uint8Array(buffer);
}
export function createLocalDictation({view,owner,getValue,setValue,onState,isUsable,maxLength,append}) {
  let run=null;
  function release(current) {
    clearTimeout(current.timer);current.stream?.getTracks().forEach(t=>t.stop());current.node?.disconnect();current.source?.disconnect();current.context?.close().catch(()=>{});
  }
  function finish(current,text){if(run!==current)return;run=null;release(current);current.chunks=[];onState({phase:'idle',text});}
  const api={get active(){return !!run;},
    async start(){
      if(run||!isUsable())return;
      if(getValue().length>=maxLength){onState({phase:'idle',text:'回答已达到字数上限，请先编辑文字。'});return;}
      const current={chunks:[],frames:0,abort:new view.AbortController(),phase:'starting'};run=current;
      onState({phase:'starting',text:'正在开启麦克风，请允许录音；声音只在本机处理。'});
      current.timer=setTimeout(()=>api.cancel('麦克风启动超时，请检查权限或使用Win + H。'),15000);
      try{
        const stream=await view.navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}});
        if(run!==current||!isUsable()){stream.getTracks().forEach(t=>t.stop());if(run===current)api.cancel();return;}
        current.stream=stream;const context=new view.AudioContext();current.context=context;
        await context.audioWorklet.addModule('/voice-recorder-worklet.js');
        if(run!==current||!isUsable()){if(run===current)api.cancel();return;}
        current.node=new view.AudioWorkletNode(context,'voice-recorder',{channelCount:1,channelCountMode:'explicit'});
        current.node.port.onmessage=event=>{
          if(run!==current||current.phase!=='listening')return;
          const remaining=context.sampleRate*60-current.frames,chunk=event.data.slice(0,Math.max(0,remaining));
          if(chunk.length){current.chunks.push(chunk);current.frames+=chunk.length;}
          if(current.frames>=context.sampleRate*60)api.stop();
        };
        current.source=context.createMediaStreamSource(stream);current.source.connect(current.node);current.node.connect(context.destination);
        await context.resume();if(run!==current)return;
        clearTimeout(current.timer);current.phase='listening';current.timer=setTimeout(()=>api.stop(),60000);
        onState({phase:'listening',text:'正在本机录音（每段最多60秒），说完点击停止，再识别成文字。'});
      }catch(error){if(run===current)finish(current,error.name==='NotAllowedError'?'未获得麦克风权限，请检查浏览器和Windows的麦克风设置。':'无法开启麦克风，可使用Win + H听写；原草稿保留。');}
    },
    async stop(){
      const current=run;if(!current||current.phase==='stopping')return;
      if(current.phase==='starting'){api.cancel('录音已取消，已有草稿保留。');return;}
      current.phase='stopping';release(current);
      if(current.frames<1600){finish(current,'录音太短，请重新录制一句话；原草稿保留。');return;}
      onState({phase:'stopping',text:'录音已停止，正在本机识别，请稍候。'});
      const timeout=setTimeout(()=>current.abort.abort(),50000);
      try{
        const bytes=encodeVoiceWav(current.chunks,current.context.sampleRate);current.chunks=[];
        let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
        const response=await view.fetch('/api/voice/transcribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner,audio:view.btoa(binary)}),signal:current.abort.signal});
        const result=await response.json();if(!response.ok)throw Error(result.error||'本机识别未完成。');
        if(run!==current)return;if(!isUsable()){api.cancel();return;}
        if(!result.text?.trim()){finish(current,'没有识别出文字，请缩短录音并靠近麦克风重试，或使用Win + H。');return;}
        const added=append(getValue(),result.text,maxLength);setValue(added.value);
        finish(current,added.truncated?'识别文字已填入，达到字数上限；请核对并编辑。':'本机识别完成，请核对错字和技术词，确认后手动提交。');
      }catch(error){if(run===current)finish(current,error.name==='AbortError'?'本机识别已取消或超时，原草稿保留。':error.message+' 原草稿保留。');}
      finally{clearTimeout(timeout);}
    },
    cancel(note='录音与识别已停止，原草稿保留。'){const current=run;if(!current)return;current.abort.abort();finish(current,note);}
  };return api;
}
