import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccount } from '../public/account.js';

test('account autosave serializes a newer draft behind an in-flight revision',async t=>{
  let records=[{id:'first'}],release,posts=[];
  t.mock.method(globalThis,'fetch',async(path,options)=>{
    if(path==='/api/account')return Response.json({user:{name:'one'},records:[],revision:0});
    const body=JSON.parse(options.body);posts.push(body);
    if(posts.length===1)await new Promise(resolve=>release=resolve);
    return Response.json({revision:body.revision+1});
  });
  const account=createAccount({getRecords:()=>records,onState:()=>{},onStatus:()=>{}});await account.init();account.save();const saving=account.flush();
  records=[{id:'newer'}];account.save();release();await saving;
  assert.equal(posts.length,2);assert.deepEqual(posts.map(p=>p.revision),[0,1]);assert.equal(posts[1].records[0].id,'newer');assert.equal(account.unsaved,false);
  await account.flush();
});

test('failed account save retains dirty state and prevents logout from discarding it',async t=>{
  const calls=[];
  t.mock.method(globalThis,'fetch',async path=>{calls.push(path);return path==='/api/account'?Response.json({user:{name:'one'},records:[],revision:0}):Response.json({error:'保存冲突'},{status:409});});
  const account=createAccount({getRecords:()=>[{id:'draft'}],onState:()=>{},onStatus:()=>{}});await account.init();account.save();await assert.rejects(account.flush(),/保存冲突/);
  assert.equal(account.unsaved,true);await assert.rejects(account.logout(),/保存冲突/);assert.ok(!calls.includes('/api/auth/logout'));assert.equal(account.user.name,'one');
});
