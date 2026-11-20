import { buildReport, fmtDur, fmtPace, fmtGap } from './report-calc.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) { if (k === 'class') e.className = v; else if (k === 'style') e.style.cssText = v; else e[k] = v; }
  for (const c of kids.flat()) if (c != null) e.append(c instanceof Node ? c : document.createTextNode(c));
  return e;
};
const TZ = 'Europe/Rome';
const fmtDate = (ms) => new Intl.DateTimeFormat('it-IT', { dateStyle: 'full', timeZone: TZ }).format(ms);
const fmtDay = (ms) => new Intl.DateTimeFormat('it-IT', { dateStyle: 'long', timeZone: TZ }).format(ms);
const km1 = (n) => (n == null ? '–' : `${n.toFixed(1).replace('.', ',')} km`);

$('pdf').onclick = () => window.print();
$('copy').onclick = async () => {
  try { await navigator.clipboard.writeText(location.href); $('copy').textContent = 'Copiato'; setTimeout(() => ($('copy').textContent = 'Copia link'), 2000); }
  catch { prompt('Copia il link:', location.href); }
};

function msg(title, text) {
  $('out').replaceChildren(el('div', { class: 'msg' }, el('h1', {}, title), el('p', { class: 'muted' }, text)));
}

function render(r) {
  document.title = `Report · ${r.name} · Surfer · Live`;
  const rep = buildReport(r);
  const out = [];
  out.push(el('div', { class: 'eyebrow' }, 'Report di gara'));
  out.push(el('h1', {}, r.name));
  out.push(el('div', { class: 'chips' },
    r.startedAt ? el('span', { class: 'chip' }, fmtDate(r.startedAt)) : null,
    el('span', { class: 'chip' }, 'Distanza ', el('b', {}, km1(r.totalKm))),
    r.meta?.gain != null ? el('span', { class: 'chip' }, 'D+ ', el('b', {}, `${r.meta.gain} m`)) : null,
    el('span', { class: 'chip' }, 'Corridori ', el('b', {}, String(r.participants.length)))));

  // classifica
  out.push(el('h2', {}, 'Classifica'));
  out.push(el('div', { class: 'scroll' }, el('table', {},
    el('thead', {}, el('tr', {}, ...['', 'Corridore', 'Tempo', 'Distacco', 'Passo medio', 'Distanza'].map((h) => el('th', {}, h)))),
    el('tbody', {}, ...rep.ranking.map((x) => el('tr', {},
      el('td', { class: 'pos' }, String(x.pos)),
      el('td', {}, el('span', { class: 'who' }, el('i', { style: `background:${x.color || '#999'}` }), x.name)),
      el('td', { class: 'mono' }, x.finished ? fmtDur(x.totalSec) : 'Non arrivato'),
      el('td', { class: 'mono gap' }, fmtGap(x.gapSec)),
      el('td', { class: 'mono' }, x.avgPaceSecKm ? `${fmtPace(x.avgPaceSecKm)} /km` : '–'),
      el('td', { class: 'mono' }, km1(x.distKm))))))));

  // settori
  if (rep.sectors.length > 1 || rep.rows.some((x) => x.cells.some(Boolean))) {
    out.push(el('h2', {}, 'Tempi per settore'));
    out.push(el('div', { class: 'scroll' }, el('table', {},
      el('thead', {}, el('tr', {}, el('th', {}, 'Corridore'),
        ...rep.sectors.map((s) => el('th', {}, `${s.from} → ${s.to}`, el('small', {}, km1(s.km)))))),
      el('tbody', {}, ...rep.rows.map((x) => el('tr', {},
        el('td', {}, el('span', { class: 'who' }, el('i', { style: `background:${x.color || '#999'}` }), x.name)),
        ...x.cells.map((c) => c
          ? el('td', { class: c.best ? 'best' : '' }, el('div', { class: 'cell' },
              el('div', { class: 't' }, fmtDur(c.sec)),
              el('div', { class: 's' }, `${fmtPace(c.paceSecKm)} /km · ${c.kmh.toFixed(1).replace('.', ',')} km/h`),
              rep.comparable ? el('div', { class: 'd' }, c.deltaSec === 0 ? 'migliore' : `+${fmtDur(c.deltaSec)}`) : null))
          : el('td', { class: 'none' }, '–'))))))));
    if (rep.comparable) out.push(el('p', { class: 'legend' }, el('span'), 'In viola il miglior tempo di ogni settore. I distacchi sono dal più veloce.'));
  }

  // schede
  out.push(el('h2', {}, 'Schede'));
  out.push(el('div', { class: 'cards' }, ...rep.rows.map((x) => el('div', { class: 'card' },
    el('span', { class: 'who' }, el('i', { style: `background:${x.color || '#999'}` }), x.name),
    el('dl', {},
      ...[['Distanza', km1(x.distKm)], ['Dislivello +', x.gain != null ? `${x.gain} m` : '–'], ['Dislivello −', x.loss != null ? `${x.loss} m` : '–'],
        ['Passo in salita', x.paceByGrade?.salita ? `${fmtPace(x.paceByGrade.salita)} /km` : '–'],
        ['Passo in piano', x.paceByGrade?.piano ? `${fmtPace(x.paceByGrade.piano)} /km` : '–'],
        ['Passo in discesa', x.paceByGrade?.discesa ? `${fmtPace(x.paceByGrade.discesa)} /km` : '–']]
        .flatMap(([a, b]) => [el('dt', {}, a), el('dd', {}, b)]))))));

  $('out').replaceChildren(...out);
  $('foot').textContent = (r.expiresAt ? `Disponibile fino al ${fmtDay(r.expiresAt)}. ` : '')
    + 'Tempi e passi sono stime dal GPS dei telefoni: non sono cronometraggio ufficiale.';
}

async function load() {
  const t = decodeURIComponent(location.hash.slice(1));
  if (!t) return msg('Link non valido', 'Apri il report dal link che hai ricevuto.');
  try {
    const res = await fetch(`/api/report?t=${encodeURIComponent(t)}`);
    const j = await res.json().catch(() => ({}));
    if (res.status === 410) return msg('Report scaduto', 'Questo report non è più disponibile.');
    if (res.status === 404) return msg('Report non trovato', 'Potrebbe essere scaduto o non ancora pronto. Riprova tra qualche minuto.');
    if (!res.ok) return msg('Link non valido', j.error || 'Il link non è corretto.');
    render(j);
  } catch { msg('Nessuna connessione', 'Riprova tra poco.'); }
}
load();
