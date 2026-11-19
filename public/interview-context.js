// Rebuild from user answers, never from interviewer assumptions or cached labels.
// These are explicit, quoted boundaries; they are not ability assessments.
export function interviewContext(answers) {
  const rules = [
    ['guided', '参考教程或已有实现', /跟(?:着|随)[^。！？\n]{0,30}(?:视频|教程|讲解)|(?:主要|基本)[^。！？\n]{0,12}(?:复用|沿用)|(?:主要|基本)[^。！？\n]{0,12}参考[^。！？\n]{0,15}(?:开源|课程|教程|已有)|(?:跟着|按照)(?:视频|教程)|教程复现/],
    ['notDecisionMaker', '没有独立完成选型', /不是[^。！？\n]{0,25}(?:独立|自主)[^。！？\n]{0,15}(?:选|设计|决定)|(?:没有|没做过|未做过)[^。！？\n]{0,15}(?:选型|方案对比|接口取舍)/],
    ['noIndependentDebug', '尚无可展开的独立排查案例', /(?:没有|还没有|没)[^。！？\n]{0,55}(?:独立排查|独立定位|独立解决|独立调试)/],
    ['causeUnknown', '故障原因或关键修改尚不确定', /(?:不(?:能|太能|知道|清楚)|还需要)[^。！？\n]{0,30}(?:说明|确认|确定|回看|判断)[^。！？\n]{0,35}(?:修改|原因|哪一处)|(?:不知道|不清楚|想不起来)[^。！？\n]{0,25}(?:原因|哪.{0,4}(?:改|解决))/],
    ['noMetrics', '未提供量化测试依据', /(?:没有|没|未)[^。！？\n]{0,30}(?:测量|量化|对照数据|性能数据|帧率|延迟测|压测)|缺乏量化数据/],
    ['manualValidation', '使用实际操作观察结果', /(?:人工|手动|上板|实际操作)[^。！？\n]{0,18}(?:验证|测试|检查)|(?:主观|感觉)[^。！？\n]{0,16}(?:正常|改善|恢复|流畅)/]
  ];
  const facts = [];
  answers.forEach((answer, answerIndex) => {
    for (const clause of answer.split(/(?<=[。！？\n])/u)) {
      for (const [kind, label, pattern] of rules) if (pattern.test(clause)) {
        // Do not interpret a plan, a hypothetical or an explicit negation of
        // tutorial use as a past experience restriction.
        if (/^(?:如果|假设|计划|准备|将来)/.test(clause.trim()) || /(?:并非|不是|没有)(?:跟着|跟随|按照)(?:视频|教程)/.test(clause)) continue;
        const fact = { kind, label, answerIndex, quote: clause.trim().slice(0, 500) };
        const previous = facts.findIndex(f => f.kind === kind);
        if (previous >= 0) facts.splice(previous, 1);
        facts.push(fact);
      }
    }
  });
  return { version: 1, facts, learningBased: facts.some(f => ['guided', 'notDecisionMaker', 'noIndependentDebug'].includes(f.kind)) };
}

export function sessionContext(session, latestAnswer) {
  return interviewContext([...session.turns.map(t => t.text), ...(latestAnswer === undefined ? [] : [latestAnswer])]);
}

export function contextualNodes(nodes, context, topic) {
  if (topic !== 'job' || !context.learningBased) return nodes;
  return nodes.map(n => {
    if (n.id === 'ownership') return { ...n, target: '澄清复用、跟随练习与亲自修改的边界，不预设独立解决过故障', followup: '选一个你接触过的模块，说说它的输入、处理过程和输出。' };
    if (n.id === 'decision') return { ...n, label: '理解与依据', target: '围绕回答中提到的一个模块，考察实现过程或接口衔接的理解；不要求自主选型经历', question: '沿用已有方案时，你能选一个模块，说说它在代码中怎样工作吗？', followup: '请沿着一次输入，说说数据怎样经过这个模块。' };
    if (n.id === 'results') return { ...n, target: '了解亲自观察到的运行现象、验证方法及未验证内容；不预设个人改动起关键作用', question: '你实际操作时观察到了什么结果？选一个现象说明即可。', followup: '当时怎样观察这个现象？没有测量数据也可以说明实际操作过程。' };
    return n;
  });
}

export function respectsContext(question, context, targetId) {
  if (!question || !context.learningBased) return true;
  if (targetId === 'motivation') return true;
  if (/如果|假如|假设|将来|以后/.test(question)) return true;
  return !/(?:你(?:当时|最终|为什么|为何)?(?:选择了|决定采用|选定了)|为什么(?:最终)?(?:选择|决定采用)|你(?:亲自|独立)(?:解决|定位|设计)|(?:你|你的)[^。？]{0,16}(?:起到|发挥)[^。？]{0,8}关键作用)/.test(question);
}
