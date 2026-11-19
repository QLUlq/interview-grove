import test from 'node:test';
import assert from 'node:assert/strict';
import { createVerification } from '../public/framework.js';
import { sessionTitle } from '../public/plan-view.js';
import { practiceTasks } from '../public/practice.js';
import { Store, studyProfile } from '../store.mjs';

test('AI test records are labeled and excluded from personal practice and shared experience', () => {
  const real=createVerification('job','Redis项目');
  real.turns=[{node:'ownership',text:'我还没理解Redis缓存',unsure:true,memory:{tags:['Redis'],focus:['技术原理']}}];
  real.messages.push({role:'user',text:real.turns[0].text});
  const simulated={...structuredClone(real),id:'simulation',testRun:{kind:'ai-dogfood'}};
  assert.equal(sessionTitle(simulated),'AI代测 · 模拟练习');
  assert.equal(sessionTitle({...simulated,plan:{track:'project'}}),'AI代测 · 项目技术练习');
  assert.deepEqual(studyProfile([simulated,real]),studyProfile([real]));
  assert.equal(practiceTasks([simulated,real]).length,1);
  assert.equal(practiceTasks([simulated]).length,0);
  const store=new Store(':memory:');
  try {
    for(let i=0;i<3;i++)store.db.prepare('INSERT INTO users(id,name,salt,password,shared,records) VALUES(?,?,?,?,1,?)').run(String(i),`test${i}`,'test','test',JSON.stringify([simulated]));
    assert.deepEqual(store.sharedHints(),[]);
    store.db.prepare('UPDATE users SET records=?').run(JSON.stringify([real]));
    assert.deepEqual(store.sharedHints(),[{theme:'Redis',focus:'技术原理'}]);
  } finally {store.close();}
});
