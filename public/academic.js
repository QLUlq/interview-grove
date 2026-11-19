// These are practice presets, not a promise about any university's syllabus.
export const academicRanges = {
  cs408: { label: '408 · 计算机专业基础', areas: ['数据结构', '计算机组成原理', '操作系统', '计算机网络', '综合应用'], questions: ['顺序表和链表在存储方式上有什么不同？', 'CPU执行一条指令，大致需要经过哪些过程？', '进程和线程有什么区别？', 'TCP为什么需要建立连接？', '从操作系统和网络配合的角度，描述程序发送一条网络消息的大致过程。'] },
  signals: { label: '信号与系统', areas: ['信号与系统基础', '时域分析与卷积', '频域分析', '变换域分析', '采样与应用'], questions: ['怎样判断一个系统是不是线性系统？', '卷积在求线性时不变系统输出时起什么作用？', '傅里叶变换怎样帮助我们理解信号的频率成分？', '拉普拉斯变换的收敛域有什么意义？', '采样频率过低时，为什么可能无法恢复原信号？'] },
  custom: { label: '自定义专业范围', areas: [] }
};
export function academicSettings(input) {
  if (!input || typeof input.major !== 'string' || !input.major.trim() || input.major.length > 120 || !Object.hasOwn(academicRanges, input.range) || typeof input.scope !== 'string' || input.scope.length > 2000 || (input.range === 'custom' && !input.scope.trim())) throw new Error('请填写报考专业并选择练习范围；自定义范围需要填写具体科目或章节。');
  return { version: 1, major: input.major.trim(), range: input.range, scope: input.scope.trim() };
}
export function academicAnchor(profile) { return `${profile.major} · ${academicRanges[profile.range].label}`.slice(0, 160); }
export function validAcademic(profile) {
  try { academicSettings(profile); } catch { return false; }
  return profile.version === 1 && Array.isArray(profile.nodes) && profile.nodes.length === 5 && new Set(profile.nodes.map(n => n?.id)).size === 5 && new Set(profile.nodes.map(n => n?.question)).size === 5 && profile.nodes.every(n => n && typeof n.id === 'string' && n.id.length <= 80 && ['label', 'target', 'question'].every(key => typeof n[key] === 'string' && n[key].trim() && n[key].length <= (key === 'question' ? 180 : 200)));
}
export function academicNodes(session, fallback) { return session.topic === 'academic' && session.academic ? session.academic.nodes : fallback; }
export function academicPresetNodes(profile) {
  const preset = academicRanges[profile.range];
  if (profile.range === 'custom' || profile.scope) throw new Error('自定义科目或限定章节需要使用AI面试；规则体验请使用未限定章节的预设范围。');
  return preset.areas.map((area, i) => ({ id: `academic-${i}`, label: area, target: `了解${area}中的基础概念与实际应用`, question: preset.questions[i], followup: '能用一个简单例子解释你刚才的说法吗？' }));
}
