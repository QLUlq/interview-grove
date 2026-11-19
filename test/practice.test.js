import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, answerSession } from '../public/engine.js';
import { branchSession } from '../public/branch.js';
import { sessionNodes } from '../public/plan.js';
import { practiceTasks, completePractice, removeRecord } from '../public/practice.js';
import { Store } from '../store.mjs';
import { coachAnswer } from '../model.mjs';
import { mountSummary } from '../public/session-summary.js';

function source() {
  let s=createSession('academic','',{anchor:'TCP'});
  s=answerSession(s,'这个问题我还没理解');
  s=answerSession(s,'我知道网络会传递数据，但不知道具体过程');
  s.summary={version:1,covered:[],unverified:[],nextStep:{answerIndex:1,text:'解释一次传输经过的环节',quote:'我知道网络'}};
  return s;
}

test('single deletion retains branches and repairs ancestry without changing originals',()=>{
  const root=source(), child=branchSession(root,1,sessionNodes(root)), grandchild=branchSession(child,0,sessionNodes(child));
  const other=source(), records=[grandchild,child,root,other], snapshot=structuredClone(records);
  const next=removeRecord(records,child.id);
  assert.deepEqual(next.map(s=>s.id),[grandchild.id,root.id,other.id]);
  assert.equal(next[0].parentId,root.id);assert.equal(next[0].rootId,root.id);
  assert.deepEqual(next[0].messages,grandchild.messages);assert.deepEqual(records,snapshot);
  const detached=removeRecord(next,root.id);
  assert.equal(detached[0].parentId,undefined);assert.equal(detached[0].rootId,grandchild.id);
  assert.deepEqual(removeRecord(detached,'missing'),detached);
});

test('tasks include summary suggestions and uncertainty without counting copied branch prefixes twice',()=>{
  const s=source(), tasks=practiceTasks([s]);
  assert.equal(tasks.length,2);assert.equal(tasks[0].index,1);assert.equal(tasks[0].reason,'整轮复盘建议');
  const branch=branchSession(s,1,sessionNodes(s));
  assert.equal(practiceTasks([branch,s]).length,2);
  const task=tasks[0], attempt=completePractice(task,'我理解先发送数据，接收方会确认收到；重传细节还需要核对。');
  const after=practiceTasks([attempt,s]);
  assert.equal(after.length,2);assert.equal(after.find(t=>t.index===1).attempts[0].id,attempt.id);
  assert.equal(after.find(t=>t.index===0).attempts.length,0);
});

test('single practice saves exactly one revised answer, drops future state and remains coachable',async()=>{
  const s=source(), snapshot=structuredClone(s), task=practiceTasks([s])[0];
  const attempt=completePractice(task,'发送端发送数据，接收端确认；超时后如何重传还需要核对。');
  assert.equal(attempt.turns.length,task.index+1);assert.equal(attempt.finishReason,'single-practice');assert.ok(attempt.completedAt);
  assert.equal(attempt.turns[0].text,s.turns[0].text);assert.equal(attempt.messages.filter(m=>m.role==='user').length,attempt.turns.length);
  assert.equal(attempt.summary,undefined);assert.equal(attempt.parentId,s.id);assert.deepEqual(s,snapshot);
  assert.throws(()=>completePractice(task,'   '));assert.throws(()=>completePractice(task,task.answer));
  const coaching=await coachAnswer(attempt,task.index,{key:'test',base:'https://example.invalid',model:'test'},async()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({strengths:[],improvements:[],rewrite:'发送端发送数据，接收端确认；重传机制仍需核对。',missing:[],nextStep:'核对一次超时重传流程'})}}]}));
  assert.equal(coaching.nextStep,'核对一次超时重传流程');
  const ordinary=branchSession(attempt,task.index,sessionNodes(attempt));assert.equal(ordinary.practiceTask,undefined);
});

test('account saves single practice, drafts and deletion without touching another account',async()=>{
  const store=new Store(':memory:');
  try {
    const a=(await store.authenticate('practice_a','test-pass-123',true,'a')).user;
    const b=(await store.authenticate('practice_b','test-pass-123',true,'b')).user;
    const s=source(), task=practiceTasks([s])[0], attempt=completePractice(task,'我先观察发送和接收的结果，再核对协议中的确认过程。');
    s.practiceDrafts={0:'草稿仍保留'};
    assert.equal(store.save(a,[attempt,s],0),1);assert.equal(store.save(b,[s],0),1);
    const remaining=removeRecord([attempt,s],s.id);assert.equal(store.save(a,remaining,1),2);
    const read=user=>JSON.parse(store.db.prepare('SELECT records FROM users WHERE id=?').get(user.id).records);
    assert.equal(read(a).length,1);assert.equal(read(a)[0].practiceTask.goal,task.goal);assert.equal(read(b)[0].id,s.id);
    assert.throws(()=>store.save(a,[{...attempt,practiceTask:{...attempt.practiceTask,index:99}}],2),/单题练习/);
  } finally { store.close(); }
});

test('opening a single-practice report never automatically spends a whole-interview summary call',t=>{
  const s=source(), task=practiceTasks([s])[0], attempt=completePractice(task,'我先明确确认机制，再核对超时重传的过程。');
  attempt.runtime='ai';
  t.mock.method(globalThis,'fetch',()=>assert.fail('single practice only analyses on explicit request'));
  const host={isConnected:true,innerHTML:''};
  mountSummary(host,attempt,{owner:'test',save:()=>{},onBusy:()=>assert.fail('no background analysis')});
  assert.match(host.innerHTML,/单题重练/);
});
