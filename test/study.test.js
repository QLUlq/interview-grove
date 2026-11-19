import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createVerification } from '../public/framework.js';
import { academicReviewTasks, completePractice } from '../public/practice.js';
import { recordTrack, createStudy, submitStudy, studyResult, validStudy, validStudyQuestions, questionKey, rateStudy, studyReviewItems } from '../public/study.js';
import { generateStudyQuestions, validateSession } from '../model.mjs';
import { Store, studyProfile } from '../store.mjs';
import { createServer } from '../server.mjs';
const academic={major:'计算机技术',range:'cs408',scope:'只练操作系统'};
const config={key:'test-only',base:'https://example.invalid',model:'test'};
const rawQuestions=Array.from({length:3},(_,i)=>({stem:`操作系统练习${i+1}？`,topic:'进程',options:['选项甲','选项乙','选项丙','选项丁'],correctIndex:1,explanation:'参考要点：选项乙对应本题条件。'}));
const questions=rawQuestions.map((q,i)=>({...q,id:`q${i}`,kind:'choice'}));
const reply=raw=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(raw)}}]});
function source(){const s=createVerification('academic','',{anchor:'操作系统'});s.turns=[{node:'concept',text:'我理解进程的基本概念。'},{node:'basis',text:'这里我还没理解。'}];s.messages=[{role:'assistant',text:'进程是什么？'},{role:'user',text:s.turns[0].text},{role:'assistant',text:'如何理解调度？'},{role:'user',text:s.turns[1].text}];s.completedAt=Date.now();return s;}
test('history directions include legacy job topics and academic review contains every original question',()=>{
  const s=source(),job=createVerification('job'),before=structuredClone(s);
  for(const topic of ['job','project','cache','concurrency'])assert.equal(recordTrack({topic}),'job');
  assert.equal(recordTrack(s),'academic');
  const tasks=academicReviewTasks([s,job]);assert.equal(tasks.length,2);assert.deepEqual(tasks.map(t=>t.question),['进程是什么？','如何理解调度？']);
  const attempt=completePractice(tasks[0],'进程是程序的一次执行过程，具有自己的资源。');
  assert.equal(academicReviewTasks([attempt,s]).length,2);assert.equal(academicReviewTasks([attempt,s])[0].attempts.length,1);assert.deepEqual(s,before);
});
test('choice attempts preserve drafts and prior answers; oral references do not create correctness claims',()=>{
  const s=createStudy(academic,questions);s.drill.drafts.q0=0;const original=structuredClone(s);
  const next=submitStudy(s,'q0',0);assert.deepEqual(s,original);assert.equal(next.drill.drafts.q0,undefined);assert.equal(studyResult(questions[0],next.drill.attempts[0]).correct,false);
  const again=submitStudy(next,'q0',1);assert.equal(again.drill.attempts.length,2);assert.equal(studyResult(questions[0],again.drill.attempts[1]).correct,true);
  assert.equal(again.completedAt,null);assert.throws(()=>submitStudy(s,'q0',-1));assert.throws(()=>submitStudy(s,'q0',4));assert.throws(()=>submitStudy(s,'missing',1));
  const oral=createStudy(academic,[{id:'oral',kind:'oral',topic:'进程',stem:'进程是什么？',reference:'程序的一次执行过程。'}]);
  assert.throws(()=>submitStudy(oral,'oral',null));const done=submitStudy(oral,'oral','程序的一次执行过程');assert.ok(done.completedAt);assert.equal(studyResult(done.drill.questions[0],done.drill.attempts[0]).correct,undefined);
  assert.throws(()=>validateSession(done,'下一题'),/专项/);
});

test('review keeps earlier mistakes after correct retries and filters actual saved topics and ranges',()=>{
  const original=createStudy(academic,questions);
  assert.equal(studyReviewItems([original]).length,0);
  const wrong=submitStudy(original,'q0',0),correct=submitStudy(wrong,'q0',1);
  const other=submitStudy(createStudy({major:'电子信息',range:'signals',scope:'卷积'},[{id:'convolution',kind:'oral',topic:'卷积的意义',stem:'卷积如何求输出？',reference:'仅用于线性时不变系统，结合输入和冲激响应。'}]),'convolution','将输入与冲激响应做卷积。');
  const items=studyReviewItems([correct,other]);assert.equal(items.length,2);
  assert.equal(items.find(i=>i.wrong).last.answer,1);assert.equal(items.find(i=>i.wrong).attempts.length,2);
  assert.equal(studyReviewItems([correct,other],{status:'wrong'}).length,1);
  assert.equal(studyReviewItems([correct,other],{range:'signals',keyword:'卷积'}).length,1);
  assert.equal(studyReviewItems([correct,other],{range:'signals',keyword:'操作系统'}).length,0);
  assert.equal(studyReviewItems([correct,other],{keyword:'操作系统'}).length,1);
  assert.equal(studyReviewItems([{...correct,topic:'job'}, {...other,testRun:{kind:'ai-dogfood'}}]).length,0);
  const clean=submitStudy(original,'q0',1);assert.equal(studyReviewItems([clean]).length,0);assert.equal(studyReviewItems([clean],{status:'all'}).length,1);
});

test('oral self ratings belong to individual attempts, reset on retry and retain previous self assessments',()=>{
  const oral=createStudy(academic,[{id:'oral',kind:'oral',topic:'进程',stem:'进程是什么？',reference:'程序的一次执行过程。'}]);
  assert.throws(()=>rateStudy(oral,'oral','understood'));
  const answered=submitStudy(oral,'oral','我还不清楚。');
  assert.equal(studyReviewItems([answered]).length,1);
  for(const rating of ['unsure','practice','understood']){
    const rated=rateStudy(answered,'oral',rating);assert.equal(validStudy(rated.drill),true);
    assert.equal(studyReviewItems([rated]).length,rating==='understood'?0:1);
    assert.equal(studyReviewItems([rated],{status:'understood'}).length,rating==='understood'?1:0);
  }
  const understood=rateStudy(answered,'oral','understood'),retry=submitStudy(understood,'oral','我会用新的例子解释。');
  assert.equal(retry.drill.attempts[0].selfRating,'understood');assert.equal(retry.drill.attempts[1].selfRating,undefined);
  assert.equal(studyReviewItems([retry]).length,1);assert.equal(answered.drill.attempts[0].selfRating,undefined);
  retry.drill.drafts.oral='还在编辑';assert.throws(()=>rateStudy(retry,'oral','understood'));
  assert.throws(()=>rateStudy(answered,'oral','mastered'));assert.throws(()=>rateStudy(submitStudy(createStudy(academic,questions),'q0',1),'q0','understood'));
  assert.equal(validStudy({...answered.drill,attempts:[{...answered.drill.attempts[0],selfRating:'mastered'}]}),false);
});
test('account persistence validates question banks and drafts, and excludes drills from interview profiles',async()=>{
  const store=new Store(':memory:');try{const a=await store.authenticate('study_a','test-only-password',true,'a'),b=await store.authenticate('study_b','test-only-password',true,'b');
    const s=createStudy(academic,questions);s.drill.drafts.q0=2;const answered=submitStudy(s,'q1',1);
    const oral=rateStudy(submitStudy(createStudy(academic,[{id:'oral',kind:'oral',topic:'进程',stem:'进程是什么？',reference:'程序的一次执行过程。'}]),'oral','程序的一次执行过程。'),'oral','practice');
    assert.equal(store.save(a.user,[answered,oral],0),1);assert.deepEqual(store.state(store.db.prepare('SELECT * FROM users WHERE id=?').get(a.user.id)).records,[answered,oral]);assert.deepEqual(store.state(b.user).records,[]);
    assert.deepEqual(studyProfile([answered]),studyProfile([]));
    assert.throws(()=>store.save(a.user,[{...s,drill:{...s.drill,drafts:{q0:8}}}],1));
    assert.throws(()=>store.save(a.user,[{...s,drill:{...s.drill,questions:[{...questions[0],correctIndex:5}]}}],1));
    assert.throws(()=>store.save(a.user,[{...answered,drill:{...answered.drill,attempts:[{...answered.drill.attempts[0],selfRating:'understood'}]}}],1));
  }finally{store.close();}
});
test('question generation sends actual source question and rejects another account source before model calls',async()=>{
  const s=source();let calls=0;
  const result=await generateStudyQuestions({academic,kind:'choice',source:{sessionId:s.id,index:1}},config,async(url,options)=>{calls++;const payload=JSON.parse(JSON.parse(options.body).messages[1].content);assert.equal(payload.sourceQuestion,'如何理解调度？');assert.equal(payload.scope,'只练操作系统');assert.equal(payload.count,1);assert.equal(payload.answer,undefined);return reply({questions:rawQuestions.slice(0,1)});},[s]);
  assert.equal(result.questions.length,1);assert.equal(validStudyQuestions(result.questions),true);assert.equal(calls,1);
  await assert.rejects(generateStudyQuestions({academic,kind:'choice',source:{sessionId:s.id,index:1}},config,()=>assert.fail('foreign source must not call provider'),[]),{status:400});
});
test('duplicate and malformed generated options fail; mathematical signs remain significant',async()=>{
  assert.notEqual(questionKey('x(t)'),questionKey('-x(t)'));
  const existing=createStudy(academic,questions);
  await assert.rejects(generateStudyQuestions({academic,kind:'choice',count:3},config,async()=>reply({questions:rawQuestions}),[existing]));
  assert.equal(validStudyQuestions([{...questions[0],options:['一样','一样','丙','丁']}]),false);
  assert.equal(validStudy({...existing.drill,drafts:{unknown:1}}),false);
});
test('generation endpoint requires login, matching owner and same origin; saved banks stay account scoped',async t=>{
  const store=new Store(':memory:'),a=await store.authenticate('study_http_a','test-only-password',true,'a'),b=await store.authenticate('study_http_b','test-only-password',true,'b');
  const s=source();store.save(a.user,[s],0);let calls=0;
  const server=createServer(config,async()=>{calls++;return reply({questions:rawQuestions.slice(0,1)});},store);server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();store.close();});const base=`http://127.0.0.1:${server.address().port}`;
  const request=(auth,owner,origin=base)=>fetch(base+'/api/academic/questions',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...(auth?{Cookie:`interview_session=${auth.token}`}:{})},body:JSON.stringify({academic,kind:'choice',owner,source:{sessionId:s.id,index:0}})});
  assert.equal((await request(null,'guest')).status,401);assert.equal((await request(a,'wrong')).status,409);assert.equal((await request(a,a.user.name,'https://other.invalid')).status,403);assert.equal((await request(b,b.user.name)).status,400);assert.equal(calls,0);
  const good=await request(a,a.user.name);assert.equal(good.status,200);assert.equal((await good.json()).questions.length,1);assert.equal(calls,1);
});
