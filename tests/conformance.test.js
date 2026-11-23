// Suite di conformità: le stesse verifiche valgono per OGNI implementazione di `repo` (dati live) e di `archive`.
// Per provare un nuovo database basta aggiungere la sua fabbrica in `repos` / `archives`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/store.js';
import { createRepo } from '../server/repo.js';
import { memoryArchive } from '../server/archive.js';

const repos = {
  memoria: () => { let t = 1e12; const clock = { now: () => t, advance: (ms) => { t += ms; } }; return { clock, repo: createRepo(createStore({}, clock.now), { safetyTtl: 3 * 86400, maxHistory: 5 }) }; },
  // Upstash reale: UPSTASH_REDIS_REST_URL / TOKEN (solo su richiesta, con prefisso proprio)
};
const archives = {
  memoria: () => memoryArchive(),
  // Neon reale: DATABASE_URL (solo su richiesta, su un database di prova)
};

for (const [name, make] of Object.entries(repos)) {
  test(`repo [${name}]: gara, credenziali e cancellazione`, async () => {
    const { repo } = make();
    const m = { id: 'g1', name: 'x', orgHash: 'oh', viewHash: null, participants: [{ id: 'p1', deviceHash: 'dh' }] };
    await repo.saveRace(m, 100);
    await repo.initRace(m, { totalKm: 1 }, 100);
    assert.equal((await repo.getRace('g1')).name, 'x');
    assert.deepEqual(await repo.activeRaceIds(), ['g1']);
    assert.equal(await repo.raceIdByOrg('oh'), 'g1');
    assert.deepEqual(await repo.getCourse('g1'), { totalKm: 1 });
    await repo.putDevice('dh', { raceId: 'g1', pid: 'p1' }, 100);
    assert.deepEqual(await repo.deviceRef('dh'), { raceId: 'g1', pid: 'p1' });
    await repo.setViewLink('g1', 'v1', null, 100);
    assert.equal(await repo.raceIdByView('v1'), 'g1');
    await repo.setViewLink('g1', 'v2', 'v1', 100);
    assert.equal(await repo.raceIdByView('v1'), null, 'il vecchio link cade');
    await repo.replaceDevice('dh2', { raceId: 'g1', pid: 'p1' }, 'dh', 100);
    assert.equal(await repo.deviceRef('dh'), null);
    m.viewHash = 'v2'; m.participants[0].deviceHash = 'dh2';
    await repo.deleteRace(m);
    assert.equal(await repo.getRace('g1'), null);
    assert.deepEqual(await repo.activeRaceIds(), []);
    assert.equal(await repo.raceIdByView('v2'), null);
    assert.equal(await repo.deviceRef('dh2'), null);
  });

  test(`repo [${name}]: invio dei punti, storico limitato, passaggi e cancellazione di un corridore`, async () => {
    const { repo } = make();
    for (let i = 0; i < 3; i++) await repo.commitIngest('g1', 'p1', { rec: { t: i, n: i + 1 }, rows: [`r${i}a`, `r${i}b`], passSet: [[`c1:p1`, '5']], detSet: [['c2:p1', '1:5']] });
    const data = await repo.readRace('g1', ['p1']);
    assert.equal(data.rows[0].length, 5, 'lo storico resta entro il limite');
    assert.equal(data.rows[0].at(-1), 'r2b');
    assert.equal(data.pass['c1:p1'], '5');
    assert.equal(data.last.p1.n, 3);
    assert.equal((await repo.getLast('g1', 'p1')).t, 2);
    const pd = await repo.getPassDet('g1');
    assert.equal(pd.det['c2:p1'], '1:5');
    await repo.commitIngest('g1', 'p1', { rec: { t: 3 }, rows: [], detDel: ['c2:p1'] });
    assert.equal((await repo.getPassDet('g1')).det['c2:p1'], undefined);
    await repo.deleteParticipant('g1', { id: 'p1', deviceHash: 'x' });
    assert.equal(await repo.getLast('g1', 'p1'), null);
    assert.deepEqual((await repo.readRace('g1', ['p1'])).rows[0], []);
  });

  test(`repo [${name}]: contatori, penalità e blocchi`, async () => {
    const { repo, clock } = make();
    assert.equal(await repo.count('k', 10), 1);
    assert.equal(await repo.count('k', 10), 2);
    assert.equal(await repo.hit('h', 10), 1);
    assert.equal(await repo.penalize('h', 5), 6);
    clock.advance(11000);
    assert.equal(await repo.hit('h', 10), 1, 'il contatore scade');
    assert.equal(await repo.tryLock('l', 15), true);
    assert.equal(await repo.tryLock('l', 15), false);
    await repo.unlock('l');
    assert.equal(await repo.tryLock('l', 15), true);
    clock.advance(16000);
    assert.equal(await repo.tryLock('l', 15), true, 'il blocco scade da solo');
  });
}

for (const [name, make] of Object.entries(archives)) {
  const summary = (extra = {}) => ({ id: 'g1', name: 'Gara', accountId: null, startedAt: 1000, endedAt: 5000, totalKm: 10, course: null, meta: null, expiresAt: 9000, reportSalt: 's1',
    checkpoints: [{ idx: 0, name: 'R1', km: 5, radius: 50 }],
    participants: [{ id: 'p1', name: 'Anna', color: '#fff', stats: { distKm: 10 }, passages: [{ cp: 0, t: 3000 }], consentAt: 900, consentVersion: '1' },
      { id: 'p2', name: 'Luca', color: '#000', stats: null, passages: [], consentAt: 901, consentVersion: '1' }], ...extra });

  test(`archive [${name}]: salvataggio ripetibile, lettura e cancellazioni`, async () => {
    const a = make();
    const r1 = await a.saveRace(summary()); assert.equal(r1.ok, true);
    const r2 = await a.saveRace(summary()); assert.equal(r2.ok, true, 'ripetere non crea duplicati');
    const got = await a.getRace('g1');
    assert.equal(got.participants.length, 2); assert.equal(got.participants[0].passages.length, 1); assert.equal(got.reportSalt, 's1');
    assert.equal(await a.setReportSalt('g1', 's2'), 1);
    assert.equal((await a.getRace('g1')).reportSalt, 's2');
    assert.equal(await a.deleteParticipant('g1', 'p2'), 1);
    assert.equal((await a.getRace('g1')).participants.length, 1);
    assert.equal(await a.purgeExpired(10000), 1, 'i report scaduti si cancellano');
    assert.equal(await a.getRace('g1'), null);
    await a.saveRace(summary());
    assert.equal(await a.deleteRace('g1'), 1);
    assert.equal(await a.getRace('g1'), null);
  });
}
