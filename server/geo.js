// Geometria del percorso: distanze, dislivelli, proiezione sulla traccia, statistiche.
const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;

export function haversine(lat1, lon1, lat2, lon2) {
  const dφ = rad(lat2 - lat1), dλ = rad(lon2 - lon1);
  const a = Math.sin(dφ / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dλ / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Dislivello con soglia (isteresi): ignora le oscillazioni sotto `thr` metri.
export function gainLoss(eles, thr = 3) {
  let gain = 0, loss = 0, ref = eles[0] ?? 0;
  for (const e of eles) {
    if (e - ref >= thr) { gain += e - ref; ref = e; }
    else if (ref - e >= thr) { loss += ref - e; ref = e; }
  }
  return { gain: Math.round(gain), loss: Math.round(loss) };
}

// points: [[lat, lon, ele], ...]  ->  percorso con progressive in km
export function buildCourse(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + haversine(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]) / 1000);
  }
  const { gain, loss } = gainLoss(points.map((p) => p[2] ?? 0));
  const eles = points.map((p) => p[2] ?? 0);
  return {
    points: points.map((p) => [round(p[0], 6), round(p[1], 6), Math.round(p[2] ?? 0)]),
    cum: cum.map((c) => round(c, 4)),
    totalKm: round(cum[cum.length - 1], 3),
    gain, loss, minEle: Math.round(Math.min(...eles)), maxEle: Math.round(Math.max(...eles)),
  };
}
const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

// Proiezione di un punto sulla traccia. `hintKm` limita la ricerca vicino all'ultima progressiva
// (evita salti su percorsi che si incrociano); se troppo lontano, cerca su tutta la traccia.
export function project(course, lat, lon, hintKm = null) {
  const best = (from, to) => {
    let res = null;
    const k = Math.cos(rad(lat));
    for (let i = from; i < Math.min(to, course.points.length - 1); i++) {
      const [aLat, aLon] = course.points[i], [bLat, bLon] = course.points[i + 1];
      const ax = (aLon - lon) * k, ay = aLat - lat, bx = (bLon - lon) * k, by = bLat - lat;
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      const pLat = aLat + (bLat - aLat) * t, pLon = aLon + (bLon - aLon) * t;
      const off = haversine(lat, lon, pLat, pLon);
      if (!res || off < res.offM) {
        res = { offM: off, km: course.cum[i] + (course.cum[i + 1] - course.cum[i]) * t, seg: i, t };
      }
    }
    return res;
  };
  const n = course.points.length;
  if (hintKm != null) {
    const lo = course.cum.findIndex((c) => c >= hintKm - 0.3);
    const hi = course.cum.findIndex((c) => c >= hintKm + 3);
    const r = best(Math.max(0, lo - 1), hi < 0 ? n : hi + 1);
    if (r && r.offM < 150) return r;
  }
  return best(0, n);
}

export function eleAt(course, km) {
  const c = course.cum, n = c.length;
  if (km <= 0) return course.points[0][2];
  if (km >= c[n - 1]) return course.points[n - 1][2];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= km) lo = m; else hi = m; }
  const t = (km - c[lo]) / (c[hi] - c[lo] || 1);
  return course.points[lo][2] + (course.points[hi][2] - course.points[lo][2]) * t;
}

export function gradeAtKm(course, km, windowKm = 0.2) {
  const a = Math.max(0, km - windowKm / 2), b = Math.min(course.totalKm, km + windowKm / 2);
  if (b - a < 0.02) return 0;
  return ((eleAt(course, b) - eleAt(course, a)) / ((b - a) * 1000)) * 100;
}

// Riga storica: "t,lat,lon,ele,acc,km"
export const encodePoint = (p, km) =>
  [p.t, p.lat.toFixed(6), p.lon.toFixed(6), p.ele ?? '', p.acc ?? '', km.toFixed(3)].join(',');
export function decodePoint(s) {
  const [t, lat, lon, ele, acc, km] = s.split(',');
  return { t: Number(t), lat: Number(lat), lon: Number(lon), ele: ele === '' ? null : Number(ele),
           acc: acc === '' ? null : Number(acc), km: Number(km) };
}

const fmtPace = (secPerKm) => (isFinite(secPerKm) && secPerKm > 0 ? Math.round(secPerKm) : null);

// Statistiche di un corridore. Usa la quota del percorso alla progressiva (più stabile del GPS),
// intervalli lunghi e scarta anomalie: precisione > 50 m o velocità impossibili.
export function runnerStats(course, rows, startT, nowMs) {
  const pts = rows.filter((p) => p.acc == null || p.acc <= 50);
  if (!pts.length) return { insufficient: true };
  const last = pts[pts.length - 1];
  const t0 = startT ?? pts[0].t;
  const elapsedS = Math.max(0, (last.t - t0) / 1000);
  const distKm = last.km;
  const eles = [];
  for (const p of pts) eles.push(eleAt(course, p.km));
  const { gain, loss } = gainLoss(eles, 3);

  // Passo medio su finestre di almeno 150 m e 60 s; classi di pendenza dalla traccia
  const classes = { salita: { km: 0, s: 0 }, piano: { km: 0, s: 0 }, discesa: { km: 0, s: 0 } };
  let anchor = pts[0];
  for (const p of pts) {
    const dKm = p.km - anchor.km, dS = (p.t - anchor.t) / 1000;
    if (dKm >= 0.15 && dS >= 60) {
      if (dKm / dS * 1000 < 8) { // < 8 m/s: ignora salti GPS
        const g = gradeAtKm(course, (p.km + anchor.km) / 2);
        const c = g > 3 ? 'salita' : g < -3 ? 'discesa' : 'piano';
        classes[c].km += dKm; classes[c].s += dS;
      }
      anchor = p;
    }
  }
  const paceBy = Object.fromEntries(Object.entries(classes).map(([k, v]) => [k, v.km >= 0.3 ? fmtPace(v.s / v.km) : null]));

  // Passo recente (ultimi 10 minuti) e medio complessivo
  const recent = pts.filter((p) => p.t >= last.t - 600000);
  const rKm = recent[recent.length - 1].km - recent[0].km, rS = (recent[recent.length - 1].t - recent[0].t) / 1000;
  const recentPace = rKm >= 0.2 && rS >= 120 ? fmtPace(rS / rKm) : null;
  const avgPace = distKm >= 0.3 && elapsedS > 0 ? fmtPace(elapsedS / distKm) : null;

  const remainingKm = Math.max(0, course.totalKm - distKm);
  const basis = recentPace && avgPace ? 0.5 * recentPace + 0.5 * avgPace : avgPace;
  const etaSec = basis && remainingKm > 0 ? Math.round(remainingKm * basis) : remainingKm === 0 ? 0 : null;

  return {
    distKm: round(distKm, 2), remainingKm: round(remainingKm, 2),
    ele: Math.round(eleAt(course, distKm)), gain, loss,
    elapsedSec: Math.round(elapsedS),
    avgSpeedKmh: elapsedS > 0 ? round(distKm / (elapsedS / 3600), 1) : null,
    avgPaceSecKm: avgPace, recentPaceSecKm: recentPace, paceByGrade: paceBy,
    etaSec, etaAt: etaSec != null ? last.t + etaSec * 1000 : null,
    samples: pts.length, reliability: pts.length >= 10 && distKm >= 1 ? 'Supported' : 'Estimated',
  };
}
