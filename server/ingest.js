// Ricezione delle posizioni dei corridori (browser/app) e adattatore per l'app Overland.
import { HttpError, bad, token, shortId, sha256, safeEqual, hmac } from './util.js';
import { buildCourse, project, haversine, encodePoint, decodePoint, runnerStats } from './geo.js';
import { DAY, KEEP_AFTER_END, SAFETY_TTL, DRAFT_TTL, LIVE_TTL, MAX_PARTICIPANTS, CONSENT_VERSION, MAX_HISTORY, STALE_MS, MAX_BATCH, RATE_PER_MIN, IP_PER_MIN, ANON_REPORT_DAYS, AUTO_END_HOURS, MAX_ACC, MAX_SPEED, MAX_ANOM, OFF_COURSE_M, MAX_PROG_ANOM, COLORS, STATUS_LABEL } from './config.js';

export function createIngest({ common, env, now }) {
  const { repo, loadRace, lifeTtl, saveRace, loadCourse, expireRace, admin, authorize, bearer, viewer, num, text, parseCoursePoints,
    participantStatus, ipId, reportSecret, reportSig, reportToken, reportPath, pubParticipant, pubMeta } = common;

  // ---------- ricezione posizioni (app iOS) ----------
  async function ingest(headers, body) {
    const dev = bearer(headers);
    if (!dev) { console.log(JSON.stringify({ ev: 'ingest-denied', why: 'no-token' })); throw new HttpError(401, 'Credenziale dispositivo mancante'); }
    const ref = await repo.deviceRef(sha256(dev));
    if (!ref) { console.log(JSON.stringify({ ev: 'ingest-denied', why: 'unknown-token' })); throw new HttpError(401, 'Dispositivo non autorizzato'); }
    const minute = Math.floor(now() / 60000);
    const rlKey = `rl:${ref.raceId}:${ref.pid}:${minute}`;   // per gara e corridore
    const count = await repo.count(rlKey, 90);
    if (count > RATE_PER_MIN) throw new HttpError(429, 'Troppe richieste');

    const m = await loadRace(ref.raceId);
    if (m.status === 'ended') throw new HttpError(410, 'Gara conclusa');
    const me = m.participants.find((x) => x.id === ref.pid);
    if (!me) throw new HttpError(401, 'Dispositivo non autorizzato');
    if (!me.consentAt) throw new HttpError(403, 'Il corridore non ha ancora dato il consenso');
    // una sola richiesta alla volta per corridore: evita che due invii ravvicinati si sovrascrivano
    const lock = `lock:${m.id}:${ref.pid}`;
    if (!(await repo.tryLock(lock, 15))) throw new HttpError(429, 'Invio già in corso, riprova');
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

    const last = await repo.getLast(m.id, ref.pid);
    const fresh = pts.filter((p) => last?.t == null || p.t > last.t);   // idempotente: ignora i duplicati
    const course = await loadCourse(m.id);
    const cps = course ? m.checkpoints.filter((c) => c.auto) : [];
    let pass = {}, det = {};
    if (cps.length && fresh.length) {
      ({ pass, det } = await repo.getPassDet(m.id));
    }

    const rows = [], passSet = [], detSet = [], detDel = [];
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
            if (nn >= 2) { pass[key] = String(ft); passSet.push([key, String(ft)]); delete det[key]; detDel.push(key); }
            else { det[key] = `${nn}:${ft}`; detSet.push([key, det[key]]); }
          } else if (det[key]) { delete det[key]; detDel.push(key); }
        }
      }
    }
    const rec = { ...(lastPt || { t: null }), status, rcv: t, fin, off, anom, panom: progAnom, n: (last?.n ?? 0) + rows.length };
    await repo.commitIngest(m.id, ref.pid, { rec, rows, passSet, detSet, detDel });
    console.log(JSON.stringify({ ev: 'ingest', race: m.id, p: ref.pid, got: pts.length, new: rows.length, rej: rejected, st: status }));
    return { ok: true, accepted: rows.length, rejected, duplicates: pts.length - fresh.length, raceStatus: m.status, serverTime: t };
    } finally { await repo.unlock(lock); }
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


  return { ingest, overland };
}
