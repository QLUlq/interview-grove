import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createVerification } from '../public/framework.js';
import { answerWithModel, validateDecision, coachAnswer, validateCoaching } from '../model.mjs';
import { createServer } from '../server.mjs';

const config = { key: 'test-only-placeholder', base: 'https://api.example.invalid', model: 'test-model' };
const text = '我们做了一个订单系统，我负责支付接口';
const decision = { action: 'followup', question: '支付成功而订单更新失败时，你负责的接口如何处理？', reason: '个人接口实现的失败路径尚待澄清', evidence: [{ label: '支付接口的具体实现待澄清', quote: '我负责支付接口' }] };
const reply = d => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(d) } }] }));

test('model receives background and history; response preserves evidence without mutating source', async () => {
  const s = createVerification('job', '校园交易项目', { anchor: '后端工程师' });
  const next = await answerWithModel(s, text, config, async (url, options) => {
    assert.equal(url, 'https://api.example.invalid/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer test-only-placeholder');
    const request = JSON.parse(options.body), input = JSON.parse(request.messages[1].content);
    assert.equal(input.background, '校园交易项目'); assert.equal(input.conversation.length, 1);
    assert.equal(input.anchor, '后端工程师'); return reply(decision);
  });
  assert.equal(s.turns.length, 0); assert.equal(next.runtime, 'ai');
  assert.equal(next.messages.at(-1).text, decision.question);
  assert.equal(next.evidence.ownership.signals[0].quote, '我负责支付接口');
});
test('invented evidence and forbidden follow-up are rejected', () => {
  assert.throws(() => validateDecision({ ...decision, evidence: [{ label: '测试', quote: '我用了事务' }] }, text, true, true));
  assert.throws(() => validateDecision(decision, text, false, true));
});
test('advancing changes target and max follow-up budget is enforced', async () => {
  const s = createVerification('job'); s.followupCount = 2;
  await assert.rejects(answerWithModel(s, text, config, async () => reply(decision)));
  const next = await answerWithModel(s, text, config, async () => reply({ ...decision, action: 'advance', question: '当时为什么选择这种支付方案？' }));
  assert.equal(next.current, 1); assert.equal(next.followupCount, 0);
});
test('skip does not invoke provider; missing key never silently uses rules', async () => {
  const s = createVerification('job');
  const next = await answerWithModel(s, '跳过', config, async () => assert.fail('provider must not be called'));
  assert.equal(next.current, 1);
  await assert.rejects(answerWithModel(s, text, { ...config, key: '' }), { status: 503 });
});
test('quota exhaustion is distinguished from rate limiting without disclosing raw errors', async () => {
  await assert.rejects(answerWithModel(createVerification('job'), text, {...config}, async () => new Response(JSON.stringify({ error: { code: 'insufficient_quota', message: 'provider-private-details' } }), { status: 429 })), error => error.message.includes('额度不足') && !error.message.includes('provider-private-details'));
});
test('empty output, repeated questions, network errors and upstream failures preserve original', async () => {
  const s = createVerification('job');
  for (const fetcher of [async () => new Response('{}'), async () => reply({ ...decision, question: s.messages[0].text }), async () => { throw new Error('network'); }, async () => new Response('secret-provider-details', { status: 401 })]) {
    await assert.rejects(answerWithModel(s, text, config, fetcher), error => !error.message.includes('secret-provider-details'));
    assert.equal(s.turns.length, 0);
  }
});
test('HTTP boundary: status hides keys, request works, cross-origin blocked and secrets not served', async t => {
  const server = createServer(config, async () => reply(decision));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const status = await (await fetch(`${base}/api/model/status`)).json();
  assert.deepEqual(status, { configured: true, model: 'test-model' });
  const body = JSON.stringify({ session: createVerification('job'), answer: text });
  const response = await fetch(`${base}/api/interview/answer`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body });
  assert.equal(response.status, 200); assert.equal((await response.json()).session.runtime, 'ai');
  assert.equal((await fetch(`${base}/api/interview/answer`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://other.invalid' }, body })).status, 403);
  assert.equal((await fetch(`${base}/.env`)).status, 404);
  assert.equal((await fetch(`${base}/api/interview/answer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'null' })).status, 400);
});

test('an invalid optional citation is discarded without blocking a valid question', async () => {
  const next = await answerWithModel(createVerification('job'), text, config, async () => reply({ ...decision, evidence: [{ label: 'not grounded', quote: '虚构的原话' }, ...decision.evidence] }));
  assert.equal(next.turns.length, 1);
  assert.deepEqual(next.decisions[0].signals.map(s => s.quote), ['我负责支付接口']);
});

test('malformed response retries once, but authentication never retries', async () => {
  let calls = 0;
  await answerWithModel(createVerification('job'), text, config, async () => ++calls === 1 ? new Response('{}') : reply(decision));
  assert.equal(calls, 2); calls = 0;
  await assert.rejects(answerWithModel(createVerification('job'), text, config, async () => { calls++; return new Response('{}', { status: 401 }); }));
  assert.equal(calls, 1);
});

const coaching = { strengths: [{ text: '个人职责清楚', quote: '我负责支付接口' }], improvements: [{ text: '补充具体实现', quote: '支付接口' }], rewrite: '我们做了一个订单系统，我负责支付接口。具体实现是【待补充：失败路径】。', missing: ['失败后如何处理'], nextStep: '用两句话描述一次失败的处理过程' };
test('coaching restores only quote whitespace and keeps already clear answers without forced improvements', () => {
  const answer = '我结合AI，把开源NWatch移植到STM32F103。\n我还没有独立定位卡顿原因。';
  const raw = { strengths: [{ text: '说明了项目来源和参与方式', quote: '我结合 AI，把开源 NWatch 移植到 STM32F103。 我还没有独立定位卡顿原因。' }], improvements: [], rewrite: answer, missing: [], nextStep: '用自己的话再说一遍项目来源' };
  const result = validateCoaching(raw, answer);
  assert.equal(result.strengths[0].quote, answer);
  assert.equal(result.rewrite, answer);
  assert.deepEqual(result.improvements, []);
  assert.notEqual(raw.strengths[0].quote, answer);
  for (const quote of ['我独立开发了NWatch', '我结合AI把开源NWatch移植到STM32F103。', '我结合AI，把开源NWatch移植到STM32F103。我已经定位了卡顿原因。']) {
    assert.throws(() => validateCoaching({ ...raw, strengths: [{ ...raw.strengths[0], quote }] }, answer));
  }
});

test('coaching validates evidence and only sends the selected question and answer', async () => {
  let s = await answerWithModel(createVerification('job'), text, config, async () => reply(decision));
  s.completedAt = Date.now();
  const result = await coachAnswer(s, 0, config, async (url, options) => {
    const input = JSON.parse(JSON.parse(options.body).messages[1].content);
    assert.equal(input.answer, text); assert.equal(input.question, s.messages[0].text);
    assert.equal(input.conversation, undefined);
    return reply(coaching);
  });
  assert.deepEqual(result, coaching); assert.equal(s.coaching, undefined);
  assert.throws(() => validateCoaching({ ...coaching, strengths: [{ text: '虚构', quote: '从未说过' }] }, text));
  assert.throws(() => validateCoaching({ ...coaching, rewrite: '这有效避免了重复订单。' }, text));
  assert.throws(() => validateCoaching({ ...coaching, nextStep: '没有压测容易减分' }, text));
  await assert.rejects(coachAnswer(s, 3, config));
  await assert.rejects(coachAnswer({ ...s, turns: [{ ...s.turns[0], text: '被篡改' }] }, 0, config));
});

test('coaching HTTP endpoint accepts completed sessions and rejects bad indices and cross-origin requests', async t => {
  const s = await answerWithModel(createVerification('job'), text, config, async () => reply(decision)); s.completedAt = Date.now();
  const server = createServer(config, async () => reply(coaching)); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (index, origin = base) => fetch(`${base}/api/interview/coach`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ session: s, index }) });
  assert.deepEqual((await (await request(0)).json()).coaching, coaching);
  assert.equal((await request(12)).status, 400);
  assert.equal((await request(0, 'https://other.invalid')).status, 403);
});
