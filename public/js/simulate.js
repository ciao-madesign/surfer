const $ = (id) => document.getElementById(id);
const log = (m) => { $('log').textContent = m; };
let timer = null;

function parsePairing(s) {
  const t = s.trim().replace(/-/g, '+').replace(/_/g, '/');
  const j = JSON.parse(atob(t + '='.repeat((4 - (t.length % 4)) % 4)));
  if (!j.t || !j.u) throw new Error('Codice non valido');
  return j;
}
function at(course, km) {            // posizione sulla traccia alla progressiva km
  const c = course.cum, n = c.length;
  if (km >= c[n - 1]) return course.points[n - 1];
  let i = 1; while (c[i] < km) i++;
  const t = (km - c[i - 1]) / (c[i] - c[i - 1] || 1), a = course.points[i - 1], b = course.points[i];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

$('go').onclick = async () => {
  try {
    const p = parsePairing($('code').value);
    const viewer = $('link').value.split('#')[1]?.trim();
    if (!viewer) throw new Error('Link osservatori non valido (manca la parte dopo #)');
    const res = await fetch(`${location.origin}/api/course?t=${encodeURIComponent(viewer)}`);
    if (!res.ok) throw new Error('Link osservatori rifiutato (' + res.status + ')');
    const course = (await res.json()).course;
    if (!course) throw new Error('La gara non ha una traccia');
    const speed = Number($('kmh').value) / 3.6, accel = Number($('acc').value);   // m/s
    const t0 = Date.now();
    let sent = 0, buffer = [], lastSend = 0;
    $('go').disabled = true; $('stop').disabled = false;
    timer = setInterval(async () => {
      const el = (Date.now() - t0) / 1000, km = (speed * accel * el) / 1000;
      const [lat, lon, ele] = at(course, km);
      buffer.push({ t: Date.now(), lat, lon, ele, acc: 8 });
      const done = km >= course.totalKm;
      if (Date.now() - lastSend >= 10000 || done) {
        lastSend = Date.now();
        const points = buffer.splice(0);
        try {
          const r = await fetch(`${location.origin}/api/device/positions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${p.t}` }, body: JSON.stringify({ points, status: 'tracking' }) });
          sent += points.length;
          log(`${p.n}: km ${Math.min(km, course.totalKm).toFixed(2)} / ${course.totalKm} · inviati ${sent} punti · risposta ${r.status}${r.status === 410 ? ' (gara conclusa)' : ''}`);
          if (r.status >= 400 && r.status !== 429) stop();
        } catch { log('Rete assente: riprovo (i punti restano in coda)'); buffer.unshift(...points); }
      }
      if (done) { stop(); }
    }, 2000);   // un punto ogni 2 s simulati, invio a gruppi ogni 10 s
  } catch (e) { log('Errore: ' + e.message); $('go').disabled = false; }
};
function stop() { clearInterval(timer); timer = null; $('go').disabled = false; $('stop').disabled = true; }
$('stop').onclick = () => { stop(); log('Fermato.'); };
