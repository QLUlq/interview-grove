import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, answerSession } from '../public/engine.js';
import { detectSignals } from '../public/framework.js';

test('team phrasing requests clarification, not an accusation', () => {
  const original = createSession('job');
  const s = answerSession(original, '我们团队做了订单系统，大家一起完成了上线');
  assert.match(s.messages.at(-1).text, /个人负责/);
  assert.equal(s.decisions.at(-1).rule, 'ownership');
  assert.equal(original.turns.length, 0);
  assert.equal(s.evidence.ownership.status, '已记录，待核实');
});
test('team wording with an explicit personal contribution does not trigger ownership rule', () => {
  assert.equal(detectSignals('我们团队做了订单系统，我负责实现订单创建接口', 'job').some(s => s.id === 'ownership'), false);
});
test('result number without a basis prompts measurement once', () => {
  let s = answerSession(createSession('job'), '我负责开发接口，性能提升了50%');
  assert.equal(s.decisions.at(-1).rule, 'measurement');
  s = answerSession(s, '效果不错，提高了50%');
  assert.equal(s.current, 1);
  assert.equal(s.askedRules.filter(rule => rule.endsWith(':measurement')).length, 1);
});
test('clear uncertainty offers academic migration once, then respects refusal', () => {
  let s = createSession('academic', '', { anchor: 'TCP 拥塞控制' });
  assert.match(s.messages[0].text, /TCP 拥塞控制/);
  s = answerSession(s, '我不清楚');
  assert.equal(s.decisions.at(-1).rule, 'uncertain');
  s = answerSession(s, '我不清楚');
  assert.equal(s.current, 1);
  assert.equal(s.decisions.at(-1).rule, 'respect-uncertainty');
});
test('uncertainty already connected to known knowledge moves on', () => {
  const s = answerSession(createSession('academic', '', { anchor: '一致性' }), '目前了解不深，但是我知道它与数据库事务有关');
  assert.equal(s.current, 1);
  assert.equal(s.evidence.concept.status, '已表达不确定');
});
test('ordinary negative domain statement does not imply inability', () => {
  assert.equal(detectSignals('通过原子条件更新保证库存不会超卖', 'job').some(s => s.id === 'uncertain'), false);
});
test('academic mode requires an anchor and respects all skips', () => {
  assert.throws(() => createSession('academic'));
  let s = createSession('academic', '', { anchor: '数据库事务' });
  for (let i = 0; i < 5; i++) s = answerSession(s, '跳过');
  assert.ok(s.completedAt);
  assert.equal(s.turns.length, 5);
  assert.ok(Object.values(s.evidence).every(e => e.status === '已跳过'));
});
test('follow-ups remain bounded and total answer budget cannot be bypassed', () => {
  let s = createSession('academic', '', { anchor: '事务' });
  for (let i = 0; i < 12 && !s.completedAt; i++) {
    s = answerSession(s, i === 11 ? '跳过' : i % 3 === 0 ? '一定成立' : i % 3 === 1 ? '我不清楚' : '我有一点想法');
  }
  assert.ok(s.completedAt);
  assert.ok(s.turns.length <= 12);
  for (const node of new Set(s.turns.map(turn => turn.node))) assert.ok(s.turns.filter(turn => turn.node === node).length <= 3);
  assert.throws(() => answerSession(s, '继续'));
});
test('invalid answers and mismatched versions are rejected', () => {
  const s = createSession('job');
  assert.throws(() => answerSession(s, ' '));
  assert.throws(() => answerSession(s, '字'.repeat(5001)));
  assert.throws(() => answerSession({ ...s, frameworkVersion: 'future' }, '回答'));
});
