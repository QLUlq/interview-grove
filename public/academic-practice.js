import { academicRanges } from './academic.js';
import { academicReviewTasks } from './practice.js';
import { createStudy, submitStudy, studyResult, rateStudy, oralRatings } from './study.js';
import { mountStudyReview } from './study-review.js';
import { mountVoiceInput } from './voice-input.js';
import { reportModelUsage } from './model-client.js';
import { escapeHTML as escape } from './html.js';
const pending=new Set();
export function mountAcademicPractice(host,{getRecords,getOwner,saveRecords,onBusy,onOpen,onReanswer,onSource,renderWorkspace,selection,resultId,drillId,modelAvailable,toast}) {
  const owner=getOwner(),records=getRecords(),tasks=academicReviewTasks(records),groups=records.filter(s=>s.drill);
  const selected=tasks.find(t=>t.session.id===selection?.id&&t.index===selection?.index),result=records.find(s=>s.id===resultId&&s.practiceTask);
  const drill=groups.find(s=>s.id===drillId);
  host.innerHTML=`<section class="intro"><div><span class="eyebrow">ACADEMIC PRACTICE</span><h1>把复试题，再练一遍</h1><p>重答历史题，或按科目补充专项题。作答记录与草稿保存在当前账号；练过不等于已经掌握。</p></div></section><div id="practice-workspace"></div><section class="study-review" id="study-review"></section><section class="study-generator"><h2>按范围新增专项题</h2><form id="study-generate"><label for="study-major">报考专业</label><input id="study-major" maxlength="120" required placeholder="例如：计算机技术、电子信息"><label for="study-range">练习范围</label><select id="study-range">${Object.entries(academicRanges).map(([id,r])=>`<option value="${id}">${escape(r.label)}</option>`).join('')}</select><label for="study-scope">限定科目或章节（自定义时必填）</label><textarea id="study-scope" maxlength="2000" rows="2" placeholder="例如：只练操作系统的进程与死锁；只练卷积"></textarea><div class="study-form-row"><div><label for="study-kind">题型</label><select id="study-kind"><option value="oral">口头问答</option><option value="choice">单项选择</option></select></div><div><label for="study-count">题量</label><select id="study-count"><option value="3">3题</option><option value="5">5题</option></select></div></div><p class="field-note">按需调用AI生成新题，尽量避开当前账号已有题目；不代表院校真题。提交作答后才展示参考答案。</p><button class="primary-button" type="submit" ${!modelAvailable||pending.has(owner)?'disabled':''}>${pending.has(owner)?'正在生成…':'生成一组新题 ↗'}</button><p class="field-note" data-study-error role="alert">${!modelAvailable?'配置模型后可生成新题；历史题仍可重答。':''}</p></form></section><section><div class="section-heading"><h2>我的专项题组（${groups.length}）</h2></div><div class="study-groups">${groups.map(s=>`<button class="secondary-button" data-study-open="${escape(s.id)}">${escape(s.anchor)} · ${s.drill.questions[0].kind==='choice'?'选择题':'口头题'} · 已练 ${new Set(s.drill.attempts.map(a=>a.questionId)).size}/${s.drill.questions.length} 题${s.drill.source?' · 来自历史题':''}</button>`).join('')||'<p class="muted">题目不够时，可以按上方范围新增题组。</p>'}</div></section><section><div class="section-heading"><h2>复试历史题（${tasks.length}）</h2><span class="muted">全部遇到过的题目，不限于待改进题</span></div><div class="personal-tasks">${tasks.map((t,i)=>`<article class="personal-task"><div class="task-content"><span class="eyebrow">${escape(t.session.anchor||'旧版复试')} · 已重答 ${t.attempts.length} 次</span><h3>${escape(t.question)}</h3><details><summary>查看原回答</summary><p class="practice-quote">${escape(t.answer)}</p></details><div class="report-actions"><button class="primary-button" data-academic-redo="${i}">重答这一题 ↗</button><button class="secondary-button" data-study-convert="${i}" ${!modelAvailable||pending.has(owner)?'disabled':''}>生成一道选择题</button><button class="text-button" data-academic-source="${i}">查看来源</button></div></div></article>`).join('')||'<p class="muted">还没有复试历史题，可以先完成一次复试练习，或直接生成专项题。</p>'}</div></section>`;
  const latest=records.find(s=>s.academic)?.academic||groups[0]?.drill.settings;
  if(latest){host.querySelector('#study-major').value=latest.major;host.querySelector('#study-range').value=latest.range;host.querySelector('#study-scope').value=latest.scope;}
  const updateScope=()=>host.querySelector('#study-scope').required=host.querySelector('#study-range').value==='custom';updateScope();host.querySelector('#study-range').addEventListener('change',updateScope);
  const workspace=host.querySelector('#practice-workspace');
  const refreshReview=mountStudyReview(host.querySelector('#study-review'),{getRecords,onRetry:(id,questionId)=>{
    const current=getRecords().find(r=>r.id===id);
    if(!Object.hasOwn(current.drill.drafts,questionId))current.drill.drafts[questionId]=current.drill.questions.find(q=>q.id===questionId).kind==='choice'?-1:'';
    saveRecords(getRecords());paintDrill(workspace,current,questionId);workspace.scrollIntoView({block:'start'});
  }});
  if(result||selected)renderWorkspace(workspace,selected,result);
  else if(drill)paintDrill(workspace,drill);
  async function generate(payload) {
    if(pending.has(owner))return;
    pending.add(owner);onBusy(1);
    const controls=[...host.querySelectorAll('#study-generate input,#study-generate select,#study-generate textarea,#study-generate button,[data-study-convert]')].map(el=>[el,el.disabled]);controls.forEach(([el])=>el.disabled=true);
    const error=host.querySelector('[data-study-error]');error.textContent='正在生成题目，请稍候；已有回答和草稿仍保留。';
    try {
      const response=await fetch('/api/academic/questions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,owner}),signal:AbortSignal.timeout(55000)});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'生成未完成，请重试');reportModelUsage(data);
      if(getOwner()!==owner)throw new Error('账号已切换，未向当前账号写入题目');
      const s=createStudy(data.settings,data.questions,payload.source);s.model=data.modelUsage?.model||null;pending.delete(owner);saveRecords([s,...getRecords()]);onOpen(s.id);toast('专项题已添加，选择一题开始作答');
    }catch(e){error.textContent=e.name==='TimeoutError'?'生成超时，范围和原记录保留，可以重试。':e.message;}
    finally{pending.delete(owner);onBusy(-1);controls.forEach(([el,disabled])=>el.disabled=disabled);}
  }
  host.querySelector('#study-generate').addEventListener('submit',e=>{e.preventDefault();generate({academic:{major:host.querySelector('#study-major').value.trim(),range:host.querySelector('#study-range').value,scope:host.querySelector('#study-scope').value.trim()},kind:host.querySelector('#study-kind').value,count:Number(host.querySelector('#study-count').value)});});
  host.querySelectorAll('[data-study-convert]').forEach(b=>b.addEventListener('click',()=>{
    const t=tasks[Number(b.dataset.studyConvert)],source={sessionId:t.session.id,index:t.index};
    const saved=getRecords().find(s=>s.drill?.source?.sessionId===source.sessionId&&s.drill.source.index===source.index&&s.drill.questions[0].kind==='choice');
    if(saved){onOpen(saved.id);return;}
    generate({academic:t.session.academic||{major:'专业基础复习',range:'custom',scope:t.session.anchor||t.node.label},kind:'choice',source});
  }));
  host.querySelectorAll('[data-study-open]').forEach(b=>b.addEventListener('click',()=>onOpen(b.dataset.studyOpen)));
  host.querySelectorAll('[data-academic-redo]').forEach(b=>b.addEventListener('click',()=>{const t=tasks[Number(b.dataset.academicRedo)];onReanswer(t.session.id,t.index);}));
  host.querySelectorAll('[data-academic-source]').forEach(b=>b.addEventListener('click',()=>onSource(tasks[Number(b.dataset.academicSource)].session.id)));
  function paintDrill(target,s,onlyId=null) {
    target.innerHTML=`<section class="practice-editor"><span class="eyebrow">专项刷题 · ${escape(s.anchor)}</span><h2>${escape(s.drill.settings.scope||academicRanges[s.drill.settings.range].label)}</h2><p class="field-note">提交后可看AI参考答案。选择题按参考答案判断；口头题请自行对照要点，不自动判分或判定掌握。</p>${s.drill.questions.filter(q=>!onlyId||q.id===onlyId).map(q=>{
      const last=s.drill.attempts.filter(a=>a.questionId===q.id).at(-1),editing=Object.hasOwn(s.drill.drafts,q.id)||!last,answer=s.drill.drafts[q.id];
      const result=last?studyResult(q,last):null;
      return `<article class="study-question" data-question-id="${escape(q.id)}"><span class="eyebrow">${escape(q.topic)} · ${q.kind==='choice'?'单项选择':'口头问答'} · 已作答 ${s.drill.attempts.filter(a=>a.questionId===q.id).length} 次</span><h3>${escape(q.stem)}</h3>${editing?`<form data-study-answer="${escape(q.id)}">${q.kind==='choice'?q.options.map((option,i)=>`<label class="study-option"><input type="radio" name="answer" value="${i}" ${answer===i?'checked':''} required><span>${'ABCD'[i]}. ${escape(option)}</span></label>`).join(''):`<textarea name="answer" rows="5" maxlength="5000" required placeholder="先用自己的话回答，再看参考要点">${escape(answer||'')}</textarea>`}<button class="primary-button" type="submit">提交并查看参考</button><p class="field-note" role="alert"></p></form>`:`<div class="study-result"><p>你的作答：${escape(q.kind==='choice'?`${'ABCD'[last.answer]}. ${q.options[last.answer]}`:last.answer)}</p>${q.kind==='choice'?`<p>${result.correct?'本次与参考答案一致':'本次与参考答案不一致'} · 参考答案：${'ABCD'[q.correctIndex]}. ${escape(result.answer)}</p><p>${escape(result.explanation)}</p>`:`<h4>参考要点</h4><p>${escape(result.reference)}</p>`}<small>参考内容由AI生成，有疑问时对照教材核实；本次作答不等于已经掌握。</small></div><button class="text-button" data-study-again="${escape(q.id)}">隐藏答案再做一次</button>${q.kind==='oral'?`<fieldset class="study-rating"><legend>你觉得这次理解得怎么样？</legend>${Object.entries(oralRatings).map(([value,label])=>`<button type="button" class="secondary-button" data-study-rating="${value}" data-question="${escape(q.id)}" aria-pressed="${last.selfRating===value}">${label}</button>`).join('')}</fieldset>`:''}<details class="study-attempts"><summary>历次作答（${s.drill.attempts.filter(a=>a.questionId===q.id).length}次）</summary>${s.drill.attempts.filter(a=>a.questionId===q.id).map((a,i)=>`<div><p>第 ${i+1} 次 · ${escape(new Date(a.at).toLocaleString('zh-CN'))}${q.kind==='oral'?` · 自评：${oralRatings[a.selfRating]||'尚未标记'}`:` · ${a.answer===q.correctIndex?'与参考一致':'与参考不一致'}`}</p><p class="practice-quote">${escape(q.kind==='choice'?`${'ABCD'[a.answer]}. ${q.options[a.answer]}`:a.answer)}</p></div>`).join('')}</details>`}</article>`;
    }).join('')}</section>`;
    if(s.model)target.querySelector('.practice-editor > .field-note').insertAdjacentHTML('afterend',`<p class="field-note">本题组生成模型：${escape(s.model)}</p>`);
    target.querySelectorAll('[data-study-answer]').forEach(form=>{
      form.addEventListener('input',()=>{const current=getRecords().find(r=>r.id===s.id),q=current.drill.questions.find(q=>q.id===form.dataset.studyAnswer);current.drill.drafts[q.id]=q.kind==='choice'?Number(new FormData(form).get('answer')):form.elements.answer.value;saveRecords(getRecords());});
      mountVoiceInput(form.querySelector('textarea'));
      form.addEventListener('submit',e=>{e.preventDefault();try{const current=getRecords().find(r=>r.id===s.id),q=current.drill.questions.find(q=>q.id===form.dataset.studyAnswer),raw=new FormData(form).get('answer');const updated=submitStudy(current,q.id,q.kind==='choice'?(raw===null?-1:Number(raw)):raw);saveRecords(getRecords().map(r=>r.id===s.id?updated:r));paintDrill(target,updated,onlyId);refreshReview();}catch(error){form.querySelector('[role=alert]').textContent=error.message;}});
    });
    target.querySelectorAll('[data-study-rating]').forEach(b=>b.addEventListener('click',()=>{
      const updated=rateStudy(getRecords().find(r=>r.id===s.id),b.dataset.question,b.dataset.studyRating);
      saveRecords(getRecords().map(r=>r.id===s.id?updated:r));paintDrill(target,updated,onlyId);refreshReview();
    }));
    target.querySelectorAll('[data-study-again]').forEach(b=>b.addEventListener('click',()=>{const current=getRecords().find(r=>r.id===s.id),q=current.drill.questions.find(q=>q.id===b.dataset.studyAgain);current.drill.drafts[q.id]=q.kind==='choice'?-1:'';saveRecords(getRecords());paintDrill(target,current,onlyId);}));
  }
}
