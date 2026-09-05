import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserRuntime } from '../src/browser-runtime.mjs';

test('public visitors have independent simulations and immutable returned snapshots',async()=>{
  const a=createBrowserRuntime(),b=createBrowserRuntime();
  await a.request('demo','/api/command',{type:'grant',actor:'owner'});
  const state=await a.request('demo','/api/state');state.grants[0].active=false;
  assert.equal((await a.request('demo','/api/state')).grants[0].active,true);
  assert.equal((await b.request('demo','/api/state')).grants.length,0);
  await assert.rejects(b.request('demo','/api/command',{type:'update',actor:'volunteer',value:'https://example.org/test'}),/Access denied/);
});
test('public runtime dispatches only read/preparation interfaces, never broadcasts',async()=>{
  const calls=[];
  const runtime=createBrowserRuntime({
    ens:{inspect:async x=>{calls.push(['ens',x]);return {chainId:11155111};},prepare:async()=>{throw Error('Denied');}},
    registration:{inspect:async()=>({registered:false}),prepare:async()=>({status:'skipped'})},
    receipt:async()=>({status:'pending'}),registrationReceipt:async()=>({status:'success',transactionVerified:true}),
  });
  assert.equal((await runtime.request('ens','inspect',{name:'event.eth'})).chainId,11155111);
  assert.deepEqual(calls,[['ens',{name:'event.eth'}]]);
  await assert.rejects(runtime.request('ens','prepare',{}),/Denied/);
  assert.equal((await runtime.request('registration','prepare',{})).status,'skipped');
  assert.equal((await runtime.request('ens','receipt',{})).status,'pending');
  await assert.rejects(runtime.request('ens','sendTransaction',{}),/Unsupported/);
});
