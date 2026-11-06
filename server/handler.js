// Logica delle API, indipendente da Vercel: handle({method, path, query, headers, body}) -> {status, headers, json}
import { getJSON } from './store.js';
import { HttpError, bad, token, shortId, sha256, safeEqual } from './util.js';
import { buildCourse, project, haversine, encodePoint, decodePoint, runnerStats } from './geo.js';

const DAY = 86400;
const KEEP_AFTER_END = DAY;          // 24 ore dalla fine della gara
const SAFETY_TTL = 3 * DAY;          // rete di sicurezza: dati di gare mai chiuse
const MAX_PARTICIPANTS = 5;
const MAX_HISTORY = 4000;
const MAX_BATCH = 120;
const RATE_PER_MIN = 30;
const COLORS = ['#e91e63', '#2bb7da', '#f4c20d', '#34a853', '#8e24aa'];
const STATUS_LABEL = { waiting: 'In attesa', tracking: 'Tracking attivo', paused: 'In pausa',
  no_gps: 'Segnale GPS assente', offline: 'Connessione assente', finished: 'Gara conclusa' };

export function createHandler({ store, env = process.env, now = Date.now }) {
  const courseCache = new Map();  // cache per istanza (lambda "calda"), 60 s

  // ---------- accesso ai dati ----------
  const k = {
    race: (id) => `race:${id}`, course: (id) => `course:${id}`, last: (id) => `last:${id}`,
    pos: (id, p) => `pos:${id}:${p}`, pass: (id) => `pass:${id}`, det: (id) => `det:${id}`,
    view: (h) => `v:${h}`, dev: (h) => `d:${h}`,
  };

  async function loadRace(id) {
    const m = await getJSON(store, k.race(id));
    if (!m) throw new HttpError(404, 'Gara non trovata');
    if (m.status === 'ended' && now() > m.endedAt + KEEP_AFTER_END * 1000) throw new HttpError(410, 'Dati scaduti');
    return m;
  }
  const saveRace = (m, ttl = SAFETY_TTL) => store.cmd(['SET', k.race(m.id), JSON.stringify(m), 'EX', ttl]);

  async function loadCourse(id) {
    const c = courseCache.get(id);
    if (c && c.exp > now()) return c.v;
    const v = await getJSON(store, k.course(id));
    if (v) courseCache.set(id, { v, exp: now() + 60000 });
    return v;
  }

  function allKeys(m) {
    const keys = [k.race(m.id), k.course(m.id), k.last(m.id), k.pass(m.id), k.det(m.id)];
    for (const p of m.participants) { keys.push(k.pos(m.id, p.id), k.dev(p.deviceHash)); }
    if (m.viewHash) keys.push(k.view(m.viewHash));
    return keys;
  }
  const expireRace = (m, secs) => store.pipeline(allKeys(m).map((key) => ['EXPIRE', key, secs]));

  // ---------- autenticazione ----------
  function admin(headers) {
    if (!env.ADMIN_KEY) throw new HttpError(503, 'Amministrazione non configurata (ADMIN_KEY)');
    if (!safeEqual(headers['x-admin-key'] || '', env.ADMIN_KEY)) throw new HttpError(401, 'Chiave amministratore errata');
  }
  const bearer = (headers) => (headers.authorization || '').replace(/^Bearer\s+/i, '');

  async function viewer(query, headers) {
    const t = query.t || headers['x-view-token'];
    if (!t || t.length < 20) throw new HttpError(401, 'Link non valido');
    const raceId = await store.cmd(['GET', k.view(sha256(t))]);
    if (!raceId) throw new HttpError(401, 'Link non valido, revocato o scaduto');
    return loadRace(raceId);
  }

  // ---------- validazioni ----------
  const num = (v, lo, hi, name) => {
    if (typeof v !== 'number' || !isFinite(v) || v < lo || v > hi) throw bad(`${name} non valido`);
    return v;
  };
  const text = (v, max, name) => {
    if (typeof v !== 'string' || !v.trim() || v.length > max) throw bad(`${name} non valido`);
    return v.trim();
  };
  function parseCoursePoints(arr) {
    if (!Array.isArray(arr) || arr.length < 2 || arr.length > 5000) throw bad('Traccia non valida (2–5000 punti)');
    return arr.map((p) => {
      if (!Array.isArray(p)) throw bad('Punto traccia non valido');
      return [num(p[0], -90, 90, 'lat'), num(p[1], -180, 180, 'lon'), p[2] == null ? 0 : num(p[2], -500, 9000, 'quota')];
    });
  }

  // ---------- stato partecipante ----------
  function participantStatus(m, last) {
    if (!last || last.t == null) return 'waiting';
    if (last.fin) return 'finished';
    if (m.status === 'ended') return 'finished';
    if (last.status === 'paused') return 'paused';
    if (last.status === 'no_gps') return 'no_gps';
    if (now() - last.rcv > 180000) return 'offline';
    return m.status === 'live' ? 'tracking' : 'waiting';
  }

  // ---------- rotte amministratore ----------
  async function adminRoutes(method, parts, body, headers, reqOrigin) {
    admin(headers);
    // /admin/races
    if (parts[0] !== 'races') throw new HttpError(404, 'Non trovato');
    if (parts.length === 1) {
      if (method === 'GET') {
        const ids = await store.cmd(['SMEMBERS', 'races']);
        const out = [];
        for (const id of ids) {
          const m = await getJSON(store, k.race(id));
          if (!m) { await store.cmd(['SREM', 'races', id]); continue; }
          out.push({ id, name: m.name, status: m.status, createdAt: m.createdAt, participants: m.participants.length });
        }
        return { races: out };
      }
      if (method === 'POST') {
        const name = text(body?.name, 80, 'Nome');
        const id = shortId();
        const meta = { id, name, status: 'draft', createdAt: now(), startedAt: null, endedAt: null,
          viewHash: null, participants: [], checkpoints: [] };
        let course = null;
        if (body.course) {
          course = buildCourse(parseCoursePoints(body.course.points));
          course.name = body.course.name ? String(body.course.name).slice(0, 80) : name;
        }
        const cps = Array.isArray(body.checkpoints) ? body.checkpoints : [];
        if (cps.length > 30) throw bad('Massimo 30 checkpoint');
        if (cps.length && !course) throw bad('Servono la traccia GPX per i checkpoint');
        meta.checkpoints = cps.map((c, i) => {
          const lat = num(c.lat, -90, 90, 'lat checkpoint'), lon = num(c.lon, -180, 180, 'lon checkpoint');
          return { id: `c${i + 1}`, name: text(c.name, 60, 'Nome checkpoint'), lat, lon,
            km: Math.round(project(course, lat, lon).km * 1000) / 1000,
            auto: c.auto !== false, radius: Math.min(200, Math.max(20, Number(c.radius) || 50)) };
        }).sort((a, b) => a.km - b.km);
        await saveRace(meta);
        if (course) await store.cmd(['SET', k.course(id), JSON.stringify(course), 'EX', SAFETY_TTL]);
        await store.cmd(['SADD', 'races', id]);
        return { race: pubMeta(meta), course: course && { totalKm: course.totalKm, gain: course.gain, loss: course.loss } };
      }
      throw new HttpError(405, 'Metodo non consentito');
    }
    const m = await loadRace(parts[1]);
    const sub = parts[2];
    if (!sub) {
      if (method === 'GET') {
        const last = toObj(await store.cmd(['HGETALL', k.last(m.id)]));
        const race = pubMeta(m);
        race.participants = race.participants.map((p) => {
          const l = last[p.id] ? JSON.parse(last[p.id]) : null;
          return { ...p, received: l ? { rcv: l.rcv, t: l.t, status: l.status, points: l.n ?? null, offCourseM: l.off ?? null,
            lat: l.lat ?? null, lon: l.lon ?? null } : null };
        });
        return { race, serverTime: now() };
      }
      if (method === 'DELETE') {
        await store.pipeline([...allKeys(m).map((key) => ['DEL', key]), ['SREM', 'races', m.id]]);
        return { ok: true };
      }
    }
    if (sub === 'participants' && method === 'POST' && parts.length === 3) {
      if (m.participants.length >= MAX_PARTICIPANTS) throw bad('Massimo 5 partecipanti');
      const dev = token(24), pid = `p${m.participants.length + 1}${shortId().slice(0, 3)}`;
      const p = { id: pid, name: text(body?.name, 40, 'Nome'),
        color: /^#[0-9a-f]{6}$/i.test(body?.color || '') ? body.color : COLORS[m.participants.length % 5],
        deviceHash: sha256(dev) };
      m.participants.push(p);
      await saveRace(m);
      await store.cmd(['SET', k.dev(p.deviceHash), JSON.stringify({ raceId: m.id, pid }), 'EX', SAFETY_TTL]);
      const pairing = Buffer.from(JSON.stringify({ u: reqOrigin, t: dev, n: p.name })).toString('base64url');
      return { participant: pubParticipant(p), deviceToken: dev, pairing };  // il token si vede una sola volta
    }
    if (sub === 'participants' && method === 'POST' && parts.length === 5 && parts[4] === 'token') {
      // codice smarrito: ne genera uno nuovo e invalida il vecchio (il corridore resta lo stesso, i dati restano)
      const p = m.participants.find((x) => x.id === parts[3]);
      if (!p) throw new HttpError(404, 'Partecipante non trovato');
      const dev = token(24), oldHash = p.deviceHash;
      p.deviceHash = sha256(dev);
      await saveRace(m);
      await store.pipeline([['SET', k.dev(p.deviceHash), JSON.stringify({ raceId: m.id, pid: p.id }), 'EX', SAFETY_TTL], ['DEL', k.dev(oldHash)]]);
      const pairing = Buffer.from(JSON.stringify({ u: reqOrigin, t: dev, n: p.name })).toString('base64url');
      return { participant: pubParticipant(p), deviceToken: dev, pairing };
    }
    if (sub === 'participants' && method === 'DELETE' && parts.length === 4) {
      const p = m.participants.find((x) => x.id === parts[3]);
      if (!p) throw new HttpError(404, 'Partecipante non trovato');
      m.participants = m.participants.filter((x) => x !== p);
      await saveRace(m);
      await store.pipeline([['DEL', k.dev(p.deviceHash)], ['DEL', k.pos(m.id, p.id)], ['HDEL', k.last(m.id), p.id]]);
      return { ok: true };
    }
    if (sub === 'link') {
      if (method === 'POST') {
        const ttl = Math.min(168, Math.max(1, Number(body?.ttlHours) || 72)) * 3600;
        const t = token(24), h = sha256(t);
        const ops = [['SET', k.view(h), m.id, 'EX', ttl]];
        if (m.viewHash) ops.push(['DEL', k.view(m.viewHash)]);   // il vecchio link smette di funzionare
        await store.pipeline(ops);
        m.viewHash = h; await saveRace(m);
        return { token: t, path: `/live#${t}`, expiresInHours: ttl / 3600 };
      }
      if (method === 'DELETE') {
        if (m.viewHash) await store.cmd(['DEL', k.view(m.viewHash)]);
        m.viewHash = null; await saveRace(m);
        return { ok: true };
      }
    }
    if ((sub === 'start' || sub === 'end') && method === 'POST') {
      if (m.status === 'ended') throw bad('Gara già conclusa');
      if (sub === 'start') { m.status = 'live'; m.startedAt = m.startedAt ?? now(); await saveRace(m); }
      else {
        m.status = 'ended'; m.endedAt = now(); await saveRace(m, KEEP_AFTER_END);
        await expireRace(m, KEEP_AFTER_END);   // scadenza fisica automatica dopo 24 ore
        await store.cmd(['SREM', 'races', m.id]);
      }
      return { race: pubMeta(m) };
    }
    if (sub === 'passage' && method === 'POST') {  // checkpoint manuale
      const cp = m.checkpoints.find((c) => c.id === body?.checkpointId);
      const p = m.participants.find((x) => x.id === body?.participantId);
      if (!cp || !p) throw new HttpError(404, 'Checkpoint o partecipante non trovato');
      const t = Number(body.t) || now();
      await store.cmd(['HSET', k.pass(m.id), `${cp.id}:${p.id}`, String(t)]);
      await store.cmd(['EXPIRE', k.pass(m.id), SAFETY_TTL]);
      return { ok: true, t };
    }
    throw new HttpError(404, 'Non trovato');
  }

  const pubParticipant = (p) => ({ id: p.id, name: p.name, color: p.color });
  const pubMeta = (m) => ({ id: m.id, name: m.name, status: m.status, createdAt: m.createdAt, startedAt: m.startedAt,
    endedAt: m.endedAt, hasLink: !!m.viewHash, participants: m.participants.map(pubParticipant),
    checkpoints: m.checkpoints.map(({ id, name, km, auto }) => ({ id, name, km, auto })) });

  // ---------- ricezione posizioni (app iOS) ----------
  async function ingest(headers, body) {
    const dev = bearer(headers);
    if (!dev) { console.log(JSON.stringify({ ev: 'ingest-denied', why: 'no-token' })); throw new HttpError(401, 'Credenziale dispositivo mancante'); }
    const ref = await getJSON(store, k.dev(sha256(dev)));
    if (!ref) { console.log(JSON.stringify({ ev: 'ingest-denied', why: 'unknown-token' })); throw new HttpError(401, 'Dispositivo non autorizzato'); }
    const minute = Math.floor(now() / 60000);
    const [count] = await store.pipeline([['INCR', `rl:${ref.pid}:${minute}`], ['EXPIRE', `rl:${ref.pid}:${minute}`, 90]]);
    if (count > RATE_PER_MIN) throw new HttpError(429, 'Troppe richieste');

    const m = await loadRace(ref.raceId);
    if (m.status === 'ended') throw new HttpError(410, 'Gara conclusa');
    const status = ['tracking', 'paused', 'no_gps'].includes(body?.status) ? body.status : 'tracking';
    const raw = Array.isArray(body?.points) ? body.points : [];
    if (raw.length > MAX_BATCH) throw bad(`Massimo ${MAX_BATCH} punti per richiesta`);

    const t = now();
    const pts = raw.map((p) => ({
      t: num(p.t, t - DAY * 1000, t + 120000, 't'),
      lat: num(p.lat, -90, 90, 'lat'), lon: num(p.lon, -180, 180, 'lon'),
      ele: p.ele == null ? null : num(p.ele, -500, 9000, 'quota'),
      acc: p.acc == null ? null : num(p.acc, 0, 100000, 'precisione'),
    })).sort((a, b) => a.t - b.t);

    const lastRaw = await store.cmd(['HGET', k.last(m.id), ref.pid]);
    const last = lastRaw ? JSON.parse(lastRaw) : null;
    const fresh = pts.filter((p) => last?.t == null || p.t > last.t);   // idempotente: ignora i duplicati
    const course = await loadCourse(m.id);
    const cps = course ? m.checkpoints.filter((c) => c.auto) : [];
    let pass = {}, det = {};
    if (cps.length && fresh.length) {
      const [pa, de] = await store.pipeline([['HGETALL', k.pass(m.id)], ['HGETALL', k.det(m.id)]]);
      pass = toObj(pa); det = toObj(de);
    }

    const rows = [], writes = [];
    let km = last?.km ?? 0, fin = !!last?.fin, lastPt = last, off = last?.off ?? null;
    for (const p of fresh) {
      if (course) { const pr = project(course, p.lat, p.lon, km); km = Math.max(km, pr.km); off = Math.round(pr.offM); }
      rows.push(encodePoint(p, km));
      lastPt = { t: p.t, lat: p.lat, lon: p.lon, ele: p.ele, acc: p.acc, km };
      if (course && km >= course.totalKm - 0.05) fin = true;
      if (m.startedAt && p.t >= m.startedAt && (p.acc == null || p.acc <= 60)) {
        for (const c of cps) {
          const key = `${c.id}:${ref.pid}`;
          if (pass[key]) continue;
          if (haversine(p.lat, p.lon, c.lat, c.lon) <= Math.max(c.radius, p.acc ? Math.min(p.acc, 100) : 0)) {
            const [n, first] = (det[key] || '0:0').split(':').map(Number);
            const nn = n + 1, ft = n ? first : p.t;
            if (nn >= 2) { pass[key] = String(ft); writes.push(['HSET', k.pass(m.id), key, String(ft)]); delete det[key]; writes.push(['HDEL', k.det(m.id), key]); }
            else { det[key] = `${nn}:${ft}`; writes.push(['HSET', k.det(m.id), key, det[key]]); }
          } else if (det[key]) { delete det[key]; writes.push(['HDEL', k.det(m.id), key]); }
        }
      }
    }
    const rec = { ...(lastPt || { t: null }), status, rcv: t, fin, off, n: (last?.n ?? 0) + rows.length };
    const ops = [['HSET', k.last(m.id), ref.pid, JSON.stringify(rec)], ['EXPIRE', k.last(m.id), SAFETY_TTL], ...writes];
    if (rows.length) ops.push(['RPUSH', k.pos(m.id, ref.pid), ...rows], ['LTRIM', k.pos(m.id, ref.pid), -MAX_HISTORY, -1],
      ['EXPIRE', k.pos(m.id, ref.pid), SAFETY_TTL]);
    await store.pipeline(ops);
    console.log(JSON.stringify({ ev: 'ingest', race: m.id, p: ref.pid, got: pts.length, new: rows.length, st: status }));
    return { ok: true, accepted: rows.length, duplicates: pts.length - fresh.length, raceStatus: m.status, serverTime: t };
  }
  // App "Overland" (iOS, App Store, gratuita): invia lotti GeoJSON a un indirizzo. Il token del dispositivo
  // può stare nell'indirizzo (?token=) o nell'intestazione Authorization. Risposta attesa: {"result":"ok"}.
  async function overland(headers, query, body) {
    const dev = query.token || bearer(headers);
    if (!dev) throw new HttpError(401, 'Credenziale dispositivo mancante');
    const t = now();
    const fin = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
    const pts = (Array.isArray(body?.locations) ? body.locations : [])
      .filter((f) => f?.geometry?.type === 'Point' && Array.isArray(f.geometry.coordinates))
      .map((f) => ({ t: Date.parse(f.properties?.timestamp), lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
        ele: fin(f.properties?.altitude), acc: fin(f.properties?.horizontal_accuracy) >= 0 ? f.properties.horizontal_accuracy : null }))
      .filter((p) => isFinite(p.t) && p.t > t - DAY * 1000 && p.t < t + 120000 && fin(p.lat) != null && fin(p.lon) != null
        && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 && (p.ele == null || (p.ele > -500 && p.ele < 9000)));
    const auth = { authorization: `Bearer ${dev}` };
    if (!pts.length) await ingest(auth, { points: [], status: 'tracking' });
    for (let i = 0; i < pts.length; i += 100) await ingest(auth, { points: pts.slice(i, i + 100), status: 'tracking' });
    return { result: 'ok' };
  }
  const toObj = (flat) => { const o = {}; for (let i = 0; i < (flat || []).length; i += 2) o[flat[i]] = flat[i + 1]; return o; };

  // ---------- rotte osservatore ----------
  async function live(query, headers) {
    const m = await viewer(query, headers);
    const course = await loadCourse(m.id);
    const last = toObj(await store.cmd(['HGETALL', k.last(m.id)]));
    const t = now();
    return { race: { name: m.name, status: m.status, startedAt: m.startedAt, endedAt: m.endedAt, totalKm: course?.totalKm ?? null },
      participants: m.participants.map((p) => {
        const l = last[p.id] ? JSON.parse(last[p.id]) : null;
        const st = participantStatus(m, l);
        return { id: p.id, name: p.name, color: p.color, status: st, statusLabel: STATUS_LABEL[st],
          last: l?.t != null ? { t: l.t, lat: l.lat, lon: l.lon, ele: l.ele, ageSec: Math.round((t - l.t) / 1000) } : null,
          offCourseM: l?.t != null && course ? l.off ?? null : null,
          distKm: l?.t != null && course ? Math.round(l.km * 100) / 100 : null,
          remainingKm: l?.t != null && course ? Math.round(Math.max(0, course.totalKm - l.km) * 100) / 100 : null };
      }), serverTime: t };
  }

  async function courseRoute(query, headers) {
    const m = await viewer(query, headers);
    const course = await loadCourse(m.id);
    return { name: m.name, course, checkpoints: m.checkpoints.map(({ id, name, lat, lon, km, auto }) => ({ id, name, lat, lon, km, auto })) };
  }

  async function stats(query, headers) {
    const m = await viewer(query, headers);
    const course = await loadCourse(m.id);
    if (!course) return { participants: [], note: 'Nessuna traccia caricata' };
    const reads = await store.pipeline([['HGETALL', k.pass(m.id)], ...m.participants.map((p) => ['LRANGE', k.pos(m.id, p.id), 0, -1])]);
    const pass = toObj(reads[0]);
    const out = m.participants.map((p, i) => {
      const rows = reads[i + 1].map(decodePoint);
      const s = rows.length ? runnerStats(course, rows, m.startedAt, now()) : { insufficient: true };
      let prev = m.startedAt;
      const passages = m.checkpoints.filter((c) => pass[`${c.id}:${p.id}`]).map((c) => {
        const tt = Number(pass[`${c.id}:${p.id}`]);
        const r = { checkpointId: c.id, name: c.name, km: c.km, t: tt, elapsedSec: m.startedAt ? Math.round((tt - m.startedAt) / 1000) : null,
          sinceLastSec: prev ? Math.round((tt - prev) / 1000) : null };
        prev = tt; return r;
      });
      return { id: p.id, name: p.name, color: p.color, stats: s, passages };
    });
    return { participants: out, note: 'Tempi e stime indicativi: non sostituiscono il cronometraggio ufficiale.', serverTime: now() };
  }

  // ---------- smistamento ----------
  const NOCACHE = { 'Cache-Control': 'no-store' };
  const cache = (s, swr) => ({ 'Cache-Control': `public, s-maxage=${s}, stale-while-revalidate=${swr}` });

  return async function handle({ method = 'GET', path = '/', query = {}, headers = {}, body = null, origin = '' }) {
    try {
      const parts = path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
      if (parts[0] === 'api') parts.shift();
      const h = Object.fromEntries(Object.entries(headers).map(([a, b]) => [a.toLowerCase(), b]));
      const ok = (json, headers = NOCACHE, status = 200) => ({ status, headers, json });
      const route = parts.join('/');
      if (route === 'health') return ok({ ok: true, store: store.kind, time: now() });
      if (parts[0] === 'admin') return ok(await adminRoutes(method, parts.slice(1), body, h, origin));
      if (route === 'device/positions' && method === 'POST') return ok(await ingest(h, body));
      if (route === 'device/overland' && method === 'POST') return ok(await overland(h, query, body));
      if (method === 'GET' && route === 'live') return ok(await live(query, h), cache(5, 10));
      if (method === 'GET' && route === 'course') return ok(await courseRoute(query, h), cache(60, 120));
      if (method === 'GET' && route === 'stats') return ok(await stats(query, h), cache(15, 30));
      throw new HttpError(404, 'Non trovato');
    } catch (e) {
      if (e instanceof HttpError) return { status: e.status, headers: NOCACHE, json: { error: e.message } };
      console.error(e);
      return { status: 500, headers: NOCACHE, json: { error: 'Errore interno' } };
    }
  };
}
