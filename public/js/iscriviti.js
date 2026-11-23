// Iscrizione autonoma: il corridore si aggiunge alla gara con il link dell'organizzatore e dà il consenso nello stesso gesto.
const $ = (id) => document.getElementById(id);
const t = decodeURIComponent(location.hash.slice(1));
const err = (m) => { $('msg').className = m ? 'err' : ''; $('msg').textContent = m || ''; if (m) $('msg').scrollIntoView({ block: 'center', behavior: 'smooth' }); };
const closed = (title, text) => { $('title').textContent = title; $('sub').textContent = text; };

(async () => {
  if (t.length < 20) return closed('Link non valido', 'Apri il link di iscrizione completo ricevuto dall\'organizzatore.');
  try {
    const r = await fetch(`/api/enroll?t=${encodeURIComponent(t)}`);
    if (r.status === 401) return closed('Link non valido o chiuso', 'Chiedi un nuovo link all\'organizzatore della gara.');
    const j = await r.json();
    $('title').textContent = j.name;
    if (!j.open) return closed(j.name, 'Le iscrizioni sono chiuse: la gara è già partita.');
    if (j.full) return closed(j.name, 'La gara è al completo.');
    $('form').hidden = false;
  } catch { closed('Servizio non raggiungibile', 'Riprova tra poco.'); }
})();

$('age').onchange = () => { $('join').disabled = !$('age').checked; };
$('join').onclick = async () => {
  err(''); $('join').disabled = true;
  const name = $('name').value.trim();
  if (!name) { err('Scrivi il tuo nome o soprannome.'); $('join').disabled = !$('age').checked; return; }
  try {
    const r = await fetch('/api/enroll', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t, name, accept: true, ageOk: true }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(r.status === 400 && /Massimo/.test(j.error || '') ? 'La gara è al completo.' : r.status === 410 ? 'Le iscrizioni sono chiuse: la gara è già partita.' : r.status === 429 ? 'Troppi tentativi: riprova tra poco.' : (j.error || 'Iscrizione non riuscita. Riprova.'));
    history.replaceState(null, '', location.pathname);
    $('form').hidden = true; $('done').hidden = false;
    $('sub').textContent = `Benvenuto, ${j.participant.name}.`;
    $('open').href = `/track#${j.pairing}`;
    $('code').textContent = j.deviceToken;
    $('ovl').textContent = `${location.origin}/api/device/overland`;
    $('trc').textContent = `${location.origin}/api/device/osmand`;
    $('copycode').onclick = async () => { try { await navigator.clipboard.writeText(j.deviceToken); $('copycode').textContent = 'Copiato'; } catch { /* si copia a mano */ } };
  } catch (e) { err(e.message); $('join').disabled = false; }
};
