import { topics } from './engine.js';
import { academicNodes } from './academic.js';
import { contextualNodes, sessionContext } from './interview-context.js';
export const interviewBudgets = { 10:{main:4,extra:1},20:{main:6,extra:2},30:{main:8,extra:3} };
export const projectApproach = 'project-understanding-v1';
export const projectStages = {
  overview:{label:'整体用途',guide:'选一个实际使用场景，说明这个项目能做什么。只讲你确认过的功能；跟教程完成、尚未理解的部分都可以直接说明。'},
  feature:{label:'功能实现',guide:'从用户的一次操作或一个输入开始，说明系统经过哪些处理、最后产生什么结果。先讲过程，不必背函数名；不确定的环节可以指出来。'},
  flow:{label:'模块协作',guide:'选一条完整的操作路径，说清数据或事件怎样经过几个模块，以及它们怎样配合。没有测量过的延迟或效果不要补造。'},
  verification:{label:'验证与改进',guide:'先说实际观察过的现象，再说还需要怎样验证。已经做过的检查与准备尝试的改进要分开，不必假设项目一定存在故障。'}
};
export function projectStageSequence(count) {
  return ['overview',...Array(count===4?2:count-3).fill('feature'),...(count===4?[]:['flow']),'verification'];
}
export function singleProjectQuestion(question) {
  // Keep the first self-contained question if the model appends another task.
  if(typeof question!=='string')return question;
  const core=question.trim().match(/^[\s\S]*?[?？]/)?.[0]||question.trim();
  return core.replace(/按下(?:物理|机械)按键/g,'进行一次操作').replace(/(?:物理|机械)按键/g,'操作输入').replace(/确保|保证/g,'让');
}
// These are presentation constraints, not a proof that a model understood code.
export function projectQuestionProblem(question,{allowCode=false}={}) {
  if(typeof question!=='string'||!question.trim()||question.length>160)return '问题须为160字以内的一个核心问题';
  if((question.match(/[?？]/g)||[]).length>1)return '一次只能问一个核心问题';
  if(!allowCode&&(/`|->|<<|>>/.test(question)||/\b[\w-]+\.(?:c|h|cpp|hpp|js|ts|py|java|rs)\b/i.test(question)||/\b[A-Za-z_]\w*\s*\(/.test(question)||/\b[A-Za-z]\w*_[A-Za-z0-9_]\w*\b/.test(question)))return '主问题应描述功能和过程，文件名、函数名与表达式放在代码依据中';
  if(/有何优势|有什么优势|为何不直接|为什么不直接/.test(question))return '不要预设方案有优势或作者放弃另一方案的原因';
  if(/物理按键|机械按键|确保|保证|掉电不丢失|不会丢失/.test(question))return '用中性的输入或操作描述，不预设是机械按键，也不把可靠性保证当成事实；请问实现过程或验证方法';
  return '';
}
export function sessionNodes(session) {
  return session.plan?.version===1 ? session.plan.nodes : academicNodes(session, contextualNodes(topics[session.topic].nodes,sessionContext(session),session.topic));
}
export function planCoverage(session) {
  if(!session.plan)return null;
  const answered=new Set(session.turns.filter(t=>!t.skip).map(t=>t.node));
  const skipped=new Set(session.turns.filter(t=>t.skip).map(t=>t.node));
  return {asked:session.plan.nodes.filter(n=>answered.has(n.id)),skipped:session.plan.nodes.filter(n=>!answered.has(n.id)&&skipped.has(n.id)),remaining:session.plan.nodes.filter(n=>!answered.has(n.id)&&!skipped.has(n.id)),deferred:session.plan.deferred||[]};
}
export function canResumeTimedSession(s) {
  return !!(s?.completedAt&&s.finishReason==='time-budget'&&validMaterial(s.material)&&validPlan(s.plan,s.material)&&Array.isArray(s.turns)&&s.turns.length<s.plan.maxAnswers&&s.plan.nodes.some((n,i)=>i>=s.current&&!s.turns.some(t=>t.node===n.id)));
}
export function resumeTimedSession(s) {
  if(!canResumeTimedSession(s))throw new Error('这轮没有可接续的剩余问题');
  const next=structuredClone(s);
  next.current=next.plan.nodes.findIndex((n,i)=>i>=s.current&&!next.turns.some(t=>t.node===n.id));
  next.completedAt=null;delete next.finishReason;delete next.summary;delete next.summaryError;
  next.followup=false;next.followupCount=0;
  if(next.messages.at(-1)?.role==='assistant')next.messages.pop();
  next.messages.push({role:'assistant',text:next.plan.nodes[next.current].question});
  return next;
}
export function validMaterial(m) {
  if(!m||m.version!==1||!['project','resume'].includes(m.kind)||typeof m.summary!=='string'||m.summary.length>2800||!Array.isArray(m.sources)||!m.sources.length||m.sources.length>80||!Array.isArray(m.sections)||!m.sections.length||m.sections.length>12)return false;
  if(m.sources.some(s=>!s||typeof s.id!=='string'||!s.id.trim()||s.id.length>30||typeof s.path!=='string'||s.path.length>180||typeof s.text!=='string'||!s.text.trim()||s.text.length>6500)||m.sources.reduce((n,s)=>n+s.text.length,0)>115000||new Set(m.sources.map(s=>s.id)).size!==m.sources.length)return false;
  if(!m.coverage||m.coverage.included!==m.sources.length||(m.kind==='project'&&(!Number.isInteger(m.coverage.readable)||m.coverage.readable<m.sources.length||!Number.isInteger(m.coverage.clipped)||m.coverage.clipped<0||m.coverage.clipped>m.sources.length)))return false;
  return m.sections.every(s=>s&&typeof s.id==='string'&&typeof s.title==='string'&&s.title.length<=80&&typeof s.detail==='string'&&s.detail.length<=1200&&Array.isArray(s.refs)&&s.refs.length>0&&s.refs.length<=3&&s.refs.every(r=>r&&typeof r.quote==='string'&&r.quote.trim()&&r.quote.length<=400&&m.sources.find(f=>f.id===r.sourceId)?.text.includes(r.quote)))&&new Set(m.sections.map(s=>s.id)).size===m.sections.length;
}
export function validPlan(p,m) {
  const budget=interviewBudgets[p?.minutes];
  if(!budget||p.version!==1||!['project','resume'].includes(p.track)||p.track!==m?.kind||!['whole','module'].includes(p.scope)||typeof p.module!=='string'||p.module.length>200||!Array.isArray(p.nodes)||p.nodes.length!==budget.main||p.maxAnswers!==budget.main+budget.extra||!Array.isArray(p.deferred)||p.deferred.length>12)return false;
  const ids=new Set(m.sections.map(s=>s.id));
  if(p.approach!==undefined&&(p.approach!==projectApproach||p.track!=='project'||p.nodes.some((n,i)=>n?.stage!==projectStageSequence(budget.main)[i]||projectQuestionProblem(n?.question))))return false;
  return new Set(p.nodes.map(n=>n?.id)).size===p.nodes.length&&new Set(p.nodes.map(n=>n?.question)).size===p.nodes.length&&p.nodes.every(n=>n&&typeof n.id==='string'&&n.id.length<=80&&typeof n.label==='string'&&n.label.trim()&&n.label.length<=80&&typeof n.target==='string'&&n.target.trim()&&n.target.length<=300&&typeof n.question==='string'&&n.question.trim()&&n.question.length<=400&&Array.isArray(n.sectionIds)&&n.sectionIds.length>0&&n.sectionIds.length<=3&&n.sectionIds.every(id=>ids.has(id)))&&p.deferred.every(d=>d&&ids.has(d.sectionId)&&typeof d.reason==='string'&&d.reason.length<=200);
}
