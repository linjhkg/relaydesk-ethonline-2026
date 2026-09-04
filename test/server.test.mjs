import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { createDemoServer } from '../server.mjs';

let server, base;
before(async () => {
  server = createDemoServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(resolve => server.close(resolve)));
const command = body => fetch(`${base}/api/command`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('HTTP handover grants, updates, revokes and rejects without changing state', async () => {
  const original = await (await fetch(`${base}/api/state`)).json();
  assert.equal((await command({ type: 'grant', actor: 'owner' })).status, 200);
  const updated = await command({ type: 'update', actor: 'volunteer', value: 'https://example.org/new-event' });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).name, original.name);
  assert.equal((await command({ type: 'revoke', actor: 'owner' })).status, 200);
  const beforeDenied = await (await fetch(`${base}/api/state`)).json();
  assert.equal((await command({ type: 'update', actor: 'volunteer', value: 'https://example.org/hijack' })).status, 400);
  assert.deepEqual(await (await fetch(`${base}/api/state`)).json(), beforeDenied);
});

test('localhost service rejects cross-site mutation, invalid media, and host rebinding', async () => {
  assert.equal((await fetch(`${base}/api/reset`, { method: 'POST', headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await fetch(`${base}/api/reset`, { method: 'POST', body: '{}' })).status, 415);
  // Node fetch replaces Host; use http.request to exercise the actual hostile header.
  const hostileStatus = await new Promise((resolve, reject) => {
    const req = http.get(`${base}/api/state`, { headers: { Host: 'untrusted.example' } }, res => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
  });
  assert.equal(hostileStatus, 403);
});

test('invalid JSON and command schemas cannot crash the service', async () => {
  assert.equal((await fetch(`${base}/api/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await command(null)).status, 400);
  assert.equal((await command({ type: 'unknown', actor: 'owner' })).status, 400);
  assert.equal((await fetch(`${base}/api/state`)).status, 200);
});

test('static routes expose only allowlisted files with protective headers', async () => {
  const response = await fetch(base);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await fetch(`${base}/package.json`)).status, 404);
  assert.equal((await fetch(`${base}/.env`)).status, 404);
});
