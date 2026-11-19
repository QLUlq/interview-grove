import { reportModelUsage } from './model-client.js';
import { topics, answerSession } from './engine.js';
import { renderReview, reviewTurns, coachingHTML } from './review.js';
import { branchSession } from './branch.js';
import { createAccount, downloadRecords } from './account.js';
import { setupMaterials } from './materials.js';
import { sessionNodes, resumeTimedSession } from './plan.js';
import { sessionTitle, materialRefsHTML, projectGuideHTML } from './plan-view.js';
import { removeRecord, practiceTasks, completePractice } from './practice.js';
import { recordTrack } from './study.js';
import { mountAcademicPractice } from './academic-practice.js';
import { mountVoiceInput } from './voice-input.js';
import { escapeHTML as escape } from './html.js';

const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  history: '<path d="M3 11a9 9 0 1 1 2 7M3 5v6h6"/><path d="M12 7v5l3 2"/>',
  branch: '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10m12-10v2a4 4 0 0 1-4 4H6"/>',
  shield: '<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  briefcase: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V4h8v3M3 12c6 4 12 4 18 0m-9 0v4"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8zm-10 10 10 5 10-5M2 18l10 5 10-5"/>',
  nodes: '<circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/><path d="M10 8 6 16m8-8 4 8M8 19h8"/>',
  leaf: '<path d="M20 4C8 2 2 8 5 15s16 6 15-11ZM5 20 16 9"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.leaf}</svg>`;
document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon));
const main = document.querySelector('#main');
const dialog = document.querySelector('#setup-dialog');
const storageKey = 'interview-grove-v1';
let modelStatus = { configured: false, model: null };
try { const response = await fetch('/api/model/status', { signal: AbortSignal.timeout(3000) }); if (response.ok) modelStatus = await response.json(); } catch { /* Local practice remains available. */ }
let submitting = false, preparing = false;
let analysing = 0, switchingAccount = false;
let sessions = [];
let activeId = null;
let practiceSelection = null, practiceResultId = null;
let historyTrack='job',methodTrack='job',studyDrillId=null;
let storageAvailable = true;
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
  if (Array.isArray(saved)) sessions = saved.filter(s => [1, 2].includes(s.version) && topics[s.topic] && Array.isArray(s.messages) && Array.isArray(s.turns) && s.evidence && Number.isInteger(s.current) && s.current >= 0 && s.current <= (s.plan?.nodes?.length || topics[s.topic].nodes.length));
} catch { storageAvailable = false; }
let page = 'home';
let toastTimer;
function toast(message) { const el = document.querySelector('#toast'); el.textContent = message; el.style.display = 'block'; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.style.display = 'none', 3500); }
globalThis.addEventListener('interview-model-used',event=>{
  modelStatus.model=event.detail.model;
  if(event.detail.switchedFrom)toast(`${event.detail.switchedFrom} 免费额度不足，已自动切换到 ${event.detail.model}`);
});
const account = createAccount({ getRecords: () => sessions, onState(user, records) {
  if (user) sessions = records;
  else { try { sessions = JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch { sessions = []; } }
  activeId = null;
  practiceSelection = null; practiceResultId = null; studyDrillId=null;
  document.querySelector('#profile-name').textContent = user ? user.name : '访客练习空间';
  document.querySelector('#account-actions').innerHTML = user ? `<span class="account-name">${escape(user.name)}</span><button class="text-button" data-logout>退出</button>` : '<button class="secondary-button" data-login>登录 / 注册</button>';
  document.querySelector('#history-count').textContent = sessions.length;
}, onStatus: text => { document.querySelector('#save-status').textContent = text; if(text.startsWith('保存失败'))toast('账号保存失败。请在练习方法页重试保存，或先下载记录备份。'); } });
function save() {
  if (account.user) account.save();
  else try { localStorage.setItem(storageKey, JSON.stringify(sessions)); } catch { storageAvailable = false; toast('浏览器无法保存记录，本次内容仅在当前页面有效。'); }
  document.querySelector('#history-count').textContent = sessions.length;
}
function current() { return sessions.find(s => s.id === activeId); }
function date(value) { return new Date(value).toLocaleString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }); }
function navigate(view) {
  page = view;
  document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === (view === 'session' || view === 'report' ? 'history' : view)));
  document.querySelector('#breadcrumb').innerHTML = ({ home: '练习空间 <span>/</span> 开始新的可能', history: '面试记录 <span>/</span> 每一步都算数', method: '练习方法 <span>/</span> 有目的地深入', session: '练习空间 <span>/</span> 专注这一轮对话', report: '面试记录 <span>/</span> 回看与下一步' })[view];
  ({ home: renderHome, history: renderHistory, method: renderMethod, session: renderSession, report: renderReport })[view]();
}
function historyRow(s) { return `<div class="history-entry"><button class="history-row" data-open="${escape(s.id)}"><div><strong>${s.parentId ? '↳ 回答分支 · ' : ''}${escape(sessionTitle(s)||topics[s.topic].name)}${s.practiceTask ? ' · 单题重练' : ''}</strong><small>${date(s.startedAt)} · ${s.drill?`专项 ${s.drill.questions.length} 题 · 已作答 ${s.drill.attempts.length} 次`:s.practiceTask?`本次重答 1 题 · 保留 ${s.turns.length-1} 段上下文`:`已回答 ${s.turns.length} 次`}${s.parentId ? ` · 从第 ${s.branchAt + 1} 题修改` : ''}</small></div><span>${s.drill?'打开刷题':s.completedAt ? '查看复盘' : '继续练习'} ↗</span></button><button class="history-delete" data-delete-record="${escape(s.id)}" aria-label="删除记录：${escape(sessionTitle(s)||topics[s.topic].name)}，${date(s.startedAt)}" title="只删除这一条记录">删除</button></div>`; }
function renderHome() {
  const unfinished = sessions.find(s => !s.completedAt&&!s.drill);
  main.innerHTML = `<section class="intro"><div><h1>准备好，迎接下一场面试。</h1></div></section>
  ${unfinished ? `<div class="resume-strip"><span>你还有一场未结束的「${topics[unfinished.topic].name}」练习。</span><button class="secondary-button" data-open="${escape(unfinished.id)}">继续上次练习 ↗</button></div>` : ''}
  <section class="hero"><div class="hero-copy"><span class="pill">${icon('leaf')} 你的专属面试练习场</span><h2>把实力，<br><em>讲出来。</em></h2><p>从项目代码或简历出发，把技术和经历讲清楚。</p><button class="primary-button" data-start="job">开始面试 <span>↗</span></button></div><div class="hero-visual" aria-hidden="true"><div class="orbit"></div><span class="visual-spark">✳</span><div class="sample-card"><div class="sample-top"><span class="sample-dot"></span>再深入一步</div><div class="sample-line"></div><p class="sample-question">“为什么，<br>你选择了这个方案？”</p><div class="sample-answer">让每一个选择，都有你的思考。</div><div class="followup-badge">${icon('branch')} 从回答，到追问</div></div></div></section>
  <section><div class="section-heading"><h2>两大方向，按你的材料开始</h2><span class="muted">点击「开始面试」后选择方向</span></div><div class="topic-grid">
  <article class="topic-card mode-card"><span class="topic-icon">${icon('briefcase')}</span><h3>求职面试</h3><p>项目技术练习：从用途、功能到实现，逐步理解项目。简历模拟面试：结合岗位，覆盖项目和实习。</p><div class="topic-bottom"><span>上传项目文件夹或简历图片</span><span>01</span></div></article><article class="topic-card mode-card"><span class="topic-icon">${icon('layers')}</span><h3>考研复试</h3><p>按报考专业与复试范围，练习408、信号与系统或自定义科目的专业问答。</p><div class="topic-bottom"><span>选择报考专业与练习科目</span><span>02</span></div></article></div></section>
  <section class="recent-section"><div class="section-heading"><h2>最近练习</h2><button class="text-button" data-navigate="history">查看全部 ↗</button></div>${sessions.length ? historyRow(sessions[0]) : `<div class="empty-history">${icon('history')}<div><h3>完成第一轮面试，在这里回看。</h3></div></div>`}</section>
  <p class="prototype-notice">${modelStatus.configured ? `可使用 AI 面试 · ${escape(modelStatus.model)}${modelStatus.automaticFallback?' · 已配置自动备用':''}` : '规则体验 · AI 面试待配置'}${!storageAvailable ? ' · 本地存储不可用' : ''}</p>`;
}
function renderHistory() {
  const records=sessions.filter(s=>recordTrack(s)===historyTrack),seen=new Set();
  function tree(s,depth=0){if(seen.has(s.id))return '';seen.add(s.id);return `<div class="history-tree ${depth?'history-child':''}">${historyRow(s)}${records.filter(c=>c.parentId===s.id).map(c=>tree(c,depth+1)).join('')}</div>`;}
  const journal=records.filter(s=>!s.parentId||!records.some(p=>p.id===s.parentId)).map(s=>tree(s)).join('')+records.filter(s=>!seen.has(s.id)).map(s=>tree(s)).join('');
  main.innerHTML=`<section class="intro"><div><h1>${historyTrack==='academic'?'考研复试记录':'求职面试记录'}</h1><p>按方向分别回看，原对话和修改分支继续保留。</p></div><button class="secondary-button" data-start="${historyTrack}">新的练习 ↗</button></section><div class="practice-tabs" role="group" aria-label="记录方向">${['job','academic'].map(track=>`<button class="${track===historyTrack?'active':''}" aria-pressed="${track===historyTrack}" data-history-track="${track}">${track==='job'?'求职面试':'考研复试'} · ${sessions.filter(s=>recordTrack(s)===track).length}</button>`).join('')}</div>${records.length?journal:`<section class="empty-history"><p>这个方向还没有记录，另一个方向的记录可切换查看。</p></section>`}${sessions.length?'<div class="report-actions"><button class="secondary-button" data-backup>下载全部记录备份</button><button class="text-button" id="clear-history">清除当前方向记录</button></div>':''}`;
  main.querySelectorAll('[data-history-track]').forEach(b=>b.addEventListener('click',()=>{historyTrack=b.dataset.historyTrack;renderHistory();}));
  main.querySelector('#clear-history')?.addEventListener('click',()=>{if(analysing){toast('正在保存分析，请稍候');return;}if(confirm(`清除当前${historyTrack==='academic'?'考研复试':'求职'}方向的全部记录？另一个方向的记录会保留。此操作无法撤销。`)){for(const s of records)sessions=removeRecord(sessions,s.id);activeId=null;save();renderHistory();}});
}
function mountMethodTabs(){
  const tabs=document.createElement('div');tabs.className='practice-tabs';tabs.setAttribute('role','group');tabs.setAttribute('aria-label','练习方向');
  tabs.innerHTML=['job','academic'].map(track=>`<button class="${track===methodTrack?'active':''}" aria-pressed="${track===methodTrack}" data-method-track="${track}">${track==='job'?'求职重答':'考研复试刷题'}</button>`).join('');main.prepend(tabs);
  tabs.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{methodTrack=b.dataset.methodTrack;practiceSelection=null;practiceResultId=null;studyDrillId=null;renderMethod();}));
}
function openStudy(id){studyDrillId=id;practiceSelection=null;practiceResultId=null;methodTrack='academic';if(page==='method'){renderMethod();main.querySelector('#practice-workspace')?.scrollIntoView({block:'start'});}else toast('新题组已保存，可在考研复试刷题中查看');}
function renderAcademicMethod(){
  main.innerHTML='<div id="academic-practice"></div>';mountMethodTabs();
  mountAcademicPractice(main.querySelector('#academic-practice'),{getRecords:()=>sessions,getOwner:()=>account.user?.name,saveRecords:records=>{sessions=records;save();},onBusy:delta=>analysing+=delta,onOpen:openStudy,onReanswer:(id,index)=>{studyDrillId=null;practiceResultId=null;practiceSelection={id,index};renderMethod();},onSource:id=>{activeId=id;historyTrack='academic';navigate(sessions.find(s=>s.id===id)?.completedAt?'report':'session');},renderWorkspace:renderPracticeWorkspace,selection:practiceSelection,resultId:practiceResultId,drillId:studyDrillId,modelAvailable:modelStatus.configured,toast});
}
function renderMethod() {
  if (!account.user) { main.innerHTML = `<section class="intro"><div><span class="eyebrow">YOUR PERSONAL PRACTICE</span><h1>把上次没讲清的，再讲一次</h1><p>从你的复盘或尚未理解的回答中选一题，重答后对照，保存为独立分支。</p></div></section><section class="personal-gate"><span class="tiny-sprout">✳</span><h2>根据自己的记录，练具体的一题</h2><p>登录后整理你的待练问题、原回答和练习目标。访客记录可以在登录后手动导入。</p><button class="primary-button" data-login>登录，整理我的练习</button></section>`; mountMethodTabs(); return; }
  if(methodTrack==='academic'){renderAcademicMethod();return;}
  const records=sessions.filter(s=>recordTrack(s)==='job');
  const tasks = practiceTasks(records), pending = tasks.filter(t => !t.attempts.length), done = tasks.filter(t => t.attempts.length);
  const orphanKeys=new Set();
  const orphanAttempts=records.filter(s=>{
    if(!s.practiceTask||tasks.some(t=>t.key===s.practiceTask.key)||orphanKeys.has(s.practiceTask.key))return false;
    orphanKeys.add(s.practiceTask.key);return true;
  });
  const selected = tasks.find(t => t.session.id === practiceSelection?.id && t.index === practiceSelection?.index);
  const result = records.find(s => s.id === practiceResultId && s.practiceTask);
  const taskCard = t => `<article class="personal-task"><div class="task-content"><span class="eyebrow">${escape(t.reason)} · ${escape(sessionTitle(t.session)||topics[t.session.topic].name)} · 第 ${t.index+1} 答</span><h3>${escape(t.question)}</h3><p class="task-goal">这次只练：${escape(t.goal)}</p><details><summary>为什么安排这题</summary><p class="practice-quote">${escape(t.answer)}</p><small>以上是你当时的原回答；建议只是复查线索。</small></details><div class="report-actions"><button class="${t.attempts.length?'secondary':'primary'}-button" data-practice-session="${escape(t.session.id)}" data-practice-index="${t.index}">${t.attempts.length?'再练这一题':'重答这一题'} ↗</button><button class="text-button" data-task-review="${escape(t.session.id)}" data-task-index="${t.index}">查看来源</button>${t.attempts.length?`<button class="text-button" data-practice-result="${escape(t.attempts[0].id)}">查看上次重答</button>`:''}</div></div></article>`;
  main.innerHTML = `<section class="intro"><div><span class="eyebrow">YOUR PERSONAL PRACTICE</span><h1>把上次没讲清的，再讲一次</h1><p>只使用 ${escape(account.user.name)} 的记录。先选一道题，按一个目标重答，再对照原回答。</p></div></section><section class="practice-overview"><div><strong>${pending.length}</strong><span>道待练问题</span></div><div><strong>${done.length+orphanAttempts.length}</strong><span>道已经重答</span></div><p>重答代表完成一次练习，不代表已掌握。建议来自复盘；没有分析时，从原回答自查开始。</p></section><div id="practice-workspace"></div><div class="section-heading"><h2>待练问题</h2><span class="muted">一次只练一题，不开启整轮面试</span></div><div class="personal-tasks">${pending.map(taskCard).join('') || `<section class="evidence-card"><h3>${done.length?'这批问题已经重答过了':'还没有可整理的问题'}</h3><p>${done.length?'可以展开下方已重答记录再练；AI 建议需要你核对。':'先完成一段回答，或导入访客记录；无需先生成 AI 分析也能开始自查。'}</p><button class="text-button" data-navigate="history">查看面试记录 ↗</button></section>`}</div>${done.length||orphanAttempts.length?`<details class="practice-done"><summary>已重答的问题（${done.length+orphanAttempts.length}）</summary><div class="personal-tasks">${done.map(taskCard).join('')}${orphanAttempts.map(s=>`<article class="personal-task"><div class="task-content"><h3>${escape(s.practiceTask.goal)}</h3><p>来源记录已删除或调整，本次重答仍保留。</p><button class="secondary-button" data-practice-result="${escape(s.id)}">查看保留的重答 ↗</button></div></article>`).join('')}</div></details>`:''}<details class="practice-settings"><summary>数据保存与经验共享</summary><section class="sharing-settings"><h3>自愿分享通用提问线索</h3><p>仅汇总固定技术标签和复查方向，至少3个参与账号出现同类线索才用于其他用户的相关追问。简历、代码、原话与身份不会共享；不会训练模型参数。</p><label class="sharing-choice"><input type="checkbox" id="sharing-optin" ${account.user.shared?'checked':''}>参与去身份化经验汇总</label></section><div class="report-actions"><button class="secondary-button" data-backup>下载我的记录备份</button><button class="text-button" id="import-guest">导入本浏览器访客记录</button><button class="text-button" id="retry-save">重试保存</button></div></details>`;
  mountMethodTabs();renderPracticeWorkspace(main.querySelector('#practice-workspace'),selected,result);
  document.querySelector('#sharing-optin').addEventListener('change', async event => { const el=event.target; el.disabled=true; try { await account.share(el.checked); toast(el.checked?'已参与通用经验汇总':'已退出经验汇总'); } catch(error) { el.checked=!el.checked;toast(error.message); } finally { el.disabled=false; } });
  document.querySelector('#retry-save').addEventListener('click', () => account.flush().then(()=>toast('记录已保存')).catch(error=>toast(error.message)));
  document.querySelector('#import-guest').addEventListener('click', () => { if(!confirm('将本浏览器访客记录复制到当前账号？请确认这些记录属于你。'))return; try {const guest=JSON.parse(localStorage.getItem(storageKey)||'[]');sessions=[...sessions,...guest.filter(g=>!sessions.some(s=>s.id===g.id))];save();renderMethod();toast('访客记录已复制，原访客记录仍保留');}catch{toast('访客记录读取失败');} });
}
function renderPracticeWorkspace(workspace,selected,result){
  if (result) renderPracticeResult(workspace, result);
  else if (selected) {
    workspace.innerHTML = `<section class="practice-editor"><span class="eyebrow">只练这一题 · 约3分钟</span><h2>${escape(selected.question)}</h2><p class="task-goal">练习目标：${escape(selected.goal)}</p><details><summary>看一下原回答</summary><p class="practice-quote">${escape(selected.answer)}</p></details>${projectGuideHTML(selected.session,selected.node)}<form id="practice-form"><label for="practice-answer">重新组织你的回答</label><textarea id="practice-answer" rows="7" maxlength="5000" required placeholder="用你自己的话解释，已确认的内容和还不清楚的环节分开说。">${escape(selected.session.practiceDrafts?.[selected.index]??selected.answer)}</textarea><p class="field-note">保存只会新增一个回答分支，原回答保留。不会自动追问，也不会在保存时调用模型。</p><p id="practice-error" role="alert"></p><div class="report-actions"><button class="primary-button" type="submit">保存重答并对照 ↗</button><button class="text-button" type="button" data-practice-close>先放一放</button></div></form></section>`;
    main.querySelector('#practice-answer').addEventListener('input',event=>{selected.session.practiceDrafts||={};selected.session.practiceDrafts[selected.index]=event.target.value;save();});
    mountVoiceInput(main.querySelector('#practice-answer'));
    main.querySelector('#practice-form').addEventListener('submit',event=>{
      event.preventDefault();
      try { const attempt=completePractice(selected,main.querySelector('#practice-answer').value);delete selected.session.practiceDrafts?.[selected.index];sessions.unshift(attempt);save();practiceResultId=attempt.id;practiceSelection=null;renderMethod();main.querySelector('#practice-workspace').scrollIntoView({block:'start'});toast('这一题已重答，原回答与分支分别保存'); }
      catch(error){main.querySelector('#practice-error').textContent=error.message;}
    });
  }
}
function renderPracticeResult(host, result) {
  const meta=result.practiceTask, source=sessions.find(s=>s.id===meta.sourceId), index=meta.index;
  const turn=reviewTurns(result,{nodes:sessionNodes(result)})[index];
  host.innerHTML=`<section class="practice-editor"><span class="eyebrow">单题重答已保存 · 尚未核实理解</span><h2>${escape(turn.question)}</h2><p class="task-goal">这次的目标：${escape(meta.goal)}</p><div class="practice-comparison"><section><h3>上次回答</h3><p>${escape(source?.turns[index]?.text||'来源记录已删除；本次重答仍保留。')}</p></section><section><h3>这次重答</h3><p>${escape(turn.answer)}</p></section></div><p class="field-note">对照看看：是否补清了目标中的一个环节？有没有把未验证的猜测说成事实？</p><div id="practice-advice">${result.coaching?.[index]?coachingHTML(result.coaching[index]):'<p class="muted">可以先自己对照；需要时再让 AI 对本次重答给建议。</p>'}</div><div class="report-actions">${result.version===2&&modelStatus.configured?'<button class="secondary-button" id="practice-coach">'+(result.coaching?.[index]?'重新生成建议':'生成本次重答建议')+'</button>':''}<button class="text-button" data-practice-close>返回待练问题</button></div><p id="practice-coach-error" role="alert"></p></section>`;
  host.querySelector('#practice-coach')?.addEventListener('click',async event=>{
    const button=event.target;button.disabled=true;button.textContent='正在分析本次重答…';analysing++;
    try {const response=await fetch('/api/interview/coach',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session:result,index,owner:account.user.name}),signal:AbortSignal.timeout(55000)});const data=await response.json();if(response.ok)reportModelUsage(data);if(!response.ok)throw new Error(data.error||'分析未完成');result.coaching||={};result.coaching[index]=data.coaching;save();if(host.isConnected)renderPracticeResult(host,result);}
    catch(error){if(host.isConnected){host.querySelector('#practice-coach-error').textContent=error.name==='TimeoutError'?'建议生成超时，重答已保存，可以重试。':error.message;button.disabled=false;button.textContent='重试生成建议';}}
    finally{analysing--;}
  });
}
function renderSession() {
  const s = current(); if (!s) { navigate('home'); return; }
  if (s.completedAt) { navigate('report'); return; }
  const topic = { ...topics[s.topic], name:sessionTitle(s)||topics[s.topic].name, nodes:sessionNodes(s) };
  main.innerHTML = `<div class="session-heading"><div><span class="eyebrow">${s.plan ? 'YOUR MATERIAL, YOUR PRACTICE' : 'ONE QUESTION AT A TIME'}</span><h1>${topic.name}${s.parentId ? ' · 回答分支' : ''}</h1><p class="muted">${s.plan ? `基于已读材料安排 ${s.plan.nodes.length} 个考察点，约 ${s.plan.minutes} 分钟（不强制计时），最多 ${s.plan.maxAnswers} 次回答。${s.plan.scope==='module'?`范围：${escape(s.plan.module)}。`:''}` : s.academic ? `${escape(s.anchor)}${s.academic.scope?` · 限定：${escape(s.academic.scope)}`:''}。5个专业考察点，最多12次回答。` : '聚焦这段经历，一次说清一个问题。'}${s.parentId ? ' 原对话保留，修改后的回答将在这里继续。' : ''}</p></div><div class="session-controls"><button class="text-button" data-review>回看与修改</button><button class="secondary-button" id="end-session">结束并复盘</button></div></div>
  <div class="session-layout"><section class="conversation" aria-label="面试对话"><div class="conversation-header"><div class="interviewer-avatar">${icon('leaf')}</div><div><strong>面向 · 练习面试官</strong><small>围绕一个目标，慢慢深入</small></div><span class="rule-badge">规则演示</span></div><div class="messages" id="messages" role="log" aria-live="polite">${s.messages.map(m => `<article class="message ${m.role}"><div class="message-label">${m.role === 'user' ? '你的回答' : '面向'}</div><div class="bubble">${escape(m.text)}</div></article>`).join('')}${projectGuideHTML(s,topic.nodes[s.current])}${materialRefsHTML(s,topic.nodes[s.current])}</div><form class="composer" id="answer-form"><label for="answer" class="field-note">你的回答</label><textarea id="answer" rows="3" maxlength="5000" placeholder="像面对一位耐心的面试官，说说你的思路……" required></textarea><div class="composer-bottom"><small>Ctrl / ⌘ + Enter 发送 · 也可以输入“跳过”</small><button class="primary-button" type="submit">发送回答 <span>↑</span></button></div><p id="answer-error" class="field-note" role="alert"></p></form></section>
  <aside class="session-aside"><section><h3>${s.plan ? '本轮材料考察计划' : '这一轮的路线'}</h3><div class="progress-items">${topic.nodes.map((n,i) => `<div class="progress-item ${i === s.current ? 'current' : i < s.current ? 'done' : ''}" ${i === s.current ? 'aria-current="step"' : ''}><span class="progress-dot">${i < s.current ? '✓' : i+1}</span>${escape(n.label)}</div>`).join('')}</div><div class="progress-line"><div style="width:${s.current / topic.nodes.length * 100}%"></div></div><p>已完成 ${s.current} / ${topic.nodes.length} 个方向</p></section><section><h3>给自己一点空间</h3><p>可以停下来想一想。<br>遇到不熟悉的问题，坦诚说明也是一种表达。</p></section>${s.plan ? `<section><h3>出题依据</h3><p>${escape(s.material.summary)}</p><p>${s.material.kind==='project'?`已读 ${s.material.coverage.included} / ${s.material.coverage.readable} 个可读文件；${s.material.coverage.clipped} 个按片段读取。`:'根据你核对后的简历识别内容提问。'}</p></section>` : ''}${s.project ? `<section><h3>${s.academic?'复试补充':s.plan?'你的补充':'你的项目备忘'}</h3><p>${escape(s.project)}</p></section>` : ''}</aside></div>`;
  const messages = document.querySelector('#messages'); messages.scrollTop = messages.scrollHeight;
  const answer = document.querySelector('#answer');
  answer.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) { event.preventDefault(); document.querySelector('#answer-form').requestSubmit(); } });
  answer.value = s.draft || '';
  answer.addEventListener('input', () => { s.draft = answer.value; save(); });
  mountVoiceInput(answer);
  document.querySelector('.rule-badge').textContent = s.runtime === 'ai' ? `AI · ${s.model || modelStatus.model || '已配置模型'}` : '规则体验';
  document.querySelector('#answer-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting || switchingAccount) return;
    const text = answer.value.trim();
    if (!text) { document.querySelector('#answer-error').textContent = '请先填写回答。'; return; }
    submitting = true; s.draft = answer.value; save();
    const button = document.querySelector('#answer-form button[type=submit]');
    button.disabled = true; answer.disabled = true; button.textContent = '正在整理下一问…';
    const started = Date.now();
    const waiting = setInterval(() => { button.textContent = `正在整理下一问 · ${Math.floor((Date.now() - started) / 1000)} 秒`; }, 1000);
    document.querySelector('#answer-error').textContent = '';
    document.querySelector('#end-session').disabled = true;
    try {
      let next;
      if (s.runtime === 'ai') {
        const response = await fetch('/api/interview/answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: s, answer: text, owner: account.user?.name || 'guest' }), signal: AbortSignal.timeout(55000) });
        const data = await response.json(); if(response.ok)reportModelUsage(data);
        if (!response.ok) throw new Error(data.error || '请求失败，请重试。');
        next = data.session;
      } else next = answerSession(s, text);
      next.draft = ''; sessions = sessions.map(item => item.id === next.id ? next : item); save();
      submitting = false; navigate(next.completedAt ? 'report' : 'session'); document.querySelector('#answer')?.focus({ preventScroll: true });
    } catch (error) {
      document.querySelector('#answer-error').textContent = error.name === 'TimeoutError' ? '等待超时，回答已保留，请重试。' : error.message;
      submitting = false; button.disabled = false; answer.disabled = false; button.innerHTML = '重试发送 <span>↑</span>'; document.querySelector('#end-session').disabled = false;
    } finally { clearInterval(waiting); }
  });
  document.querySelector('#end-session').addEventListener('click', () => { if (confirm('现在结束并生成复盘？未考察的方向会标注为“未进行”。')) { s.completedAt = Date.now(); save(); navigate('report'); } });
}
function renderReport() {
  const session = current(); if (!session) { navigate('history'); return; }
  const topic = { ...topics[session.topic], name:sessionTitle(session)||topics[session.topic].name, nodes:sessionNodes(session) };
  renderReview(main, session, topic, { date, save, toast, owner: account.user?.name || 'guest', onBusy: delta => { analysing += delta; }, onTaskReady: () => { if(page === 'method')renderMethod(); } });
}
function startBranch(source, index) {
  const branch = branchSession(source, index, sessionNodes(source));
  sessions.unshift(branch); activeId=branch.id; historyTrack=recordTrack(branch); save(); navigate('session');
  document.querySelector('#answer')?.focus({preventScroll:true});toast('已建立回答分支：修改输入框中的原回答，再发送继续');
}
function updateSetup() {
  const mode = document.querySelector('#topic').value;
  document.querySelector('#setup-subtitle').textContent = mode === 'academic' ? '填写报考专业和科目范围，从基础到应用练习专业问答' : '先读材料，再安排这一轮的考察范围';
  const track=document.querySelector('input[name=practice]:checked').value;
  const projectMode=mode==='job'&&track==='project';
  const input = document.querySelector('#anchor');
  document.querySelector('#anchor-field').hidden = projectMode || mode === 'academic';
  input.required = false;
  document.querySelector('#academic-options').hidden = mode !== 'academic';
  document.querySelector('#academic-major').required = mode === 'academic';
  document.querySelector('#academic-scope').required = mode === 'academic' && document.querySelector('#academic-range').value === 'custom';
  document.querySelector('#job-track').hidden=mode!=='job';
  document.querySelector('#project-options').hidden=!projectMode;
  document.querySelector('#module-field').hidden=document.querySelector('#project-scope').value!=='module';
  document.querySelector('#responsible-module').required=projectMode&&document.querySelector('#project-scope').value==='module';
  document.querySelector('#duration-field').hidden=mode!=='job';
  document.querySelector('#runtime-field').hidden=mode==='job';
  document.querySelector('#material-import').hidden = mode !== 'job';
  document.querySelector('#resume-upload').hidden=track!=='resume';
  document.querySelector('#folder-upload').hidden=track!=='project';
  document.querySelector('#material-title').textContent=projectMode?'读取项目代码':'读取简历经历';
  document.querySelector('#extract-materials').textContent=projectMode?'读取项目并识别考察点':'读取简历并识别经历';
  document.querySelector('#material-privacy').textContent=projectMode?'读取的代码片段会发送给当前模型服务并随练习保存，请先移除私密内容。大项目会显示实际读取范围，不把部分读取称为全仓库分析。':'图片会发送给当前模型服务，请先遮盖姓名、联系方式等隐私。仅保存识别后的经历与技术信息，原图片不保存。';
  document.querySelector('#project-label').textContent=mode==='academic'?'复试补充（选填）':projectMode?'项目补充（选填）':'简历补充（选填）';
  document.querySelector('#project').placeholder=mode==='academic'?'例如：本科已学课程、当前基础、希望先从基础概念开始；不要填写账号或其他隐私':projectMode?'例如：这是跟课程完成的开源移植，我使用STM32F103；希望从功能和实现流程开始理解，不预设原创设计。':'例如：某段实习仅参与了接口测试；图片识别的项目职责有误，请按这里的补充为准。';
  document.querySelector('#anchor-label').textContent = '目标岗位（选填）';
  input.placeholder = '例如：后端开发工程师';
  const runtime = document.querySelector('#runtime'), option = runtime.querySelector('[value=ai]');
  const available = modelStatus.configured && ['job', 'academic'].includes(mode);
  option.disabled = !available;
  option.textContent = available ? `AI 面试 · ${modelStatus.model}` : 'AI 面试 · 尚未配置或本主题暂不支持';
  if (!available) runtime.value = 'demo'; else if(mode==='job')runtime.value='ai';
  updateRuntimeNote();
}
function updateRuntimeNote() {
  const ai = document.querySelector('#runtime').value === 'ai';
  const job=document.querySelector('#topic').value==='job';
  document.querySelector('#setup-note').textContent = job?(modelStatus.configured?'先读取并核对材料；项目练习从用途、功能到实现逐层展开。预计时长只用于安排题量，不会因查资料或离开页面而自动结束。':'项目与简历练习需要配置模型服务后使用。'):ai?'按报考专业和科目范围安排5个专业考察点，从基础到应用，最多12次回答；不强制计时。':'规则体验提供预设科目的5道基础问题，不调用模型；自定义或限定章节请使用AI面试。';
  document.querySelector('.privacy-note span:last-child').textContent = `${account.user ? '记录保存到当前本机账号。' : '访客记录仅在当前浏览器保存。'}${ai ? '材料、补充和回答会发送给模型服务。' : '规则对话不发送给模型。'}`;
  document.querySelector('#extract-materials').disabled = !modelStatus.configured;
}
const materials = setupMaterials({toast});
document.querySelector('#runtime').addEventListener('change', updateRuntimeNote);
document.querySelector('#academic-range').addEventListener('change', updateSetup);
function openSetup(topic) { document.querySelector('#topic').value = topic==='academic'?'academic':'job'; document.querySelector('#anchor').value = ''; document.querySelector('#setup-error').textContent=''; document.querySelector('#runtime').value = modelStatus.configured ? 'ai' : 'demo'; materials.reset(); updateSetup(); dialog.showModal(); }
document.querySelector('#topic').addEventListener('change', () => { document.querySelector('#anchor').value = ''; updateSetup(); });
document.querySelectorAll('input[name=practice]').forEach(el=>el.addEventListener('change',()=>{materials.reset();updateSetup();}));
document.querySelector('#project-scope').addEventListener('change',updateSetup);
document.addEventListener('click', event => {
  if ((switchingAccount || preparing) && event.target.closest('button, a')) { event.preventDefault(); toast('正在切换账号或规划本轮问题，请稍候'); return; }
  if (submitting && event.target.closest('button, a')) { event.preventDefault(); toast('正在等待面试官回应，请稍候。'); return; }
  if(event.target.closest('[data-login]')) { if(materials.busy){toast('材料仍在读取，请稍候');return;}if(analysing){toast('正在保存复盘分析，请稍候再切换账号');return;}document.querySelector('#auth-error').textContent='';document.querySelector('#account-dialog').showModal();return; }
  if(event.target.closest('[data-logout]')) { if(materials.busy){toast('材料仍在读取，请稍候');return;}if(analysing){toast('复盘分析尚未完成，请稍候再退出');return;}switchingAccount=true;account.logout().then(()=>navigate('home')).catch(error=>toast(error.message)).finally(()=>{switchingAccount=false;});return; }
  if(event.target.closest('[data-backup]')) { downloadRecords(sessions);return; }
  const removal=event.target.closest('[data-delete-record]');
  if(removal) {
    if(analysing){toast('正在保存分析，请稍候再删除记录');return;}
    const record=sessions.find(s=>s.id===removal.dataset.deleteRecord);if(!record)return;
    if(!confirm(`删除「${sessionTitle(record)||topics[record.topic].name}」这条记录？\n${date(record.startedAt)} · ${record.turns.length} 次回答\n只删除这一条，已有回答分支会保留。此操作无法撤销。`))return;
    sessions=removeRecord(sessions,record.id);if(activeId===record.id)activeId=null;
    if(practiceResultId===record.id)practiceResultId=null;
    practiceSelection=null;save();navigate(page==='home'?'home':'history');toast(account.user?'已移除这条记录，正在同步到账号':'已删除这条记录');return;
  }
  const practice=event.target.closest('[data-practice-session]');
  if(practice){methodTrack=recordTrack(sessions.find(s=>s.id===practice.dataset.practiceSession));studyDrillId=null;practiceSelection={id:practice.dataset.practiceSession,index:Number(practice.dataset.practiceIndex)};practiceResultId=null;navigate('method');main.querySelector('#practice-workspace').scrollIntoView({block:'start'});main.querySelector('#practice-answer')?.focus({preventScroll:true});return;}
  const practiceResult=event.target.closest('[data-practice-result]');
  if(practiceResult){methodTrack=recordTrack(sessions.find(s=>s.id===practiceResult.dataset.practiceResult));studyDrillId=null;practiceResultId=practiceResult.dataset.practiceResult;practiceSelection=null;navigate('method');main.querySelector('#practice-workspace').scrollIntoView({block:'start'});return;}
  if(event.target.closest('[data-practice-close]')){practiceSelection=null;practiceResultId=null;renderMethod();return;}
  const taskReview=event.target.closest('[data-task-review]');
  if(taskReview){activeId=taskReview.dataset.taskReview;navigate('report');main.querySelector(`#review-turn-${Number(taskReview.dataset.taskIndex)}`)?.scrollIntoView({block:'start'});return;}
  if(event.target.closest('[data-review]')) { navigate('report');return; }
  if(event.target.closest('[data-resume-timed]')) {try{const resumed=resumeTimedSession(current());sessions=sessions.map(s=>s.id===resumed.id?resumed:s);save();navigate('session');}catch(error){toast(error.message);}return;}
  const branch=event.target.closest('[data-branch]');if(branch){try{startBranch(current(),Number(branch.dataset.branch));}catch(error){toast(error.message);}return;}
  const task=event.target.closest('[data-task-session]');if(task){try{startBranch(sessions.find(s=>s.id===task.dataset.taskSession),Number(task.dataset.taskIndex));}catch(error){toast(error.message);}return;}
  const start = event.target.closest('[data-start]'); if (start) { openSetup(start.dataset.start); return; }
  const nav = event.target.closest('[data-view], [data-navigate]'); if (nav) { navigate(nav.dataset.view || nav.dataset.navigate); return; }
  const open = event.target.closest('[data-open]'); if (open) { activeId = open.dataset.open;historyTrack=recordTrack(current());if(current()?.drill){page='method';openStudy(current().id);navigate('method');}else navigate(current()?.completedAt ? 'report' : 'session'); }
});
document.querySelector('#close-setup').addEventListener('click', () => { if(materials.busy){toast('正在提取材料，请稍候');return;}dialog.close(); });
dialog.addEventListener('cancel', event => { if(materials.busy||preparing)event.preventDefault(); });
document.querySelector('#setup-form').addEventListener('submit', async event => {
  event.preventDefault();if(preparing||materials.busy)return;
  const form=event.currentTarget,button=form.querySelector('[type=submit]'),error=document.querySelector('#setup-error');error.textContent='';
  const topic=document.querySelector('#topic').value,track=document.querySelector('input[name=practice]:checked').value;
  if(topic==='job'&&(!modelStatus.configured||materials.material?.kind!==track)){error.textContent=modelStatus.configured?'请先读取并核对本路线的材料，再开始练习':'请先配置模型服务';return;}
  preparing=true;const controls=[...form.querySelectorAll('input,select,textarea,button')].map(el=>[el,el.disabled]);controls.forEach(([el])=>el.disabled=true);button.textContent=topic==='job'?'正在根据材料规划本轮问题…':'正在准备练习…';
  try {
    let s;
    if(topic==='job') {
      const response=await fetch('/api/interview/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner:account.user?.name||'guest',material:materials.material,track,scope:track==='project'?document.querySelector('#project-scope').value:'whole',module:track==='project'&&document.querySelector('#project-scope').value==='module'?document.querySelector('#responsible-module').value.trim():'',minutes:Number(document.querySelector('#duration').value),supplement:document.querySelector('#project').value.trim(),anchor:track==='resume'?document.querySelector('#anchor').value.trim():''}),signal:AbortSignal.timeout(55000)});
      const data=await response.json();if(response.ok)reportModelUsage(data);if(!response.ok)throw new Error(data.error||'问题规划未完成');s=data.session;
    } else {
      const response=await fetch('/api/interview/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner:account.user?.name||'guest',track:'academic',runtime:document.querySelector('#runtime').value,academic:{major:document.querySelector('#academic-major').value.trim(),range:document.querySelector('#academic-range').value,scope:document.querySelector('#academic-scope').value.trim()},supplement:document.querySelector('#project').value.trim()}),signal:AbortSignal.timeout(55000)});
      const data=await response.json();if(response.ok)reportModelUsage(data);if(!response.ok)throw new Error(data.error||'专业问题安排未完成');s=data.session;
    }
    sessions.unshift(s);activeId=s.id;historyTrack=recordTrack(s);save();dialog.close();document.querySelector('#project').value='';navigate('session');document.querySelector('#answer')?.focus();
  }catch(cause){error.textContent=cause.name==='TimeoutError'?'问题规划超时，材料已保留，可以重试':cause.message;}
  finally{preparing=false;controls.forEach(([el,disabled])=>el.disabled=disabled);button.textContent='准备好了，开始面试 ↗';}
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });
document.querySelector('#close-account').addEventListener('click',()=>document.querySelector('#account-dialog').close());
document.querySelector('#auth-mode').addEventListener('change',event=>{document.querySelector('#password').autocomplete=event.target.value==='register'?'new-password':'current-password';});
document.querySelector('#account-form').addEventListener('submit', async event=>{
  event.preventDefault();if(switchingAccount)return;switchingAccount=true;
  const button=event.target.querySelector('[type=submit]');button.disabled=true;document.querySelector('#auth-error').textContent='';
  try {await account.authenticate(document.querySelector('#username').value.trim(),document.querySelector('#password').value,document.querySelector('#auth-mode').value==='register');document.querySelector('#password').value='';document.querySelector('#account-dialog').close();navigate('home');toast('已进入你的账号空间');}
  catch(error){document.querySelector('#auth-error').textContent=error.message;}finally{switchingAccount=false;button.disabled=false;}
});
window.addEventListener('beforeunload',event=>{if(account.unsaved){event.preventDefault();event.returnValue='';account.flush().catch(()=>{});}});
try { await account.init(); } catch { toast('账号服务暂不可用，仍可进行访客练习'); }
document.querySelector('#history-count').textContent = sessions.length;
navigate('home');
