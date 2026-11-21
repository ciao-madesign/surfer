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
  for (const [k, v] of Object.entries(props)) { if (k === 'class') e.className = v; else e[k] = v; }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : document.createTextNode(c));
  return e;
}
function msg(text, kind = 'ok') { const m = document.getElementById('msg'); m.className = text ? kind : ''; m.textContent = text || ''; if (text && kind === 'ok') setTimeout(() => { if (m.className === 'ok') m.className = ''; }, 5000); }
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
const sigNode = (p) => { const [c, t] = signal(p); return el('span', { class: `sig ${c}`, id: `sig-${p.id}` }, t); };
setInterval(async () => {
  if (!race || document.hidden) return;
  try { const j = await api('GET', `races/${race.id}`); race = j.race; serverTime = j.serverTime;
    for (const p of race.participants) { const n = document.getElementById(`sig-${p.id}`); if (n) { const [c, t] = signal(p); n.className = `sig ${c}`; n.textContent = t; } }
    const st = document.getElementById('ready'); if (st) st.textContent = readyText();
  } catch { /* riprova al prossimo giro */ }
}, 5000);
const connected = () => race.participants.filter((p) => p.received).length;
const readyText = () => `${connected()} di ${race.participants.length} corridori collegati`;

// ---------- sezioni ----------
function sRunners() {
  const full = race.participants.length >= 5, can = race.status !== 'ended';
  const add = !full && can ? el('div', { class: 'row', style: 'margin-top:10px' },
    el('input', { id: 'pname', placeholder: 'Nome o soprannome', maxLength: 40, style: 'flex:1;min-width:140px', 'aria-label': 'Nome del corridore' }),
    el('input', { id: 'pcolor', type: 'color', value: COLORS[race.participants.length % 5], style: 'width:56px;padding:2px', 'aria-label': 'Colore sulla mappa' }),
    el('button', { class: 'primary', onclick: run(async () => {
      const name = document.getElementById('pname').value.trim(); if (!name) throw new Error('Scrivi il nome del corridore');
      const j = await api('POST', `races/${race.id}/participants`, { name, color: document.getElementById('pcolor').value });
      setSec((s) => { s[j.participant.id] = { pairing: j.pairing, device: j.deviceToken }; }); await refresh();
    }) }, 'Aggiungi')) : '';
  return el('section', { class: 'card' }, el('h2', {}, 'Chi corre'),
    el('p', { class: 'small muted' }, 'Fino a 5 persone, ognuna con il suo colore.'),
    ...race.participants.map((p) => el('div', { class: 'rn' }, el('span', { class: 'dot', style: `background:${p.color}` }), el('b', {}, p.name),
      can ? el('button', { class: 'small', onclick: run(async () => { if (!confirm(`Rimuovere ${p.name}?`)) return; await api('DELETE', `races/${race.id}/participants/${p.id}`); await refresh(); }) }, 'Rimuovi') : '')),
    race.participants.length ? '' : el('p', { class: 'muted' }, 'Ancora nessuno.'), add);
}

function sHow() {
  const tabs = el('div', { class: 'tabs' }, ...[['iphone', 'iPhone'], ['android', 'Android']].map(([k, label]) =>
    el('button', { 'aria-pressed': String(platform === k), onclick: () => { platform = k; try { localStorage.setItem('sl.platform', k); } catch { /* ok */ } render(); } }, label)));
  const ip = platform === 'iphone';
  return el('div', { class: 'keynote' }, el('b', {}, 'Come si collega'), tabs,
    el('ol', { class: 'how' },
      el('li', {}, 'Inquadra il QR con la fotocamera e apri il link nel browser.'),
      el('li', {}, 'Tocca «Avvia condivisione» e consenti la posizione.'),
      el('li', {}, ip ? 'Tieni lo schermo acceso e la pagina aperta.' : 'Tieni lo schermo acceso e disattiva il risparmio energetico.')),
    el('p', { class: 'small muted' }, ip ? 'A schermo spento? Usa l\'app gratuita Overland (sotto).' : 'Su Android, per ora, la pagina deve restare aperta e lo schermo acceso.'),
    el('p', { class: 'small' }, 'Quando compare «Segnale ricevuto ✓», funziona.'));
}

function sConnect() {
  const s = sec(), base = location.origin;
  const cards = race.participants.map((p) => {
    const x = s[p.id], url = x ? `${base}/track#${x.pairing}` : '';
    return el('div', { class: 'keynote' },
      el('div', { class: 'rn' }, el('span', { class: 'dot', style: `background:${p.color}` }), el('b', {}, p.name), sigNode(p)),
      x ? el('div', {}, qr(url),
        el('div', { class: 'row' }, el('button', { onclick: () => copy(url) }, 'Copia link'), el('button', { onclick: () => share(`Collegamento di ${p.name}`, url) }, 'Invia'))) 
        : el('p', { class: 'small muted' }, 'Il QR non si può rivedere. Creane uno nuovo.'),
      el('div', { class: 'row', style: 'margin-top:6px' }, el('button', { class: 'small', onclick: run(async () => {
        if (x && !confirm(`Creare un nuovo QR code per ${p.name}? Il vecchio smette di funzionare.`)) return;
        const j = await api('POST', `races/${race.id}/participants/${p.id}/token`, {});
        setSec((o) => { o[p.id] = { pairing: j.pairing, device: j.deviceToken }; }); await refresh();
      }) }, x ? 'Nuovo QR code' : 'Mostra QR code')),
      x ? el('p', { class: 'small', style: 'margin-top:8px' }, 'Verifica che il corridore sia d\'accordo a condividere la posizione.') : '',
      x && platform === 'iphone' ? el('details', { class: 'small', style: 'margin-top:8px' }, el('summary', {}, 'Con l\'app Overland (anche a schermo spento)'),
        el('p', { class: 'muted' }, 'Scarica «Overland» dall\'App Store e inserisci questi dati.'),
        el('div', { class: 'muted' }, 'Receiver Endpoint'), el('div', { class: 'secret' }, `${base}/api/device/overland`), el('button', { onclick: () => copy(`${base}/api/device/overland`) }, 'Copia indirizzo'),
        el('div', { class: 'muted', style: 'margin-top:8px' }, 'Access Token (personale)'), el('div', { class: 'secret' }, x.device), el('button', { onclick: () => copy(x.device) }, 'Copia token')) : '');
  });
  return el('section', { class: 'card' }, el('h2', {}, 'Collega i telefoni'),
    race.participants.length ? [sHow(), ...cards] : el('p', { class: 'muted' }, 'Aggiungi prima chi corre.'));
}

function sLink() {
  const s = sec(), url = s.link ? `${location.origin}${s.link}` : '';
  const make = (label) => el('button', { class: url || race.hasLink ? '' : 'primary', onclick: run(async () => {
    if (race.hasLink && !confirm('Creare un nuovo link? Quello vecchio smette di funzionare.')) return;
    const j = await api('POST', `races/${race.id}/link`, {}); setSec((o) => { o.link = j.path; }); await refresh();
  }) }, label);
  return el('section', { class: 'card' }, el('h2', {}, 'Il link per chi ti segue'),
    el('p', { class: 'small muted' }, 'Mandalo a chi vuole seguirti. Nessuna app, nessun account.'),
    el('p', { class: 'small muted' }, 'Funziona fino a 24 ore dopo la fine della gara.'),
    url ? el('div', {}, qr(url), el('div', { class: 'secret' }, url),
      el('div', { class: 'row' }, el('button', { class: 'primary', onclick: () => share(race.name, url) }, 'Condividi'), el('button', { onclick: () => copy(url) }, 'Copia link')))
      : race.hasLink ? el('p', { class: 'small muted' }, 'Link già creato. Per rivederlo, creane uno nuovo.') : '',
    el('div', { class: 'row', style: 'margin-top:8px' }, make(race.hasLink ? 'Nuovo link' : 'Crea il link'),
      race.hasLink ? el('button', { class: 'danger', onclick: run(async () => { if (!confirm('Disattivare il link? Chi lo ha non vedrà più la gara.')) return; await api('DELETE', `races/${race.id}/link`); setSec((o) => { delete o.link; }); await refresh(); }) }, 'Disattiva') : ''));
}

function sStart() {
  return el('section', { class: 'card' }, el('h2', {}, 'Pronti a partire?'),
    el('ul', { class: 'how', style: 'list-style:none;padding:0' },
      el('li', {}, race.participants.length ? '✓' : '○', ` ${race.participants.length} ${race.participants.length === 1 ? 'corridore' : 'corridori'}`),
      el('li', { id: 'ready' }, readyText()),
      el('li', {}, race.hasLink ? '✓ Link creato' : '○ Link non ancora creato')),
    el('p', { class: 'small muted' }, 'Puoi partire anche senza telefoni collegati.'),
    el('button', { class: 'primary big', style: 'width:100%;min-height:52px', onclick: run(async () => { await api('POST', `races/${race.id}/start`); step = 1; await refresh(); msg('Gara avviata'); }) }, 'Avvia la gara'));
}

function sReport() {
  if (race.reportPath) {
    const url = `${location.origin}${race.reportPath}`;
    return el('section', { class: 'card' }, el('h2', {}, 'Report di gara'),
      el('p', { class: 'small muted' }, 'Tempi per settore e confronti. Disponibile 3 giorni.'),
      el('div', { class: 'secret' }, url), el('div', { class: 'row' }, el('button', { onclick: () => copy(url) }, 'Copia link'), el('a', { href: race.reportPath, target: '_blank', rel: 'noopener', class: 'tag' }, 'Apri')),
      el('div', { class: 'row', style: 'margin-top:8px' }, el('button', { class: 'small', onclick: run(async () => {
        if (!confirm('Creare un nuovo link del report? Quello vecchio smette di funzionare.')) return;
        await api('POST', `races/${race.id}/report`, {}); await refresh(); msg('Nuovo link creato'); }) }, 'Nuovo link del report')));
  }
  if (race.status === 'ended' && race.archive === 'pending') return el('section', { class: 'card' }, el('h2', {}, 'Report in preparazione'),
    el('p', { class: 'small muted' }, 'Il sistema riprova da solo. Puoi riprovare anche ora.'),
    el('button', { onclick: run(async () => { await api('POST', `races/${race.id}/archive`); await refresh(); }) }, 'Riprova ora'));
  return '';
}

function sEnd() {
  const end = race.status === 'live' ? el('section', { class: 'card' }, el('h2', {}, 'Fine della gara'),
    el('p', { class: 'small muted' }, 'Le posizioni saranno cancellate dopo 24 ore e verrà preparato il report.'),
    el('button', { class: 'danger', onclick: run(async () => {
      if (!confirm('Terminare la gara? Le posizioni saranno cancellate dopo 24 ore e verrà preparato il report.')) return;
      await api('POST', `races/${race.id}/end`); await refresh(); }) }, 'Termina la gara')) : '';
  const del = el('section', { class: 'card', style: 'margin-top:32px' }, el('h2', {}, 'Elimina la gara'),
    el('p', { class: 'small muted' }, 'Cancella subito la gara e tutti i dati. Non si può annullare.'),
    el('button', { class: 'danger', onclick: run(async () => { if (!confirm('Eliminare la gara e tutti i dati?')) return;
      await api('DELETE', `races/${race.id}`); $app.replaceChildren(el('h1', {}, 'Gara eliminata'), el('p', { class: 'muted' }, 'Tutti i dati sono stati cancellati.'), el('a', { class: 'btn primary', href: '/crea' }, 'Crea una nuova gara')); }) }, 'Elimina la gara'));
  return el('div', {}, end, del);
}

// ---------- pagina ----------
function render() {
  const head = [el('h1', {}, race.name), el('div', { class: 'small muted' }, `${race.checkpoints.length} checkpoint`),
    el('div', { class: 'keynote small' }, '🔖 ', el('b', {}, 'Salva questo indirizzo tra i preferiti.'), ' È la chiave della gara: non condividerlo.')];
  if (race.status === 'draft') {
    const names = ['Corridori', 'Collega', 'Condividi', 'Avvia'];
    const body = [sRunners, sConnect, sLink, sStart][step - 1]();
    $app.replaceChildren(...head, el('ol', { class: 'steps' }, ...names.map((n, i) => el('li', { class: i + 1 === step ? 'on' : i + 1 < step ? 'done' : '' }, `${i + 1} · ${n}`))), body,
      el('div', { class: 'nav' }, step > 1 ? el('button', { onclick: () => { step--; render(); window.scrollTo(0, 0); } }, '← Indietro') : el('span'),
        step < 4 ? el('button', { class: 'primary', disabled: step === 1 && !race.participants.length, onclick: () => { step++; render(); window.scrollTo(0, 0); } }, 'Avanti →') : el('span')));
  } else {
    $app.replaceChildren(...head, el('div', { class: 'row' }, el('span', { class: 'tag' }, race.status === 'live' ? 'In corso' : 'Conclusa')),
      sReport(), sConnect(), sLink(), race.status === 'live' ? sRunners() : '', sEnd());
  }
}

(async () => {
  if (org.length < 20) return $app.replaceChildren(el('h1', {}, 'Indirizzo non valido'), el('p', { class: 'muted' }, 'Apri l\'indirizzo completo ricevuto alla creazione della gara.'), el('a', { class: 'btn primary', href: '/crea' }, 'Crea una gara'));
  try { await load(); render(); } catch (e) { $app.replaceChildren(el('h1', {}, 'Gara non trovata'), el('p', { class: 'muted' }, e.message === 'Unauthorized' || /token|autor/i.test(e.message) ? 'L\'indirizzo non è valido o la gara è scaduta.' : e.message), el('a', { class: 'btn primary', href: '/crea' }, 'Crea una gara')); }
})();
