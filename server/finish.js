// Chiusura della gara, archiviazione su Neon, scadenze, attività giornaliera e report pubblico.
import { HttpError, bad, token, shortId, sha256, safeEqual, hmac } from './util.js';
import { buildCourse, project, haversine, encodePoint, decodePoint, runnerStats } from './geo.js';
import { DAY, KEEP_AFTER_END, SAFETY_TTL, DRAFT_TTL, LIVE_TTL, MAX_PARTICIPANTS, CONSENT_VERSION, MAX_HISTORY, STALE_MS, MAX_BATCH, RATE_PER_MIN, IP_PER_MIN, ANON_REPORT_DAYS, AUTO_END_HOURS, MAX_ACC, MAX_SPEED, MAX_ANOM, OFF_COURSE_M, MAX_PROG_ANOM, COLORS, STATUS_LABEL } from './config.js';

export function createFinish({ common, archive, env, now }) {
  const { repo, loadRace, lifeTtl, saveRace, loadCourse, expireRace, admin, authorize, bearer, viewer, num, text, parseCoursePoints,
    participantStatus, ipId, reportSecret, reportSig, reportToken, reportPath, pubParticipant, pubMeta } = common;

  // ---------- chiusura e archiviazione ----------
  // Riepilogo da portare su Neon: nessuna coordinata GPS, solo tempi e statistiche finali.
  async function buildSummary(m) {
    const course = await loadCourse(m.id);
    const data = await repo.readRace(m.id, m.participants.map((p) => p.id));
    const pass = data.pass;
    const cps = m.checkpoints;           // già ordinati per km
    return {
      id: m.id, name: m.name, accountId: m.accountId ?? null, startedAt: m.startedAt, endedAt: m.endedAt,
      totalKm: course?.totalKm ?? null, reportSalt: m.reportSalt ?? null,
      meta: course ? { gain: course.gain, loss: course.loss } : null,
      course: m.accountId && course ? { name: course.name, points: course.points, totalKm: course.totalKm, gain: course.gain, loss: course.loss } : null,
      expiresAt: m.accountId ? null : m.endedAt + ANON_REPORT_DAYS * DAY * 1000,
      checkpoints: cps.map((c, i) => ({ idx: i, name: c.name, km: c.km, radius: c.radius })),
      participants: m.participants.map((p, i) => {
        const rows = data.rows[i].map(decodePoint);
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
    if (m.viewHash) await repo.expireView(m.viewHash, Math.max(60, left));   // il link di chi segue cade 24 ore dopo la fine, anche se il report è in attesa
    await repo.queueArchive(m.id, m.archive?.state === 'pending');
  }

  async function endRace(m) {
    m.status = 'ended'; m.endedAt = now(); m.reportSalt = token(12);
    await tryArchive(m);
    await applyRetention(m);
    await repo.dropActive(m.id);
  }
  async function retryArchive(m) { await tryArchive(m); await applyRetention(m); }

  // Attività periodica (Vercel Cron, una volta al giorno): chiude le gare dimenticate, riprova le archiviazioni
  // in sospeso e cancella dall'archivio i report scaduti.
  async function cron(headers) {
    if (!env.CRON_SECRET) throw new HttpError(503, 'Cron non configurato (CRON_SECRET)');
    if (!safeEqual(bearer(headers), env.CRON_SECRET)) throw new HttpError(401, 'Non autorizzato');
    const out = { autoEnded: 0, archived: 0, stillPending: 0, purged: 0 };
    for (const id of await repo.activeRaceIds()) {
      const m = await repo.getRace(id);
      if (!m) { await repo.dropActive(id); continue; }
      if (m.status === 'live' && m.startedAt && now() - m.startedAt > AUTO_END_HOURS * 3600000) { await endRace(m); out.autoEnded++; }
    }
    for (const id of await repo.archiveQueue()) {
      const m = await repo.getRace(id);
      if (!m || m.archive?.state !== 'pending') { await repo.queueArchive(id, false); continue; }
      await retryArchive(m);
      if (m.archive.state === 'done') out.archived++; else out.stillPending++;
    }
    if (archive.enabled) out.purged = await archive.purgeExpired(now());
    return out;
  }

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


  return { endRace, retryArchive, applyRetention, cron, report };
}
