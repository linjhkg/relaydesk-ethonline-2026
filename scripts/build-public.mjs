import { build } from 'esbuild';
import { readFile, writeFile, mkdir, copyFile, rm, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_RPC } from '../src/sepolia-config.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=resolve(root,'dist');
if(output!==join(root,'dist')) throw new Error('Unexpected build destination.');
const existing=await lstat(output).catch(error=>{if(error.code!=='ENOENT')throw error;});
if(existing?.isSymbolicLink()) throw new Error('Build output must not be a symlink.');
// Only generated output is replaced; never package source, recordings or local plans.
await rm(output,{recursive:true,force:true});
await mkdir(join(output,'evidence'),{recursive:true});
// A private hosting-account binding is not required for public-source builds.
const manifest=await readFile(join(root,'.openai/hosting.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
if(manifest&&(!manifest.project_id||manifest.static?.directory!=='dist')) throw new Error('Invalid static hosting manifest.');
const built=await build({
  absWorkingDir:root,entryPoints:['web/browser-entry.mjs'],outfile:join(output,'browser-api.js'),
  bundle:true,minify:true,format:'iife',platform:'browser',target:['es2022'],metafile:true,
  define:{'process.env.SEPOLIA_RPC_URL':JSON.stringify(PUBLIC_RPC)},
  legalComments:'linked',sourcemap:false,
});
const policy=`default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ${PUBLIC_RPC}; base-uri 'none'; form-action 'self'`;
for(const page of ['index','sepolia','register','evidence']) {
  let html=await readFile(join(root,`public/${page}.html`),'utf8');
  // The blocking local adapter runs before any existing page module.
  html=html.replace('<head>',`<head>\n  <meta http-equiv="Content-Security-Policy" content="${policy}" />\n  <script src="/browser-api.js"></script>`);
  if(!html.includes('/readability.css')) html=html.replace('</head>','  <link rel="stylesheet" href="/readability.css" />\n</head>');
  if(page!=='evidence') html=html.replace('</header>','  <a class="chain-link" href="/evidence">链上验收 / Onchain evidence ↗</a>\n</header>');
  if(!html.includes('name="description"')) html=html.replace('</head>','  <meta name="description" content="RelayDesk — ENSv2 event URL delegation on Sepolia. Try an isolated simulation or verify real onchain evidence." />\n</head>');
  await writeFile(join(output,`${page}.html`),html);
  if(page!=='index') {await mkdir(join(output,page),{recursive:true});await writeFile(join(output,page,'index.html'),html);}
}
for(const file of ['app.mjs','sepolia.mjs','register.mjs','evidence.mjs','styles.css','sepolia.css','register.css','readability.css']) await copyFile(join(root,'public',file),join(output,file));
for(const file of ['handover-final.json','handover-transactions.json','hackathon-registration-20260908.json','hackathon-before-grant-20260908.json','hackathon-after-grant-20260908.json','hackathon-after-revoke-20260908.json','hackathon-handover-transactions-20260908.json']) await copyFile(join(root,'docs/evidence',file),join(output,'evidence',file));
await copyFile(join(root,'docs/evidence/hackathon-final-reread-20260908.json'),join(output,'evidence/hackathon-final-reread-20260908.json'));
await writeFile(join(output,'404.html'),'<!doctype html><html lang="en"><meta charset="utf-8"><title>RelayDesk — Not found</title><h1>Page not found</h1><p><a href="/">Return to RelayDesk</a></p></html>');
await writeFile(join(output,'_headers'),`/*\n  Content-Security-Policy: ${policy}; frame-ancestors 'none'\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n`);
const packages=new Set(Object.keys(built.metafile.inputs).map(path=>path.match(/^node_modules\/((?:@[^/]+\/)?[^/]+)/)?.[1]).filter(Boolean));
const notices=[];
for(const name of [...packages].sort()) {
  for(const file of ['LICENSE','LICENSE.md','LICENSE.txt']) {
    try {notices.push(`## ${name}\n\n${await readFile(join(root,'node_modules',name,file),'utf8')}`);break;}catch(error){if(error.code!=='ENOENT')throw error;}
  }
}
await writeFile(join(output,'THIRD_PARTY_NOTICES.txt'),notices.join('\n\n'));
console.log('Built public RelayDesk: isolated simulation, direct Sepolia RPC, no server credentials.');
