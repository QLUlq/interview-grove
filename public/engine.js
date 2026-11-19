// The tree stores assessment intentions. Wording and answer interpretation can later
// be replaced with a model adapter without changing session persistence or the UI.
import { interviewModes, createVerification, answerVerification } from './framework.js';
export const topics = {
  ...interviewModes,
  project: { name: '项目深挖', subtitle: '从你的真实经历出发', nodes: [
    { id: 'ownership', label: '个人职责', question: '先聊聊你最近参与的一个项目。它解决什么问题，你具体负责了哪一部分？', cues: ['负责', '实现', '设计', '开发', '独立', '编写'], followup: '你提到了项目的整体情况。能选一个你亲自完成的功能，具体说说输入、处理过程和输出吗？', target: '说清个人贡献与具体实现' },
    { id: 'decision', label: '方案选择', question: '在你负责的部分，有哪个技术选择是需要权衡的？你比较过哪些方案，最后为什么这样选？', cues: ['因为', '对比', '权衡', '选择', '相比', '考虑', '成本'], followup: '如果换成另一个方案，会增加什么成本或限制？请结合你项目当时的条件说明。', target: '解释设计依据与取舍' },
    { id: 'failure', label: '异常与边界', question: '如果你负责的这个功能遇到依赖服务超时，或者同一个请求重复到达，会发生什么？你会怎样处理？', cues: ['重试', '幂等', '超时', '回滚', '降级', '补偿', '去重'], followup: '我们把场景缩小：请求已经执行成功，但响应丢失，用户再次提交。你会怎样避免重复执行？', target: '识别失败场景并给出处理方式' },
    { id: 'validation', label: '验证与反思', question: '你怎样验证这些设计确实有效？如果再做一次，你最想改进什么？', cues: ['测试', '压测', '指标', '日志', '验证', '监控', '对比'], followup: '可以给出一个具体的测试场景，以及你会用什么现象或指标判断它通过了吗？', target: '给出可执行的验证方法' }
  ] },
  cache: { name: '缓存设计', subtitle: '从实现走向边界条件', nodes: [
    { id: 'purpose', label: '使用场景', question: '假设你要为一个查询接口加入缓存，你会缓存什么数据？为什么这里适合使用缓存？', cues: ['读取', '查询', '频繁', '热点', '读多', '数据库', '延迟'], followup: '能举一个具体接口吗？说说它的数据变化频率，以及缓存能减少哪部分开销。', target: '将缓存方案与实际访问特点关联' },
    { id: 'consistency', label: '更新一致性', question: '现在这份数据发生了更新，你会怎样安排数据库与缓存的操作顺序？为什么？', cues: ['删除', '失效', '更新数据库', '先更新', '过期', 'ttl'], followup: '假设数据库更新成功，但缓存操作失败，用户会读到什么？你会如何补救？', target: '说明更新顺序及其风险' },
    { id: 'failure', label: '失败恢复', question: '如果缓存删除失败，或者缓存服务暂时不可用，你会怎样处理？', cues: ['重试', '消息', '队列', '补偿', '降级', '限流', '过期'], followup: '如果你选择重试，重试在哪里执行？一直失败时，怎样避免无限重试拖垮系统？', target: '给出有边界的异常处理方案' },
    { id: 'validation', label: '效果验证', question: '方案上线前，你会如何验证它的性能收益和一致性？哪些指标值得观察？', cues: ['命中', '延迟', '测试', '压测', '监控', '错误', '吞吐'], followup: '请设计一次数据库更新与并发读取同时发生的测试，说明你如何发现旧数据。', target: '用测试和指标验证设计' }
  ] },
  concurrency: { name: '并发与库存', subtitle: '让方案经得起并发追问', nodes: [
    { id: 'atomicity', label: '库存扣减', question: '一个商品只剩 10 件，同时有 100 个购买请求。你会怎样设计库存扣减，避免超卖？', cues: ['原子', '条件更新', '锁', '事务', 'lua', 'cas', '乐观'], followup: '如果先查询库存再执行扣减，两个请求可能读到相同库存。你的方案如何避免这一步竞争？', target: '识别并发竞争并保证扣减原子性' },
    { id: 'idempotency', label: '重复请求', question: '用户因网络问题重复提交同一笔订单，你如何避免重复扣减库存？', cues: ['幂等', '唯一', '订单号', '去重', '请求id', '请求 id'], followup: '用于去重的标识由谁生成、保存在哪里？两个重复请求同时到达时，怎样保证只有一个成功？', target: '说明去重标识与并发保障' },
    { id: 'compensation', label: '失败补偿', question: '库存扣减成功，但订单创建失败了。你会怎样让库存恢复到合理状态？', cues: ['补偿', '回滚', '事务', '消息', '重试', '对账'], followup: '如果恢复库存的操作也失败了，你怎样发现并最终修复这笔不一致的数据？', target: '解释跨步骤失败的恢复方式' },
    { id: 'verification', label: '并发验证', question: '你会怎样测试这套方案？请说明并发条件，以及测试结束后必须成立的结果。', cues: ['压测', '并发', '测试', '总量', '库存', '订单', '验证'], followup: '除了不出现负库存，你还会核对成功订单数、扣减次数和最终库存之间的什么关系？', target: '定义可检查的并发正确性条件' }
  ] }
};

export function createSession(topic, project = '', options = {}) {
  if (interviewModes[topic]) return createVerification(topic, project, options);
  if (!topics[topic]) throw new Error('Unknown topic');
  return { version: 1, id: crypto.randomUUID(), topic, project, startedAt: Date.now(), completedAt: null, current: 0, followup: false, turns: [], evidence: {}, messages: [{ role: 'assistant', text: topics[topic].nodes[0].question }] };
}

export function answerSession(session, answer) {
  if (session.version === 2) return answerVerification(session, answer);
  if (session.completedAt) throw new Error('Session already completed');
  const text = answer.trim();
  if (!text || text.length > 5000) throw new Error('请输入 1–5000 字的回答');
  const next = structuredClone(session);
  const nodes = topics[next.topic].nodes;
  const node = nodes[next.current];
  const unsure = /不知道|不清楚|不会|没做过|不了解|想不起来/.test(text);
  const skip = /^(跳过|跳过这题|下一题)[。！!\s]*$/.test(text);
  const hits = unsure || skip ? [] : node.cues.filter(cue => text.toLowerCase().includes(cue));
  next.messages.push({ role: 'user', text });
  next.turns.push({ node: node.id, text, hits, followup: next.followup, skip, unsure });
  const existing = next.evidence[node.id] || { label: node.label, target: node.target, samples: [], hits: [], status: '待确认' };
  existing.samples.push(text);
  existing.hits = [...new Set([...existing.hits, ...hits])];
  existing.status = existing.hits.length ? '发现相关线索' : skip ? '已跳过' : '待进一步练习';
  next.evidence[node.id] = existing;
  // Bound each topic to one follow-up. Skip explicit uncertainty rather than
  // repeatedly pressuring the candidate. Keyword evidence is never a score.
  if (!next.followup && !skip && !unsure && hits.length < 2) {
    next.followup = true;
    next.messages.push({ role: 'assistant', text: node.followup });
  } else {
    next.current++;
    next.followup = false;
    if (next.current >= nodes.length) {
      next.completedAt = Date.now();
      next.messages.push({ role: 'assistant', text: '这一轮先到这里，感谢你的分享。你可以在复盘中回看回答，并选择下一步要练习的方向。' });
    } else {
      next.messages.push({ role: 'assistant', text: `${unsure ? '可以，我们先换一个角度。\n\n' : ''}${nodes[next.current].question}` });
    }
  }
  return next;
}
