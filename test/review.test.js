import test from 'node:test';
import assert from 'node:assert/strict';
import { createVerification, interviewModes } from '../public/framework.js';
import { reviewTurns, coachingHTML } from '../public/review.js';

test('review pairs each question with its answer and the decision that produced that question', () => {
  const s = createVerification('job');
  s.messages.push({ role: 'user', text: '我负责订单' }, { role: 'assistant', text: '为什么选它？' }, { role: 'user', text: '因为成本' });
  s.turns = [{ node: 'ownership', text: '我负责订单' }, { node: 'decision', text: '因为成本' }];
  s.decisions = [{ answerIndex: 0, reason: '需要解释成本', signals: [{ quote: '订单' }] }];
  const turns = reviewTurns(s, interviewModes.job);
  assert.equal(turns[0].question, s.messages[0].text);
  assert.equal(turns[1].question, '为什么选它？');
  assert.equal(turns[1].reason, '需要解释成本');
  assert.equal(turns[1].node.id, 'decision');
});
test('model-generated coaching is escaped before rendering', () => {
  const html = coachingHTML({ strengths: [{ text: '<script>alert(1)</script>', quote: '<img>' }], improvements: [], rewrite: '<svg onload=alert(1)>', missing: [], nextStep: '<button>' });
  assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<svg')); assert.ok(html.includes('&lt;svg'));
});
