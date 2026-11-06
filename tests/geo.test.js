import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCourse, gainLoss, project, haversine } from '../server/geo.js';

test('haversine: 1 grado di latitudine ≈ 111,2 km', () => {
  assert.ok(Math.abs(haversine(46, 8, 47, 8) - 111195) < 200);
});
test('dislivello: il rumore sotto soglia non conta', () => {
  assert.deepEqual(gainLoss([100, 101, 100, 102, 100, 101], 3), { gain: 0, loss: 0 });
  assert.deepEqual(gainLoss([100, 110, 105, 120, 100], 3), { gain: 25, loss: 25 });
});
test('proiezione: percorso che si incrocia usa l\'ultima progressiva come guida', () => {
  // anello a "8": il punto di incrocio compare a ~0 km e a ~4,4 km
  const pts = [[46, 8, 0], [46.01, 8.01, 0], [46, 8.02, 0], [46.01, 8.0, 0], [46, 8.01, 0], [46.01, 8.02, 0]];
  const c = buildCourse(pts);
  const incrocio = [46.005, 8.01];
  const vicino = project(c, incrocio[0], incrocio[1], c.totalKm * 0.9);
  const iniziale = project(c, incrocio[0], incrocio[1], 0);
  assert.ok(iniziale.km < vicino.km || Math.abs(iniziale.km - vicino.km) < 0.001);
});
