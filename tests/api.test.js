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
  const handle = createHandler({ store, env: { ADMIN_KEY: 'segreto', REPORT_SECRET: 'segreto-report' }, now: clock.now });
  const api = async (method, path, body, headers = {}, query = {}) =>
    handle({ method, path, body, headers, query, origin: 'https://x.test' });
  return { clock, store, api };
}

async function race(api, extra = {}) {
  const r = await api('POST', '/api/admin/races', { name: 'Trail di prova', course: { points: COURSE },
    checkpoints: [{ name: 'Ristoro', lat: at(5)[0], lon: 8 }], ...(({ noConsent, ...rest }) => rest)(extra) }, ADMIN);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const id = r.json.race.id;
  const p = await api('POST', `/api/admin/races/${id}/participants`, { name: 'Anna' }, ADMIN);
  const link = await api('POST', `/api/admin/races/${id}/link`, {}, ADMIN);
  if (!extra.noConsent) await api('POST', '/api/device/consent', { accept: true, ageOk: true }, { authorization: `Bearer ${p.json.deviceToken}` });
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
  const fut = await send(api, r.dev, [{ t: n + 3600000, lat: 46, lon: 8 }]);   // punto nel futuro: scartato, senza rifiutare l'invio
  assert.equal(fut.status, 200); assert.equal(fut.json.accepted, 0); assert.equal(fut.json.rejected, 1);
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

test('massimo 20 partecipanti (configurabile)', async () => {
  const { api } = setup();
  const r = await race(api);
  for (let i = 0; i < 19; i++) assert.equal((await api('POST', `/api/admin/races/${r.id}/participants`, { name: 'P' + i }, ADMIN)).status, 200);
  assert.equal((await api('POST', `/api/admin/races/${r.id}/participants`, { name: 'Ventunesimo' }, ADMIN)).status, 400);
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

// ---------- archiviazione a fine gara ----------
import { memoryArchive } from '../server/archive.js';

function setupArchive(extra = {}, archive = memoryArchive()) {
  let t = Date.parse('2026-11-14T08:00:00Z');
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const store = createStore({}, clock.now);
  const handle = createHandler({ store, env: { ADMIN_KEY: 'segreto', ARCHIVE_RETRY_MS: '0', CRON_SECRET: 'cron', REPORT_SECRET: 'segreto-report', ...extra }, now: clock.now, archive });
  const api = async (method, path, body, headers = {}, query = {}) => handle({ method, path, body, headers, query, origin: 'https://x.test' });
  return { clock, store, api, archive };
}
async function finishedRace(api, clock) {
  const r = await race(api);
  await api('POST', `/api/admin/races/${r.id}/start`, {}, ADMIN);
  const base = clock.now();
  clock.advance(3000000);
  await send(api, r.dev, [pt(base + 120000, 1), pt(base + 600000, 4.9), pt(base + 660000, 5.0), pt(base + 690000, 5.0005), pt(base + 720000, 5.1), pt(base + 1500000, 9)]);
  return r;
}

test('archivio: a fine gara vanno su Neon solo tempi e statistiche, senza coordinate GPS', async () => {
  const { api, clock, archive, store } = setupArchive();
  const r = await finishedRace(api, clock);
  const end = await api('POST', `/api/admin/races/${r.id}/end`, {}, ADMIN);
  assert.equal(end.json.race.archive, 'done');
  const s = await archive.getRace(r.id);
  assert.equal(s.checkpoints.length, 1);
  assert.equal(s.participants[0].name, 'Anna');
  assert.equal(s.participants[0].passages.length, 1);          // il passaggio al checkpoint
  assert.ok(s.participants[0].stats.distKm > 8);
  assert.equal(s.participants[0].stats.etaSec, null);          // niente stima a gara finita
  assert.equal(s.course, null, 'senza profilo la traccia non viene conservata');
  assert.equal(s.expiresAt, s.endedAt + 3 * 86400000, 'report disponibile 3 giorni');
  assert.ok(!/"lat"|"lon"/.test(JSON.stringify(s)), 'nessuna coordinata GPS nell\'archivio');
  const ttl = await store.cmd(['TTL', `race:${r.id}`]);
  assert.ok(ttl <= 86400 && ttl > 0, 'Redis si svuota entro 24 ore');
});

test('archivio: con un profilo la traccia viene conservata e non scade', async () => {
  const { api, clock, archive, store } = setupArchive();
  const r = await finishedRace(api, clock);
  const m = JSON.parse(await store.cmd(['GET', `race:${r.id}`]));
  m.accountId = 'acc1';
  await store.cmd(['SET', `race:${r.id}`, JSON.stringify(m), 'EX', 100000]);
  await api('POST', `/api/admin/races/${r.id}/end`, {}, ADMIN);
  const s = await archive.getRace(r.id);
  assert.equal(s.accountId, 'acc1');
  assert.ok(s.course && s.course.points.length === 11);
  assert.equal(s.expiresAt, null);
});

test('archivio: se Neon non risponde i dati restano su Redis e il nuovo tentativo funziona', async () => {
  let down = true;
  const real = memoryArchive();
  const flaky = { ...real, saveRace: async (s) => { if (down) throw new Error('database non raggiungibile'); return real.saveRace(s); } };
  const { api, clock, store } = setupArchive({}, flaky);
  const r = await finishedRace(api, clock);
  const end = await api('POST', `/api/admin/races/${r.id}/end`, {}, ADMIN);
  assert.equal(end.json.race.archive, 'pending');
  assert.ok((await store.cmd(['TTL', `race:${r.id}`])) > 86400, 'dati conservati più a lungo finché non c\'è conferma');
  assert.equal(await real.getRace(r.id), null);
  down = false;
  const again = await api('POST', `/api/admin/races/${r.id}/archive`, {}, ADMIN);
  assert.equal(again.json.archive.state, 'done');
  assert.ok((await store.cmd(['TTL', `race:${r.id}`])) <= 86400, 'dopo la conferma scade entro 24 ore');
  assert.ok(await real.getRace(r.id));
  assert.equal((await store.cmd(['SMEMBERS', 'archq'])).length, 0);
});

test('archivio: la verifica fallita lascia la gara in sospeso', async () => {
  const bad = { ...memoryArchive(), saveRace: async () => ({ ok: false, counts: {} }) };
  const { api, clock } = setupArchive({}, bad);
  const r = await finishedRace(api, clock);
  assert.equal((await api('POST', `/api/admin/races/${r.id}/end`, {}, ADMIN)).json.race.archive, 'pending');
});

test('archivio disattivato: comportamento di prima (scadenza 24 ore)', async () => {
  const { api, clock, store } = setupArchive({}, { kind: 'none', enabled: false });
  const r = await finishedRace(api, clock);
  assert.equal((await api('POST', `/api/admin/races/${r.id}/end`, {}, ADMIN)).json.race.archive, 'off');
  assert.ok((await store.cmd(['TTL', `race:${r.id}`])) <= 86400);
});

test('cron: chiude le gare dimenticate, riprova le archiviazioni e cancella i report scaduti', async () => {
  let down = true;
  const real = memoryArchive();
  const flaky = { ...real, saveRace: async (s) => { if (down) throw new Error('giù'); return real.saveRace(s); } };
  const { api, clock } = setupArchive({}, flaky);
  assert.equal((await api('GET', '/api/cron/archive', null, {})).status, 401);
  assert.equal((await api('GET', '/api/cron/archive', null, { authorization: 'Bearer no' })).status, 401);
  const dim = await race(api);                                          // gara avviata e dimenticata
  await api('POST', `/api/admin/races/${dim.id}/start`, {}, ADMIN);
  const fin = await finishedRace(api, clock);
  await api('POST', `/api/admin/races/${fin.id}/end`, {}, ADMIN);       // archiviazione in sospeso (Neon giù)
  clock.advance(37 * 3600000);
  down = false;
  const out = await api('GET', '/api/cron/archive', null, { authorization: 'Bearer cron' });
  assert.equal(out.status, 200);
  assert.equal(out.json.autoEnded, 1);
  assert.ok(out.json.archived >= 1);
  assert.ok(await real.getRace(dim.id) && await real.getRace(fin.id));
  clock.advance(4 * 86400000);
  assert.equal((await api('GET', '/api/cron/archive', null, { authorization: 'Bearer cron' })).json.purged, 2);
  assert.equal(await real.getRace(fin.id), null);
});

test('report: link firmato, leggibile finché l\'archivio lo conserva, senza traccia né account', async () => {
  const { api, clock, store } = setupArchive();
  const r = await finishedRace(api, clock);
  const m = JSON.parse(await store.cmd(['GET', `race:${r.id}`]));
  m.accountId = 'acc1';
  await store.cmd(['SET', `race:${r.id}`, JSON.stringify(m), 'EX', 100000]);
  assert.equal((await api('GET', `/api/admin/races/${r.id}`, null, ADMIN)).json.race.reportPath, null, 'niente report prima della fine');
  const end = await api('POST', `/api/admin/races/${r.id}/end`, {}, ADMIN);
  const path = end.json.race.reportPath;
  assert.match(path, /^\/report#/);
  const live = await api('GET', '/api/live', null, {}, { t: r.view });
  assert.equal(live.json.race.reportPath, path, 'anche chi guarda trova il collegamento al report');
  const t = path.split('#')[1];
  const rep = await api('GET', '/api/report', null, {}, { t });
  assert.equal(rep.status, 200);
  assert.equal(rep.json.participants[0].name, 'Anna');
  assert.ok(rep.json.meta.gain > 0);
  assert.ok(!('course' in rep.json) && !('accountId' in rep.json));
  assert.ok(!/"lat"|"lon"/.test(JSON.stringify(rep.json)));
  assert.equal((await api('GET', '/api/report', null, {}, { t: t.slice(0, -1) + 'x' })).status, 401);
  assert.equal((await api('GET', '/api/report', null, {}, { t: 'x.y' })).status, 401);
  assert.equal((await api('GET', '/api/report', null, {}, {})).status, 401);
  assert.equal((await api('GET', '/api/report', null, {}, { t: `altra.${t.split('.')[1]}` })).status, 404, 'gara inesistente');
  const id = t.split('.')[0];
  assert.equal((await api('GET', '/api/report', null, {}, { t: `${id}.${'0'.repeat(32)}` })).status, 401, 'la firma vale solo per la propria gara');
});

test('report: scade con l\'archivio (3 giorni senza profilo)', async () => {
  const { api, clock } = setupArchive();
  const r = await finishedRace(api, clock);
  const t = (await api('POST', `/api/admin/races/${r.id}/end`, {}, ADMIN)).json.race.reportPath.split('#')[1];
  clock.advance(2 * 86400000);
  assert.equal((await api('GET', '/api/report', null, {}, { t })).status, 200);
  clock.advance(2 * 86400000);
  assert.equal((await api('GET', '/api/report', null, {}, { t })).status, 410);
});

test('gara di esempio: dati simulati coerenti, senza credenziali né scritture', async () => {
  const { api, store } = setup();
  const c = await api('GET', '/api/demo/course');
  assert.equal(c.status, 200);
  assert.ok(c.json.course.totalKm > 35 && c.json.checkpoints.length === 4);
  const live = await api('GET', '/api/demo/live');
  assert.equal(live.json.participants.length, 3);
  assert.ok(live.json.participants.every((p) => p.last && typeof p.distKm === 'number'));
  const st = await api('GET', '/api/demo/stats');
  assert.equal(st.json.participants.length, 3);
  assert.equal((await store.cmd(['SMEMBERS', 'races'])).length, 0, 'la demo non crea nulla nell\'archivio');
});

test('input malformati: 400 e non 500', async () => {
  const { api } = setup();
  const r = await race(api);
  assert.equal((await send(api, r.dev, [null])).status, 400);
  assert.equal((await send(api, r.dev, ['x'])).status, 400);
  const bad = await api('POST', '/api/admin/races', { name: 'x', course: { points: COURSE }, checkpoints: [null] }, ADMIN);
  assert.equal(bad.status, 400);
  const pa = await api('POST', `/api/admin/races/${r.id}/passage`, { checkpointId: 'c1', participantId: r.pid, t: 'ieri' }, ADMIN);
  assert.equal(pa.status, 400);
});

test('report: senza REPORT_SECRET dedicato i report sono disattivati (non usa la chiave admin)', async () => {
  const store = createStore({});
  const h = createHandler({ store, env: { ADMIN_KEY: 'segreto' } });
  const r = await h({ method: 'GET', path: '/api/report', headers: {}, query: { t: 'x.y' }, origin: 'https://x.test' });
  assert.equal(r.status, 401);
});

test('link di chi segue: 15 giorni se la gara non parte, 7 dall\'avvio, 24 ore dopo la fine', async () => {
  const D = 86400000;
  const live = (api, r) => api('GET', '/api/live', null, {}, { t: r.view }).then((x) => x.status);
  // non avviata: vale 15 giorni dalla creazione
  { const { api, clock } = setup(); const r = await race(api);
    clock.advance(14 * D); assert.equal(await live(api, r), 200);
    clock.advance(2 * D); assert.equal(await live(api, r), 401, 'dopo 16 giorni è scaduto'); }
  // avviata e dimenticata: 7 giorni dall'avvio (anche se creata 10 giorni prima)
  { const { api, clock } = setup(); const r = await race(api);
    clock.advance(10 * D);
    await api('POST', `/api/admin/races/${r.id}/start`, {}, ADMIN);
    clock.advance(6 * D); assert.equal(await live(api, r), 200);
    clock.advance(2 * D); assert.equal(await live(api, r), 401, 'dopo 8 giorni dall\'avvio è scaduto'); }
  // conclusa: 24 ore dopo la fine
  { const { api, clock } = setup(); const r = await race(api);
    await api('POST', `/api/admin/races/${r.id}/start`, {}, ADMIN);
    clock.advance(3 * 3600000);
    await api('POST', `/api/admin/races/${r.id}/end`, {}, ADMIN);
    clock.advance(23 * 3600000); assert.equal(await live(api, r), 200);
    clock.advance(2 * 3600000); assert.notEqual(await live(api, r), 200, 'dopo 25 ore dalla fine è scaduto'); }
});

test('stima d\'arrivo: sospesa dopo 3 minuti senza segnale, torna con il segnale', async () => {
  const { api, clock } = setup();
  const r = await race(api);
  await api('POST', `/api/admin/races/${r.id}/start`, {}, ADMIN);
  const t0 = clock.now();
  const pts = Array.from({ length: 21 }, (_, i) => pt(t0 + i * 60000, i * 0.2));
  clock.advance(21 * 60000);
  await send(api, r.dev, pts);
  const st = async () => (await api('GET', '/api/stats', null, {}, { t: r.view })).json.participants[0].stats;
  assert.ok((await st()).etaAt, 'con segnale recente la stima c\'è');
  clock.advance(4 * 60000);
  const s = await st();
  assert.equal(s.etaAt, null); assert.equal(s.etaSuspended, true); assert.ok(s.signalAgeSec >= 240);
  await send(api, r.dev, [pt(clock.now(), 4.2)]);
  assert.ok((await st()).etaAt, 'col segnale la stima ritorna');
});

test('invio: un punto troppo vecchio non fa rifiutare gli altri; due invii insieme non si sovrappongono', async () => {
  const { api, clock, store } = setup();
  const r = await race(api);
  const n = clock.now();
  const res = await send(api, r.dev, [pt(n - 25 * 3600000, 0.1), pt(n, 0.2)]);
  assert.equal(res.status, 200); assert.equal(res.json.accepted, 1); assert.equal(res.json.rejected, 1);
  const k = (await store.cmd(['SMEMBERS', 'races']))[0];
  await store.cmd(['SET', `lock:${k}:${r.pid}`, '1', 'NX', 'EX', 15]);   // un altro invio è in corso
  assert.equal((await send(api, r.dev, [pt(n + 1000, 0.3)])).status, 429);
});

test('cancellazione: eliminare la gara cancella anche l\'archivio e il link al report', async () => {
  const { api, clock, archive } = setupArchive();
  const r = await finishedRace(api, clock);
  const end = await api('POST', `/api/admin/races/${r.id}/end`, {}, ADMIN);
  const t = end.json.race.reportPath.split('#')[1];
  assert.equal((await api('GET', '/api/report', null, {}, { t })).status, 200);
  assert.equal((await api('DELETE', `/api/admin/races/${r.id}`, null, ADMIN)).status, 200);
  assert.equal(await archive.getRace(r.id), null);
  assert.equal((await api('GET', '/api/report', null, {}, { t })).status, 404);
});

test('cancellazione: l\'organizzatore toglie un corridore anche dall\'archivio', async () => {
  const { api, clock, archive } = setupArchive();
  const r = await finishedRace(api, clock);
  await api('POST', `/api/admin/races/${r.id}/end`, {}, ADMIN);
  assert.equal((await archive.getRace(r.id)).participants.length, 1);
  assert.equal((await api('DELETE', `/api/admin/races/${r.id}/participants/${r.pid}`, null, ADMIN)).status, 200);
  assert.equal((await archive.getRace(r.id)).participants.length, 0);
});

test('report: nuovo link, il vecchio smette di funzionare', async () => {
  const { api, clock } = setupArchive();
  const r = await finishedRace(api, clock);
  const old = (await api('POST', `/api/admin/races/${r.id}/end`, {}, ADMIN)).json.race.reportPath.split('#')[1];
  const nuovo = (await api('POST', `/api/admin/races/${r.id}/report`, {}, ADMIN)).json.reportPath.split('#')[1];
  assert.notEqual(old, nuovo);
  assert.equal((await api('GET', '/api/report', null, {}, { t: old })).status, 401);
  assert.equal((await api('GET', '/api/report', null, {}, { t: nuovo })).status, 200);
});

test('diritti del corridore: vede i propri dati e li cancella con il proprio codice', async () => {
  const { api, clock } = setupArchive();
  const r = await race(api);
  await api('POST', `/api/admin/races/${r.id}/start`, {}, ADMIN);
  await api('POST', '/api/device/positions', { points: [pt(clock.now(), 0.1)] }, { authorization: `Bearer ${r.dev}` });
  const auth = { authorization: `Bearer ${r.dev}` };
  const me = await api('GET', '/api/device/me', null, auth);
  assert.equal(me.status, 200); assert.equal(me.json.name, 'Anna'); assert.equal(me.json.points, 1);
  assert.equal((await api('GET', '/api/device/me', null, { authorization: 'Bearer sbagliato-sbagliato-sbagliato' })).status, 401);
  assert.equal((await api('DELETE', '/api/device/me', null, auth)).status, 200);
  assert.equal((await api('GET', '/api/device/me', null, auth)).status, 401, 'il codice non vale più');
  const live = await api('GET', '/api/live', null, {}, { t: r.view });
  assert.equal(live.json.participants.length, 0);
});

test('limiti: tentativi con credenziali sbagliate e troppe richieste dalla stessa rete', async () => {
  const { api } = setup();
  let last;
  for (let i = 0; i < 25; i++) last = await api('GET', '/api/live', null, {}, { t: 'x'.repeat(30) });
  assert.equal(last.status, 429, 'dopo una ventina di accessi sbagliati la rete viene fermata');
  const { api: api2 } = setup();
  const r = await race(api2);
  let st = 0;
  for (let i = 0; i < 125; i++) st = (await api2('GET', '/api/live', null, {}, { t: r.view })).status;
  assert.equal(st, 429, 'oltre 120 richieste al minuto da una rete');
  const { api: api3, clock } = setup();
  const r3 = await race(api3);
  assert.equal((await api3('GET', '/api/live', null, {}, { t: r3.view })).status, 200);
  clock.advance(61000);
  assert.equal((await api3('GET', '/api/live', null, {}, { t: r3.view })).status, 200, 'il limite si azzera dopo un minuto');
});

test('cache: parametri in più sono ignorati e l\'intestazione del token non è accettata', async () => {
  const { api } = setup();
  const r = await race(api);
  assert.equal((await api('GET', '/api/live', null, {}, { t: r.view, x: '1' })).status, 200, 'i parametri aggiunti dall\'hosting non devono rompere il link');
  assert.equal((await api('GET', '/api/live', null, { 'x-view-token': r.view })).status, 401);
});

test('consenso: senza il gesto del corridore le posizioni non vengono accettate e non valgono punti precedenti', async () => {
  const { api, clock } = setup();
  const r = await race(api, { noConsent: true });
  const auth = { authorization: `Bearer ${r.dev}` };
  assert.equal((await send(api, r.dev, [pt(clock.now(), 0.1)])).status, 403);
  assert.equal((await api('POST', '/api/device/consent', { accept: true }, auth)).status, 400, 'serve anche la conferma dell\'età');
  assert.equal((await api('POST', '/api/device/consent', {}, auth)).status, 400);
  const before = clock.now();
  clock.advance(60000);
  assert.equal((await api('POST', '/api/device/consent', { accept: true, ageOk: true }, auth)).status, 200);
  const res = await send(api, r.dev, [pt(before, 0.1), pt(clock.now() + 1000, 0.2)]);
  assert.equal(res.status, 200); assert.equal(res.json.accepted, 1, 'il punto precedente al consenso è scartato');
  const me = (await api('GET', '/api/device/me', null, auth)).json;
  assert.equal(me.consent, true);
});

test('consenso: data e versione vanno nell\'archivio ma non nel report pubblico', async () => {
  const { api, clock, archive } = setupArchive();
  const r = await finishedRace(api, clock);
  const end = await api('POST', `/api/admin/races/${r.id}/end`, {}, ADMIN);
  const s = await archive.getRace(r.id);
  assert.ok(s.participants[0].consentAt > 0); assert.equal(s.participants[0].consentVersion, '1');
  const rep = await api('GET', '/api/report', null, {}, { t: end.json.race.reportPath.split('#')[1] });
  assert.equal(rep.json.participants[0].consentAt, undefined);
});

test('app di tracciamento: OsmAnd/Traccar, OwnTracks e GPSLogger passano dallo stesso ingest', async () => {
  const { api, clock } = setup();
  const r = await race(api);
  await api('POST', `/api/admin/races/${r.id}/start`, {}, ADMIN);
  const sec = (ms) => Math.floor(ms / 1000);
  const lat = (km) => String(at(km)[0]);
  // OsmAnd / Traccar Client: parametri nell'indirizzo, id = codice del corridore, orario in secondi
  clock.advance(60000);
  assert.equal((await api('GET', '/api/device/osmand', null, {}, { id: r.dev, lat: lat(0.1), lon: '8', timestamp: String(sec(clock.now())), altitude: '1000', accuracy: '5' })).status, 200);
  // OwnTracks: JSON con _type location
  clock.advance(60000);
  assert.deepEqual((await api('POST', '/api/device/owntracks', { _type: 'location', lat: at(0.3)[0], lon: 8, tst: sec(clock.now()), acc: 6, alt: 1000 }, {}, { token: r.dev })).json, []);
  // GPSLogger: orario ISO
  clock.advance(60000);
  assert.equal((await api('GET', '/api/device/gpslogger', null, {}, { token: r.dev, lat: lat(0.5), lon: '8', time: new Date(clock.now()).toISOString(), acc: '7' })).status, 200);
  const me = (await api('GET', '/api/device/me', null, { authorization: `Bearer ${r.dev}` })).json;
  assert.equal(me.points, 3);
  // codice sbagliato
  assert.equal((await api('GET', '/api/device/osmand', null, {}, { id: 'sbagliato-sbagliato-sbagliato', lat: '46', lon: '8' })).status, 401);
});

test('app di tracciamento: senza consenso del corridore nessuna posizione, anche da altre app', async () => {
  const { api, clock } = setup();
  const r = await race(api, { noConsent: true });
  assert.equal((await api('GET', '/api/device/osmand', null, {}, { id: r.dev, lat: lat46(), lon: '8', timestamp: String(Math.floor(clock.now() / 1000)) })).status, 403);
});
const lat46 = () => '46.001';

test('API v1: gli stessi percorsi con il prefisso /api/v1', async () => {
  const { api } = setup();
  const r = await race(api);
  assert.equal((await api('GET', '/api/v1/live', null, {}, { t: r.view })).status, 200);
  assert.equal((await api('GET', '/api/v1/health')).status, 200);
});

test('iscrizione autonoma: il corridore si iscrive con il link, dà il consenso e riceve il suo codice', async () => {
  const { api, clock } = setup();
  const r = await race(api);
  const en = await api('POST', `/api/admin/races/${r.id}/enroll`, {}, ADMIN);
  assert.equal(en.status, 200); assert.match(en.json.path, /^\/iscriviti#/);
  const t = en.json.token;
  const join = (extra = {}) => api('POST', '/api/enroll', { t, name: 'Giulia', accept: true, ageOk: true, ...extra });
  assert.equal((await join({ accept: false })).status, 400, 'senza consenso non ci si iscrive');
  const ok = await join();
  assert.equal(ok.status, 200); assert.equal(ok.json.raceName, 'Trail di prova'); assert.ok(ok.json.deviceToken && ok.json.pairing);
  // il codice funziona subito: il consenso è già dato
  clock.advance(1000);
  assert.equal((await send(api, ok.json.deviceToken, [pt(clock.now(), 0.1)])).status, 200);
  assert.equal((await api('POST', '/api/enroll', { t: 'x'.repeat(30), name: 'A', accept: true, ageOk: true })).status, 401);
  // il link si rigenera: il vecchio non vale più
  const en2 = await api('POST', `/api/admin/races/${r.id}/enroll`, {}, ADMIN);
  assert.equal((await join({ name: 'Marco' })).status, 401);
  assert.equal((await api('POST', '/api/enroll', { t: en2.json.token, name: 'Marco', accept: true, ageOk: true })).status, 200);
  // alla partenza le iscrizioni si chiudono
  await api('POST', `/api/admin/races/${r.id}/start`, {}, ADMIN);
  assert.equal((await api('POST', '/api/enroll', { t: en2.json.token, name: 'Tardi', accept: true, ageOk: true })).status, 410);
  const list = (await api('GET', `/api/admin/races/${r.id}`, null, ADMIN)).json.race.participants;
  assert.deepEqual(list.map((p) => p.name).sort(), ['Anna', 'Giulia', 'Marco']);
  assert.equal(new Set(list.map((p) => p.color)).size, 3, 'ognuno ha il suo colore');
});

test('iscrizione autonoma: tetto rispettato e link disattivabile', async () => {
  const { api } = setup();
  const r = await race(api);
  const t = (await api('POST', `/api/admin/races/${r.id}/enroll`, {}, ADMIN)).json.token;
  let last;
  for (let i = 0; i < 19; i++) last = await api('POST', '/api/enroll', { t, name: 'C' + i, accept: true, ageOk: true });
  assert.equal(last.status, 200);   // con Anna sono 20
  assert.equal((await api('POST', '/api/enroll', { t, name: 'Extra', accept: true, ageOk: true })).status, 400, 'gara al completo');
  assert.equal((await api('DELETE', `/api/admin/races/${r.id}/enroll`, null, ADMIN)).status, 200);
  assert.equal((await api('POST', '/api/enroll', { t, name: 'Dopo', accept: true, ageOk: true })).status, 401);
});

test('limiti: le app dei corridori hanno un limite per rete più largo (stessa rete alla partenza)', async () => {
  const { api } = setup();
  const r = await race(api);
  let st = 0;
  for (let i = 0; i < 150; i++) st = (await api('GET', '/api/device/me', null, { authorization: `Bearer ${r.dev}` })).status;
  assert.equal(st, 200, '150 richieste di corridori dalla stessa rete non vengono fermate');
});
