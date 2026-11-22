// Pagina dell'organizzatore: percorso guidato (corridori → collegamento telefoni → link → avvio) e, a gara avviata, gestione.
const org = decodeURIComponent(location.hash.slice(1));
const $app = document.getElementById('app');
const COLORS = ['#e91e63', '#2bb7da', '#f4c20d', '#34a853', '#8e24aa'];
let race = null, serverTime = Date.now(), step = 1;
let platform = (() => { try { return localStorage.getItem('sl.platform'); } catch { return null; } })() || (/android/i.test(navigator.userAgent) ? 'android' : 'iphone');

// segreti mostrati una sola volta dal server: restano solo in questa scheda del browser
const secKey = () => `sl.sec.${race.id}`;
const sec = () => { try { return JSON.parse(sessionStorage.getItem(secKey())) || {}; } catch { return {}; } };
const setSec = (fn) => { const s = sec(); fn(s); try { sessionStorage.setItem(secKey(), JSON.stringify(s)); } catch { /* si continua senza */ } };

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) { if (k === 'class') e.className = v; else if (k.includes('-')) e.setAttribute(k, v); else e[k] = v; }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : document.createTextNode(c));
  return e;
}
// sezione: scheda normale, oppure richiudibile (a gara avviata, per le parti che servono di rado)
const openBoxes = new Set();   // le sezioni aperte restano aperte quando la pagina si aggiorna
const box = (title, body, collapsible) => collapsible
  ? el('details', { class: 'card', open: openBoxes.has(title), ontoggle: (e) => { if (e.target.open) openBoxes.add(title); else openBoxes.delete(title); } },
    el('summary', {}, el('h2', {}, title)), ...[body].flat())
  : el('section', { class: 'card' }, el('h2', {}, title), ...[body].flat());
function msg(text, kind = 'ok') { const m = document.getElementById('msg'); m.className = text ? kind : ''; m.textContent = text || ''; if (text) setTimeout(() => (m.className = ''), 5000); }
async function api(method, path, body) {
  const r = await fetch(`/api/admin/${path}`, { method, headers: { 'content-type': 'application/json', 'x-org-token': org }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
const run = (fn) => async () => { try { await fn(); } catch (e) { msg(e.message, 'err'); } };
const copy = async (t) => { try { await navigator.clipboard.writeText(t); msg('Copiato'); } catch { msg('Copia non riuscita: seleziona il testo e copialo a mano', 'err'); } };
const share = async (title, url) => { if (navigator.share) { try { await navigator.share({ title, url }); } catch { /* annullato */ } } else copy(url); };
function qr(text) {
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  const d = el('div', { class: 'qr', role: 'img', 'aria-label': 'QR code' }); d.innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); return d;
}

async function load() {
  const { races } = await api('GET', 'races');
  if (!races[0]) throw new Error('Gara non trovata o scaduta');
  const j = await api('GET', `races/${races[0].id}`);
  race = j.race; serverTime = j.serverTime;
}
const refresh = async () => { await load(); render(); };

// ---------- segnale ----------
const ago = (ms) => { const s = Math.max(0, Math.round((serverTime - ms) / 1000)); return s < 90 ? `${s} s fa` : s < 5400 ? `${Math.round(s / 60)} min fa` : `${Math.round(s / 3600)} h fa`; };
function signal(p) {
  const x = p.received;
  if (!x) return ['wait', 'In attesa del primo segnale…'];
  const fresh = serverTime - x.rcv < 90000;
  return [fresh ? 'ok' : 'old', `${fresh ? 'Segnale ricevuto ✓' : 'Ultimo segnale'} ${ago(x.rcv)}`];
}
const sigNode = (p) => { const [c, t] = signal(p); const n = el('span', { class: `sig ${c}` }, t); n.dataset.sig = p.id; return n; };
setInterval(async () => {
  if (!race || document.hidden) return;
  try { const j = await api('GET', `races/${race.id}`); race = j.race; serverTime = j.serverTime;
    for (const p of race.participants) for (const n of document.querySelectorAll(`[data-sig="${p.id}"]`)) { const [c, t] = signal(p); n.className = `sig ${c}`; n.textContent = t; }
    const st = document.getElementById('ready'); if (st) st.replaceWith(readyItem());
  } catch { /* riprova al prossimo giro */ }
}, 5000);
const connected = () => race.participants.filter((p) => p.received).length;
const readyText = () => `${connected()} di ${race.participants.length} corridori collegati`;
const checkItem = (ok, text, id) => el('li', id ? { id } : {}, el('span', { class: `ic${ok ? ' ok' : ''}`, 'aria-hidden': 'true' }, ok ? '✓' : '○'), el('span', {}, text));
const readyItem = () => checkItem(race.participants.length > 0 && connected() === race.participants.length, readyText(), 'ready');

// ---------- sezioni ----------
function sRunners(collapsible = false) {
  const full = race.participants.length >= 5, can = race.status !== 'ended';
  const add = !full && can ? el('div', { class: 'row', style: 'margin-top:10px' },
    el('input', { id: 'pname', placeholder: 'Nome o soprannome', maxLength: 40, style: 'flex:1;min-width:140px', 'aria-label': 'Nome del corridore' }),
    el('input', { id: 'pcolor', type: 'color', value: COLORS[race.participants.length % 5], style: 'width:56px;padding:2px', 'aria-label': 'Colore sulla mappa' }),
    el('button', { class: 'primary', onclick: run(async () => {
      const name = document.getElementById('pname').value.trim(); if (!name) throw new Error('Scrivi il nome del corridore');
      const j = await api('POST', `races/${race.id}/participants`, { name, color: document.getElementById('pcolor').value });
      setSec((s) => { s[j.participant.id] = { pairing: j.pairing, device: j.deviceToken }; }); await refresh();
    }) }, 'Aggiungi')) : '';
  const body = [el('p', { class: 'small muted' }, 'Aggiungi fino a 5 persone. Ognuna avrà il proprio colore sulla mappa e il proprio collegamento.'),
    race.participants.length ? el('ul', { class: 'list' }, ...race.participants.map((p) => el('li', { class: 'rn' }, el('span', { class: 'dot', style: `background:${p.color}` }), el('b', {}, p.name),
      can ? el('button', { class: 'end', onclick: run(async () => { if (!confirm(`Rimuovere ${p.name}?`)) return; await api('DELETE', `races/${race.id}/participants/${p.id}`); await refresh(); }) }, 'Rimuovi') : '')))
      : el('p', { class: 'muted' }, 'Ancora nessuno.'), add];
  return box('Chi corre', body, collapsible);
}

function sHow() {
  const tabs = el('div', { class: 'tabs' }, ...[['iphone', 'iPhone'], ['android', 'Android']].map(([k, label]) =>
    el('button', { 'aria-pressed': String(platform === k), onclick: () => { platform = k; try { localStorage.setItem('sl.platform', k); } catch { /* ok */ } render(); } }, label)));
  const ip = platform === 'iphone';
  return el('div', { class: 'keynote' }, el('b', {}, 'Come si collega il telefono'), tabs,
    el('ol', { class: 'how' },
      el('li', {}, `Il corridore inquadra il QR code con la fotocamera e apre il link${ip ? ' in Safari' : ' in Chrome'}.`),
      el('li', {}, 'Tocca «Avvia condivisione» e consente l\'uso della posizione.'),
      el('li', {}, ip ? 'Tiene lo schermo acceso e la pagina aperta: se blocca il telefono, la condivisione si ferma.' : 'Tiene lo schermo acceso e la pagina in primo piano, con il risparmio energetico disattivato.')),
    el('p', { class: 'small muted' }, ip ? 'Per tracciare anche a schermo spento si può usare l\'app gratuita Overland: le istruzioni sono sotto, in «Con l\'app Overland».'
      : 'Un\'app per tracciare a schermo spento su Android è in arrivo.'),
    el('p', { class: 'small' }, el('b', {}, 'Prova prima della gara: '), 'quando sotto compare «Segnale ricevuto ✓», il collegamento funziona.'));
}

function sConnect(collapsible = false) {
  const s = sec(), base = location.origin;
  const cards = race.participants.map((p) => {
    const x = s[p.id], url = x ? `${base}/track#${x.pairing}` : '';
    return el('div', { class: 'keynote' },
      el('div', { class: 'rn' }, el('span', { class: 'dot', style: `background:${p.color}` }), el('b', {}, p.name), sigNode(p)),
      x ? qr(url) : el('p', { class: 'small muted' }, 'Per sicurezza il QR code non si può rivedere. Creane uno nuovo: il vecchio smette di funzionare.'),
      el('div', { class: 'row' },
        x ? el('button', { onclick: () => copy(url) }, 'Copia link') : '',
        x ? el('button', { onclick: () => share(`Collegamento di ${p.name}`, url) }, 'Invia') : '',
        el('button', { class: x ? '' : 'primary', onclick: run(async () => {
        if (x && !confirm(`Creare un nuovo QR code per ${p.name}? Il vecchio smette di funzionare.`)) return;
        const j = await api('POST', `races/${race.id}/participants/${p.id}/token`, {});
        setSec((o) => { o[p.id] = { pairing: j.pairing, device: j.deviceToken }; }); await refresh();
      }) }, x ? 'Nuovo QR code' : 'Mostra QR code')),
      x && platform === 'iphone' ? el('details', { class: 'small', style: 'margin-top:12px' }, el('summary', {}, 'Con l\'app Overland (anche a schermo spento)'),
        el('p', { class: 'muted' }, 'Scarica «Overland» dall\'App Store, apri Impostazioni e inserisci questi due dati.'),
        el('div', { class: 'muted' }, 'Receiver Endpoint'), el('div', { class: 'secret' }, `${base}/api/device/overland`), el('button', { onclick: () => copy(`${base}/api/device/overland`) }, 'Copia indirizzo'),
        el('div', { class: 'muted', style: 'margin-top:12px' }, 'Access Token (è personale: non condividerlo)'), el('div', { class: 'secret' }, x.device), el('button', { onclick: () => copy(x.device) }, 'Copia token')) : '');
  });
  return box('Collega i telefoni', race.participants.length ? [sHow(), ...cards] : el('p', { class: 'muted' }, 'Aggiungi prima chi corre.'), collapsible);
}

function sLink() {
  const s = sec(), url = s.link ? `${location.origin}${s.link}` : '';
  const make = (label) => el('button', { class: url || race.hasLink ? '' : 'primary', onclick: run(async () => {
    if (race.hasLink && !confirm('Creare un nuovo link? Quello vecchio smette di funzionare.')) return;
    const j = await api('POST', `races/${race.id}/link`, {}); setSec((o) => { o.link = j.path; }); await refresh();
  }) }, label);
  return el('section', { class: 'card' }, el('h2', {}, 'Il link per chi ti segue'),
    el('p', { class: 'small muted' }, 'Mandalo ai tuoi cari o al tuo coach. Chi lo riceve vede la gara da qualsiasi dispositivo, senza app e senza account.'),
    url ? el('div', {}, qr(url), el('div', { class: 'secret' }, url),
      el('div', { class: 'row' }, el('button', { class: 'primary', onclick: () => share(race.name, url) }, 'Condividi'), el('button', { onclick: () => copy(url) }, 'Copia link')))
      : race.hasLink ? el('p', { class: 'small muted' }, 'Il link è già stato creato. Per sicurezza non si può rivedere: se ti serve di nuovo, creane uno nuovo.') : '',
    el('div', { class: 'row', style: 'margin-top:8px' }, make(race.hasLink ? 'Nuovo link' : 'Crea il link'),
      race.hasLink ? el('button', { class: 'danger', onclick: run(async () => { if (!confirm('Disattivare il link? Chi lo ha non vedrà più la gara.')) return; await api('DELETE', `races/${race.id}/link`); setSec((o) => { delete o.link; }); await refresh(); }) }, 'Disattiva') : ''));
}

function sStart() {
  return el('section', { class: 'card' }, el('h2', {}, 'Pronti a partire?'),
    el('ul', { class: 'check' },
      checkItem(race.participants.length > 0, `${race.participants.length} ${race.participants.length === 1 ? 'corridore' : 'corridori'}`),
      readyItem(),
      checkItem(race.hasLink, race.hasLink ? 'Link creato' : 'Link non ancora creato')),
    el('p', { class: 'small muted' }, 'Puoi avviare la gara anche prima che i telefoni siano collegati: le posizioni compaiono appena arrivano.'),
    el('button', { class: 'primary big', style: 'width:100%;min-height:52px', onclick: run(async () => { await api('POST', `races/${race.id}/start`); step = 1; await refresh(); msg('Gara avviata'); }) }, 'Avvia la gara'));
}

function sReport() {
  if (race.reportPath) {
    const url = `${location.origin}${race.reportPath}`;
    return el('section', { class: 'card' }, el('h2', {}, 'Report di gara'),
      el('p', { class: 'small muted' }, 'Tempi per settore e confronto tra i corridori. Resta disponibile per 3 giorni.'),
      el('div', { class: 'secret' }, url), el('div', { class: 'row' }, el('button', { onclick: () => copy(url) }, 'Copia link'), el('a', { href: race.reportPath, target: '_blank', rel: 'noopener', class: 'tag' }, 'Apri')));
  }
  if (race.status === 'ended' && race.archive === 'pending') return el('section', { class: 'card' }, el('h2', {}, 'Report in preparazione'),
    el('p', { class: 'small muted' }, 'L\'archivio non ha ancora risposto. Il sistema riprova da solo; puoi anche riprovare ora.'),
    el('button', { onclick: run(async () => { await api('POST', `races/${race.id}/archive`); await refresh(); }) }, 'Riprova ora'));
  return '';
}

// a gara avviata: chi trasmette e da quanto, in una lista compatta
function sStatus() {
  return box('Corridori', race.participants.length
    ? el('ul', { class: 'list' }, ...race.participants.map((p) => el('li', { class: 'rn' }, el('span', { class: 'dot', style: `background:${p.color}` }), el('b', {}, p.name), el('span', { class: 'end' }, sigNode(p)))))
    : el('p', { class: 'muted' }, 'Nessun corridore.'));
}

function sEnd() {
  return el('div', { class: 'danger-zone' },
    race.status === 'live' ? el('button', { class: 'danger', style: 'width:100%', onclick: run(async () => {
      if (!confirm('Terminare la gara? Le posizioni saranno cancellate dopo 24 ore e verrà preparato il report.')) return;
      await api('POST', `races/${race.id}/end`); await refresh(); }) }, 'Termina la gara') : '',
    el('p', {}, el('button', { class: 'linkbtn', onclick: run(async () => { if (!confirm('Eliminare la gara e tutti i dati?')) return;
      await api('DELETE', `races/${race.id}`); $app.replaceChildren(el('h1', {}, 'Gara eliminata'), el('p', { class: 'muted' }, 'Tutti i dati sono stati cancellati.'), el('a', { class: 'btn primary', href: '/crea' }, 'Crea una nuova gara')); }) }, 'Elimina la gara e tutti i dati')));
}

// ---------- pagina ----------
function render() {
  const state = race.status === 'live' ? ' · In corso' : race.status === 'ended' ? ' · Conclusa' : '';
  const head = [el('h1', {}, race.name), el('div', { class: 'small muted' }, `${race.checkpoints.length} checkpoint${state}`),
    el('div', { class: 'keynote small' }, 'Questo indirizzo è la chiave della tua gara: ', el('b', {}, 'salvalo tra i preferiti'), ' e non condividerlo. Chi lo ha può modificare la gara.')];
  if (race.status === 'draft') {
    const names = ['Corridori', 'Collega', 'Condividi', 'Avvia'];
    const body = [sRunners, sConnect, sLink, sStart][step - 1]();
    $app.replaceChildren(...head, el('ol', { class: 'steps' }, ...names.map((n, i) => el('li', { class: i + 1 === step ? 'on' : i + 1 < step ? 'done' : '' }, `${i + 1} · ${n}`))), body,
      el('div', { class: 'nav' }, step > 1 ? el('button', { onclick: () => { step--; render(); window.scrollTo(0, 0); } }, '← Indietro') : el('span'),
        step < 4 ? el('button', { class: 'primary', disabled: step === 1 && !race.participants.length, onclick: () => { step++; render(); window.scrollTo(0, 0); } }, 'Avanti →') : el('span')));
  } else {
    $app.replaceChildren(...head, sReport(), sStatus(), sLink(), sConnect(true), race.status === 'live' ? sRunners(true) : '', sEnd());
  }
}

(async () => {
  if (org.length < 20) return $app.replaceChildren(el('h1', {}, 'Indirizzo non valido'), el('p', { class: 'muted' }, 'Apri l\'indirizzo completo ricevuto alla creazione della gara.'), el('a', { class: 'btn primary', href: '/crea' }, 'Crea una gara'));
  try { await load(); render(); } catch (e) { $app.replaceChildren(el('h1', {}, 'Gara non trovata'), el('p', { class: 'muted' }, e.message === 'Unauthorized' || /token|autor/i.test(e.message) ? 'L\'indirizzo non è valido o la gara è scaduta.' : e.message), el('a', { class: 'btn primary', href: '/crea' }, 'Crea una gara')); }
})();
