// Tracker web per il corridore: funziona in Safari, senza app. Limite di iOS: a schermo spento o con
// un'altra app in primo piano la pagina viene sospesa e il GPS si ferma (nessuna pagina web può evitarlo).
const $ = (id) => document.getElementById(id);
const LS = { pairing: 'tt.pairing', queue: 'tt.queue' };
const MAX_QUEUE = 3000, CHUNK = 100;
let pairing = null, watchId = null, wake = null, sharing = false, sending = false;
let lastFix = null, lastEnq = 0, lastSentAt = 0, retry = 5000, queue = [], watchdog = null;

const load = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* spazio finito: si continua senza persistenza */ } };

function parsePairing(s) {
  s = s.trim(); if (s.includes('#')) s = s.slice(s.lastIndexOf('#') + 1);   // accetta anche il link intero
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const j = JSON.parse(atob(t + '='.repeat((4 - (t.length % 4)) % 4)));
  if (!j.t || j.t.length < 20) throw new Error('Codice non valido');
  return { token: j.t, name: j.n || 'Corridore' };
}
const fmtAgo = (ms) => { const s = Math.round((Date.now() - ms) / 1000); return s < 90 ? `${s} s fa` : `${Math.round(s / 60)} min fa`; };

function ui() {
  $('pair').hidden = !!pairing; $('run').hidden = !pairing;
  if (!pairing) return;
  $('who').textContent = pairing.name;
  const st = $('state');
  st.textContent = !sharing ? (lastFix ? 'Condivisione ferma: la tua posizione non viene più inviata' : 'Condivisione ferma') : document.hidden ? 'In pausa: pagina in secondo piano' : lastFix && Date.now() - lastFix.t > 90000 ? 'Segnale GPS assente' : 'Condivisione attiva';
  st.className = 'state ' + (sharing && !document.hidden && !(lastFix && Date.now() - lastFix.t > 90000) ? 'ok' : sharing ? 'bad' : '');
  $('toggle').textContent = sharing ? 'Interrompi condivisione' : 'Avvia condivisione';
  $('toggle').className = 'big ' + (sharing ? 'danger' : 'primary');
  $('last').textContent = lastFix ? fmtAgo(lastFix.t) + (sharing ? '' : ' (non condiviso)') : '–';
  $('acc').textContent = lastFix ? `${Math.round(lastFix.acc)} m` : '–';
  $('queue').textContent = String(queue.length);
  $('sent').textContent = lastSentAt ? fmtAgo(lastSentAt) : '–';
  $('net').textContent = navigator.onLine ? 'connesso' : 'assente';
  document.body.classList.toggle('sharing', sharing);
}
const showErr = (m) => { $('err').textContent = m || ''; };
const showPairErr = (m) => { $('perr').textContent = m || ''; };

// ---------- collegamento ----------
$('link').onclick = () => {
  try { pairing = parsePairing($('code').value); save(LS.pairing, pairing); $('code').value = ''; showPairErr(''); showErr(''); }
  catch { showPairErr('Codice non valido. Incolla il link o il codice ricevuto dall\'organizzatore.'); }
  ui();
};
$('unlink').onclick = () => { if (sharing) stop(); pairing = null; localStorage.removeItem(LS.pairing); ui(); };

// ---------- invio ----------
async function post(points, status) {
  const r = await fetch('/api/device/positions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${pairing.token}` }, body: JSON.stringify({ points, status }), keepalive: points.length < 20 });
  return r.status;
}
async function flush(status = 'tracking', force = false) {
  if (sending || !pairing || !(sharing || force)) return;
  sending = true;
  try {
    do {
      const batch = queue.slice(0, CHUNK);
      let code;
      try { code = await post(batch, status); } catch { showErr('Nessuna connessione: i dati restano nel telefono e partono appena torna.'); scheduleRetry(); return; }
      if (code === 200 || code === 400) { queue.splice(0, batch.length); save(LS.queue, queue); lastSentAt = Date.now(); retry = 5000; showErr(code === 400 ? 'Alcuni dati sono stati rifiutati dal server.' : ''); }
      else if (code === 401) { showErr('Collegamento non più valido: chiedi un nuovo QR all\'organizzatore.'); stop(false); return; }
      else if (code === 410) { showErr('La gara è finita: condivisione terminata.'); stop(false); return; }
      else { showErr('Servizio non raggiungibile, riprovo.'); scheduleRetry(); return; }
    } while (queue.length);
  } finally { sending = false; ui(); }
}
function scheduleRetry() { const d = retry; retry = Math.min(retry * 2, 60000); setTimeout(() => flush(), d); }

// ---------- GPS ----------
const interval = (speed) => (speed >= 1.5 ? 15 : speed >= 0.5 ? 30 : 60) * 1000;   // movimento regolare / lento / sosta
function onFix(pos) {
  const c = pos.coords, now = Date.now();
  let speed = c.speed;
  if (speed == null && lastFix) { const dt = (pos.timestamp - lastFix.t) / 1000; speed = dt > 0 ? haversine(lastFix.lat, lastFix.lon, c.latitude, c.longitude) / dt : 0; }
  lastFix = { t: pos.timestamp, lat: c.latitude, lon: c.longitude, acc: c.accuracy };
  if (now - lastEnq >= interval(Math.max(speed || 0, 0))) {
    lastEnq = now;
    queue.push({ t: pos.timestamp, lat: c.latitude, lon: c.longitude, ele: c.altitude ?? null, acc: c.accuracy });
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
    save(LS.queue, queue); flush();
  }
  ui();
}
function haversine(a, b, c, d) { const r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 12742000 * Math.asin(Math.sqrt(x)); }
function onGpsError(e) { showErr(e.code === 1 ? 'Posizione non consentita. Attivala per il browser nelle impostazioni del telefono.' : 'Segnale GPS assente.'); if (e.code !== 1) flush('no_gps'); ui(); }

async function keepAwake() {
  try { if ('wakeLock' in navigator && sharing && !document.hidden) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } }
  catch { /* non supportato: l'avviso resta valido */ }
}
function start() {
  if (!confirm('Condividere la tua posizione?\n\nDurante la gara verrà inviata a chi ha il link. Puoi interrompere quando vuoi. I dati vengono cancellati 24 ore dopo la fine.')) return;
  if (!('geolocation' in navigator)) return showErr('Questo browser non supporta la posizione.');
  sharing = true; lastEnq = 0; showErr('');
  watchId = navigator.geolocation.watchPosition(onFix, onGpsError, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  keepAwake();
  watchdog = setInterval(() => { if (lastFix && Date.now() - lastFix.t > 90000) flush('no_gps'); ui(); }, 15000);
  if (!('wakeLock' in navigator)) showErr('Attenzione: questo iPhone non può tenere lo schermo acceso da solo (serve iOS 16.4 o successivo). Imposta Blocco automatico su «Mai».');
  ui();
}
function stop(final = true) {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null; clearInterval(watchdog); try { wake?.release(); } catch { /* già rilasciato */ } wake = null;
  sharing = false;
  queue = []; save(LS.queue, queue);            // interruzione immediata: i punti non inviati non verranno condivisi
  if (final) flush('paused', true);
  ui();
}
$('toggle').onclick = () => (sharing ? stop() : start());
document.addEventListener('visibilitychange', () => { if (!document.hidden && sharing) { keepAwake(); flush(); } ui(); });
window.addEventListener('online', () => { flush(); ui(); });

// ---------- avvio ----------
pairing = load(LS.pairing); queue = load(LS.queue) || [];
// collegamento da QR code: il codice sta dopo «#» e non viene mai inviato a nessun server
if (location.hash.length > 20) {
  try { pairing = parsePairing(location.hash.slice(1)); save(LS.pairing, pairing); queue = []; save(LS.queue, queue); } catch { /* codice non valido: si usa il collegamento manuale */ }
  history.replaceState(null, '', location.pathname);
}
if (queue.length && !pairing) { queue = []; save(LS.queue, queue); }
ui(); setInterval(ui, 5000);
