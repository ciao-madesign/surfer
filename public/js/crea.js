import { parseGPXString } from './gpx-parser.js';

const $ = (id) => document.getElementById(id);
let course = null;
const err = (t) => { const m = $('msg'); m.className = t ? 'err' : ''; m.textContent = t || ''; };
const run = (fn) => async () => { err(''); try { await fn(); } catch (e) { err(e.message); } };

$('gpx').onchange = run(async () => {
  const f = $('gpx').files[0]; if (!f) return;
  const pts = await parseGPXString(await f.text());
  const step = Math.ceil(pts.length / 1500);
  const sel = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  course = { points: sel.map((p) => [p.lat, p.lon, Math.round(p.ele)]), dist: sel.map((p) => p.dist_from_start / 1000), name: f.name.replace(/\.gpx$/i, '') };
  if (!$('name').value) $('name').value = course.name;
  $('gpxinfo').textContent = `${course.dist.at(-1).toFixed(1)} km caricati ✓`;
});

function kmToCoord(km) {
  const d = course.dist; let i = d.findIndex((x) => x >= km);
  if (i <= 0) i = km <= 0 ? 1 : d.length - 1;
  const t = (km - d[i - 1]) / (d[i] - d[i - 1] || 1), a = course.points[i - 1], b = course.points[i];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

$('create').onclick = run(async () => {
  if (!course) throw new Error('Carica prima il file GPX del percorso');
  const total = course.dist.at(-1), cps = [];
  const every = Number($('every').value) || 0;
  if (every > 0) for (let km = every; km < total - 1 && cps.length < 25; km += every) {
    const [lat, lon] = kmToCoord(km); cps.push({ name: `km ${km}`, lat, lon, auto: true });
  }
  for (const l of $('cps').value.split('\n').map((x) => x.trim()).filter(Boolean)) {
    const m = l.match(/^(.+?)\s*@\s*([\d.,]+)$/); if (!m) throw new Error(`Riga non valida: «${l}»`);
    const [lat, lon] = kmToCoord(parseFloat(m[2].replace(',', '.'))); cps.push({ name: m[1], lat, lon, auto: true });
  }
  const r = await fetch('/api/races', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: $('name').value, course: { name: course.name, points: course.points }, checkpoints: cps }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Errore nella creazione');
  location.href = j.organizerPath;   // pagina di gestione: il link nell'indirizzo è la chiave della gara
});
