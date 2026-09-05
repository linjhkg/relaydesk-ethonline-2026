import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createDemoServer } from '../server.mjs';

let server, base;
const calls=[];
before(async()=>{
  server=createDemoServer({registrationService:{
    inspect:async plan=>{calls.push(['inspect',plan]);return {chainId:11155111,name:plan.name,registered:false,price:null};},
    prepare:async plan=>{calls.push(['prepare',plan]);return {status:'skipped',action:plan.action,summary:'Enough test tokens.',inspected:{registered:false}};},
  },registrationReceiptService:async body=>{calls.push(['receipt',body]);return {hash:body.hash,status:'pending',transactionVerified:false};}});
  server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;
});
after(()=>new Promise(resolve=>server.close(resolve)));
const post=(name,body,headers={})=>fetch(`${base}/api/registration/${name}`,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});

test('registration page and scripts served from static allowlist',async()=>{
  for(const path of ['/register','/register.css','/register.mjs']) assert.equal((await fetch(base+path)).status,200);
  assert.equal((await fetch(base+'/src/registration.mjs')).status,404);
  assert.equal((await fetch(base+'/src/abi/eth-registrar.json')).status,404);
});
test('registration API passes plan to separate service without mutating demo',async()=>{
  const initial=await(await fetch(base+'/api/state')).json();
  assert.equal((await(await post('inspect',{name:'event.eth'})).json()).registered,false);
  assert.deepEqual(calls.at(-1),['inspect',{name:'event.eth'}]);
  const skipped=await(await post('prepare',{name:'event.eth',action:'mint'})).json();
  assert.equal(skipped.status,'skipped');assert.equal(skipped.transaction,undefined);
  assert.deepEqual(await(await fetch(base+'/api/state')).json(),initial);
});
test('bound receipt route preserves expected request and never upgrades pending',async()=>{
  const request={hash:'example',expected:{to:'example'}};
  const result=await(await post('receipt',request)).json();
  assert.deepEqual(calls.at(-1),['receipt',request]);
  assert.equal(result.status,'pending');assert.equal(result.transactionVerified,false);
});
test('all registration endpoints enforce origin, JSON and object boundaries',async()=>{
  for(const route of ['inspect','prepare','receipt']) {
    assert.equal((await post(route,{}, {Origin:'https://untrusted.example'})).status,403);
    assert.equal((await post(route,{}, {'Content-Type':'text/plain'})).status,415);
    assert.equal((await post(route,null)).status,400);
    assert.equal((await post(route,[])).status,400);
  }
});
