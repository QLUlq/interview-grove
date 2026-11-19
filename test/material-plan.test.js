import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {collectProjectFiles,sourceForReading} from '../public/source-material.js';
import {validMaterial,validPlan,sessionNodes,planCoverage,projectStageSequence,projectApproach,canResumeTimedSession,resumeTimedSession} from '../public/plan.js';
import {coverageHTML,coverageText,materialRefsHTML,projectGuideHTML,projectOutlineHTML,projectOutlineText} from '../public/plan-view.js';
import {reviewTurns} from '../public/review.js';
import {extractMaterials,startMaterialInterview,answerWithModel,validateSession,modelConfig,summarizeSession} from '../model.mjs';
import {branchSession} from '../public/branch.js';
import {Store} from '../store.mjs';
import {createServer} from '../server.mjs';
import {mountSummary} from '../public/session-summary.js';
const config={key:'test-placeholder',base:'https://example.invalid',model:'test'};
const reply=raw=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(raw)}}]});
function material(kind='project') {
  const names=['显示缓冲区','红外输入','菜单切换','控球游戏','刷新异常','任务同步'];
  const sources=names.map((n,i)=>({id:`s${i}`,path:`watch/${i===0?'display':'module'+i}.c`,text:`void function_${i}(void) { /* ${n} */ }`}));
  return {version:1,kind,summary:'项目包括显示、红外、菜单与游戏',sources,sections:names.map((title,i)=>({id:`section-${i}`,title,detail:`${title}的调用过程`,kind:kind==='project'?'module':i<2?'project':i===2?'internship':'skill',refs:[{sourceId:`s${i}`,quote:`function_${i}`}]})),coverage:{included:6,readable:6,clipped:0}};
}
function planResponse(m=material(),count=4) {return {nodes:Array.from({length:count},(_,i)=>{
  const section=m.sections[i%m.sections.length],stage=projectStageSequence(count)[i];
  const questions={overview:'这个项目在实际使用时能完成哪些事情？',feature:`围绕${section.title}，第${i+1}个处理环节怎样把输入变成结果？`,flow:`围绕${section.title}，一次操作怎样经过各个相关模块？`,verification:`怎样检查${section.title}是否达到了预期效果？`};
  return {label:section.title,target:'理解功能从输入到结果的过程',question:m.kind==='project'?questions[stage]:`结合${section.title}，function_${i}怎样传递数据？`,sectionIds:[section.id],...(m.kind==='project'?{stage}:{})};
})};}
const start=(m=material(),extra={},fetcher=async()=>reply(planResponse(m)))=>startMaterialInterview({track:m.kind,material:m,minutes:10,...extra},config,fetcher);
const file=(path,text)=>({name:path.split('/').at(-1),webkitRelativePath:path,size:text.length,text:async()=>text});

test('learning plans reject source quizzes and retry with actionable validation feedback',async()=>{
  const m=material();let calls=0;
  const s=await start(m,{},async(url,options)=>{
    const input=JSON.parse(options.body),raw=planResponse(m);calls++;
    if(calls===1)raw.nodes[1].question='buttons.c中的processButton如何用counter <<= 1去抖？';
    else assert.match(input.messages.at(-1).content,/文件名、函数名与表达式/);
    return reply(raw);
  });
  assert.equal(calls,2);assert.equal(s.plan.approach,projectApproach);
  assert.deepEqual(s.plan.nodes.map(n=>n.stage),['overview','feature','feature','verification']);
  assert.match(projectGuideHTML(s,s.plan.nodes[1]),/不必背函数名/);
});

test('a deep-only or leading project plan is rejected and an appended second task is removed',async()=>{
  const m=material();
  await assert.rejects(start(m,{},async()=>{const raw=planResponse(m);raw.nodes[0].stage='feature';return reply(raw);}),/有效内容/);
  const s=await start(m,{},async()=>{const raw=planResponse(m);raw.nodes[1].question='输入是什么？怎样优化CPU占用？';return reply(raw);});assert.equal(s.plan.nodes[1].question,'输入是什么？');
  await assert.rejects(start(m,{},async()=>{const raw=planResponse(m);raw.nodes[1].question='这种算法有何优势？';return reply(raw);}),/有效内容/);
});

test('learning bookends and feature scaffolds do not repeat guessed examples or start with an optimization exam',async()=>{
  const m=material();const s=await start(m,{},async()=>{const raw=planResponse(m);raw.nodes[0].question='这个商业项目解决了什么市场痛点？';raw.nodes[1].question='如何优化按键防抖算法？';raw.nodes[3].question='如何确认未出现的贪吃蛇游戏运行正常？';return reply(raw);});
  assert.match(s.plan.nodes[0].question,/实际使用/);assert.match(s.plan.nodes[1].question,/输入到结果/);assert.ok(!s.plan.nodes[3].question.includes('贪吃蛇'));assert.match(s.plan.nodes[3].question,/运行结果是否符合预期/);
});

test('project reading prioritizes application implementation over vendor code and repeated banners',async()=>{
  const result=await collectProjectFiles([file('watch/Drivers/STM32F1xx_HAL_Driver/Src/stm32f1xx_hal.c','vendor'),file('watch/buttons.c','/* Copyright author */\n/* 函数名称: process */\nvoid process(void) { /* 每位代表一次采样 */ sample(); }')]);
  assert.equal(result.sources.length,1);assert.equal(result.coverage.excluded,1);assert.ok(!result.sources[0].text.includes('Copyright'));assert.match(result.sources[0].text,/每位代表一次采样/);
  assert.equal(sourceForReading('/* Copyright in prose */','notes.md'),'/* Copyright in prose */');
});

test('unused small-file allowance is redistributed to preserve a complete implementation',async()=>{
  const result=await collectProjectFiles([file('watch/main.c','int main(){}'),...Array.from({length:70},(_,i)=>file(`watch/h${i}.h`,'void f();')),file('watch/buttons.c','a'.repeat(4500))]);
  assert.equal(result.sources.find(s=>s.path==='watch/buttons.c').text.length,4500);assert.equal(result.coverage.clipped,0);
});

test('whole-project planning receives all retained code instead of trusting a guessed module summary',async()=>{
  const m=material();m.summary='错误摘要声称SPI显示';m.sections[0].detail='未核实：四个物理按键';m.sources.push({id:'entry',path:'watch/main.c',text:'void main(void){ IRReceiver_Init(); }'});m.coverage.included++;m.coverage.readable++;
  await start(m,{},async(url,options)=>{
    const payload=JSON.parse(JSON.parse(options.body).messages[1].content);
    assert.equal(payload.sources.length,7);assert.equal(payload.overview,undefined);assert.equal(payload.sections[0].detail,undefined);assert.ok(payload.sources.some(s=>s.id==='entry'));return reply(planResponse(m));
  });
});

test('an invalid learning followup advances safely without stranding the answer or inventing evidence',async()=>{
  const s=await start();let calls=0;
  const next=await answerWithModel(s,'我知道遥控器能控制小游戏，但还不懂中间的过程。',config,async(url,options)=>{
    const payload=JSON.parse(options.body);assert.match(payload.messages[0].content,/把问题降为/);calls++;
    return reply({action:'followup',question:calls===1?'DHT11_WaitFor_Val怎样处理超时？':'按下遥控器后，你实际观察到小游戏有什么变化？',reason:'用户已准确理解，符合预期',evidence:[]});
  });
  assert.equal(calls,1);assert.equal(next.current,1);assert.match(next.decisions[0].reason,/下一问了解/);assert.ok(!next.decisions[0].reason.includes('准确'));assert.equal(next.turns[0].text,'我知道遥控器能控制小游戏，但还不懂中间的过程。');
});

test('review explains the current learning question rather than praising the previous answer',async()=>{
  let s=await start();s=await answerWithModel(s,'能显示菜单和运行游戏。',config,async()=>reply({action:'advance',question:'',reason:'已清晰解释并符合预期',evidence:[]}));s=await answerWithModel(s,'跳过',config);
  const turns=reviewTurns(s,{nodes:s.plan.nodes});assert.match(turns[1].reason,/理解功能从输入到结果/);assert.ok(!turns[1].reason.includes('符合预期'));
  assert.match(projectOutlineHTML(s),/未回答/);assert.match(projectOutlineText(s),/不是掌握程度评定/);
  s.plan.nodes[0].label='<img src=x onerror=alert(1)>';
  assert.ok(!projectOutlineHTML(s).includes('<img'));
});

test('legacy project plans remain readable without retroactively rewriting old questions',async()=>{
  const s=await start();delete s.plan.approach;delete s.plan.nodes[0].stage;s.plan.nodes[0].question='解释driver_lcd.c中的LCD_Flush函数。';
  assert.equal(validPlan(s.plan,s.material),true);validateSession(s,'继续');assert.equal(projectGuideHTML(s,s.plan.nodes[0]),'');
  s.plan.approach=projectApproach;assert.equal(validPlan(s.plan,s.material),false);
});

test('project reading keeps relative paths, samples directories and states omission instead of claiming full reading',async()=>{
  const files=[file('watch/.env','key=private'),file('watch/FWLIB/vendor.c','vendor'),file('watch/main.c','int main(){}'),...Array.from({length:90},(_,i)=>file(`watch/module${i%9}/file${i}.c`,'start\n'+'x'.repeat(9000)+'\nend'))];
  const result=await collectProjectFiles(files);
  assert.equal(result.sources.length,80);assert.equal(result.coverage.omitted,11);assert.equal(result.coverage.excluded,2);
  assert.ok(result.sources.some(s=>s.path==='watch/main.c'));assert.ok(result.sources.some(s=>s.path.includes('/module8/')));
  assert.ok(result.sources.every(s=>s.text.length<=6500));assert.ok(result.coverage.characters<=115000);assert.ok(result.coverage.clipped>0);
  assert.ok(!JSON.stringify(result).includes('key=private'));
});

test('legacy Chinese source encoding and CRLF are decoded before model citation checks',async()=>{
  const encoded=Uint8Array.from([0xd6,0xd0,0xce,0xc4,13,10,118,111,105,100,32,102,40,41,59]);
  const {sources}=await collectProjectFiles([{name:'display.c',size:encoded.length,arrayBuffer:async()=>encoded}]);
  assert.equal(sources[0].text,'中文\nvoid f();');
});

test('supported Aliyun Qwen uses explicit non-thinking mode without sending nonstandard flags to other APIs',async()=>{
  const env={INTERVIEW_BASE_URL:'https://dashscope.aliyuncs.com/compatible-mode/v1',INTERVIEW_MODEL:'qwen3.7-plus',INTERVIEW_API_KEY:'test-placeholder'};
  assert.equal(modelConfig(env).enableThinking,false);assert.equal(modelConfig({...env,INTERVIEW_THINKING:'true'}).enableThinking,true);
  assert.equal(modelConfig({...env,INTERVIEW_BASE_URL:'https://api.openai.com/v1'}).enableThinking,undefined);
  await startMaterialInterview({material:material(),track:'project',minutes:10},modelConfig(env),async(url,options)=>{assert.equal(JSON.parse(options.body).enable_thinking,false);return reply(planResponse());});
});

test('project question wording does not attribute existing code configuration to the candidate',async()=>{
  const m=material();const s=await start(m,{},async()=>{const raw=planResponse(m);raw.nodes[1].question='你配置了显示缓存，请解释它的数据结构？';return reply(raw);});
  assert.match(s.plan.nodes[1].question,/代码中配置了/);assert.ok(!s.plan.nodes[1].question.includes('你配置了'));
});

test('source reading sends actual code and refuses invented file citations',async()=>{
  const m=material();let calls=0;
  const {material:result}=await extractMaterials({kind:'project',sources:m.sources},config,async(url,options)=>{
    const content=JSON.parse(JSON.parse(options.body).messages[1].content);assert.equal(content.sources[0].path,'watch/display.c');assert.ok(content.sources[0].text.includes('function_0'));
    calls++;return reply({summary:m.summary,sections:m.sections.map(s=>({title:s.title,detail:s.detail,refs:calls===1?[{sourceId:'not-a-file',quote:'fiction'}]:s.refs}))});
  });
  assert.equal(calls,2);assert.equal(validMaterial(result),true);assert.equal(result.sources[0].text,m.sources[0].text);
  const bad=structuredClone(m);bad.sections[0].refs[0].quote='not in source';assert.equal(validMaterial(bad),false);
});

test('image resume reading retains separate projects, internship and skills without keeping the image',async()=>{
  const {material:m}=await extractMaterials({kind:'resume',image:'data:image/png;base64,AA=='},config,async()=>reply({summary:'嵌入式经历',experiences:[{title:'手表移植',kind:'project',detail:'使用STM32和OLED实现界面'},{title:'接口测试实习',kind:'internship',detail:'参与接口测试'},{title:'C语言',kind:'skill',detail:'学习C语言指针'}]}));
  assert.equal(m.sections.length,3);assert.equal(m.sections[1].kind,'internship');assert.ok(!JSON.stringify(m).includes('base64'));assert.equal(validMaterial(m),true);
});

test('project first question is planned from code before any answer, and includes diverse material points',async()=>{
  const m=material(),s=await start(m,{supplement:'跟着视频完成的开源移植'},async(url,options)=>{
    const input=JSON.parse(JSON.parse(options.body).messages[1].content);assert.equal(input.sources.length,6);assert.equal(input.targetRole,undefined);assert.equal(input.projectSupplement,'跟着视频完成的开源移植');return reply(planResponse(m));
  });
  assert.equal(s.turns.length,0);assert.equal(s.anchor,'');assert.match(s.messages[0].text,/实际使用/);assert.equal(s.plan.deferred.length,2);assert.equal(validPlan(s.plan,m),true);
  assert.ok(materialRefsHTML(s,s.plan.nodes[0]).includes('watch/display.c'));
  const snapshot=structuredClone(s);
  const next=await answerWithModel(s,'不太确定，但我想继续谈显示',config,async(url,options)=>{
    const input=JSON.parse(JSON.parse(options.body).messages[1].content);assert.ok(input.currentMaterial[0].files[0].text.includes('function_0'));assert.equal(input.nextTarget.label,'红外输入');return reply({action:'advance',question:'泛泛谈谈岗位动机',reason:'继续了解材料中的输入模块',evidence:[]});
  });
  assert.equal(next.messages.at(-1).text,s.plan.nodes[1].question);assert.deepEqual(s,snapshot);
});

test('module-only planning filters unrelated code and rejects unmatched modules',async()=>{
  const m=material();const s=await start(m,{scope:'module',module:'display'},async(url,options)=>{
    const input=JSON.parse(JSON.parse(options.body).messages[1].content);assert.equal(input.sections.length,1);assert.deepEqual(input.sources.map(f=>f.path),['watch/display.c']);
    const raw=planResponse({...m,sections:[m.sections[0]]});return reply(raw);
  });
  assert.ok(s.plan.nodes.every(n=>n.sectionIds[0]==='section-0'));assert.equal(s.plan.scope,'module');
  await assert.rejects(start(m,{scope:'module',module:'payment'}),{status:400});
  await assert.rejects(start(m,{scope:'module',module:'display'},async()=>reply(planResponse(m))),/有效内容/);
});

test('an explicit responsibility restriction in the supplement overrides the default whole-project scope',async()=>{
  const m=material();const s=await start(m,{supplement:'这是团队项目，我负责display模块，其他没有参与。'},async(url,options)=>{
    const input=JSON.parse(JSON.parse(options.body).messages[1].content);assert.equal(input.scope,'module');assert.equal(input.module,'display');assert.equal(input.sections.length,1);return reply(planResponse({...m,sections:[m.sections[0]]}));
  });assert.equal(s.plan.scope,'module');
});

test('resume plan covers every project and internship, not only what the candidate mentions first',async()=>{
  const m=material('resume');let attempts=0;
  const s=await start(m,{anchor:'嵌入式开发'},async()=>{
    const raw=planResponse(m);if(++attempts===1)raw.nodes[2]={...raw.nodes[2],sectionIds:['section-4']};return reply(raw);
  });
  assert.equal(attempts,2);assert.equal(s.anchor,'嵌入式开发');assert.equal(s.plan.track,'resume');
});

test('a resume skill is not silently promoted into an implemented project deployment',async()=>{
  const m=material('resume');m.sections[3].detail='学习Docker';
  const s=await start(m,{},async()=>{const raw=planResponse(m);raw.nodes[3].question='该项目使用了Docker进行部署。你是如何编写Dockerfile的？';raw.nodes[3].sectionIds=['section-0','section-3'];return reply(raw);});
  assert.match(s.plan.nodes[3].question,/假设把Docker/);assert.ok(!s.plan.nodes[3].question.includes('该项目使用了Docker进行部署'));
});

test('followup reserve guarantees all planned main questions fit inside the answer budget',async()=>{
  let s=await start();const fetcher=async(url,options)=>{
    const input=JSON.parse(JSON.parse(options.body).messages[1].content);return reply({action:input.allowedActions.includes('followup')?'followup':'advance',question:'这里的输入先怎样进入缓冲区？',reason:'澄清当前数据流',evidence:[]});
  };
  s=await answerWithModel(s,'写入了显示缓冲区',config,fetcher);assert.equal(s.followupCount,1);
  while(!s.completedAt)s=await answerWithModel(s,'下一步我还需要看代码确认',config,fetcher);
  assert.equal(s.turns.length,5);assert.equal(new Set(s.turns.map(t=>t.node)).size,4);assert.equal(planCoverage(s).remaining.length,0);assert.equal(planCoverage(s).deferred.length,2);
});

test('a long pause does not end the round or mark untouched points answered',async()=>{
  let s=await start();s=await answerWithModel(s,'跳过',config,async()=>assert.fail('skip calls no model'));assert.equal(s.current,1);assert.equal(planCoverage(s).skipped.length,1);
  let calls=0;s.startedAt=Date.now()-3*3600000;s=await answerWithModel(s,'我还在理解输入过程',config,async()=>{calls++;return reply({action:'advance',question:'',reason:'了解下一个功能',evidence:[]});});
  assert.equal(calls,1);assert.equal(s.completedAt,null);assert.equal(s.current,2);assert.equal(planCoverage(s).remaining.length,2);assert.match(coverageText(s),/还没问到/);assert.match(coverageHTML(s),/已跳过/);
});

test('crossing the estimated duration while waiting for a model does not end the round',async t=>{
  let now=Date.now();t.mock.method(Date,'now',()=>now);const s=await start();
  const next=await answerWithModel(s,'我知道界面会显示时间。',config,async()=>{now+=3600000;return reply({action:'advance',question:'',reason:'了解下一个功能',evidence:[]});});
  assert.equal(next.completedAt,null);assert.equal(next.current,1);
});

test('an old two-answer timeout resumes the remaining plan without changing answers or its source object',async()=>{
  let s=await start();s=await answerWithModel(s,'跳过',config);s=await answerWithModel(s,'跳过',config);
  s.completedAt=Date.now();s.finishReason='time-budget';s.messages.at(-1).text='这一轮先到这里。';s.summary={old:true};s.summaryError='old';
  const snapshot=structuredClone(s);assert.equal(canResumeTimedSession(s),true);
  let resumed=resumeTimedSession(s);assert.equal(resumed.id,s.id);assert.equal(resumed.current,2);assert.deepEqual(resumed.turns,s.turns);assert.equal(resumed.messages.at(-1).text,s.plan.nodes[2].question);assert.equal(resumed.summary,undefined);assert.equal(resumed.summaryError,undefined);assert.equal(canResumeTimedSession(resumed),false);assert.deepEqual(s,snapshot);validateSession(resumed,'继续');
  while(!resumed.completedAt)resumed=await answerWithModel(resumed,'跳过',config);
  assert.equal(resumed.finishReason,'plan-completed');assert.equal(resumed.turns.length,4);assert.equal(canResumeTimedSession(resumed),false);
});

test('a skipped-only completed round shows coverage without spending a summary request',async()=>{
  let s=await start();s=await answerWithModel(s,'跳过',config);s.completedAt=Date.now();
  const host={isConnected:true,innerHTML:''};mountSummary(host,s,{owner:'guest',save:()=>assert.fail('no save'),onBusy:()=>assert.fail('no model request')});assert.match(host.innerHTML,/均已跳过/);
});

test('whole-session coaching distinguishes answered, skipped and deferred material points',async()=>{
  let s=await start();s=await answerWithModel(s,'我理解function_0负责写缓冲区',config,async()=>reply({action:'advance',question:'',reason:'继续了解输入模块',evidence:[]}));
  while(!s.completedAt)s=await answerWithModel(s,'跳过',config);
  const result=await summarizeSession(s,config,async(url,options)=>{
    const input=JSON.parse(JSON.parse(options.body).messages[1].content);assert.equal(input.coverage.asked.length,1);assert.equal(input.coverage.skipped.length,3);assert.equal(input.coverage.deferred.length,2);
    return reply({covered:[{text:'描述了函数与缓冲区的关系，仍待源码核对',answerIndex:0,quote:'function_0负责写缓冲区'}],unverified:[],nextStep:{text:'画出function_0的调用链并逐个核对代码',answerIndex:0,quote:'function_0'}});
  });assert.equal(result.version,1);assert.match(coverageText(s),/已跳过/);
});

test('planned branches retain source references and the original plan, but truncate future answers and summaries',async()=>{
  let s=await start();s=await answerWithModel(s,'跳过',config);s=await answerWithModel(s,'跳过',config);s.summary={old:true};
  const snapshot=structuredClone(s),branch=branchSession(s,1,sessionNodes(s));assert.equal(branch.current,1);assert.equal(branch.turns.length,1);assert.equal(branch.summary,undefined);assert.deepEqual(branch.material,s.material);assert.equal(branch.messages.at(-1).text,s.plan.nodes[1].question);assert.deepEqual(s,snapshot);validateSession(branch,'继续');
});

test('long plans persist on accounts and malformed plans cannot bypass validation',async()=>{
  const m=material(),s=await start(m,{minutes:30},async()=>reply(planResponse(m,8)));s.current=7;
  const store=new Store(':memory:');try{const {user,token}=await store.authenticate('plan_user','test-pass-123',true,'ip');assert.equal(store.save(user,[s],0),1);assert.equal(store.state(store.user({headers:{cookie:`interview_session=${token}`}})).records[0].plan.nodes.length,8);const invalid=structuredClone(s);invalid.plan.nodes[0].sectionIds=['invented'];assert.throws(()=>store.save(user,[invalid],1),/格式/);assert.throws(()=>validateSession(invalid,'回答'),{status:400});}finally{store.close();}
});

test('start API checks current account and origin before spending model calls',async t=>{
  let calls=0;const store=new Store(':memory:'),server=createServer(config,async()=>{calls++;return reply(planResponse());},store);server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.closeAllConnections();server.close();store.close();});
  const base=`http://127.0.0.1:${server.address().port}`,post=(owner,origin=base)=>fetch(base+'/api/interview/start',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({owner,material:material(),track:'project',minutes:10})});
  assert.equal((await post('another')).status,409);assert.equal((await post('guest','https://other.invalid')).status,403);assert.equal(calls,0);const response=await post('guest');assert.equal(response.status,200);assert.match((await response.json()).session.messages[0].text,/实际使用/);
});
