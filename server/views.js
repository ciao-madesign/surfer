// Rotte di chi segue la gara: posizioni, traccia e statistiche.
import { HttpError, bad, token, shortId, sha256, safeEqual, hmac } from './util.js';
import { buildCourse, project, haversine, encodePoint, decodePoint, runnerStats } from './geo.js';
import { DAY, KEEP_AFTER_END, SAFETY_TTL, DRAFT_TTL, LIVE_TTL, MAX_PARTICIPANTS, CONSENT_VERSION, MAX_HISTORY, STALE_MS, MAX_BATCH, RATE_PER_MIN, IP_PER_MIN, ANON_REPORT_DAYS, AUTO_END_HOURS, MAX_ACC, MAX_SPEED, MAX_ANOM, OFF_COURSE_M, MAX_PROG_ANOM, COLORS, STATUS_LABEL } from './config.js';

export function createViews({ common, env, now }) {
  const { repo, loadRace, lifeTtl, saveRace, loadCourse, expireRace, admin, authorize, bearer, viewer, num, text, parseCoursePoints,
    participantStatus, ipId, reportSecret, reportSig, reportToken, reportPath, pubParticipant, pubMeta } = common;

  // ---------- rotte osservatore ----------
  async function live(query, headers) {
    const m = await viewer(query, headers);
    const course = await loadCourse(m.id);
    const last = await repo.getAllLast(m.id);
    const t = now();
    return { race: { name: m.name, status: m.status, startedAt: m.startedAt, endedAt: m.endedAt, totalKm: course?.totalKm ?? null, reportPath: reportPath(m) },
      participants: m.participants.map((p) => {
        const l = last[p.id] || null;
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
    const data = await repo.readRace(m.id, m.participants.map((p) => p.id));
    const pass = data.pass, lastAll = data.last;
    const out = m.participants.map((p, i) => {
      const rows = data.rows[i].map(decodePoint);
      const s = rows.length ? runnerStats(course, rows, m.startedAt, now()) : { insufficient: true };
      // senza segnale recente la stima d'arrivo non è credibile: viene sospesa (e torna da sola)
      const l = lastAll[p.id] || null;
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


  return { live, courseRoute, stats };
}
