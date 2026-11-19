// Shared verification engine. Rules surface questions, never verdicts about truth,
// personality, academic potential or political beliefs. No model is connected yet.
import { academicNodes } from './academic.js';
export const frameworkVersion = 'verification-1';
const node = (id, label, target, question, followup, types) => ({ id, label, target, question, followup, types, cues: [] });
export const interviewModes = {
  job: { name: '求职面试', subtitle: '从经历到行动，再到结果', nodes: [
    node('ownership', '经历与贡献', '区分团队背景与个人职责', '选一段与你目标岗位相关的经历。它解决了什么问题，你个人负责什么？', '聚焦你亲自完成的一项工作，能具体描述当时的任务和你的行动吗？', ['行为']),
    node('decision', '决策与依据', '说明选择所依赖的约束和假设', '在这段经历中，你做过什么重要选择？当时有哪些限制，为什么选这个方案？', '如果换一个方案，成本或风险会怎样变化？', ['情境', '技术']),
    node('results', '结果与验证', '核实结果的衡量方法和归因依据', '这项工作的结果如何？你用什么方法确认它有效，又怎样区分个人贡献和其他因素？', '请选一个结果，说清对比基线、观察周期和数据来源；没有数据也可以说明其他验证方法。', ['行为', '职能']),
    node('motivation', '选择与匹配', '说明目标选择与岗位要求的联系', '你为什么选择这个岗位？结合一项实际工作要求，说说它与你的经历和期待怎样匹配。', '如果入职后的任务与你的预期不同，你会先了解哪些情况，再决定怎么适应？', ['动机', '组织匹配'])
  ] },
  academic: { name: '考研复试', subtitle: '从概念到依据，再到边界与迁移', nodes: [
    node('concept', '概念与结构', '说明概念含义及其与相关知识的关系', '围绕你选择的专业知识点，请用自己的话解释它解决什么问题，以及它与相关概念的联系。', '能举一个具体例子，把这个概念的输入、过程或结果说清楚吗？', ['专业基础']),
    node('basis', '依据与选择', '解释方法成立所需的条件', '在什么条件下你会使用这个方法或理论？请说明选择它的依据。', '如果不用这个方法，你会考虑什么替代方法，依据有什么不同？', ['专业基础', '学术思考']),
    node('boundary', '边界与反例', '识别方法失效或不适用的情形', '它在哪些情况下不适用？可以构造一个反例，或说明一个关键假设失效后的结果吗？', '只改变一个条件，你认为哪个条件最可能让原来的结论不成立？为什么？', ['专业基础', '学术思考']),
    node('transfer', '场景迁移', '在新约束下重新判断结论是否成立', '把应用场景换成资源更有限、数据更少或规模更大的情况，你会怎样重新判断这个方法是否适用？任选一种变化展开。', '请选一个改变后的约束，说明哪些结论还能保留，哪些需要重新验证。', ['学术思考']),
    node('motivation', '研究与动机', '将读研兴趣关联到已有经历和可探索问题', '结合本科课程、毕业论文或项目，说一个你希望读研后继续研究的问题，以及你准备怎样开始了解它。', '你会先阅读什么类型的资料，或做什么小实验，来判断这个问题是否值得继续研究？', ['自我认知', '读研认知'])
  ] }
};

const has = (text, expression) => expression.test(text);
export function detectSignals(text, mode) {
  const signals = [];
  const add = (id, label, pattern) => { const match = text.match(pattern); if (match) signals.push({ id, label, quote: match[0] }); };
  // An inability claim must be about knowledge/experience, not domain wording
  // such as “不会超卖” or “不知道请求是否成功”. Still a heuristic, not semantics.
  add('uncertain', '表达了知识或经验的不确定', /(?:这[个道题方面问题知识点]+)?(?:不太清楚|不了解|没学过|没做过|没接触过|想不起来|目前了解不深)|(?:我|这个问题我)(?:不知道|不会|不清楚)|^(?:不知道|不会|不清楚)[。！!\s]*$/);
  if (mode === 'job') {
    if (!has(text, /(?:我(?:个人|主要|具体|独立|负责|实现|设计|完成|编写|做)|由我|本人)/)) add('ownership', '团队表述中的个人行动待澄清', /我们|团队|大家/);
    if (!has(text, /基线|基准|数据来源|监控|日志|统计|对照|测试|样本|观察周期/)) add('measurement', '结果口径待澄清', /效果不错|效果很好|提升了?|降低了?|提高了?|\d+(?:\.\d+)?\s*[%％]/);
    add('convention', '选择依据待澄清', /大家都用|都这么做|行业惯例|主流方案/);
  }
  if (mode === 'academic') add('absolute', '绝对表述的适用范围待澄清', /一定成立|总是成立|任何情况|永远|绝对正确|没有局限/);
  return signals;
}

const questions = {
  ownership: '你提到了团队的工作。能把其中你个人负责的一项行动单独展开吗？',
  measurement: '你提到了效果变化。这个结果和什么基线比较，观察了多久，依据来自哪里？没有量化数据也可以说明其他证据。',
  convention: '除了常见或流行，结合当时的限制，这个选择具体解决了什么问题？',
  absolute: '这个结论需要哪些前提？试着改变一个前提，看看它是否仍然成立。',
  uncertain: '可以先停在你确定的范围。你愿意关联一个已学过的概念，说明你认为二者可能有什么联系吗？也可以直接跳过。'
};

export function createVerification(topic, project = '', options = {}) {
  const mode = interviewModes[topic];
  if (!mode) throw new Error('Unknown interview mode');
  const anchor = String(options.anchor || '').trim().slice(0, 160);
  if (topic === 'academic' && !anchor) throw new Error('请填写一个要练习的专业知识点');
  const s = { version: 2, frameworkVersion, id: crypto.randomUUID(), topic, project, anchor, startedAt: Date.now(), completedAt: null, current: 0, followup: false, followupCount: 0, turns: [], evidence: {}, decisions: [], askedRules: [], messages: [] };
  s.messages.push({ role: 'assistant', text: opening(s, mode.nodes[0]) });
  return s;
}
function opening(session, node) {
  return `${session.anchor ? `本轮${session.topic === 'academic' ? (session.academic ? '复试范围' : '知识锚点') : '目标岗位'}：${session.anchor}。\n\n` : ''}${node.question}`;
}

export function answerVerification(session, answer) {
  if (session.frameworkVersion !== frameworkVersion) throw new Error('题树版本不匹配，原记录仍可查看，请开始新面试');
  if (session.completedAt) throw new Error('Session already completed');
  const text = answer.trim();
  if (!text || text.length > 5000) throw new Error('请输入 1–5000 字的回答');
  const next = structuredClone(session), nodes = academicNodes(next, interviewModes[next.topic].nodes), n = nodes[next.current];
  const skip = /^(跳过|跳过这题|下一题)[。！!\s]*$/.test(text);
  const signals = skip ? [] : detectSignals(text, next.topic);
  const unsure = signals.some(signal => signal.id === 'uncertain');
  const e = next.evidence[n.id] ||= { label: n.label, target: n.target, samples: [], hits: [], signals: [], status: '已记录，待核实' };
  e.samples.push(text);
  e.signals.push(...signals.map(signal => ({ ...signal, sample: e.samples.length - 1 })));
  e.status = skip ? (e.samples.length === 1 ? '已跳过' : '已记录，结束追问') : unsure ? '已表达不确定' : '已记录，待核实';
  next.messages.push({ role: 'user', text });
  next.turns.push({ node: n.id, text, signals, skip, unsure, followup: next.followup });
  const used = id => next.askedRules.includes(`${n.id}:${id}`);
  const followups = next.followupCount || 0;
  let rule, action, question;
  if (next.turns.length >= 12) { action = 'finish'; rule = 'session-budget'; }
  else if (skip) { action = 'advance'; rule = 'explicit-skip'; }
  else if (unsure) {
    if (next.topic === 'academic' && !used('uncertain') && followups < 2 && !/关联|联系|类似|学过|但是我知道/.test(text)) { action = 'followup'; rule = 'uncertain'; question = questions.uncertain; }
    else { action = 'advance'; rule = 'respect-uncertainty'; }
  } else if (followups < 2) {
    const signal = signals.find(item => !used(item.id));
    if (signal) { action = 'followup'; rule = signal.id; question = questions[rule]; }
    else if (followups === 0 && text.length < 45) { action = 'followup'; rule = 'clarify'; question = n.followup; }
    else { action = 'advance'; rule = 'continue-plan'; }
  } else { action = 'advance'; rule = 'node-budget'; }
  next.decisions.push({ node: n.id, action, rule, answerIndex: next.turns.length - 1, signals });
  if (action === 'followup') {
    next.askedRules.push(`${n.id}:${rule}`); next.followup = true; next.followupCount = followups + 1;
    next.messages.push({ role: 'assistant', text: question });
  } else {
    if (action === 'advance') next.current++;
    next.followup = false; next.followupCount = 0;
    if (next.current >= nodes.length || action === 'finish') {
      next.completedAt = Date.now(); next.finishReason = action === 'finish' ? 'question-budget' : 'plan-completed';
      next.messages.push({ role: 'assistant', text: '这一轮先到这里。复盘会保留你的回答和需要进一步澄清的线索，方便下一次练习。' });
    } else next.messages.push({ role: 'assistant', text: `${unsure ? '可以，我们换一个方向。\n\n' : ''}${opening(next, nodes[next.current])}` });
  }
  return next;
}
