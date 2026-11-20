import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/store.js';
import { createHandler } from '../server/handler.js';

const ADMIN = { 'x-admin-key': 'segreto' };
// Percorso rettilineo verso nord: 11 punti, ~1,11 km ciascuno, quota che sale di 50 m a punto.
const COURSE = Array.from({ length: 11 }, (_, i) => [46 + i * 0.01, 8, 1000 + i * 50]);
const at = (km) => [46 + km / 111.195, 8];   // posizione a `km` dall'inizio

function setup() {
  let t = Date.parse('2026-11-14T08:00:00Z');
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const store = createStore({}, clock.now);
  const handle = createHandler({ store, env: { ADMIN_KEY: 'segreto' }, now: clock.now });
  const api = async (method, path, body, headers = {}, query = {}) =>
    handle({ method, path, body, headers, query, origin: 'https://x.test' });
  return { clock, store, api };
}

async function race(api, extra = {}) {
  const r = await api('POST', '/api/admin/races', { name: 'Trail di prova', course: { points: COURSE },
    checkpoints: [{ name: 'Ristoro', lat: at(5)[0], lon: 8 }], ...extra }, ADMIN);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const id = r.json.race.id;
  const p = await api('POST', `/api/admin/races/${id}/participants`, { name: 'Anna' }, ADMIN);
  const link = await api('POST', `/api/admin/races/${id}/link`, {}, ADMIN);
  return { id, dev: p.json.deviceToken, pid: p.json.participant.id, view: link.json.token, pairing: p.json.pairing };
}
const send = (api, dev, points, status) =>
  api('POST', '/api/device/positions', { points, status }, { authorization: `Bearer ${dev}` });
const pt = (t, km, extra = {}) => ({ t, lat: at(km)[0], lon: 8, ele: 1000, acc: 5, ...extra });

test('amministrazione: chiave obbligatoria', async () => {
  const { api } = setup();
  assert.equal((await api('POST', '/api/admin/races', { name: 'x' })).status, 401);
  assert.equal((await api('POST', '/api/admin/races', { name: 'x' }, { 'x-admin-key': 'no' })).status, 401);
  const h = createHandler({ store: createStore({}), env: {} });
  assert.equal((await h({ method: 'GET', path: '/api/admin/races', headers: ADMIN })).status, 503);
});

test('flusso completo: crea, collega, invia, osserva', async () => {
  const { api, clock } = setup();
  const r = await race(api);
  await api('POST', `/api/admin/races/${r.id}/start`, {}, ADMIN);
  clock.advance(60000);
  const s = await send(api, r.dev, [pt(clock.now() - 1000, 2.5)]);
  assert.equal(s.json.accepted, 1);
  const live = await api('GET', '/api/live', null, {}, { t: r.view });
  assert.equal(live.status, 200);
  const p = live.json.participants[0];
  assert.equal(p.status, 'tracking');
  assert.ok(Math.abs(p.distKm - 2.5) < 0.05, `distKm=${p.distKm}`);
  assert.ok(Math.abs(p.remainingKm - (live.json.race.totalKm - 2.5)) < 0.05);
  assert.match(live.headers['Cache-Control'], /s-maxage=5/);
  assert.ok(JSON.parse(Buffer.from(r.pairing, 'base64url')).t === r.dev);
});

test('link privato: token errato, revoca, rigenerazione', async () => {
  const { api } = setup();
  const r = await race(api);
  assert.equal((await api('GET', '/api/live', null, {}, { t: 'x'.repeat(32) })).status, 401);
  assert.equal((await api('GET', '/api/live', null, {}, {})).status, 401);
  assert.equal((await api('GET', '/api/live', null, {}, { t: r.view })).status, 200);
  const nuovo = await api('POST', `/api/admin/races/${r.id}/link`, {}, ADMIN);
  assert.equal((await api('GET', '/api/live', null, {}, { t: r.view })).status, 401, 'il vecchio link deve cadere');
  assert.equal((await api('GET', '/api/live', null, {}, { t: nuovo.json.token })).status, 200);
  await api('DELETE', `/api/admin/races/${r.id}/link`, null, ADMIN);
  assert.equal((await api('GET', '/api/live', null, {}, { t: nuovo.json.token })).status, 401);
});

test('credenziali dispositivo e link osservatore sono distinte', async () => {
  const { api } = setup();
  const r = await race(api);
  assert.equal((await api('GET', '/api/live', null, {}, { t: r.dev })).status, 401);
  assert.equal((await send(api, r.view, [])).status, 401);
  assert.equal((await send(api, 'sbagliato', [])).status, 401);
  assert.equal((await api('GET', '/api/admin/races', null, { 'x-admin-key': r.view })).status, 401);
});

test('invio idempotente e recupero dopo perdita di rete (fuori ordine)', async () => {
  const { api, clock } = setup();
  const r = await race(api);
  await api('POST', `/api/admin/races/${r.id}/start`, {}, ADMIN);
  const base = clock.now();
  clock.advance(900000);
  const batch = [pt(base + 600000, 1), pt(base + 200000, 0.3), pt(base + 400000, 0.7)];
  assert.equal((await send(api, r.dev, batch)).json.accepted, 3);
  const again = await send(api, r.dev, batch);
  assert.equal(again.json.accepted, 0);
  assert.equal(again.json.duplicates, 3);
  const live = await api('GET', '/api/live', null, {}, { t: r.view });
  assert.ok(Math.abs(live.json.participants[0].distKm - 1) < 0.05);
});

test('validazione: coordinate, orari, dimensione batch', async () => {
  const { api, clock } = setup();
  const r = await race(api);
  const n = clock.now();
  assert.equal((await send(api, r.dev, [{ t: n, lat: 99, lon: 8 }])).status, 400);
  assert.equal((await send(api, r.dev, [{ t: n + 3600000, lat: 46, lon: 8 }])).status, 400);
  assert.equal((await send(api, r.dev, [{ t: 'ieri', lat: 46, lon: 8 }])).status, 400);
  assert.equal((await send(api, r.dev, Array.from({ length: 121 }, (_, i) => pt(n - i, 0)))).status, 400);
});

test('limite richieste per dispositivo', async () => {
  const { api } = setup();
  const r = await race(api);
  let last;
  for (let i = 0; i < 31; i++) last = await send(api, r.dev, []);
  assert.equal(last.status, 429);
});

test('stato: senza dati, pausa, GPS assente, connessione assente', async () => {
  const { api, clock } = setup();
  const r = await race(api);
  const st = async () => (await api('GET', '/api/live', null, {}, { t: r.view })).json.participants[0];
  assert.equal((await st()).status, 'waiting');
  await api('POST', `/api/admin/races/${r.id}/start`, {}, ADMIN);
  await send(api, r.dev, [pt(clock.now(), 1)]);
  assert.equal((await st()).status, 'tracking');
  await send(api, r.dev, [], 'paused');
  assert.equal((await st()).status, 'paused');
  await send(api, r.dev, [], 'no_gps');
  assert.equal((await st()).status, 'no_gps');
  await send(api, r.dev, [pt(clock.now() + 1000, 1.1)], 'tracking');
  clock.advance(200000);
  const off = await st();
  assert.equal(off.status, 'offline');
  assert.equal(off.last.ageSec >= 190, true, 'mostra l\'età del dato, senza simulare spostamenti');
});

test('checkpoint automatico: serve la conferma di due rilevazioni', async () => {
  const { api, clock } = setup();
  const r = await race(api);
  await api('POST', `/api/admin/races/${r.id}/start`, {}, ADMIN);
  const t0 = clock.now();
  await send(api, r.dev, [pt(t0 + 1000, 4.9)]);
  await send(api, r.dev, [pt(t0 + 2000, 5.0)]);       // una sola rilevazione nel raggio
  let s = (await api('GET', '/api/stats', null, {}, { t: r.view })).json;
  assert.equal(s.participants[0].passages.length, 0);
  await send(api, r.dev, [pt(t0 + 3000, 5.0), pt(t0 + 4000, 5.1)]);
  s = (await api('GET', '/api/stats', null, {}, { t: r.view })).json;
  assert.equal(s.participants[0].passages.length, 1);
  assert.equal(s.participants[0].passages[0].t, t0 + 2000, 'orario della prima rilevazione');
  assert.equal(s.participants[0].passages[0].name, 'Ristoro');
});

test('statistiche: distanza lungo la traccia, passo, stima di arrivo', async () => {
  const { api, clock } = setup();
  const r = await race(api);
  await api('POST', `/api/admin/races/${r.id}/start`, {}, ADMIN);
  const t0 = clock.now();
  const pts = Array.from({ length: 21 }, (_, i) => pt(t0 + i * 60000, i * 0.2));  // 5 min/km
  clock.advance(21 * 60000);   // i punti arrivano a gruppi, dopo la corsa
  assert.equal((await send(api, r.dev, pts.slice(0, 10))).status, 200);
  assert.equal((await send(api, r.dev, pts.slice(10))).status, 200);
  const s = (await api('GET', '/api/stats', null, {}, { t: r.view })).json.participants[0].stats;
  assert.ok(Math.abs(s.distKm - 4) < 0.1, `dist=${s.distKm}`);
  assert.ok(Math.abs(s.avgPaceSecKm - 300) < 15, `passo=${s.avgPaceSecKm}`);
  assert.ok(s.gain > 150 && s.gain < 250, `D+=${s.gain}`);
  assert.ok(s.etaSec > 0 && s.paceByGrade.salita > 0);
  assert.equal(s.reliability, 'Supported');
});

test('anomalie GPS: precisione scarsa scartata dalle statistiche', async () => {
  const { api, clock } = setup();
  const r = await race(api);
  await api('POST', `/api/admin/races/${r.id}/start`, {}, ADMIN);
  const t0 = clock.now();
  await send(api, r.dev, [pt(t0 + 1000, 0.1), pt(t0 + 2000, 0.2, { acc: 400 })]);
  const s = (await api('GET', '/api/stats', null, {}, { t: r.view })).json.participants[0].stats;
  assert.equal(s.samples, 1);
});

test('massimo 5 partecipanti', async () => {
  const { api } = setup();
  const r = await race(api);
  for (let i = 0; i < 4; i++) assert.equal((await api('POST', `/api/admin/races/${r.id}/participants`, { name: 'P' + i }, ADMIN)).status, 200);
  assert.equal((await api('POST', `/api/admin/races/${r.id}/participants`, { name: 'Sesto' }, ADMIN)).status, 400);
});

test('conservazione: dopo 24 ore dalla fine i dati non sono più accessibili e vengono cancellati', async () => {
  const { api, clock, store } = setup();
  const r = await race(api);
  await api('POST', `/api/admin/races/${r.id}/start`, {}, ADMIN);
  await send(api, r.dev, [pt(clock.now(), 1)]);
  await api('POST', `/api/admin/races/${r.id}/end`, {}, ADMIN);
  assert.equal((await send(api, r.dev, [pt(clock.now(), 2)])).status, 410, 'niente invii a gara conclusa');
  clock.advance(23 * 3600 * 1000);
  assert.equal((await api('GET', '/api/live', null, {}, { t: r.view })).status, 200);
  assert.ok(await store.cmd(['TTL', `pos:${r.id}:${r.pid}`]) > 0, 'scadenza fisica impostata');
  clock.advance(2 * 3600 * 1000);
  const gone = await api('GET', '/api/live', null, {}, { t: r.view });
  assert.ok([401, 410].includes(gone.status));
  for (const key of [`race:${r.id}`, `course:${r.id}`, `last:${r.id}`, `pos:${r.id}:${r.pid}`]) {
    assert.equal(await store.cmd(['EXISTS', key]), 0, key);
  }
});

test('la risposta live non contiene credenziali né dati amministrativi', async () => {
  const { api } = setup();
  const r = await race(api);
  const body = JSON.stringify([(await api('GET', '/api/live', null, {}, { t: r.view })).json,
    (await api('GET', '/api/course', null, {}, { t: r.view })).json]);
  assert.ok(!body.includes(r.dev) && !body.includes('deviceHash') && !body.includes('viewHash'));
});

test('eliminazione gara', async () => {
  const { api, store } = setup();
  const r = await race(api);
  await api('DELETE', `/api/admin/races/${r.id}`, null, ADMIN);
  assert.equal((await api('GET', '/api/live', null, {}, { t: r.view })).status, 401);
  assert.equal(await store.cmd(['EXISTS', `race:${r.id}`]), 0);
});

test('prefisso chiavi: il database può essere condiviso con altri progetti', async () => {
  const { withPrefix } = await import('../server/store.js');
  const seen = [];
  const fake = { kind: 'fake', cmd: async (c) => { seen.push(c); return 'OK'; }, pipeline: async (cs) => { seen.push(...cs); return cs.map(() => 'OK'); } };
  const s = withPrefix(fake, 'trail:');
  await s.cmd(['SET', 'race:1', 'x', 'EX', 60]);
  await s.pipeline([['HSET', 'last:1', 'p1', '{}'], ['EXPIRE', 'last:1', 5]]);
  assert.deepEqual(seen, [['SET', 'trail:race:1', 'x', 'EX', 60], ['HSET', 'trail:last:1', 'p1', '{}'], ['EXPIRE', 'trail:last:1', 5]]);
  // per default createStore usa "trail:", diverso da "wiztrail:"
  const { createStore: cs } = await import('../server/store.js');
  const m = cs({}); await m.cmd(['SET', 'a', '1']); assert.equal(await m.cmd(['GET', 'a']), '1');
});

test('codice dispositivo smarrito: il nuovo sostituisce il vecchio, i dati restano', async () => {
  const { api, clock } = setup();
  const r = await race(api);
  await api('POST', `/api/admin/races/${r.id}/start`, {}, ADMIN);
  await send(api, r.dev, [pt(clock.now(), 1)]);
  clock.advance(300000);
  const n = await api('POST', `/api/admin/races/${r.id}/participants/${r.pid}/token`, {}, ADMIN);
  assert.equal(n.status, 200);
  assert.equal((await send(api, r.dev, [pt(clock.now() - 100000, 1.2)])).status, 401, 'il vecchio codice non vale più');
  assert.equal((await send(api, n.json.deviceToken, [pt(clock.now(), 1.4)])).status, 200);
  const live = await api('GET', '/api/live', null, {}, { t: r.view });
  assert.equal(live.json.participants.length, 1);
  assert.ok(live.json.participants[0].distKm >= 1.3);
  assert.equal((await api('POST', `/api/admin/races/${r.id}/participants/zzz/token`, {}, ADMIN)).status, 404);
  assert.equal((await api('POST', `/api/admin/races/${r.id}/participants/${r.pid}/token`, {})).status, 401);
});

test('Overland: lotti GeoJSON accettati (token in indirizzo o intestazione)', async () => {
  const { api, clock } = setup();
  const r = await race(api);
  await api('POST', `/api/admin/races/${r.id}/start`, {}, ADMIN);
  const iso = (ms) => new Date(ms).toISOString();
  const f = (ms, km, p = {}) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [8, at(km)[0]] },
    properties: { timestamp: iso(ms), altitude: 1100, horizontal_accuracy: 6, speed: 2, ...p } });
  const t0 = clock.now();
  clock.advance(700000);
  const body = { locations: [f(t0 + 100000, 1), f(t0 + 200000, 1.1),
    { type: 'Feature', properties: { type: 'trip' } },                       // elementi non-posizione: ignorati
    f(t0 + 250000, 1.2, { horizontal_accuracy: -1 }),                         // precisione non valida -> nulla
    f(clock.now() + 99999999, 1.3)] };                                        // dal futuro: scartato
  const ok = await api('POST', '/api/device/overland', body, {}, { token: r.dev });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json, { result: 'ok' });
  const ok2 = await api('POST', '/api/device/overland', { locations: [f(t0 + 400000, 1.4)] }, { authorization: `Bearer ${r.dev}` });
  assert.equal(ok2.status, 200);
  const raw = await api('POST', '/api/device/overland', { locations: [f(t0 + 500000, 1.5)] }, { Authorization: r.dev });  // token senza "Bearer"
  assert.equal(raw.status, 200);
  const live = await api('GET', '/api/live', null, {}, { t: r.view });
  assert.ok(Math.abs(live.json.participants[0].distKm - 1.5) < 0.05);
  assert.equal((await api('POST', '/api/device/overland', body, {}, { token: 'sbagliato' })).status, 401);
  assert.equal((await api('POST', '/api/device/overland', body)).status, 401);
});

test('diagnostica: l\'organizzatore vede l\'ultimo invio ricevuto e la distanza dal percorso', async () => {
  const { api, clock } = setup();
  const r = await race(api);
  const before = (await api('GET', `/api/admin/races/${r.id}`, null, ADMIN)).json.race.participants[0];
  assert.equal(before.received, null);
  await api('POST', `/api/admin/races/${r.id}/start`, {}, ADMIN);
  await send(api, r.dev, [{ t: clock.now(), lat: 47.5, lon: 9, ele: 300, acc: 10 }]);   // ~150+ km dal percorso
  const j = (await api('GET', `/api/admin/races/${r.id}`, null, ADMIN)).json;
  const x = j.race.participants[0].received;
  assert.equal(x.points, 1);
  assert.ok(x.offCourseM > 100000);
  assert.ok(j.serverTime >= x.rcv);
  const live = (await api('GET', '/api/live', null, {}, { t: r.view })).json.participants[0];
  assert.ok(live.offCourseM > 100000 && live.last.lat === 47.5);
});

test('creazione pubblica: ogni organizzatore gestisce solo la propria gara', async () => {
  const { api } = setup();
  const mk = (ip) => api('POST', '/api/races', { name: 'Mia gara', course: { points: COURSE } }, { 'x-forwarded-for': ip });
  const a = await mk('1.1.1.1'), b = await mk('2.2.2.2');
  assert.equal(a.status, 200);
  assert.ok(a.json.organizerToken && a.json.organizerPath.startsWith('/gestisci#'));
  const ta = { 'x-org-token': a.json.organizerToken }, idA = a.json.race.id, idB = b.json.race.id;
  // vede e modifica la propria gara
  assert.equal((await api('GET', `/api/admin/races/${idA}`, null, ta)).status, 200);
  const p = await api('POST', `/api/admin/races/${idA}/participants`, { name: 'Anna' }, ta);
  assert.equal(p.status, 200);
  assert.equal((await api('POST', `/api/admin/races/${idA}/link`, {}, ta)).status, 200);
  // non vede quella degli altri, non può crearne con l'API admin né elencarle tutte
  assert.equal((await api('GET', `/api/admin/races/${idB}`, null, ta)).status, 403);
  assert.equal((await api('POST', '/api/admin/races', { name: 'x' }, ta)).status, 403);
  assert.deepEqual((await api('GET', '/api/admin/races', null, ta)).json.races.map((r) => r.id), [idA]);
  // token inventato o troppo corto
  assert.equal((await api('GET', `/api/admin/races/${idA}`, null, { 'x-org-token': 'a'.repeat(32) })).status, 401);
  assert.equal((await api('GET', `/api/admin/races/${idA}`, null, { 'x-org-token': 'x' })).status, 401);
  // il token non compare nelle risposte di lettura
  assert.ok(!JSON.stringify((await api('GET', `/api/admin/races/${idA}`, null, ta)).json).includes(a.json.organizerToken));
  // eliminando la gara il link organizzatore smette di funzionare
  assert.equal((await api('DELETE', `/api/admin/races/${idA}`, null, ta)).status, 200);
  assert.equal((await api('GET', `/api/admin/races/${idA}`, null, ta)).status, 401);
});

test('creazione pubblica: limite giornaliero per IP e tetto globale', async () => {
  const { api, clock } = setup();
  const mk = (ip) => api('POST', '/api/races', { name: 'G' }, { 'x-forwarded-for': ip });
  for (let i = 0; i < 5; i++) assert.equal((await mk('9.9.9.9')).status, 200);
  assert.equal((await mk('9.9.9.9')).status, 429);
  assert.equal((await mk('8.8.8.8')).status, 200);     // un altro IP può creare
  clock.advance(86400000 * 1.1);
  assert.equal((await mk('9.9.9.9')).status, 200);     // il giorno dopo si riparte
  const h = createHandler({ store: createStore({}), env: { MAX_ACTIVE_RACES: '1' } });
  const c = (ip) => h({ method: 'POST', path: '/api/races', body: { name: 'G' }, headers: { 'x-forwarded-for': ip } });
  assert.equal((await c('1.2.3.4')).status, 200);
  assert.equal((await c('1.2.3.5')).status, 503);
});

test('GPS: punti lontani dal percorso non fanno avanzare la progressiva', async () => {
  const { api, clock } = setup();
  const r = await race(api);
  await api('POST', `/api/admin/races/${r.id}/start`, {}, ADMIN);
  const base = clock.now();
  clock.advance(1200000);
  await send(api, r.dev, [pt(base + 60000, 2)]);
  // 150 km a est: non è sul percorso
  // (i primi salti sono scartati; poi la nuova posizione viene accettata ma resta fuori percorso)
  const farPts = [0, 1, 2, 3, 4].map((i) => ({ t: base + 400000 + i * 30000, lat: at(8)[0], lon: 9.8, ele: 1000, acc: 5 }));
  const far = await send(api, r.dev, farPts);
  assert.ok(far.json.accepted >= 1);
  const live = (await api('GET', '/api/live', null, {}, { t: r.view })).json.participants[0];
  assert.ok(Math.abs(live.distKm - 2) < 0.05, `progressiva ferma a 2 km, non ${live.distKm}`);
  assert.ok(live.offCourseM > 100000);
});

test('GPS: deviazione lenta oltre 300 m dal percorso non fa avanzare i km', async () => {
  const { api, clock } = setup();
  const r = await race(api);
  await api('POST', `/api/admin/races/${r.id}/start`, {}, ADMIN);
  const base = clock.now();
  clock.advance(1200000);
  await send(api, r.dev, [pt(base + 60000, 3)]);
  // 600 m a est del km 5, camminando piano: ~1,1 km/10 min verso il km 4
  const side = (i, km) => ({ t: base + 200000 + i * 60000, lat: at(km)[0], lon: 8.0068, ele: 1000, acc: 8 });
  await send(api, r.dev, [side(0, 3.2), side(1, 3.4), side(2, 3.6)]);
  const live = (await api('GET', '/api/live', null, {}, { t: r.view })).json.participants[0];
  assert.ok(live.distKm < 3.1, `progressiva ferma, non ${live.distKm}`);
  assert.ok(live.offCourseM > 300);
});

test('GPS: salti impossibili e precisione pessima vengono scartati', async () => {
  const { api, clock } = setup();
  const r = await race(api);
  await api('POST', `/api/admin/races/${r.id}/start`, {}, ADMIN);
  const base = clock.now();
  clock.advance(1200000);
  await send(api, r.dev, [pt(base + 60000, 1)]);
  // 4 km in 20 s (200 m/s) e un punto con precisione di 400 m
  const res = await send(api, r.dev, [pt(base + 80000, 5), pt(base + 100000, 1.1, { acc: 400 })]);
  assert.equal(res.json.accepted, 0);
  assert.equal(res.json.rejected, 2);
  const live = (await api('GET', '/api/live', null, {}, { t: r.view })).json.participants[0];
  assert.ok(Math.abs(live.distKm - 1) < 0.05);
  // dopo tre salti consecutivi la nuova posizione viene accettata (recupero dopo un trasferimento reale)
  await send(api, r.dev, [pt(base + 120000, 5), pt(base + 140000, 5.01), pt(base + 160000, 5.02)]);
  const r4 = await send(api, r.dev, [pt(base + 180000, 5.03)]);
  assert.equal(r4.json.accepted, 1);
});
