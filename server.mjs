import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createDemoState, applyCommand } from './src/domain.mjs';

const assets = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['public/styles.css', 'text/css; charset=utf-8']],
  ['/app.mjs', ['public/app.mjs', 'text/javascript; charset=utf-8']],
]);

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) {
      const error = new Error('Request exceeds 8 KB.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new Error('Invalid JSON.'); }
}

// Deliberately a localhost-only shared demo, not production authentication.
export function createDemoServer() {
  let state = createDemoState();
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const port = req.socket.localPort;
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (!hosts.includes(req.headers.host)) return json(res, 403, { error: 'Localhost access only.' });
    const path = req.url;
    if (req.method === 'GET' && path === '/api/state') return json(res, 200, state);
    if (req.method === 'POST' && ['/api/command', '/api/reset'].includes(path)) {
      const allowedOrigins = hosts.map(host => `http://${host}`);
      if ((req.headers.origin && !allowedOrigins.includes(req.headers.origin)) || req.headers['sec-fetch-site'] === 'cross-site') {
        return json(res, 403, { error: 'Cross-site requests are not allowed.' });
      }
      if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
        return json(res, 415, { error: 'Use application/json.' });
      }
      try {
        const command = await readJson(req);
        state = path === '/api/reset' ? createDemoState() : applyCommand(state, command);
        return json(res, 200, state);
      } catch (error) {
        return json(res, error.status || 400, { error: error.message });
      }
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && assets.has(path)) {
      const [file, mime] = assets.get(path);
      try {
        const body = await readFile(new URL(file, import.meta.url));
        res.writeHead(200, { 'Content-Type': mime });
        return res.end(req.method === 'HEAD' ? undefined : body);
      } catch { return json(res, 503, { error: 'Frontend is not available.' }); }
    }
    return json(res, 404, { error: 'Not found.' });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.RELAYDESK_PORT || 4317);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid RELAYDESK_PORT.');
  const server = createDemoServer();
  server.listen(port, '127.0.0.1', () => {
    console.log(`RelayDesk local simulation: http://127.0.0.1:${port}`);
  });
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
}
