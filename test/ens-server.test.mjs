import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createDemoServer } from '../server.mjs';

let server, base;
const calls = [];
const service = {
  inspect: async body => { calls.push(['inspect', body]); return { name:body.name,chainId:11155111,url:null }; },
  prepare: async body => {
    calls.push(['prepare',body]);
    const error = new Error('Simulation rejected.'); error.code='SIMULATION_REJECTED'; throw error;
  },
};
before(async () => {
  server=createDemoServer({ensService:service,receiptService:async body=>({hash:body.hash,status:'pending'})});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  base=`http://127.0.0.1:${server.address().port}`;
});
after(()=>new Promise(resolve=>server.close(resolve)));
const post=(route,body,headers={})=>fetch(`${base}/api/ens/${route}`,{
  method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body),
});

test('chain reads are separate from simulated demo state',async()=>{
  const before=await(await fetch(`${base}/api/state`)).json();
  const response=await post('inspect',{name:'event.eth'});
  assert.equal(response.status,200);
  assert.equal((await response.json()).chainId,11155111);
  assert.deepEqual(calls.at(-1),['inspect',{name:'event.eth'}]);
  assert.deepEqual(await(await fetch(`${base}/api/state`)).json(),before);
});

test('simulation failure is an error, not a signed or successful transaction',async()=>{
  const response=await post('prepare',{name:'event.eth',action:'grant'});
  assert.equal(response.status,400);
  const body=await response.json();
  assert.equal(body.code,'SIMULATION_REJECTED');
  assert.equal(body.transaction,undefined);
});

test('receipt endpoint preserves pending and all chain endpoints reject cross-site calls',async()=>{
  assert.equal((await(await post('receipt',{hash:'0xabc'})).json()).status,'pending');
  for(const route of ['inspect','prepare','receipt']) {
    assert.equal((await post(route,{}, {Origin:'https://attacker.example'})).status,403);
    assert.equal((await post(route,null)).status,400);
  }
});
