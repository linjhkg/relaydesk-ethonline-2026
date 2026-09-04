import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createDemoState, applyCommand } from './src/domain.mjs';
import { createEnsService } from './src/ens-chain.mjs';
import { getReceipt } from './src/ens-receipt.mjs';

const assets = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['public/styles.css', 'text/css; charset=utf-8']],
  ['/app.mjs', ['public/app.mjs', 'text/javascript; charset=utf-8']],
  ['/sepolia', ['public/sepolia.html', 'text/html; charset=utf-8']],
  ['/sepolia.html', ['public/sepolia.html', 'text/html; charset=utf-8']],
  ['/sepolia.css', ['public/sepolia.css', 'text/css; charset=utf-8']],
  ['/sepolia.mjs', ['public/sepolia.mjs', 'text/javascript; charset=utf-8']],
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
export function createDemoServer({ ensService = createEnsService(), receiptService = getReceipt } = {}) {
  let state = createDemoState();
  let ensInFlight = 0;
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
    if (req.method === 'POST' && ['/api/command', '/api/reset', '/api/ens/inspect', '/api/ens/prepare', '/api/ens/receipt'].includes(path)) {
      const allowedOrigins = hosts.map(host => `http://${host}`);
      if ((req.headers.origin && !allowedOrigins.includes(req.headers.origin)) || req.headers['sec-fetch-site'] === 'cross-site') {
        return json(res, 403, { error: 'Cross-site requests are not allowed.' });
      }
      if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
        return json(res, 415, { error: 'Use application/json.' });
      }
      try {
        const command = await readJson(req);
        if (path.startsWith('/api/ens/')) {
          if (!command || typeof command !== 'object' || Array.isArray(command)) return json(res, 400, { error: 'Provide a JSON object.', code: 'INVALID_INPUT' });
          if (ensInFlight >= 4) return json(res, 429, { error: 'Too many chain requests; retry shortly.', code: 'BUSY' });
          ensInFlight += 1;
          try {
            const result = path === '/api/ens/inspect' ? await ensService.inspect(command)
              : path === '/api/ens/prepare' ? await ensService.prepare(command)
                : await receiptService(command);
            return json(res, 200, result);
          } finally { ensInFlight -= 1; }
        }
        state = path === '/api/reset' ? createDemoState() : applyCommand(state, command);
        return json(res, 200, state);
      } catch (error) {
        return json(res, error.status || 400, { error: (error.shortMessage || error.message || 'Request failed.').slice(0,700), ...(error.code ? { code: String(error.code) } : {}) });
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
    console.log(`RelayDesk demo: http://127.0.0.1:${port} | Sepolia: http://127.0.0.1:${port}/sepolia`);
  });
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
}
