import { reportModelUsage } from './model-client.js';
import { escapeHTML as escape } from './html.js';
const pending = new Map();

export function summaryHTML(summary) {
  const item = value => `<li><p>${escape(value.text)}</p><a href="#review-turn-${value.answerIndex}">第 ${value.answerIndex + 1} 答 · ${escape(value.quote)}</a></li>`;
  return `<div class="summary-columns"><section><h3>已经说明的内容</h3><ul>${summary.covered.map(item).join('') || '<li>本轮尚未提取到可归纳的内容</li>'}</ul></section><section><h3>还需要验证的地方</h3><ul>${summary.unverified.map(item).join('') || '<li>本轮没有列出具体待验证项，这不代表全部掌握</li>'}</ul></section></div><div class="summary-next"><span class="review-kicker">下一次，只练这一件事</span><p>${escape(summary.nextStep.text)}</p><button class="secondary-button" data-branch="${summary.nextStep.answerIndex}">从第 ${summary.nextStep.answerIndex + 1} 答继续练习 ↗</button></div>`;
}

export function summaryText(summary) {
  if (!summary) return '';
  const line = item => `${item.text}\n依据：第${item.answerIndex + 1}答「${item.quote}」`;
  return `本轮简短复盘\n\n已经说明的内容\n${summary.covered.map(line).join('\n')}\n\n还需要验证的地方\n${summary.unverified.map(line).join('\n')}\n\n下一次练习\n${line(summary.nextStep)}\n\n——\n\n`;
}

// The request belongs to the session, not its DOM. Leaving and reopening the
// report attaches to the same promise; saved summaries never call the model again.
export function mountSummary(host, session, { owner, save, onBusy, onTaskReady = () => {} }) {
  const key = `${owner}:${session.id}`;
  function paint() {
    if (!host.isConnected) return;
    if (session.summary) { host.innerHTML = summaryHTML(session.summary); return; }
    if (pending.has(key)) { host.innerHTML = '<p class="summary-status" role="status">正在整理本轮回答，生成简短复盘… 原回答已经保存，可以先逐题回看</p>'; return; }
    if (session.summaryError) {
      host.innerHTML = `<p class="summary-status" role="alert">${escape(session.summaryError)}</p><button class="secondary-button" data-retry-summary>重试生成本轮复盘</button>`;
      host.querySelector('[data-retry-summary]').addEventListener('click', () => { delete session.summaryError; start(); }); return;
    }
    if (session.practiceTask) { host.innerHTML = '<p class="summary-status">这是一次单题重练。前面的对话是来源上下文，本次只新增一段回答；可以在练习方法中对照前后回答并按需生成建议。</p>'; return; }
    if (!session.completedAt) { host.innerHTML = '<p class="summary-status">结束面试后，将自动生成本轮简短复盘。现在可以逐题查看或修改回答</p>'; return; }
    if (!session.turns.length) { host.innerHTML = '<p class="summary-status">这一轮还没有回答，完成一道题后再来复盘</p>'; return; }
    if (session.turns.every(t=>t.skip)) { host.innerHTML = '<p class="summary-status">本轮问题均已跳过，暂不生成回答分析；可以查看考察范围，选择一题修改后继续练习</p>'; return; }
    if (session.runtime !== 'ai' || session.version !== 2) { host.innerHTML = '<p class="summary-status">规则体验保留逐题记录；AI 面试结束后会自动生成整轮复盘</p>'; return; }
    start();
  }
  function start() {
    if (pending.has(key)) return;
    onBusy(1);
    const request = (async () => {
      try {
        const response = await fetch('/api/interview/summary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session, owner }), signal: AbortSignal.timeout(55000) });
        const data = await response.json(); if(response.ok)reportModelUsage(data); if (!response.ok) throw new Error(data.error || '本轮复盘生成未完成');
        session.summary = data.summary; delete session.summaryError; save(); onTaskReady();
      } catch (error) { session.summaryError = error.name === 'TimeoutError' ? '本轮复盘等待超时，原回答仍已保存，请重试' : error.message; save(); }
      finally { pending.delete(key); onBusy(-1); }
    })();
    pending.set(key, request); paint(); request.then(paint);
  }
  if (pending.has(key)) pending.get(key).then(paint);
  paint();
}
