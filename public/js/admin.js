import { parseGPXString } from './gpx-parser.js';

const $ = (id) => document.getElementById(id);
let key = sessionStorage.getItem('adminKey') || '';
let course = null;      // {points:[[lat,lon,ele]], dist:[km], name}
let current = null;

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e[k] = v; else e[k] = v; }
  for (const c of kids.flat()) e.append(c instanceof Node ? c : document.createTextNode(c ?? ''));
  return e;
}
function msg(text, kind = 'ok') { const m = $('msg'); m.className = text ? kind : ''; m.textContent = text || ''; if (text) setTimeout(() => (m.className = ''), 6000); }
async function api(method, path, body) {
  const r = await fetch(`/api/admin/${path}`, { method, headers: { 'content-type': 'application/json', 'x-admin-key': key }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
const run = (fn) => async () => { try { await fn(); } catch (e) { msg(e.message, 'err'); } };
const copy = async (t) => { try { await navigator.clipboard.writeText(t); msg('Copiato'); } catch { msg('Copia manuale: seleziona il testo', 'err'); } };

async function enter() {
  key = $('key').value || key;
  await api('GET', 'races');
  sessionStorage.setItem('adminKey', key);
  $('login').hidden = true; $('app').hidden = false;
  await loadRaces();
}
$('enter').onclick = run(enter);
if (key) enter().catch(() => { sessionStorage.removeItem('adminKey'); key = ''; });

// ---------- GPX ----------
$('gpx').onchange = run(async () => {
  const f = $('gpx').files[0]; if (!f) return;
  const pts = await parseGPXString(await f.text());
  const step = Math.ceil(pts.length / 1500);
  const sel = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  course = { points: sel.map((p) => [p.lat, p.lon, Math.round(p.ele)]), dist: sel.map((p) => p.dist_from_start / 1000), name: f.name.replace(/\.gpx$/i, '') };
  if (!$('name').value) $('name').value = course.name;
  $('gpxinfo').textContent = `${pts.length} punti, ${course.dist.at(-1).toFixed(1)} km (semplificata a ${sel.length} punti)`;
});
function kmToCoord(km) {
  const d = course.dist; let i = d.findIndex((x) => x >= km);
  if (i <= 0) i = km <= 0 ? 1 : d.length - 1;
  const t = (km - d[i - 1]) / (d[i] - d[i - 1] || 1), a = course.points[i - 1], b = course.points[i];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
$('create').onclick = run(async () => {
  if (!course) throw new Error('Carica prima la traccia GPX');
  const checkpoints = $('cps').value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^(.+?)\s*@\s*([\d.,]+)$/); if (!m) throw new Error(`Riga non valida: «${l}»`);
    const [lat, lon] = kmToCoord(parseFloat(m[2].replace(',', '.'))); return { name: m[1], lat, lon, auto: true };
  });
  const r = await api('POST', 'races', { name: $('name').value, course: { name: course.name, points: course.points }, checkpoints });
  msg(`Gara creata: ${r.course.totalKm} km, D+ ${r.course.gain} m`); await loadRaces(); await open(r.race.id);
});

// ---------- elenco e dettaglio ----------
async function loadRaces() {
  const { races } = await api('GET', 'races');
  $('races').replaceChildren(...(races.length ? races.map((r) => el('div', { class: 'row', style: 'margin:4px 0' },
    el('button', { onclick: run(() => open(r.id)) }, r.name), el('span', { class: 'tag' }, r.status))) : ['Nessuna gara attiva.']));
}
async function open(id) { current = (await api('GET', `races/${id}`)).race; render(); }

function render(extra = {}) {
  const r = current, d = $('detail');
  const act = (label, fn, cls = '') => el('button', { class: cls, onclick: run(async () => { await fn(); await open(r.id); await loadRaces(); }) }, label);
  const pairs = extra.pairing ? el('div', { class: 'card' }, el('b', {}, `Codice di collegamento di ${extra.pairing.name}`),
    el('div', { class: 'small muted' }, 'Mostrato una sola volta: incollalo nell\'app sul telefono del corridore.'),
    el('div', { class: 'secret' }, extra.pairing.code), el('button', { onclick: () => copy(extra.pairing.code) }, 'Copia'),
    el('div', { class: 'small muted', style: 'margin-top:8px' }, `Sul telefono apri ${location.origin}/track e incolla il codice.`),
    extra.pairing.overland ? el('details', { class: 'small', style: 'margin-top:6px' }, el('summary', {}, 'Alternativa: app Overland (tracking affidabile a schermo spento)'),
      el('div', { class: 'muted' }, 'In Overland imposta «Receiver Endpoint» con questo indirizzo (contiene la credenziale, non condividerlo):'),
      el('div', { class: 'secret' }, extra.pairing.overland), el('button', { onclick: () => copy(extra.pairing.overland) }, 'Copia indirizzo')) : '') : '';
  const link = extra.link ? el('div', { class: 'card' }, el('b', {}, 'Link privato per gli osservatori'),
    el('div', { class: 'small muted' }, 'Chiunque lo abbia può vedere la gara. Mostrato una sola volta.'),
    el('div', { class: 'secret' }, extra.link), el('button', { onclick: () => copy(extra.link) }, 'Copia')) : '';
  d.replaceChildren(el('div', { class: 'card' },
    el('h2', {}, r.name, ' ', el('span', { class: 'tag' }, r.status)),
    el('div', { class: 'small muted' }, `${r.checkpoints.length} checkpoint · ${r.participants.length}/5 partecipanti · link ${r.hasLink ? 'attivo' : 'non generato'}`),
    el('div', { class: 'row', style: 'margin-top:8px' },
      r.status === 'draft' ? act('Avvia gara', () => api('POST', `races/${r.id}/start`), 'primary') : '',
      r.status === 'live' ? act('Termina gara', () => { if (!confirm('Terminare la gara? I dati saranno cancellati dopo 24 ore.')) throw new Error('Annullato'); return api('POST', `races/${r.id}/end`); }, 'danger') : '',
      r.status !== 'ended' ? el('button', { onclick: run(async () => { const j = await api('POST', `races/${r.id}/link`, {}); await open(r.id); render({ link: `${location.origin}${j.path}` }); }) }, r.hasLink ? 'Nuovo link (revoca il vecchio)' : 'Genera link') : '',
      r.hasLink ? act('Revoca link', () => api('DELETE', `races/${r.id}/link`), 'danger') : '',
      act('Elimina gara', () => { if (!confirm('Eliminare la gara e tutti i dati?')) throw new Error('Annullato'); return api('DELETE', `races/${r.id}`).then(() => { $('detail').replaceChildren(); }); }, 'danger'))),
    link, pairs,
    el('div', { class: 'card' }, el('b', {}, 'Partecipanti'),
      ...r.participants.map((p) => el('div', { class: 'row', style: 'margin:6px 0' }, el('span', { class: 'dot', style: `background:${p.color}` }), p.name,
        el('button', { onclick: run(async () => {
          if (!confirm(`Generare un nuovo codice per ${p.name}? Il vecchio smette di funzionare.`)) return;
          const j = await api('POST', `races/${r.id}/participants/${p.id}/token`, {});
          render({ pairing: { name: p.name, code: j.pairing, overland: `${location.origin}/api/device/overland?token=${j.deviceToken}` } });
        }) }, 'Nuovo codice'),
        act('Rimuovi', () => api('DELETE', `races/${r.id}/participants/${p.id}`)))),
      r.participants.length < 5 && r.status !== 'ended' ? el('div', { class: 'row', style: 'margin-top:8px' },
        el('input', { id: 'pname', placeholder: 'Nome o pseudonimo', maxLength: 40, style: 'flex:1' }),
        el('input', { id: 'pcolor', type: 'color', value: ['#e91e63', '#2bb7da', '#f4c20d', '#34a853', '#8e24aa'][r.participants.length], style: 'width:56px;padding:2px' }),
        el('button', { class: 'primary', onclick: run(async () => {
          const name = $('pname').value; const j = await api('POST', `races/${r.id}/participants`, { name, color: $('pcolor').value });
          await open(r.id); render({ pairing: { name: j.participant.name, code: j.pairing, overland: `${location.origin}/api/device/overland?token=${j.deviceToken}` } });
        }) }, 'Aggiungi')) : ''));
}
