import { reportModelUsage } from './model-client.js';
import { api } from './account.js';
import { collectProjectFiles } from './source-material.js';
import { escapeHTML as escape } from './html.js';
export function setupMaterials({toast}) {
  const form=document.querySelector('#setup-form'),resume=document.querySelector('#resume-file'),folder=document.querySelector('#project-folder'),button=document.querySelector('#extract-materials'),status=document.querySelector('#material-status'),preview=document.querySelector('#material-preview');
  let busy=false,material=null;
  const track=()=>form.querySelector('input[name=practice]:checked').value;
  function invalidate(){material=null;preview.innerHTML='';status.textContent=track()==='project'?(folder.files.length?`已选择 ${folder.files.length} 个文件，请读取项目`:'选择文件夹后，先读取材料'):(resume.files[0]?'已选择简历图片，请读取材料':'选择简历图片后，先读取材料');}
  resume.addEventListener('change',invalidate);folder.addEventListener('change',invalidate);
  document.querySelector('#responsible-module').addEventListener('input',invalidate);
  document.querySelector('#project-scope').addEventListener('change',invalidate);
  button.addEventListener('click',async()=>{
    if(busy)return;
    const kind=track(),imageFile=resume.files[0];
    if(kind==='project'&&!folder.files.length){status.textContent='请先选择项目源代码文件夹';return;}
    if(kind==='resume'&&(!imageFile||!['image/png','image/jpeg','image/webp'].includes(imageFile.type)||imageFile.size>4*1024*1024)){status.textContent='请选择4MB以内的PNG、JPEG或WebP简历图片';return;}
    busy=true;material=null;preview.innerHTML='';button.disabled=true;form.querySelector('[type=submit]').disabled=true;
    const controls=[...form.querySelectorAll('input,select,textarea')].map(el=>[el,el.disabled]);controls.forEach(([el])=>el.disabled=true);
    status.textContent=kind==='project'?'正在阅读过滤后的代码，建立模块与文件索引…':'正在逐项识别简历项目、实习和技能…';
    try{
      let payload;
      if(kind==='project')payload={kind,...await collectProjectFiles([...folder.files],document.querySelector('#project-scope').value==='module'?document.querySelector('#responsible-module').value:'')};
      else payload={kind,image:await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('图片读取失败'));reader.readAsDataURL(imageFile);})};
      const result=await api('/api/materials',payload);reportModelUsage(result);material=result.material;
      const c=material.coverage;
      status.textContent=kind==='project'?`已读 ${c.included} / ${c.readable} 个可读文件，${c.clipped} 个使用片段，${c.excluded} 个已过滤${c.omitted?`，${c.omitted} 个未读`:''}。识别 ${material.sections.length} 个考察项`:`已识别 ${material.sections.length} 项经历与技能，请核对识别内容`;
      preview.innerHTML=`<details open><summary>查看已读内容与考察点</summary><p>${escape(material.summary)}</p><ul>${material.sections.map(s=>`<li><strong>${escape(s.title)}</strong><p>${escape(s.detail)}</p><small>${s.refs.map(r=>escape(material.sources.find(f=>f.id===r.sourceId)?.path)).join(' · ')}</small></li>`).join('')}</ul><p class="field-note">${kind==='project'?'主问题从项目功能和实现流程展开，代码片段作为核对依据按需查看。片段省略和未读取的文件不代表已经完整审阅。':'图片识别可能有误，请在下方补充里纠正经历归属或识别错误；原图片不会保存。'}</p></details>`;
      toast('材料已读取，请确认范围后开始练习');
    }catch(error){status.textContent=error.name==='TimeoutError'?'材料读取超时，文件已保留，可以重试':error.message;}
    finally{busy=false;button.disabled=false;form.querySelector('[type=submit]').disabled=false;controls.forEach(([el,disabled])=>el.disabled=disabled);}
  });
  return {get busy(){return busy;},get material(){return material;},invalidate,reset(){resume.value='';folder.value='';invalidate();}};
}
