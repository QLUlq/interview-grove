import { academicRanges } from './academic.js';
import { oralRatings, studyReviewItems } from './study.js';
import { escapeHTML as escape } from './html.js';

export function mountStudyReview(target,{getRecords,onRetry}) {
  target.innerHTML=`<h2>错题与待复习</h2><p class="field-note">选择题按AI参考答案整理，曾答错的题会继续保留。口头题由你自评；暂时理解也不代表已经掌握。</p><div class="study-review-filters"><label>查看<select data-review-status><option value="pending">错题与待复习</option><option value="wrong">曾答错的选择题</option><option value="understood">口头题 · 暂时理解</option><option value="all">全部已作答题</option></select></label><label>练习范围<select data-review-range><option value="">全部范围</option>${Object.entries(academicRanges).map(([id,r])=>`<option value="${id}">${escape(r.label)}</option>`).join('')}</select></label><label>科目或知识点<input data-review-keyword type="search" maxlength="120" placeholder="例如：操作系统、卷积"></label></div><p class="field-note" data-review-count aria-live="polite"></p><div class="personal-tasks" data-review-list></div>`;
  function refresh() {
    const items=studyReviewItems(getRecords(),{status:target.querySelector('[data-review-status]').value,range:target.querySelector('[data-review-range]').value,keyword:target.querySelector('[data-review-keyword]').value});
    target.querySelector('[data-review-count]').textContent=`当前筛选 ${items.length} 题`;
    const list=target.querySelector('[data-review-list]');
    list.innerHTML=items.map((item,i)=>{
      const {record,question,last,attempts,wrong}=item;
      const status=question.kind==='oral'?`自评：${oralRatings[last.selfRating]||'尚未标记'}`:last.answer===question.correctIndex?`最近与参考一致${wrong?' · 曾答错，继续保留':''}`:'最近与参考不一致';
      return `<article class="personal-task"><div class="task-content"><span class="eyebrow">${escape(academicRanges[record.drill.settings.range].label)} · ${escape(question.topic)} · 已作答 ${attempts.length} 次</span><h3>${escape(question.stem)}</h3><p>${escape(status)}</p><button class="secondary-button" data-review-retry="${i}">隐藏答案再练 ↗</button></div></article>`;
    }).join('')||'<p class="muted">当前筛选没有题目。完成作答后，错题和需要再练的口头题会在这里整理。</p>';
    list.querySelectorAll('[data-review-retry]').forEach(b=>b.addEventListener('click',()=>{const item=items[Number(b.dataset.reviewRetry)];onRetry(item.record.id,item.question.id);}));
  }
  target.querySelectorAll('select').forEach(el=>el.addEventListener('change',refresh));
  target.querySelector('input').addEventListener('input',refresh);
  refresh();return refresh;
}
