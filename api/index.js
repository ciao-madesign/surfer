// Unica funzione serverless (limite di 12 funzioni su Vercel Hobby): smista tutte le rotte /api/*.
import { createStore } from '../server/store.js';
import { createHandler } from '../server/handler.js';

const handle = createHandler({ store: createStore() });

export default async function (req, res) {
  const url = new URL(req.url, 'http://x');
  const path = url.searchParams.get('p') ?? url.pathname;   // vercel.json riscrive /api/* in ?p=*
  url.searchParams.delete('p');
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const r = await handle({
    method: req.method, path, query: Object.fromEntries(url.searchParams), headers: req.headers,
    body: req.body, origin: `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`,
  });
  res.status(r.status);
  for (const [a, b] of Object.entries(r.headers)) res.setHeader(a, b);
  res.json(r.json);
}
