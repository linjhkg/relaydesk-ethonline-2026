import { readFile, readdir } from 'node:fs/promises';
import { strict as assert } from 'node:assert';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { PUBLIC_RPC } from '../src/sepolia-config.mjs';

const directory=new URL('../dist/',import.meta.url);
const source=await readFile(new URL('browser-api.js',directory),'utf8');
assert.ok(source.length<2_000_000,'Keep the public runtime bounded.');
assert.ok(!source.includes('process.env.'),'No environment values may leak into the browser bundle.');
for(const page of ['index','sepolia','register','evidence']) {
  const html=await readFile(new URL(`${page}.html`,directory),'utf8');
  assert.ok(html.indexOf('/browser-api.js')<html.indexOf('type="module"'),'Install the adapter before page modules.');
  assert.match(html,/Content-Security-Policy/);
  assert.match(html,/readability\.css/);
  if(page!=='index') assert.equal(await readFile(new URL(`${page}/index.html`,directory),'utf8'),html);
}
const files=await readdir(directory);
assert.ok(!files.some(name=>/^(\.env|\.git|src|node_modules|recordings|submission)$/.test(name)));
const calls=[];
function runtime() {
  const context=vm.createContext({TextEncoder,TextDecoder,URL,URLSearchParams,AbortController,AbortSignal,Request,Response,Headers,structuredClone,setTimeout,clearTimeout,setInterval,clearInterval,crypto:webcrypto,console,
    fetch:async(url,options)=>{calls.push(url);const payload=JSON.parse(options.body);return new Response(JSON.stringify({jsonrpc:'2.0',id:payload.id,result:'0x1'}),{headers:{'Content-Type':'application/json'}});},
  });
  vm.runInContext(source,context);
  return context.RelayDeskRuntime;
}
const a=runtime(),b=runtime();
assert.equal(calls.length,0,'No requests on initial load.');
await a.request('demo','/api/command',{actor:'owner',type:'grant'});
await a.request('demo','/api/command',{actor:'volunteer',type:'update',value:'https://example.org/demo'});
await a.request('demo','/api/command',{actor:'owner',type:'revoke'});
await assert.rejects(a.request('demo','/api/command',{actor:'volunteer',type:'update',value:'https://example.org/rejected'}),/Access denied/);
assert.equal((await a.request('demo','/api/state')).url,'https://example.org/demo');
assert.equal((await b.request('demo','/api/state')).revision,0,'Visitors do not share simulation state.');
assert.equal(calls.length,0,'Simulation has no network dependency.');
await assert.rejects(a.request('registration','inspect',{owner:'invalid'}),/Owner/);
await assert.rejects(a.request('ens','inspect',{name:'event.eth'}),/Sepolia/);
assert.ok(calls.length>0&&calls.every(url=>new URL(typeof url==='string'?url:url.url).href===new URL(PUBLIC_RPC).href),'Live requests use only the configured public RPC.');
console.log('Public build verified: isolated simulation, fixed RPC, network guard, bounded assets and no startup requests.');
