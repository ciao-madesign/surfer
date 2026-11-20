import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, fmtDur, fmtPace } from '../public/js/report-calc.js';

const T0 = Date.parse('2026-11-14T08:00:00Z');
const run = (id, name, passMin, finishSec, dist = 10) => ({
  id, name, color: '#fff',
  stats: { distKm: dist, elapsedSec: finishSec, gain: 100, loss: 90, avgPaceSecKm: 400, paceByGrade: {} },
  passages: passMin.map((m, i) => (m == null ? null : { cp: i, t: T0 + m * 60000 })).filter(Boolean),
});
const race = {
  startedAt: T0, totalKm: 10, checkpoints: [{ idx: 0, name: 'Ristoro', km: 4 }, { idx: 1, name: 'Colle', km: 7 }],
  participants: [run('a', 'Anna', [30, 55], 4200), run('b', 'Bruno', [28, 58], 4000), run('c', 'Carla', [35, null], 3000, 6)],
};

test('settori: tempi, passo e distacchi dal migliore', () => {
  const r = buildReport(race);
  assert.deepEqual(r.sectors.map((s) => [s.from, s.to, s.km]), [['Partenza', 'Ristoro', 4], ['Ristoro', 'Colle', 3], ['Colle', 'Arrivo', 3]]);
  const [a, b] = [r.rows[0], r.rows[1]];
  assert.equal(a.cells[0].sec, 1800);
  assert.equal(b.cells[0].sec, 1680);
  assert.equal(b.cells[0].best, true);
  assert.equal(a.cells[0].best, false);
  assert.equal(a.cells[0].deltaSec, 120);
  assert.equal(a.cells[1].sec, 1500);            // Anna è più veloce nel settore centrale
  assert.equal(a.cells[1].best, true);
  assert.equal(a.cells[2].sec, 4200 - 55 * 60);
  assert.ok(Math.abs(a.cells[0].paceSecKm - 450) < 1e-9);
});

test('classifica: arrivati per tempo, poi gli altri per distanza; distacco dal primo', () => {
  const r = buildReport(race);
  assert.deepEqual(r.ranking.map((x) => x.name), ['Bruno', 'Anna', 'Carla']);
  assert.equal(r.ranking[1].gapSec, 200);
  assert.equal(r.ranking[2].finished, false);
  assert.equal(r.ranking[2].gapSec, null);
});

test('dati mancanti: nessun settore inventato e nessun "migliore" senza confronto', () => {
  const r = buildReport(race);
  const carla = r.rows[2];
  assert.ok(carla.cells[0]);                     // partenza → ristoro noto
  assert.equal(carla.cells[1], null);            // checkpoint mancante
  assert.equal(carla.cells[2], null);            // non arrivata
  const solo = buildReport({ ...race, participants: [race.participants[0]] });
  assert.ok(solo.rows[0].cells.every((c) => !c || !c.best));
  assert.equal(solo.comparable, false);
});

test('formati', () => {
  assert.equal(fmtDur(4200), '1:10:00');
  assert.equal(fmtDur(75), '1:15');
  assert.equal(fmtPace(405), '6:45');
  assert.equal(fmtDur(null), '–');
});
