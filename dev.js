// Server locale per sviluppo e prove: serve /public e le API con archivio in memoria (o Upstash se configurato).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { createStore } from './server/store.js';
import { createHandler } from './server/handler.js';

const handle = createHandler({ store: createStore() });
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const rewrites = { '/live': '/live.html', '/admin': '/admin.html' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    let body = '';
    for await (const c of req) body += c;
    const r = await handle({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers,
      body: body ? JSON.parse(body) : null, origin: `http://${req.headers.host}` });
    res.writeHead(r.status, { 'content-type': 'application/json', ...r.headers });
    return res.end(JSON.stringify(r.json));
  }
  const p = rewrites[url.pathname] ?? (url.pathname === '/' ? '/index.html' : url.pathname);
  try {
    const file = join('public', normalize(p).replace(/^(\.\.[/\\])+/, ''));
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end('Non trovato'); }
}).listen(process.env.PORT || 3000, () => console.log(`http://localhost:${process.env.PORT || 3000}`));
