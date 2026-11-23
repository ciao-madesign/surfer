// Gara dimostrativa: tre corridori simulati sul percorso di esempio. Nessun dato salvato né credenziali:
// tutto è una funzione dell'ora. Una gara di 6 ore simulate dura 8 minuti reali (45×) e poi ricomincia.
import { buildCourse, runnerStats } from './geo.js';
import { DEMO_ROUTE } from './demo-data.js';

const CYCLE_MS = 8 * 60000;           // durata reale di un giro
const SIM_MS = 6 * 3600000;           // durata simulata
const WARMUP_MS = 4 * 60000;          // i primi minuti simulati: tutti alla partenza
const course = buildCourse(DEMO_ROUTE);
const NAME = 'Valtellina Wine Trail 42k · gara di esempio';
const CP_KM = [9.5, 19, 28.5, 35];  // ristori di esempio
const checkpoints = CP_KM.map((km, i) => {
  const [lat, lon] = at(km);
  return { id: `c${i + 1}`, name: `Ristoro ${i + 1}`, lat, lon, km, auto: true };
});
const RUNNERS = [
  { id: 'a', name: 'Giulia', color: '#e91e63', total: 4 * 3600 + 25 * 60 },
  { id: 'b', name: 'Marco', color: '#2bb7da', total: 4 * 3600 + 58 * 60 },
  { id: 'c', name: 'Luca', color: '#f4c20d', total: 5 * 3600 + 42 * 60 },
];

// punto sul percorso alla progressiva km
function at(km) {
  const c = course.cum, n = c.length;
  if (km <= 0) return course.points[0];
  if (km >= c[n - 1]) return course.points[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= km) lo = m; else hi = m; }
  const t = (km - c[lo]) / (c[hi] - c[lo] || 1), a = course.points[lo], b = course.points[hi];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// tempo cumulato (in frazione 0..1 del totale) a ogni punto del percorso: più lento in salita, più veloce in discesa
const cumT = (() => {
  const out = [0];
  for (let i = 1; i < course.points.length; i++) {
    const d = (course.cum[i] - course.cum[i - 1]) * 1000;
    const g = d > 0 ? ((course.points[i][2] - course.points[i - 1][2]) / d) * 100 : 0;
    out.push(out[i - 1] + (d / 1000) * (1 + 0.06 * Math.max(-8, Math.min(20, g))));
  }
  const tot = out[out.length - 1];
  return out.map((v) => v / tot);
})();

// progressiva (km) raggiunta dal corridore dopo `sec` secondi dalla partenza
function kmAt(r, sec) {
  const f = Math.max(0, Math.min(1, sec / r.total));
  let lo = 0, hi = cumT.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cumT[m] <= f) lo = m; else hi = m; }
  const t = (f - cumT[lo]) / (cumT[hi] - cumT[lo] || 1);
  return course.cum[lo] + (course.cum[hi] - course.cum[lo]) * t;
}
// istante (s dalla partenza) del passaggio a una progressiva
function secAt(r, km) {
  let lo = 0, hi = course.cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (course.cum[m] <= km) lo = m; else hi = m; }
  const t = (km - course.cum[lo]) / (course.cum[hi] - course.cum[lo] || 1);
  return (cumT[lo] + (cumT[hi] - cumT[lo]) * t) * r.total;
}

function clock(now) {
  const phase = (now % CYCLE_MS) / CYCLE_MS;
  const elapsedMs = WARMUP_MS + phase * (SIM_MS - WARMUP_MS);
  const day = new Date(now); day.setUTCHours(7, 0, 0, 0);        // partenza simulata: 07:00 UTC (circa le 8)
  const startedAt = day.getTime();
  return { startedAt, elapsedSec: elapsedMs / 1000, simNow: startedAt + elapsedMs };
}

function state(r, c) {
  const km = kmAt(r, c.elapsedSec);
  const done = c.elapsedSec >= r.total;
  return { km, done, pos: at(km) };
}

export function demoCourse() {
  return { name: NAME, course, checkpoints };
}

export function demoLive(now) {
  const c = clock(now);
  return {
    race: { name: NAME, status: 'live', startedAt: c.startedAt, endedAt: null, totalKm: course.totalKm, reportPath: null, demo: true },
    participants: RUNNERS.map((r) => {
      const s = state(r, c);
      const status = c.elapsedSec < 5 * 60 ? 'waiting' : s.done ? 'finished' : 'tracking';
      return { id: r.id, name: r.name, color: r.color, status,
        statusLabel: { waiting: 'In attesa', tracking: 'Segnale attivo', finished: 'Gara conclusa' }[status],
        last: { t: c.simNow - 15000, lat: s.pos[0], lon: s.pos[1], ele: Math.round(s.pos[2]), ageSec: 15 },
        offCourseM: 0, distKm: Math.round(s.km * 100) / 100, remainingKm: Math.round(Math.max(0, course.totalKm - s.km) * 100) / 100 };
    }),
    serverTime: c.simNow,
  };
}

export function demoStats(now) {
  const c = clock(now);
  return {
    participants: RUNNERS.map((r) => {
      const upTo = Math.min(c.elapsedSec, r.total);
      const rows = [];
      for (let t = 0; t <= upTo; t += 60) { const km = kmAt(r, t); const p = at(km); rows.push({ t: c.startedAt + t * 1000, lat: p[0], lon: p[1], ele: p[2], acc: 8, km }); }
      const stats = rows.length > 1 ? runnerStats(course, rows, c.startedAt, c.simNow) : { insufficient: true };
      let prev = 0;
      const passages = checkpoints.filter((cp) => secAt(r, cp.km) <= c.elapsedSec).map((cp) => {
        const s = secAt(r, cp.km);
        const out = { checkpointId: cp.id, name: cp.name, km: cp.km, t: c.startedAt + s * 1000, elapsedSec: Math.round(s), sinceLastSec: Math.round(s - prev) };
        prev = s; return out;
      });
      return { id: r.id, name: r.name, color: r.color, stats, passages };
    }),
    note: 'Gara di esempio con dati simulati e accelerati.', serverTime: c.simNow,
  };
}
