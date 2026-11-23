// Logica delle API, indipendente da Vercel: handle({method, path, query, headers, body}) -> {status, headers, json}
// Qui c'è solo lo smistamento delle richieste (limiti per rete, rotte, errori); il resto sta nei moduli:
//   common (autenticazione, durata, vista pubblica) · races (gare e diritti del corridore) · ingest (posizioni e Overland)
//   finish (chiusura, archivio, report, cron) · views (chi segue) · repo (dati live) · archive (Neon)
import { createRepo } from './repo.js';
import { HttpError, bad } from './util.js';
import { createArchive } from './archive.js';
import { demoCourse, demoLive, demoStats } from './demo.js';
import { SAFETY_TTL, MAX_HISTORY, IP_PER_MIN, IP_PER_DEVICE_MIN } from './config.js';
import { createCommon } from './common.js';
import { createFinish } from './finish.js';
import { createRaces } from './races.js';
import { createIngest } from './ingest.js';
import { createViews } from './views.js';

export function createHandler({ store, env = process.env, now = Date.now, archive = createArchive(env) }) {
  const repo = createRepo(store, { safetyTtl: SAFETY_TTL, maxHistory: MAX_HISTORY });   // unico punto che parla con il database live
  const common = createCommon({ repo, env, now });
  const finish = createFinish({ common, archive, env, now });
  const races = createRaces({ common, finish, archive, env, now });
  const { ingest, overland, osmand, owntracks, gpslogger } = createIngest({ common, env, now });
  const { live, courseRoute, stats } = createViews({ common, env, now });
  const { ipId } = common, { report, cron } = finish, { publicCreate, adminRoutes, deviceMe, enroll, enrollInfo } = races;

  // ---------- smistamento ----------
  const NOCACHE = { 'Cache-Control': 'no-store' };
  // La CDN usa l'URL completo (token compreso) come chiave: solo chi ha il link riceve la risposta in cache.
// Niente "stale-while-revalidate": dopo una revoca nessuno riceve dati vecchi oltre la durata indicata.
const cache = (s) => ({ 'Cache-Control': `public, s-maxage=${s}, max-age=0` });
const privateCache = (s) => ({ 'Cache-Control': `private, max-age=${s}` });

  return async function handle({ method = 'GET', path = '/', query = {}, headers = {}, body = null, origin = '' }) {
    let ipk = null;
    try {
      const parts = path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
      if (parts[0] === 'api') parts.shift();
      if (parts[0] === 'v1') parts.shift();   // /api/v1/... equivale a /api/...
      const h = Object.fromEntries(Object.entries(headers).map(([a, b]) => [a.toLowerCase(), b]));
      const ok = (json, headers = NOCACHE, status = 200) => ({ status, headers, json });
      const route = parts.join('/');
      // la CDN usa l'URL come chiave di cache: parametri in più servirebbero solo a saltarla
      if (method === 'GET' && ['live', 'course', 'stats', 'report'].includes(route) && Object.keys(query).some((x) => x !== 't')) throw bad('Richiesta non valida');
      if (route !== 'health' && route !== 'cron/archive' && !route.startsWith('demo/')) {
        ipk = `rl:ip${route.startsWith('device/') ? 'd' : ''}:${ipId(h)}:${Math.floor(now() / 60000)}`;
        const n = await repo.hit(ipk, 90);
        if (n > (route.startsWith('device/') ? IP_PER_DEVICE_MIN : IP_PER_MIN)) throw new HttpError(429, 'Troppe richieste: riprova tra un minuto');
      }
      if (route === 'health') return ok({ ok: true, store: store.kind, time: now() });
      if (method === 'GET' && route === 'demo/course') return ok(demoCourse(), privateCache(300));
      if (method === 'GET' && route === 'demo/live') return ok(demoLive(now()), NOCACHE);
      if (method === 'GET' && route === 'demo/stats') return ok(demoStats(now()), NOCACHE);
      if (method === 'GET' && route === 'report') return ok(await report(query), privateCache(60));
      if (route === 'cron/archive') return ok(await cron(h));
      if (route === 'races' && method === 'POST') return ok(await publicCreate(h, body));
      if (parts[0] === 'admin') return ok(await adminRoutes(method, parts.slice(1), body, h, origin));
      if (route === 'enroll' && method === 'GET') return ok(await enrollInfo(h, query));
      if (route === 'enroll' && method === 'POST') return ok(await enroll(h, body, origin));
      if (route === 'device/positions' && method === 'POST') return ok(await ingest(h, body));
      if (route === 'device/me' && (method === 'GET' || method === 'DELETE')) return ok(await deviceMe(h, method));
      if (route === 'device/consent' && method === 'POST') return ok(await deviceMe(h, 'POST', body));
      if (route === 'device/overland' && method === 'POST') return ok(await overland(h, query, body));
      if (route === 'device/osmand' && (method === 'GET' || method === 'POST')) return ok(await osmand(h, query, body));
      if (route === 'device/owntracks' && method === 'POST') return ok(await owntracks(h, query, body));
      if (route === 'device/gpslogger' && (method === 'GET' || method === 'POST')) return ok(await gpslogger(h, query, body));
      if (method === 'GET' && route === 'live') return ok(await live(query, h), cache(5));
      if (method === 'GET' && route === 'course') return ok(await courseRoute(query, h), privateCache(60));
      if (method === 'GET' && route === 'stats') return ok(await stats(query, h), cache(15));
      throw new HttpError(404, 'Non trovato');
    } catch (e) {
      if (e instanceof HttpError && e.status === 401 && ipk) { try { await repo.penalize(ipk, 5); } catch { /* il limite resta quello già contato */ } }   // un accesso sbagliato pesa 6 richieste
      if (e instanceof HttpError) return { status: e.status, headers: NOCACHE, json: { error: e.message } };
      console.error(e);
      return { status: 500, headers: NOCACHE, json: { error: 'Errore interno' } };
    }
  };
}
