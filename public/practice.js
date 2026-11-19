import { branchSession } from './branch.js';
import { sessionNodes, projectStages } from './plan.js';
import { reviewTurns } from './review.js';

// Removing one record never cascades to its independently stored branches.
export function removeRecord(records, id) {
  const removed = records.find(s => s.id === id);
  if (!removed) return records;
  const next = records.filter(s => s.id !== id).map(s => structuredClone(s));
  for (const s of next) if (s.parentId === id) {
    if (next.some(p => p.id === removed.parentId) && removed.parentId !== s.id) s.parentId = removed.parentId;
    else delete s.parentId;
  }
  for (const s of next) {
    let root = s, seen = new Set([s.id]);
    while (root.parentId && !seen.has(root.parentId)) {
      const parent = next.find(p => p.id === root.parentId);
      if (!parent) break;
      seen.add(parent.id); root = parent;
    }
    if (s.rootId) s.rootId = root.id;
  }
  return next;
}

function taskKey(s, index, question) {
  return JSON.stringify([s.rootId || s.id, index, question.trim()]);
}

export function practiceTasks(records) {
  const tasks = new Map();
  const sorted = [...records].sort((a, b) => b.startedAt - a.startedAt);
  for (const s of sorted) {
    if (s.practiceTask || s.drill || s.testRun?.kind === 'ai-dogfood') continue;
    const turns = reviewTurns(s, { nodes: sessionNodes(s) });
    const add = (index, goal, reason) => {
      // A branch's copied prefix is already represented by its source record.
      if (s.parentId && records.some(p => p.id === s.parentId) && index < s.branchAt) return;
      const turn = turns[index]; if (!turn || !goal) return;
      const key = taskKey(s, index, turn.question);
      if (!tasks.has(key)) tasks.set(key, { key, session: s, index, question: turn.question, answer: turn.answer, node: turn.node, goal, reason });
    };
    if (s.summary?.nextStep) add(s.summary.nextStep.answerIndex, s.summary.nextStep.text, '整轮复盘建议');
    for (const [index, c] of Object.entries(s.coaching || {})) add(Number(index), c.nextStep, '逐题分析建议');
    for (const item of s.summary?.unverified || []) add(item.answerIndex, item.text, '复盘中的待核实内容');
    s.turns.forEach((t, index) => {
      if (t.unsure || t.skip || /不知道|不清楚|还没理解|不了解|没弄懂/.test(t.text)) {
        const guide = projectStages[turns[index]?.node.stage]?.guide;
        add(index, guide || `用自己的话解释“${turns[index]?.node.label || '这道题'}”，指出一个仍不清楚的环节。`, t.skip ? '上次跳过的问题' : '你提到尚未理解');
      }
    });
    if (!s.summary && !Object.keys(s.coaching || {}).length && turns.length) {
      const index = turns.findIndex((_, i) => !s.parentId || i >= s.branchAt);
      if (index >= 0) add(index, projectStages[turns[index].node.stage]?.guide || '补充一个真实的例子，把过程说清楚；没有做过或尚未确认的部分直接说明。', '原回答自查 · 尚无 AI 建议');
    }
  }
  return [...tasks.values()].map(task => ({ ...task, attempts: sorted.filter(s => s.practiceTask?.key === task.key) }));
}

// One answer, saved immediately. AI advice is optional and cannot block saving.
export function academicReviewTasks(records) {
  const tasks=[];
  for(const s of [...records].sort((a,b)=>b.startedAt-a.startedAt)) {
    if(s.topic!=='academic'||s.practiceTask||s.drill||s.testRun?.kind==='ai-dogfood')continue;
    for(const turn of reviewTurns(s,{nodes:sessionNodes(s)})) {
      if(s.parentId&&records.some(p=>p.id===s.parentId)&&turn.index<s.branchAt)continue;
      const key=taskKey(s,turn.index,turn.question);
      if(tasks.some(t=>t.key===key))continue;
      tasks.push({key,session:s,...turn,goal:'不看原回答，用自己的话解释这道题；不确定的地方直接说明。',attempts:records.filter(r=>r.practiceTask?.key===key)});
    }
  }
  return tasks;
}

export function completePractice(task, answer) {
  const text = answer.trim();
  if (!text || text.length > 5000) throw new Error('请填写 1–5000 字的重答内容');
  if (text === task.answer.trim()) throw new Error('请先修改原回答，补充一点自己的理解');
  const next = branchSession(task.session, task.index, sessionNodes(task.session));
  const node = sessionNodes(next)[next.current];
  const unsure = /不知道|不清楚|还没理解|不了解|没弄懂/.test(text);
  next.turns.push({ node: node.id, label: node.label, target: node.target, text, hits: [], signals: [], followup: next.followup, unsure, source: 'practice' });
  next.messages.push({ role: 'user', text }, { role: 'assistant', text: '这一题已重答并保存。可以对照原回答，或按需生成建议。' });
  const evidence = next.evidence[node.id] ||= { label: node.label, target: node.target, samples: [], hits: [], signals: [], status: '已记录，待核实' };
  evidence.samples.push(text);
  next.decisions.push({ node: node.id, action: 'advance', rule: 'single-practice', reason: '完成一次单题重答，尚未核实理解。', signals: [], answerIndex: task.index });
  next.draft = ''; delete next.practiceDrafts;
  next.completedAt = Date.now(); next.finishReason = 'single-practice';
  next.practiceTask = { key: task.key, sourceId: task.session.id, index: task.index, goal: task.goal };
  next.context = undefined;
  return next;
}
