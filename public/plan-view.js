import { planCoverage, projectApproach, projectStages } from './plan.js';
import { academicRanges } from './academic.js';
import { escapeHTML as escape } from './html.js';
export function sessionTitle(s){const title=s.drill?`复试专项刷题 · ${academicRanges[s.drill.settings.range]?.label||'自定义范围'}`:s.academic?`考研复试 · ${academicRanges[s.academic.range]?.label||'自定义范围'}`:s.plan?(s.plan.track==='project'?'项目技术练习':'简历模拟面试'):null;return s.testRun?.kind==='ai-dogfood'?`AI代测 · ${title||'模拟练习'}`:title;}
export function projectGuideHTML(s,node) {
  const stage=s.plan?.approach===projectApproach&&projectStages[node?.stage];
  return stage?`<details class="project-guide"><summary>回答思路 · ${stage.label}</summary><p>${stage.guide}</p><small>这是组织思路的提示，不是项目实现的标准答案。</small></details>`:'';
}
export function projectOutlineHTML(s) {
  if(s.plan?.approach!==projectApproach)return '';
  return `<section class="plan-coverage project-outline"><h2>把项目讲成一条完整的线</h2><p>先讲用途，再解释功能如何实现，最后说明怎样验证。点击已回答的部分回看；记录了回答不代表已经理解。</p><ol>${s.plan.nodes.map(n=>{
    const i=s.turns.findIndex(t=>t.node===n.id&&!t.skip);
    return `<li><span>${projectStages[n.stage].label}</span> ${i>=0?`<a href="#review-turn-${i}">${escape(n.label)}</a>`:`${escape(n.label)} · 未回答`}</li>`;
  }).join('')}</ol><small>下次可选一条实际操作路径，不看稿讲一遍，再对照运行现象和代码检查缺失环节。</small></section>`;
}
export function projectOutlineText(s) {
  if(s.plan?.approach!==projectApproach)return '';
  return '项目讲解提纲（不是掌握程度评定）\n'+s.plan.nodes.map(n=>`${projectStages[n.stage].label}：${n.label}${s.turns.some(t=>t.node===n.id&&!t.skip)?'':'（未回答）'}`).join('\n')+'\n练习：选一条实际操作路径，不看稿讲一遍，再对照运行现象和代码核对。\n\n';
}
export function materialRefsHTML(s,node) {
  if(!s.plan||!node)return '';
  const sections=s.material.sections.filter(section=>node.sectionIds.includes(section.id));
  return `<details class="question-sources"><summary>${s.plan.track==='project'?'这道题对应的代码':'这道题对应的简历内容'}</summary>${sections.map(section=>`<section><h4>${escape(section.title)}</h4>${section.refs.map(r=>`<p class="source-path">${escape(s.material.sources.find(f=>f.id===r.sourceId)?.path)}</p><pre>${escape(r.quote)}</pre>`).join('')}</section>`).join('')}<small>用于说明出题依据，不代表已经核实你的理解或个人贡献</small></details>`;
}
export function coverageHTML(s) {
  const coverage=planCoverage(s);if(!coverage)return '';
  const list=nodes=>nodes.map(n=>escape(n.label)).join('、')||'无';
  return `<section class="plan-coverage"><h2>本轮考察范围</h2><p>${escape(sessionTitle(s))} · ${s.plan.minutes} 分钟预计时长 · ${s.plan.scope==='module'?`限定 ${escape(s.plan.module)}`:'围绕导入材料'}</p><dl><dt>已回答</dt><dd>${list(coverage.asked)}</dd><dt>已跳过</dt><dd>${list(coverage.skipped)}</dd><dt>还没问到</dt><dd>${list(coverage.remaining)}</dd><dt>留待下一轮的材料要点</dt><dd>${coverage.deferred.map(d=>escape(s.material.sections.find(section=>section.id===d.sectionId)?.title)).join('、')||'无'}</dd></dl><small>这里记录本轮涉及的考察项，不表示已经掌握全部细节；限定范围外、未读取及片段省略的内容没有被完整考察</small></section>`;
}
export function coverageText(s){const c=planCoverage(s);if(!c)return '';return `本轮考察范围：${sessionTitle(s)}\n已回答：${c.asked.map(n=>n.label).join('、')||'无'}\n已跳过：${c.skipped.map(n=>n.label).join('、')||'无'}\n还没问到：${c.remaining.map(n=>n.label).join('、')||'无'}\n留待下一轮：${c.deferred.map(d=>s.material.sections.find(section=>section.id===d.sectionId)?.title).join('、')||'无'}\n\n`;}
