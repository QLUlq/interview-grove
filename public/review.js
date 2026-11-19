import { reportModelUsage } from './model-client.js';
import { mountSummary, summaryText } from './session-summary.js';
import { coverageHTML, coverageText, materialRefsHTML, projectGuideHTML, projectOutlineHTML, projectOutlineText } from './plan-view.js';
import {canResumeTimedSession} from './plan.js';
import { escapeHTML as escape } from './html.js';

export function reviewTurns(session, topic) {
  let index = 0;
  return session.messages.flatMap((message, i) => {
    if (message.role !== 'user') return [];
    const turnIndex = index++, turn = session.turns[turnIndex];
    const baseNode = topic.nodes.find(n => n.id === turn?.node) || topic.nodes[0];
    const node = { ...baseNode, label: turn?.label || baseNode.label, target: turn?.target || baseNode.target };
    const prior = session.decisions?.find(d => d.answerIndex === turnIndex - 1);
    return [{ index: turnIndex, question: session.messages[i - 1]?.text || node.question, answer: message.text, node,
      reason: session.plan ? `${turn?.followup?'进一步理解':'这一问了解'}：${node.target}` : turnIndex === 0 ? `这道开场题关注${node.target}，先建立后续追问的事实基础。` : prior?.reason || `这一问关注${node.target}。`,
      quotes: turnIndex === 0 ? [] : prior?.signals || [] }];
  });
}

export function coachingHTML(coaching) {
  const list = (items, empty) => items.length ? items.map(item => `<li><p>${escape(item.text)}</p><q>${escape(item.quote)}</q></li>`).join('') : `<li>${empty}</li>`;
  return `<div class="coach-columns"><section><h4>值得保留</h4><ul>${list(coaching.strengths, '这段回答暂未提取到具体优点')}</ul></section><section><h4>可以更进一步</h4><ul>${list(coaching.improvements, '本次没有额外的改进建议，可以先保留原来的说法')}</ul></section></div>
    <section class="rewrite-panel"><div class="rewrite-heading"><h4>试着这样表达</h4><span>保留原意，练习自然地说清楚</span></div><p>${escape(coaching.rewrite)}</p><small>先理解，再用自己的话说；使用前核对是否符合真实情况${coaching.rewrite.includes('【待补充') ? '；【待补充】需要你填写真实信息' : ''}</small></section>
    ${coaching.missing.length ? `<section class="missing-panel"><h4>还需要你补充</h4><ul>${coaching.missing.map(t => `<li>${escape(t)}</li>`).join('')}</ul></section>` : ''}
    <div class="practice-task"><span>下一次，只练这一件事</span><p>${escape(coaching.nextStep)}</p></div>`;
}

export function renderReview(main, s, topic, { date, save, toast, owner = 'guest', onBusy = () => {}, onTaskReady = () => {} }) {
  const turns = reviewTurns(s, topic), covered = new Set(s.turns.filter(t=>!s.plan||!t.skip).map(t => t.node)).size;
  main.innerHTML = `<div class="review-page"><header class="review-heading"><div><span class="review-kicker">面试复盘 / ${escape(topic.name)}</span><h1>每一答，都有进步的余地</h1><p>${date(s.startedAt)} <span>·</span> ${turns.length} 次回答 <span>·</span> ${escape(s.anchor || '自由练习')}</p></div><button class="secondary-button" data-navigate="history">返回记录</button></header>
    <section class="review-overview"><div><span class="review-kicker">从回看到练习</span><h2>找到下一次<br>说得更好的地方</h2><p>先理解提问的目的，再把你的思路讲清楚</p></div><div class="review-stat"><strong>${String(turns.length).padStart(2, '0')}</strong><span>段回答可以回看</span></div><div class="review-stat"><strong>${covered}<small> / ${topic.nodes.length}</small></strong><span>个考察方向已覆盖</span></div></section>
    <div class="review-layout"><aside class="review-rail"><span class="review-kicker">本轮路线</span><nav aria-label="复盘目录">${topic.nodes.map(n => { const first = turns.find(t => t.node.id === n.id); return first ? `<a href="#review-turn-${first.index}"><span class="route-mark">✓</span>${escape(n.label)}</a>` : `<span class="route-unanswered"><span class="route-mark">—</span>${escape(n.label)} · 未进行</span>`; }).join('')}</nav><p>选一题展开详细分析<br>把这次回答变成下次练习</p><button class="primary-button" data-start="${s.topic}">再练一轮 ↗</button><button class="text-button" id="download-report">下载本轮复盘</button></aside>
    <div class="review-turns"><div class="review-section-title"><h2>逐题回看</h2><span>原回答始终保留</span></div>${turns.map(t => `<article class="review-turn" id="review-turn-${t.index}"><div class="turn-heading"><span>第 ${String(t.index + 1).padStart(2, '0')} 题</span><span>${escape(t.node.label)}</span></div><div class="question-panel"><span class="speaker-label">面试官</span><h3>${escape(t.question)}</h3><details class="why-panel"><summary>为什么问这题</summary><p>${escape(t.reason)}</p><small>考察重点：${escape(t.node.target)}</small>${t.quotes.map(q => `<blockquote>上一答中的线索：${escape(q.quote)}</blockquote>`).join('')}</details></div><div class="answer-panel"><span class="speaker-label">你的原回答</span><p>${escape(t.answer)}</p></div>
    <details class="answer-detail" data-coach="${t.index}"><summary><span>详细分析与润色</span><span class="detail-hint">优点 · 改进 · 表达示范</span></summary><div class="coach-body" id="coach-${t.index}">${s.coaching?.[t.index] ? coachingHTML(s.coaching[t.index]) + `<button class="text-button" data-generate="${t.index}">重新分析这段回答</button>` : `<div class="coach-invitation"><p>结合这道题，看看哪些内容值得保留、哪些地方需要补充</p>${s.version === 2 && modelStatusAvailable(s) ? `<button class="secondary-button" data-generate="${t.index}">生成这段回答的建议</button>` : '<p>这份旧版记录暂不支持 AI 分析，可以开始新一轮求职或考研练习</p>'}<small>点击后由 AI 分析，不会修改你的原回答</small></div>`}</div></details></article>`).join('') || '<div class="review-empty"><h2>这一轮还没有回答</h2><p>先完成一道题，再来查看具体建议</p></div>'}
    <div class="review-finish"><div><h3>带着一个改进点，再试一次</h3><p>保留真实经历，把刚才没讲清的地方补上</p></div><button class="primary-button" data-start="${s.topic}">再练一轮 ↗</button></div><p class="review-disclaimer">AI 建议用于练习表达，不代表事实核验或院校、企业的评价标准</p></div></div></div>`;
  if(s.academic) {
    const scope=document.createElement('section');scope.className='plan-coverage';
    scope.innerHTML=`<h2>本轮复试范围</h2><p>报考专业：${escape(s.academic.major)}</p><p>${escape(s.anchor)}${s.academic.scope?` · 限定内容：${escape(s.academic.scope)}`:''}</p><small>根据填写范围安排练习，不代表院校官方考纲或真实录取评价。</small>`;
    main.querySelector('.review-overview').after(scope);
  }
  if(s.testRun?.kind==='ai-dogfood') {
    main.querySelector('.review-heading h1').textContent='AI代测复盘（非本人作答）';
    main.querySelectorAll('.answer-panel .speaker-label').forEach(label=>label.textContent='AI模拟回答');
    const note=document.createElement('section');note.className='plan-coverage';
    note.innerHTML=`<h2>本轮是AI代测记录</h2><p>回答由AI模拟，用于检查练习流程，不代表你的真实回答或掌握程度，不进入个人待练题与经验汇总。</p>${Array.isArray(s.testRun.findings)?`<ul>${s.testRun.findings.map(finding=>`<li>${escape(finding)}</li>`).join('')}</ul>`:''}`;
    main.querySelector('.review-overview').after(note);
  }
  const summarySection=document.createElement('section'); summarySection.className='session-summary'; summarySection.setAttribute('aria-label','本轮简短复盘');
  if(s.practiceTask) {
    const button=document.createElement('button');button.className='secondary-button';button.dataset.practiceResult=s.id;button.textContent='查看单题重答对照 ↗';main.querySelector('.review-heading').append(button);
  }
  summarySection.innerHTML='<div class="review-section-title"><h2>本轮简短复盘</h2><span>依据原回答整理 · 不作能力评分</span></div><div data-summary-body></div>';
  main.querySelector('.review-layout').before(summarySection);
  if(canResumeTimedSession(s)) {
    const notice=document.createElement('section');notice.className='plan-coverage';
    notice.innerHTML='<h2>上次因时间到期结束，还有问题没问完</h2><p>现在时长只影响题量，不会因查资料或离开页面而自动结束。可以保留已有回答，接着练习剩余内容。</p><button class="primary-button" data-resume-timed>继续剩余问题 ↗</button>';
    main.querySelector('.review-overview').after(notice);
  }
  if(s.plan?.track==='project') {
    main.querySelector('.review-heading h1').textContent=s.testRun?.kind==='ai-dogfood'?'AI代测复盘（非本人作答）':'把项目的来龙去脉讲清楚';
    main.querySelector('.review-overview h2').textContent='从功能出发，理清实现过程';
    main.querySelector('.review-overview p').textContent='回看你解释过的过程，找出一个还需要核对的环节';
  }
  if(s.plan)summarySection.insertAdjacentHTML('beforebegin',projectOutlineHTML(s)+coverageHTML(s));
  if(s.plan)turns.forEach(t=>{
    const planned=s.plan.nodes.find(n=>n.id===t.node.id);
    main.querySelector(`#review-turn-${t.index} .question-panel`).insertAdjacentHTML('beforeend',projectGuideHTML(s,planned)+materialRefsHTML(s,t.node));
  });
  mountSummary(summarySection.querySelector('[data-summary-body]'),s,{owner,save,onBusy,onTaskReady});
  main.querySelectorAll('.answer-panel').forEach((panel, index) => {
    const button = document.createElement('button'); button.className = 'text-button branch-answer'; button.dataset.branch = index; button.textContent = '修改这段回答，从这里继续 ↗'; panel.append(button);
  });
  if(s.parentId) {
    const notice = document.createElement('div'); notice.className='branch-notice'; notice.textContent=`这是从第 ${s.branchAt+1} 题修改后继续的分支。 `;
    const link=document.createElement('button');link.className='text-button';link.dataset.open=s.parentId;link.textContent='查看来源对话 ↗';notice.append(link);main.querySelector('.review-overview').before(notice);
  }
  const pending = new Set();
  main.querySelectorAll('[data-generate]').forEach(button => button.addEventListener('click', async () => {
    const index = Number(button.dataset.generate); if (pending.has(index)) return;
    pending.add(index); onBusy(1); button.disabled = true; button.textContent = '正在分析这段回答…';
    const started = Date.now();
    const waiting = setInterval(() => { button.textContent = `正在分析 · ${Math.floor((Date.now() - started) / 1000)} 秒`; }, 1000);
    const host = main.querySelector(`#coach-${index}`);
    try {
      const response = await fetch('/api/interview/coach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: s, index, owner }), signal: AbortSignal.timeout(50000) });
      const data = await response.json(); if(response.ok)reportModelUsage(data); if (!response.ok) throw new Error(data.error || '分析未完成，请重试');
      s.coaching ||= {}; s.coaching[index] = data.coaching; save(); host.innerHTML = coachingHTML(data.coaching);
    } catch (error) { button.disabled = false; button.textContent = '重新生成建议'; let message = host.querySelector('[role=alert]'); if (!message) { message = document.createElement('p'); message.setAttribute('role', 'alert'); host.append(message); } message.textContent = error.name === 'TimeoutError' ? '本次分析等待超时，原回答仍已保存，可以重试' : error.message; }
    finally { clearInterval(waiting); pending.delete(index); onBusy(-1); }
  }));
  main.querySelector('#download-report').addEventListener('click', () => {
    const text = `面向 · ${topic.name}\n${date(s.startedAt)}\n\n` + (s.academic?`报考专业：${s.academic.major}\n复试范围：${s.anchor}\n限定内容：${s.academic.scope||'所选预设范围'}\n\n`:'') + projectOutlineText(s) + coverageText(s) + (summaryText(s.summary) || (s.summaryError ? `整轮复盘暂未生成：${s.summaryError}\n\n` : '整轮复盘尚未生成；以下保留完整逐题记录\n\n')) + turns.map(t => {
      const c = s.coaching?.[t.index];
      return `第${t.index + 1}题：${t.question}\n为什么问：${t.reason}\n原回答：${t.answer}\n${c ? `值得保留：${c.strengths.map(x => x.text).join('；')}\n改进建议：${c.improvements.map(x => x.text).join('；')}\n表达示范：${c.rewrite}\n待补充：${c.missing.join('；')}\n下一步：${c.nextStep}` : '尚未生成详细建议'}`;
    }).join('\n\n——\n\n');
    const url = URL.createObjectURL(new Blob(['\ufeff', text], { type: 'text/plain;charset=utf-8' })), a = document.createElement('a'); a.href = url; a.download = `面向-${topic.name}-复盘.txt`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('复盘已下载');
  });
}
function modelStatusAvailable(s) { return ['job', 'academic'].includes(s.topic); }
