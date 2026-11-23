// Parti condivise dai moduli: lettura gare, durata, autenticazione, validazioni e vista pubblica di gare e corridori.
import { HttpError, bad, token, shortId, sha256, safeEqual, hmac } from './util.js';
import { buildCourse, project, haversine, encodePoint, decodePoint, runnerStats } from './geo.js';
import { DAY, KEEP_AFTER_END, SAFETY_TTL, DRAFT_TTL, LIVE_TTL, MAX_PARTICIPANTS, CONSENT_VERSION, MAX_HISTORY, STALE_MS, MAX_BATCH, RATE_PER_MIN, IP_PER_MIN, ANON_REPORT_DAYS, AUTO_END_HOURS, MAX_ACC, MAX_SPEED, MAX_ANOM, OFF_COURSE_M, MAX_PROG_ANOM, COLORS, STATUS_LABEL } from './config.js';

export function createCommon({ repo, env, now }) {
  const courseCache = new Map();  // cache per istanza (lambda "calda"), 60 s

  async function loadRace(id, { allowExpired = false } = {}) {
    const m = await repo.getRace(id);
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
  const saveRace = (m, ttl = lifeTtl(m)) => repo.saveRace(m, ttl);

  async function loadCourse(id) {
    const c = courseCache.get(id);
    if (c && c.exp > now()) return c.v;
    const v = await repo.getCourse(id);
    if (v) courseCache.set(id, { v, exp: now() + 60000 });
    return v;
  }

  const expireRace = (m, secs) => repo.expireRace(m, secs);

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
      const raceId = await repo.raceIdByOrg(sha256(org));
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
    const raceId = await repo.raceIdByView(sha256(t));
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

  // ---------- report di gara ----------
  // Il collegamento al report si ricava dall'id della gara con una firma segreta: non serve salvarlo e resta
  // sempre lo stesso. Chi lo ha può leggere il report finché l'archivio lo conserva.
  const reportSecret = env.REPORT_SECRET || '';   // dedicato: senza, i report restano disattivati
  const reportSig = (id, salt) => hmac(reportSecret, `report:${id}${salt ? `:${salt}` : ''}`).slice(0, 32);   // il sale per gara rende il link revocabile
  const reportToken = (id, salt) => `${id}.${reportSig(id, salt)}`;
  const reportPath = (m) => (reportSecret && m.status === 'ended' && m.archive?.state === 'done' ? `/report#${reportToken(m.id, m.reportSalt)}` : null);

  const pubParticipant = (p) => ({ id: p.id, name: p.name, color: p.color, consent: !!p.consentAt });
  const pubMeta = (m) => ({ id: m.id, name: m.name, status: m.status, createdAt: m.createdAt, startedAt: m.startedAt,
    endedAt: m.endedAt, archive: m.archive?.state ?? null, reportPath: reportPath(m), hasLink: !!m.viewHash, participants: m.participants.map(pubParticipant),
    checkpoints: m.checkpoints.map(({ id, name, km, auto }) => ({ id, name, km, auto })) });


  return { repo, loadRace, lifeTtl, saveRace, loadCourse, expireRace, admin, authorize, bearer, viewer, num, text, parseCoursePoints,
    participantStatus, ipId, reportSecret, reportSig, reportToken, reportPath, pubParticipant, pubMeta };
}
