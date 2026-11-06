import { BASEMAPS, DEM, POLL_MS, STATS_MS, TZ } from './config.js';

const $ = (id) => document.getElementById(id);
const token = location.hash.slice(1);
const q = `t=${encodeURIComponent(token)}`;
const state = { course: null, live: null, stats: null, map: null, markers: {}, base: 'sat', is3d: false, ready: false };

// ---------- utilità (testo sempre via textContent: nessun HTML dai dati) ----------
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v; else if (k === 'style') e.style.cssText = v; else e[k] = v;
  }
  for (const c of kids.flat()) e.append(c instanceof Node ? c : document.createTextNode(c ?? ''));
  return e;
}
const fmtTime = (ms) => new Date(ms).toLocaleTimeString('it-IT', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const fmtDur = (s) => { if (s == null) return '–'; const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`; };
const fmtPace = (s) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} /km` : '–');
const fmtAge = (s) => (s < 90 ? `${s} s fa` : s < 5400 ? `${Math.round(s / 60)} min fa` : `${Math.round(s / 3600)} h fa`);
async function api(path) {
  const r = await fetch(`/api/${path}${path.includes('?') ? '&' : '?'}${q}`);
  if (!r.ok) { const e = new Error((await r.json().catch(() => ({}))).error || r.statusText); e.status = r.status; throw e; }
  return r.json();
}
function fatal(title, msg) {
  $('fatal').style.display = 'block'; $('fatal-t').textContent = title; $('fatal-m').textContent = msg;
  for (const id of ['map', 'panel', 'ctl']) { const n = $(id); if (n) n.style.display = 'none'; }
}
function banner(msg) { const b = $('banner'); b.style.display = msg ? 'block' : 'none'; b.textContent = msg || ''; }

// ---------- mappa ----------
function style(baseKey) {
  const b = BASEMAPS[baseKey];
  return { version: 8,
    sources: {
      base: { type: 'raster', tiles: b.tiles, tileSize: b.tileSize, maxzoom: b.maxzoom, attribution: b.attribution },
      dem: { type: 'raster-dem', tiles: DEM.tiles, encoding: DEM.encoding, tileSize: DEM.tileSize, maxzoom: DEM.maxzoom, attribution: DEM.attribution },
    },
    layers: [{ id: 'base', type: 'raster', source: 'base' }] };
}
function addCourse() {
  const m = state.map, c = state.course.course;
  if (!c) return;
  const coords = c.points.map((p) => [p[1], p[0]]);
  if (!m.getSource('route')) m.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } } });
  if (!m.getLayer('route-glow')) {
    m.addLayer({ id: 'route-glow', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#4fd1c5', 'line-width': 10, 'line-opacity': .25 } });
    m.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#4fd1c5', 'line-width': 4 } });
  }
}
function initMap() {
  const c = state.course.course;
  const first = c ? c.points[0] : [45.5, 9];
  state.map = new maplibregl.Map({ container: 'map', style: style(state.base), center: [first[1], first[0]], zoom: 12, pitch: 0, maxPitch: 80, attributionControl: { compact: true } });
  state.map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
  state.map.on('load', () => {
    addCourse(); fit(); state.ready = true;
    for (const cp of state.course.checkpoints) {
      new maplibregl.Marker({ element: el('div', { class: 'cp', title: `${cp.name} · km ${cp.km}` }) }).setLngLat([cp.lon, cp.lat]).addTo(state.map);
    }
    renderLive();
  });
}
function fit() {
  const c = state.course.course; if (!c) return;
  const b = new maplibregl.LngLatBounds();
  c.points.forEach((p) => b.extend([p[1], p[0]]));
  state.map.fitBounds(b, { padding: 40, duration: 600, pitch: state.is3d ? 60 : 0 });
}
function set3d(on) {
  state.is3d = on; $('b3d').textContent = on ? '2D' : '3D';
  const m = state.map;
  if (on) { m.setTerrain({ source: 'dem', exaggeration: 1.3 }); m.easeTo({ pitch: 65, duration: 600 }); }
  else { m.setTerrain(null); m.easeTo({ pitch: 0, bearing: 0, duration: 600 }); }
}
$('b3d').onclick = () => state.ready && set3d(!state.is3d);
$('bfit').onclick = () => state.ready && fit();
$('brun').onclick = () => {      // inquadra tutti i corridori (anche se lontani dal percorso)
  const pts = (state.live?.participants ?? []).filter((p) => p.last);
  if (!state.ready || !pts.length) return;
  const b = new maplibregl.LngLatBounds();
  pts.forEach((p) => b.extend([p.last.lon, p.last.lat]));
  state.map.fitBounds(b, { padding: 60, maxZoom: 15, duration: 600 });
};
$('bbase').onclick = () => {
  if (!state.ready) return;
  state.base = state.base === 'sat' ? 'topo' : 'sat';
  $('bbase').textContent = state.base === 'sat' ? 'Topografica' : 'Satellite';
  state.map.setStyle(style(state.base));
  state.map.once('styledata', () => { addCourse(); if (state.is3d) state.map.setTerrain({ source: 'dem', exaggeration: 1.3 }); });
};

// ---------- profilo altimetrico ----------
function drawProfile() {
  const svg = $('profile'), c = state.course?.course;
  if (!c) { svg.style.display = 'none'; return; }
  const W = 600, H = 110, pad = 4, span = Math.max(1, c.maxEle - c.minEle);
  const x = (km) => pad + (km / c.totalKm) * (W - 2 * pad), y = (e) => H - pad - ((e - c.minEle) / span) * (H - 2 * pad - 8);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('preserveAspectRatio', 'none');
  const step = Math.max(1, Math.floor(c.points.length / 300));
  const idx = c.points.map((_, i) => i).filter((i) => i % step === 0 || i === c.points.length - 1);
  const pts = idx.map((i) => [x(c.cum[i]), y(c.points[i][2])]);
  const NS = 'http://www.w3.org/2000/svg', mk = (t, a) => { const n = document.createElementNS(NS, t); for (const k in a) n.setAttribute(k, a[k]); return n; };
  svg.replaceChildren(
    mk('path', { d: `M${pad},${H} L${pts.map((p) => p.join(',')).join(' L')} L${W - pad},${H}Z`, fill: 'rgba(79,209,197,.25)', stroke: '#4fd1c5', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' }),
    ...state.course.checkpoints.map((cp) => mk('line', { x1: x(cp.km), x2: x(cp.km), y1: 0, y2: H, stroke: '#a8b3c2', 'stroke-dasharray': '3 3', 'vector-effect': 'non-scaling-stroke' })),
    ...(state.live?.participants ?? []).filter((p) => p.distKm != null).map((p) =>
      mk('line', { x1: x(p.distKm), x2: x(p.distKm), y1: 0, y2: H, stroke: p.color, 'stroke-width': 3, 'vector-effect': 'non-scaling-stroke' })));
  $('profile-info').textContent = `${c.totalKm.toFixed(1)} km · D+ ${c.gain} m · D− ${c.loss} m · quota ${c.minEle}–${c.maxEle} m`;
}

// ---------- corridori ----------
function renderLive() {
  const d = state.live; if (!d) return;
  $('title').textContent = d.race.name;
  $('updated').textContent = `agg. ${fmtTime(d.serverTime)}`;
  if (state.ready) for (const p of d.participants) {
    if (!p.last) continue;
    let mk = state.markers[p.id];
    const old = p.last.ageSec > 120;
    if (!mk) {
      const e = el('div', { class: 'pin', style: `background:${p.color}` }, p.name.slice(0, 1).toUpperCase());
      mk = state.markers[p.id] = { el: e, m: new maplibregl.Marker({ element: e }).setLngLat([p.last.lon, p.last.lat]).addTo(state.map) };
    }
    mk.m.setLngLat([p.last.lon, p.last.lat]);   // ultima posizione nota: nessuna animazione simulata
    mk.el.classList.toggle('old', old);
    mk.el.title = `${p.name} · ${fmtAge(p.last.ageSec)}`;
  }
  const byId = Object.fromEntries((state.stats?.participants ?? []).map((s) => [s.id, s]));
  $('runners').replaceChildren(...d.participants.map((p) => runnerCard(p, byId[p.id])));
  drawProfile();
}
function runnerCard(p, extra) {
  const s = extra?.stats, st = s && !s.insufficient ? s : null;
  const kpi = (label, value) => el('div', {}, label, el('b', {}, value));
  const card = el('div', { class: 'card runner' },
    el('div', {}, el('span', { class: 'dot', style: `background:${p.color}` }), el('span', { class: 'name' }, p.name),
      ' ', el('span', { class: `small st-${p.status}` }, p.statusLabel)),
    el('div', { class: 'small muted', style: 'text-align:right' }, p.last ? `${fmtAge(p.last.ageSec)} · ${fmtTime(p.last.t)}` : 'nessun dato'),
    p.offCourseM != null && p.offCourseM > 1000
      ? el('div', { class: 'small bad', style: 'grid-column:1/3' }, `Lontano dal percorso: ${(p.offCourseM / 1000).toFixed(p.offCourseM > 10000 ? 0 : 1)} km`)
      : p.distKm != null ? el('div', { class: 'small muted', style: 'grid-column:1/3' }, `${p.distKm.toFixed(1)} km percorsi · ${p.remainingKm.toFixed(1)} km all'arrivo`) : '');
  if (st) {
    card.append(el('div', { class: 'stats', style: 'grid-column:1/3' },
      kpi('Quota', `${st.ele} m`), kpi('D+ / D−', `${st.gain} / ${st.loss} m`),
      kpi('Tempo', fmtDur(st.elapsedSec)), kpi('Velocità media', st.avgSpeedKmh != null ? `${st.avgSpeedKmh} km/h` : '–'),
      kpi('Passo medio', fmtPace(st.avgPaceSecKm)), kpi('Ultimi 10 min', fmtPace(st.recentPaceSecKm)),
      kpi('Salita', fmtPace(st.paceByGrade.salita)), kpi('Piano', fmtPace(st.paceByGrade.piano)), kpi('Discesa', fmtPace(st.paceByGrade.discesa)),
      kpi('Arrivo stimato', st.etaAt ? `${fmtTime(st.etaAt)} (${st.reliability === 'Supported' ? 'indicativo' : 'dati scarsi'})` : '–')));
  }
  if (extra?.passages?.length) {
    const t = el('table', { style: 'grid-column:1/3;margin-top:6px' }, el('tr', {}, ...['Checkpoint', 'Ora', 'Dalla partenza', 'Dall\'ultimo'].map((h) => el('th', {}, h))));
    for (const x of extra.passages) t.append(el('tr', {}, el('td', {}, x.name), el('td', {}, fmtTime(x.t)), el('td', {}, fmtDur(x.elapsedSec)), el('td', {}, fmtDur(x.sinceLastSec))));
    card.append(t);
  }
  return card;
}

// ---------- meteo (Open-Meteo, dal browser) ----------
const WX = { 0: 'sereno', 1: 'quasi sereno', 2: 'parz. nuvoloso', 3: 'coperto', 45: 'nebbia', 48: 'nebbia', 51: 'pioviggine', 53: 'pioviggine', 55: 'pioviggine',
  61: 'pioggia debole', 63: 'pioggia', 65: 'pioggia forte', 71: 'neve debole', 73: 'neve', 75: 'neve forte', 80: 'rovesci', 81: 'rovesci', 82: 'rovesci forti', 95: 'temporale', 96: 'temporale con grandine', 99: 'temporale con grandine' };
async function weather() {
  const c = state.course?.course; if (!c) return;
  const spots = [['Partenza', c.points[0]], ['Arrivo', c.points[c.points.length - 1]]];
  const nodes = await Promise.all(spots.map(async ([label, p]) => {
    try {
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${p[0]}&longitude=${p[1]}&current=temperature_2m,precipitation,wind_speed_10m,weather_code&timezone=Europe%2FRome`);
      const j = (await r.json()).current;
      return el('div', { class: 'wx' }, el('b', {}, label), el('div', {}, `${Math.round(j.temperature_2m)} °C · ${WX[j.weather_code] ?? 'n.d.'}`),
        el('div', { class: 'small muted' }, `vento ${Math.round(j.wind_speed_10m)} km/h · prec. ${j.precipitation} mm · ore ${fmtTime(Date.parse(j.time + ':00'))}`));
    } catch { return el('div', { class: 'wx small muted' }, `${label}: meteo non disponibile`); }
  }));
  $('weather').replaceChildren(...nodes);
}

// ---------- aggiornamento periodico ----------
let lastOk = 0;
async function pollLive() {
  try {
    state.live = await api('live'); lastOk = Date.now(); banner('');
    if (state.live.race.status === 'ended') banner('Gara conclusa. I dati restano disponibili per 24 ore.');
    renderLive();
  } catch (e) {
    if (e.status === 401 || e.status === 410) return fatal(e.status === 410 ? 'Dati scaduti' : 'Link non valido', e.status === 410 ? 'Questa gara è conclusa e i dati sono stati cancellati.' : 'Il link è errato, revocato o scaduto. Chiedi un nuovo link all\'organizzatore.');
    banner(`Connessione assente. Ultimo aggiornamento alle ${lastOk ? fmtTime(lastOk) : '–'}.`);
  }
}
async function pollStats() { try { state.stats = await api('stats'); renderLive(); } catch { /* resta l'ultimo valore */ } }
function every(fn, ms) { setInterval(() => { if (!document.hidden) fn(); }, ms); }

(async function start() {
  if (token.length < 20) return fatal('Link non valido', 'Apri il link completo che ti ha inviato l\'organizzatore.');
  try { state.course = await api('course'); } catch (e) {
    return fatal(e.status === 410 ? 'Dati scaduti' : 'Link non valido', e.status === 410 ? 'Questa gara è conclusa e i dati sono stati cancellati.' : 'Il link è errato, revocato o scaduto.');
  }
  document.title = `${state.course.name} · Trail Live`;
  initMap(); drawProfile(); weather();
  await pollLive(); pollStats();
  every(pollLive, POLL_MS); every(pollStats, STATS_MS); setInterval(weather, 15 * 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { pollLive(); pollStats(); } });
})();
