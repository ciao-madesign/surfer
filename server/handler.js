// Logica delle API, indipendente da Vercel: handle({method, path, query, headers, body}) -> {status, headers, json}
import { getJSON } from './store.js';
import { HttpError, bad, token, shortId, sha256, safeEqual, hmac } from './util.js';
import { buildCourse, project, haversine, encodePoint, decodePoint, runnerStats } from './geo.js';
import { createArchive } from './archive.js';
import { demoCourse, demoLive, demoStats } from './demo.js';

const DAY = 86400;
const KEEP_AFTER_END = DAY;          // 24 ore dalla fine della gara
const SAFETY_TTL = 3 * DAY;          // rete di sicurezza: posizioni GPS di gare mai chiuse e archiviazioni da ripetere
const DRAFT_TTL = 15 * DAY;          // gara non avviata: link e bozza durano 15 giorni dalla creazione
const LIVE_TTL = 7 * DAY;            // gara avviata e mai chiusa: 7 giorni dall'avvio (poi 24 ore dopo la fine)
const MAX_PARTICIPANTS = 5;
const CONSENT_VERSION = '1';   // versione del testo di consenso mostrato al corridore
const MAX_HISTORY = 9000;     // punti per corridore: copre le 36 ore di una gara a un punto ogni 15 s
const STALE_MS = 180000;      // senza segnale oltre 3 minuti: stato «senza connessione» e stima d'arrivo sospesa
const MAX_BATCH = 120;
const RATE_PER_MIN = 30;
const IP_PER_MIN = 120;       // richieste al minuto per rete (gli accessi con credenziali sbagliate ne valgono 6)
const ANON_REPORT_DAYS = 3;  // gare senza profilo: tempi e statistiche restano 3 giorni
const AUTO_END_HOURS = 36;   // chiusura automatica di una gara dimenticata aperta
const MAX_ACC = 150;        // m: precisione peggiore accettata
const MAX_SPEED = 12;       // m/s: oltre, un salto di posizione è considerato anomalo
const MAX_ANOM = 3;         // salti consecutivi scartati prima di fidarsi della nuova posizione
const OFF_COURSE_M = 300;   // m: oltre, il punto non fa avanzare la progressiva sul percorso
const MAX_PROG_ANOM = 5;    // avanzamenti irreali consecutivi prima di accettarli
const COLORS = ['#e91e63', '#2bb7da', '#f4c20d', '#34a853', '#8e24aa'];
const STATUS_LABEL = { waiting: 'In attesa', tracking: 'Segnale attivo', paused: 'In pausa',
  no_gps: 'Senza segnale GPS', offline: 'Senza connessione', finished: 'Gara conclusa' };

export function createHandler({ store, env = process.env, now = Date.now, archive = createArchive(env) }) {
  const courseCache = new Map();  // cache per istanza (lambda "calda"), 60 s

  // ---------- accesso ai dati ----------
  const k = {
    race: (id) => `race:${id}`, course: (id) => `course:${id}`, last: (id) => `last:${id}`,
    pos: (id, p) => `pos:${id}:${p}`, pass: (id) => `pass:${id}`, det: (id) => `det:${id}`,
    view: (h) => `v:${h}`, dev: (h) => `d:${h}`, org: (h) => `o:${h}`,
  };

  async function loadRace(id, { allowExpired = false } = {}) {
    const m = await getJSON(store, k.race(id));
    if (!m) throw new HttpError(404, 'Gara non trovata');
    if (!allowExpired && m.status === 'ended' && now() > m.endedAt + KEEP_AFTER_END * 1000) throw new HttpError(410, 'Dati scaduti');
    return m;
  }
  // Durata di gara, link e chiavi collegate: dipende dalla fase (stesse regole per il link di chi segue).
  const lifeTtl = (m) => {
    const end = m.status === 'ended' ? m.endedAt + KEEP_AFTER_END * 1000
      : m.status === 'live' ? (m.startedAt ?? now()) + LIVE_TTL * 1000 : m.createdAt + DRAFT_TTL * 1000;
    return Math.max(60, Math.ceil((end - now()) / 1000));
  };
  const saveRace = (m, ttl = lifeTtl(m)) => store.cmd(['SET', k.race(m.id), JSON.stringify(m), 'EX', ttl]);

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
    if (m.orgHash) keys.push(k.org(m.orgHash));
    return keys;
  }
  const expireRace = (m, secs) => store.pipeline(allKeys(m).map((key) => ['EXPIRE', key, secs]));

  // ---------- autenticazione ----------
  function admin(headers) {
    if (!env.ADMIN_KEY) throw new HttpError(503, 'Amministrazione non configurata (ADMIN_KEY)');
    if (!safeEqual(headers['x-admin-key'] || '', env.ADMIN_KEY)) throw new HttpError(401, 'Chiave amministratore errata');
  }
  // admin globale (ADMIN_KEY) oppure organizzatore di UNA gara (x-org-token)
  async function authorize(headers) {
    const org = headers['x-org-token'];
    if (org) {
      if (org.length < 20) throw new HttpError(401, 'Link organizzatore non valido');
      const raceId = await store.cmd(['GET', k.org(sha256(org))]);
      if (!raceId) throw new HttpError(401, 'Link organizzatore non valido o scaduto');
      return { raceId };
    }
    admin(headers);
    return { raceId: null };
  }
  const bearer = (headers) => (headers.authorization || '').replace(/^Bearer\s+/i, '');

  async function viewer(query, headers) {
    const t = query.t;   // solo nell'indirizzo: la CDN usa l'URL come chiave di cache
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
    if (now() - last.rcv > STALE_MS) return 'offline';
    return m.status === 'live' ? 'tracking' : 'waiting';
  }

  // ---------- creazione gara (admin e pubblico) ----------
  async function createRace(body, withOrganizer = false) {
    const name = text(body?.name, 80, 'Nome');
    const id = shortId();
    const meta = { id, name, status: 'draft', createdAt: now(), startedAt: null, endedAt: null,
      viewHash: null, orgHash: null, participants: [], checkpoints: [] };
    let course = null;
    if (body.course) {
      course = buildCourse(parseCoursePoints(body.course.points));
      course.name = body.course.name ? String(body.course.name).slice(0, 80) : name;
    }
    const cps = Array.isArray(body.checkpoints) ? body.checkpoints : [];
    if (cps.length > 30) throw bad('Massimo 30 checkpoint');
    if (!cps.every((c) => c && typeof c === 'object')) throw bad('Checkpoint non valido');
    if (cps.length && !course) throw bad('Servono la traccia GPX per i checkpoint');
    meta.checkpoints = cps.map((c, i) => {
      const lat = num(c.lat, -90, 90, 'lat checkpoint'), lon = num(c.lon, -180, 180, 'lon checkpoint');
      return { id: `c${i + 1}`, name: text(c.name, 60, 'Nome checkpoint'), lat, lon,
        km: Math.round(project(course, lat, lon).km * 1000) / 1000,
        auto: c.auto !== false, radius: Math.min(200, Math.max(20, Number(c.radius) || 50)) };
    }).sort((a, b) => a.km - b.km);
    let orgToken = null;
    if (withOrganizer) { orgToken = token(24); meta.orgHash = sha256(orgToken); }
    await saveRace(meta);
    const ops = [['SADD', 'races', id]];
    if (course) ops.push(['SET', k.course(id), JSON.stringify(course), 'EX', DRAFT_TTL]);
    if (orgToken) ops.push(['SET', k.org(meta.orgHash), id, 'EX', DRAFT_TTL]);
    await store.pipeline(ops);
    return { race: pubMeta(meta), course: course && { totalKm: course.totalKm, gain: course.gain, loss: course.loss },
      ...(orgToken ? { organizerToken: orgToken, organizerPath: `/gestisci#${orgToken}` } : {}) };
  }

  // Rete del visitatore: per IPv6 conta il blocco /64 (un utente può cambiare l'ultima parte dell'indirizzo a piacere).
  // Si conserva solo un hash con sale che cambia ogni giorno: non permette di collegare giorni diversi.
  function ipId(headers) {
    let ip = String(headers['x-forwarded-for'] || headers['x-real-ip'] || 'local').split(',')[0].trim();
    if (ip.includes(':')) {
      const [a, b] = ip.split('::'), A = a ? a.split(':') : [], B = b ? b.split(':') : [];
      ip = [...A, ...Array(Math.max(0, 8 - A.length - B.length)).fill('0'), ...B].slice(0, 4).map((x) => x.padStart(4, '0')).join(':');
    }
    return hmac(`${env.ADMIN_KEY || ''}:${Math.floor(now() / 86400000)}`, ip).slice(0, 16);
  }

  // creazione pubblica: limiti per rete (solo hash con sale giornaliero, 1 giorno) e tetto globale
  async function publicCreate(headers, body) {
    const day = Math.floor(now() / 86400000);
    const key = `rc:${ipId(headers)}:${day}`;
    const [n] = await store.pipeline([['INCR', key], ['EXPIRE', key, 2 * DAY]]);
    if (n > (Number(env.CREATE_PER_DAY) || 5)) throw new HttpError(429, 'Troppe gare create oggi: riprova domani');
    const active = await store.cmd(['SMEMBERS', 'races']);
    if (active.length >= (Number(env.MAX_ACTIVE_RACES) || 500)) throw new HttpError(503, 'Servizio al completo: riprova tra poco');
    return createRace(body, true);
  }

  // Cancella un corridore: archivio (se la gara è già archiviata) e dati live. Usata da organizzatore e dal corridore stesso.
  async function removeParticipant(m, p) {
    if (archive.enabled && m.status === 'ended' && m.archive?.state === 'done') {
      try { await archive.deleteParticipant(m.id, p.id); }
      catch (e) { console.log(JSON.stringify({ ev: 'delete-failed', race: m.id, err: String(e.message || e).slice(0, 120) })); throw new HttpError(503, 'Cancellazione non riuscita: riprova tra poco'); }
    }
    m.participants = m.participants.filter((x) => x !== p);
    await saveRace(m, m.status === 'ended' && m.archive?.state === 'pending' ? SAFETY_TTL : lifeTtl(m));
    await store.pipeline([['DEL', k.dev(p.deviceHash)], ['DEL', k.pos(m.id, p.id)], ['HDEL', k.last(m.id), p.id]]);
  }

  // Il corridore, con il proprio codice di accesso, vede cosa è salvato su di lui e può cancellarlo.
  async function deviceMe(headers, method, body) {
    const dev = bearer(headers);
    if (!dev) throw new HttpError(401, 'Credenziale dispositivo mancante');
    const ref = await getJSON(store, k.dev(sha256(dev)));
    if (!ref) throw new HttpError(401, 'Dispositivo non autorizzato');
    const m = await loadRace(ref.raceId);
    const p = m.participants.find((x) => x.id === ref.pid);
    if (!p) throw new HttpError(401, 'Dispositivo non autorizzato');
    if (method === 'DELETE') { await removeParticipant(m, p); return { ok: true }; }
    if (method === 'POST') {   // consenso del corridore: solo con questo gesto le sue posizioni vengono accettate
      if (m.status === 'ended') throw new HttpError(410, 'Gara conclusa');
      if (body?.accept !== true || body?.ageOk !== true) throw bad('Serve il consenso esplicito');
      if (!p.consentAt) { p.consentAt = now(); p.consentVersion = CONSENT_VERSION; await saveRace(m); }
      return { ok: true, consentAt: p.consentAt };
    }
    const l = await store.cmd(['HGET', k.last(m.id), p.id]);
    return { name: p.name, raceName: m.name, raceStatus: m.status, consent: !!p.consentAt, consentAt: p.consentAt ?? null, points: l ? JSON.parse(l).n ?? 0 : 0 };
  }

  // ---------- rotte amministratore ----------
  async function adminRoutes(method, parts, body, headers, reqOrigin) {
    const scope = await authorize(headers);
    // /admin/races
    if (parts[0] !== 'races') throw new HttpError(404, 'Non trovato');
    if (parts.length === 1) {
      if (method === 'GET') {
        const ids = scope.raceId ? [scope.raceId] : await store.cmd(['SMEMBERS', 'races']);
        const out = [];
        for (const id of ids) {
          const m = await getJSON(store, k.race(id));
          if (!m) { await store.cmd(['SREM', 'races', id]); continue; }
          out.push({ id, name: m.name, status: m.status, createdAt: m.createdAt, participants: m.participants.length });
        }
        return { races: out };
      }
      if (method === 'POST') {
        if (scope.raceId) throw new HttpError(403, 'Non consentito');
        return createRace(body);
      }
      throw new HttpError(405, 'Metodo non consentito');
    }
    if (scope.raceId && parts[1] !== scope.raceId) throw new HttpError(403, 'Non consentito');
    const m = await loadRace(parts[1], { allowExpired: parts[2] === 'archive' });
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
        if (archive.enabled) {   // prima l'archivio: se non riesce, non si perde il modo di riprovare
          try { await archive.deleteRace(m.id); } catch (e) { console.log(JSON.stringify({ ev: 'delete-failed', race: m.id, err: String(e.message || e).slice(0, 120) })); throw new HttpError(503, 'Cancellazione non riuscita: riprova tra poco'); }
        }
        await store.pipeline([...allKeys(m).map((key) => ['DEL', key]), ['SREM', 'races', m.id], ['SREM', 'archq', m.id]]);
        return { ok: true };
      }
    }
    if (sub === 'participants' && method === 'POST' && parts.length === 3) {
      if (m.participants.length >= MAX_PARTICIPANTS) throw bad('Massimo 5 partecipanti');
      const dev = token(24), pid = `p${m.participants.length + 1}${shortId().slice(0, 6)}`;
      const p = { id: pid, name: text(body?.name, 40, 'Nome'),
        color: /^#[0-9a-f]{6}$/i.test(body?.color || '') ? body.color : COLORS[m.participants.length % 5],
        deviceHash: sha256(dev) };
      m.participants.push(p);
      await saveRace(m);
      await store.cmd(['SET', k.dev(p.deviceHash), JSON.stringify({ raceId: m.id, pid }), 'EX', lifeTtl(m)]);
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
      await store.pipeline([['SET', k.dev(p.deviceHash), JSON.stringify({ raceId: m.id, pid: p.id }), 'EX', lifeTtl(m)], ['DEL', k.dev(oldHash)]]);
      const pairing = Buffer.from(JSON.stringify({ u: reqOrigin, t: dev, n: p.name })).toString('base64url');
      return { participant: pubParticipant(p), deviceToken: dev, pairing };
    }
    if (sub === 'report' && method === 'POST') {   // nuovo link del report: il vecchio smette di funzionare
      if (!archive.enabled || m.status !== 'ended' || m.archive?.state !== 'done') throw bad('Report non ancora disponibile');
      const salt = token(12);
      try { await archive.setReportSalt(m.id, salt); } catch { throw new HttpError(503, 'Operazione non riuscita: riprova tra poco'); }
      m.reportSalt = salt; await applyRetention(m);
      return { reportPath: reportPath(m) };
    }
    if (sub === 'participants' && method === 'DELETE' && parts.length === 4) {
      const p = m.participants.find((x) => x.id === parts[3]);
      if (!p) throw new HttpError(404, 'Partecipante non trovato');
      await removeParticipant(m, p);
      return { ok: true };
    }
    if (sub === 'link') {
      if (method === 'POST') {
        const ttl = lifeTtl(m);   // il link dura quanto la gara: fino a 24 ore dopo la fine
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
      if (sub === 'start') {
        m.status = 'live'; m.startedAt = m.startedAt ?? now(); await saveRace(m);
        await expireRace(m, lifeTtl(m));   // la durata passa a 7 giorni dall'avvio, anche per link e chiavi già create
      }
      else await endRace(m);
      return { race: pubMeta(m) };
    }
    if (sub === 'archive' && method === 'POST') {   // nuovo tentativo manuale di archiviazione
      if (m.status !== 'ended') throw bad('La gara non è conclusa');
      if (m.archive?.state !== 'done') await retryArchive(m);
      return { archive: m.archive };
    }
    if (sub === 'passage' && method === 'POST') {  // checkpoint manuale
      const cp = m.checkpoints.find((c) => c.id === body?.checkpointId);
      const p = m.participants.find((x) => x.id === body?.participantId);
      if (!cp || !p) throw new HttpError(404, 'Checkpoint o partecipante non trovato');
      const t = body.t == null ? now() : num(body.t, now() - 7 * DAY * 1000, now() + 120000, 't');
      await store.cmd(['HSET', k.pass(m.id), `${cp.id}:${p.id}`, String(t)]);
      await store.cmd(['EXPIRE', k.pass(m.id), SAFETY_TTL]);
      return { ok: true, t };
    }
    throw new HttpError(404, 'Non trovato');
  }

  // ---------- chiusura e archiviazione ----------
  // Riepilogo da portare su Neon: nessuna coordinata GPS, solo tempi e statistiche finali.
  async function buildSummary(m) {
    const course = await loadCourse(m.id);
    const reads = await store.pipeline([['HGETALL', k.pass(m.id)], ...m.participants.map((p) => ['LRANGE', k.pos(m.id, p.id), 0, -1])]);
    const pass = toObj(reads[0]);
    const cps = m.checkpoints;           // già ordinati per km
    return {
      id: m.id, name: m.name, accountId: m.accountId ?? null, startedAt: m.startedAt, endedAt: m.endedAt,
      totalKm: course?.totalKm ?? null, reportSalt: m.reportSalt ?? null,
      meta: course ? { gain: course.gain, loss: course.loss } : null,
      course: m.accountId && course ? { name: course.name, points: course.points, totalKm: course.totalKm, gain: course.gain, loss: course.loss } : null,
      expiresAt: m.accountId ? null : m.endedAt + ANON_REPORT_DAYS * DAY * 1000,
      checkpoints: cps.map((c, i) => ({ idx: i, name: c.name, km: c.km, radius: c.radius })),
      participants: m.participants.map((p, i) => {
        const rows = reads[i + 1].map(decodePoint);
        let stats = null;
        if (course && rows.length) { stats = { ...runnerStats(course, rows, m.startedAt, m.endedAt), etaSec: null, etaAt: null }; }
        const passages = cps.map((c, idx) => (pass[`${c.id}:${p.id}`] ? { cp: idx, t: Number(pass[`${c.id}:${p.id}`]) } : null)).filter(Boolean);
        return { id: p.id, name: p.name, color: p.color, stats, passages, consentAt: p.consentAt ?? null, consentVersion: p.consentVersion ?? null };
      }),
    };
  }

  const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
  // Più tentativi con pausa crescente. Lo stato resta nei dati della gara: 'done' | 'pending' | 'off'.
  async function tryArchive(m) {
    if (!archive.enabled) { m.archive = { state: 'off' }; return; }
    const summary = await buildSummary(m);
    const wait = Number(env.ARCHIVE_RETRY_MS ?? 300);
    let err = '';
    for (let i = 1; i <= 3; i++) {
      try {
        const r = await archive.saveRace(summary);
        if (r.ok) { m.archive = { state: 'done', at: now(), attempts: (m.archive?.attempts ?? 0) + i }; return; }
        err = 'verifica fallita';
      } catch (e) { err = String(e?.message || e).slice(0, 120); }
      console.log(JSON.stringify({ ev: 'archive-retry', race: m.id, attempt: i, err }));
      await sleep(wait * i);
    }
    m.archive = { state: 'pending', attempts: (m.archive?.attempts ?? 0) + 3, lastError: err };
  }

  // Redis si svuota SOLO dopo la conferma su Neon; se l'archivio non conferma, i dati restano più a lungo per riprovare.
  async function applyRetention(m) {
    const left = Math.ceil((m.endedAt + KEEP_AFTER_END * 1000 - now()) / 1000);
    const ttl = m.archive?.state === 'pending' ? SAFETY_TTL : Math.max(60, left);
    await saveRace(m, ttl);
    await expireRace(m, ttl);
    if (m.viewHash) await store.cmd(['EXPIRE', k.view(m.viewHash), Math.max(60, left)]);   // il link di chi segue cade 24 ore dopo la fine, anche se il report è in attesa
    await store.cmd([m.archive?.state === 'pending' ? 'SADD' : 'SREM', 'archq', m.id]);
  }

  async function endRace(m) {
    m.status = 'ended'; m.endedAt = now(); m.reportSalt = token(12);
    await tryArchive(m);
    await applyRetention(m);
    await store.cmd(['SREM', 'races', m.id]);
  }
  async function retryArchive(m) { await tryArchive(m); await applyRetention(m); }

  // Attività periodica (Vercel Cron, una volta al giorno): chiude le gare dimenticate, riprova le archiviazioni
  // in sospeso e cancella dall'archivio i report scaduti.
  async function cron(headers) {
    if (!env.CRON_SECRET) throw new HttpError(503, 'Cron non configurato (CRON_SECRET)');
    if (!safeEqual(bearer(headers), env.CRON_SECRET)) throw new HttpError(401, 'Non autorizzato');
    const out = { autoEnded: 0, archived: 0, stillPending: 0, purged: 0 };
    for (const id of await store.cmd(['SMEMBERS', 'races'])) {
      const m = await getJSON(store, k.race(id));
      if (!m) { await store.cmd(['SREM', 'races', id]); continue; }
      if (m.status === 'live' && m.startedAt && now() - m.startedAt > AUTO_END_HOURS * 3600000) { await endRace(m); out.autoEnded++; }
    }
    for (const id of await store.cmd(['SMEMBERS', 'archq'])) {
      const m = await getJSON(store, k.race(id));
      if (!m || m.archive?.state !== 'pending') { await store.cmd(['SREM', 'archq', id]); continue; }
      await retryArchive(m);
      if (m.archive.state === 'done') out.archived++; else out.stillPending++;
    }
    if (archive.enabled) out.purged = await archive.purgeExpired(now());
    return out;
  }

  // ---------- report di gara ----------
  // Il collegamento al report si ricava dall'id della gara con una firma segreta: non serve salvarlo e resta
  // sempre lo stesso. Chi lo ha può leggere il report finché l'archivio lo conserva.
  const reportSecret = env.REPORT_SECRET || '';   // dedicato: senza, i report restano disattivati
  const reportSig = (id, salt) => hmac(reportSecret, `report:${id}${salt ? `:${salt}` : ''}`).slice(0, 32);   // il sale per gara rende il link revocabile
  const reportToken = (id, salt) => `${id}.${reportSig(id, salt)}`;
  const reportPath = (m) => (reportSecret && m.status === 'ended' && m.archive?.state === 'done' ? `/report#${reportToken(m.id, m.reportSalt)}` : null);

  async function report(query) {
    const t = String(query.t || '');
    const i = t.lastIndexOf('.');
    const id = t.slice(0, i), sig = t.slice(i + 1);
    if (!reportSecret || i < 1 || !/^[\w-]{4,40}$/.test(id) || sig.length !== 32) throw new HttpError(401, 'Link del report non valido');
    if (!archive.enabled) throw new HttpError(404, 'Report non disponibile');
    const r = await archive.getRace(id);
    if (!r) throw new HttpError(404, 'Report non trovato o scaduto');
    if (!safeEqual(sig, reportSig(id, r.reportSalt))) throw new HttpError(401, 'Link del report non valido');
    if (r.expiresAt != null && r.expiresAt < now()) throw new HttpError(410, 'Report scaduto');
    const { course, accountId, reportSalt, ...pub } = r;
    pub.participants = pub.participants.map(({ consentAt, consentVersion, ...rest }) => rest);      // la traccia e l'account non escono mai dal report
    return { ...pub, serverTime: now() };
  }

  const pubParticipant = (p) => ({ id: p.id, name: p.name, color: p.color, consent: !!p.consentAt });
  const pubMeta = (m) => ({ id: m.id, name: m.name, status: m.status, createdAt: m.createdAt, startedAt: m.startedAt,
    endedAt: m.endedAt, archive: m.archive?.state ?? null, reportPath: reportPath(m), hasLink: !!m.viewHash, participants: m.participants.map(pubParticipant),
    checkpoints: m.checkpoints.map(({ id, name, km, auto }) => ({ id, name, km, auto })) });

  // ---------- ricezione posizioni (app iOS) ----------
  async function ingest(headers, body) {
    const dev = bearer(headers);
    if (!dev) { console.log(JSON.stringify({ ev: 'ingest-denied', why: 'no-token' })); throw new HttpError(401, 'Credenziale dispositivo mancante'); }
    const ref = await getJSON(store, k.dev(sha256(dev)));
    if (!ref) { console.log(JSON.stringify({ ev: 'ingest-denied', why: 'unknown-token' })); throw new HttpError(401, 'Dispositivo non autorizzato'); }
    const minute = Math.floor(now() / 60000);
    const rlKey = `rl:${ref.raceId}:${ref.pid}:${minute}`;   // per gara e corridore
    const [count] = await store.pipeline([['INCR', rlKey], ['EXPIRE', rlKey, 90]]);
    if (count > RATE_PER_MIN) throw new HttpError(429, 'Troppe richieste');

    const m = await loadRace(ref.raceId);
    if (m.status === 'ended') throw new HttpError(410, 'Gara conclusa');
    const me = m.participants.find((x) => x.id === ref.pid);
    if (!me) throw new HttpError(401, 'Dispositivo non autorizzato');
    if (!me.consentAt) throw new HttpError(403, 'Il corridore non ha ancora dato il consenso');
    // una sola richiesta alla volta per corridore: evita che due invii ravvicinati si sovrascrivano
    const lock = `lock:${m.id}:${ref.pid}`;
    if (!(await store.cmd(['SET', lock, '1', 'NX', 'EX', 15]))) throw new HttpError(429, 'Invio già in corso, riprova');
    try {
    const status = ['tracking', 'paused', 'no_gps'].includes(body?.status) ? body.status : 'tracking';
    const raw = Array.isArray(body?.points) ? body.points : [];
    if (raw.length > MAX_BATCH) throw bad(`Massimo ${MAX_BATCH} punti per richiesta`);
    if (!raw.every((p) => p && typeof p === 'object')) throw bad('Punto non valido');

    const t = now();
    // un punto troppo vecchio o nel futuro viene scartato, senza rifiutare l'intero invio
    let stale = 0;
    const usable = raw.filter((p) => {
      if (typeof p.t !== 'number' || !isFinite(p.t)) throw bad('t non valido');
      if (p.t < t - DAY * 1000 || p.t > t + 120000 || p.t < me.consentAt) { stale++; return false; }   // niente punti precedenti al consenso
      return true;
    });
    const pts = usable.map((p) => ({
      t: p.t,
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
    let anom = last?.anom ?? 0, progAnom = last?.panom ?? 0, rejected = stale;
    for (const p of fresh) {
      // 1) campioni inutilizzabili: precisione pessima, oppure salto di posizione impossibile
      if (p.acc != null && p.acc > MAX_ACC) { rejected++; continue; }
      if (lastPt?.t != null) {
        const d = haversine(lastPt.lat, lastPt.lon, p.lat, p.lon);
        if (d > 100 && d / Math.max(1, (p.t - lastPt.t) / 1000) > MAX_SPEED && anom < MAX_ANOM) { anom++; rejected++; continue; }
      }
      anom = 0;
      // 2) avanzamento sul percorso: solo se il punto è vicino alla traccia e il salto è plausibile
      if (course) {
        const pr = project(course, p.lat, p.lon, km);
        off = Math.round(pr.offM);
        if (pr.offM <= OFF_COURSE_M) {
          const dt = last?.t != null && lastPt?.t != null ? (p.t - lastPt.t) / 1000 : null;
          const maxJump = dt == null ? Infinity : 0.4 + (dt * MAX_SPEED) / 1000;
          if (pr.km - km <= maxJump || progAnom >= MAX_PROG_ANOM) { km = Math.max(km, pr.km); progAnom = 0; }
          else progAnom++;
        }
      }
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
    const rec = { ...(lastPt || { t: null }), status, rcv: t, fin, off, anom, panom: progAnom, n: (last?.n ?? 0) + rows.length };
    const ops = [['HSET', k.last(m.id), ref.pid, JSON.stringify(rec)], ['EXPIRE', k.last(m.id), SAFETY_TTL], ...writes];
    if (rows.length) ops.push(['RPUSH', k.pos(m.id, ref.pid), ...rows], ['LTRIM', k.pos(m.id, ref.pid), -MAX_HISTORY, -1],
      ['EXPIRE', k.pos(m.id, ref.pid), SAFETY_TTL]);
    await store.pipeline(ops);
    console.log(JSON.stringify({ ev: 'ingest', race: m.id, p: ref.pid, got: pts.length, new: rows.length, rej: rejected, st: status }));
    return { ok: true, accepted: rows.length, rejected, duplicates: pts.length - fresh.length, raceStatus: m.status, serverTime: t };
    } finally { await store.cmd(['DEL', lock]); }
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
    return { race: { name: m.name, status: m.status, startedAt: m.startedAt, endedAt: m.endedAt, totalKm: course?.totalKm ?? null, reportPath: reportPath(m) },
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
    const reads = await store.pipeline([['HGETALL', k.pass(m.id)], ...m.participants.map((p) => ['LRANGE', k.pos(m.id, p.id), 0, -1]), ['HGETALL', k.last(m.id)]]);
    const pass = toObj(reads[0]);
    const lastAll = toObj(reads[m.participants.length + 1]);
    const out = m.participants.map((p, i) => {
      const rows = reads[i + 1].map(decodePoint);
      const s = rows.length ? runnerStats(course, rows, m.startedAt, now()) : { insufficient: true };
      // senza segnale recente la stima d'arrivo non è credibile: viene sospesa (e torna da sola)
      const l = lastAll[p.id] ? JSON.parse(lastAll[p.id]) : null;
      if (m.status === 'live' && l && !l.fin && !s.insufficient) {
        const age = l.t != null ? now() - l.t : Infinity;
        if (participantStatus(m, l) !== 'tracking' || age > STALE_MS) {
          s.etaSec = null; s.etaAt = null; s.etaSuspended = true; s.signalAgeSec = isFinite(age) ? Math.round(age / 1000) : null;
        }
      }
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
  // La CDN usa l'URL completo (token compreso) come chiave: solo chi ha il link riceve la risposta in cache.
// Niente "stale-while-revalidate": dopo una revoca nessuno riceve dati vecchi oltre la durata indicata.
const cache = (s) => ({ 'Cache-Control': `public, s-maxage=${s}, max-age=0` });
const privateCache = (s) => ({ 'Cache-Control': `private, max-age=${s}` });

  return async function handle({ method = 'GET', path = '/', query = {}, headers = {}, body = null, origin = '' }) {
    let ipk = null;
    try {
      const parts = path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
      if (parts[0] === 'api') parts.shift();
      const h = Object.fromEntries(Object.entries(headers).map(([a, b]) => [a.toLowerCase(), b]));
      const ok = (json, headers = NOCACHE, status = 200) => ({ status, headers, json });
      const route = parts.join('/');
      // la CDN usa l'URL come chiave di cache: parametri in più servirebbero solo a saltarla
      if (method === 'GET' && ['live', 'course', 'stats', 'report'].includes(route) && Object.keys(query).some((x) => x !== 't')) throw bad('Richiesta non valida');
      if (route !== 'health' && route !== 'cron/archive' && !route.startsWith('demo/')) {
        ipk = `rl:ip:${ipId(h)}:${Math.floor(now() / 60000)}`;
        const n = await store.cmd(['INCR', ipk]);
        if (n === 1) await store.cmd(['EXPIRE', ipk, 90]);
        if (n > IP_PER_MIN) throw new HttpError(429, 'Troppe richieste: riprova tra un minuto');
      }
      if (route === 'health') return ok({ ok: true, store: store.kind, time: now() });
      if (method === 'GET' && route === 'demo/course') return ok(demoCourse(), privateCache(300));
      if (method === 'GET' && route === 'demo/live') return ok(demoLive(now()), NOCACHE);
      if (method === 'GET' && route === 'demo/stats') return ok(demoStats(now()), NOCACHE);
      if (method === 'GET' && route === 'report') return ok(await report(query), privateCache(60));
      if (route === 'cron/archive') return ok(await cron(h));
      if (route === 'races' && method === 'POST') return ok(await publicCreate(h, body));
      if (parts[0] === 'admin') return ok(await adminRoutes(method, parts.slice(1), body, h, origin));
      if (route === 'device/positions' && method === 'POST') return ok(await ingest(h, body));
      if (route === 'device/me' && (method === 'GET' || method === 'DELETE')) return ok(await deviceMe(h, method));
      if (route === 'device/consent' && method === 'POST') return ok(await deviceMe(h, 'POST', body));
      if (route === 'device/overland' && method === 'POST') return ok(await overland(h, query, body));
      if (method === 'GET' && route === 'live') return ok(await live(query, h), cache(5));
      if (method === 'GET' && route === 'course') return ok(await courseRoute(query, h), privateCache(60));
      if (method === 'GET' && route === 'stats') return ok(await stats(query, h), cache(15));
      throw new HttpError(404, 'Non trovato');
    } catch (e) {
      if (e instanceof HttpError && e.status === 401 && ipk) { try { await store.cmd(['INCRBY', ipk, 5]); } catch { /* il limite resta quello già contato */ } }   // un accesso sbagliato pesa 6 richieste
      if (e instanceof HttpError) return { status: e.status, headers: NOCACHE, json: { error: e.message } };
      console.error(e);
      return { status: 500, headers: NOCACHE, json: { error: 'Errore interno' } };
    }
  };
}
