import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, answerSession } from '../public/engine.js';

test('vague answer gets one follow-up and original session is immutable', () => {
  const s = createSession('project');
  const next = answerSession(s, '做了一个网站');
  assert.equal(next.current, 0);
  assert.equal(next.followup, true);
  assert.equal(s.turns.length, 0);
  assert.equal(answerSession(next, '还是不太会解释').current, 1);
});
test('related terms move on but never produce a numeric score', () => {
  const s = answerSession(createSession('cache'), '热点查询数据，减少数据库访问');
  assert.equal(s.current, 1);
  assert.equal(s.evidence.purpose.status, '发现相关线索');
  assert.equal('score' in s.evidence.purpose, false);
});
test('explicit uncertainty is not treated as mastery even if it contains terms', () => {
  let s = createSession('cache');
  s = answerSession(s, '不知道热点数据库是什么');
  assert.equal(s.current, 1);
  assert.deepEqual(s.evidence.purpose.hits, []);
});
test('skip completes all branches without invented evidence and prevents further answers', () => {
  let s = createSession('concurrency');
  for (let i = 0; i < 4; i++) s = answerSession(s, '跳过');
  assert.ok(s.completedAt);
  assert.equal(s.turns.length, 4);
  assert.ok(Object.values(s.evidence).every(e => e.status === '已跳过'));
  assert.throws(() => answerSession(s, '继续'));
});
test('empty and oversized answers are rejected', () => {
  const s = createSession('project');
  assert.throws(() => answerSession(s, '  '));
  assert.throws(() => answerSession(s, '字'.repeat(5001)));
});
