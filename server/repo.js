// Accesso ai dati in tempo reale (gare, posizioni, link, contatori). È l'UNICO file che conosce i comandi Redis:
// l'handler parla solo con questi metodi. Per cambiare database dei dati live basta riscrivere questo file
// (o l'oggetto `store` che riceve) e far passare i test di tests/repo.test.js.
import { getJSON } from './store.js';

const toObj = (flat) => { const o = {}; for (let i = 0; i < (flat || []).length; i += 2) o[flat[i]] = flat[i + 1]; return o; };
const parseAll = (flat) => { const o = toObj(flat); for (const key of Object.keys(o)) o[key] = JSON.parse(o[key]); return o; };

export function createRepo(store, { safetyTtl, maxHistory }) {
  const k = {
    race: (id) => `race:${id}`, course: (id) => `course:${id}`, last: (id) => `last:${id}`,
    pos: (id, p) => `pos:${id}:${p}`, pass: (id) => `pass:${id}`, det: (id) => `det:${id}`,
    view: (h) => `v:${h}`, dev: (h) => `d:${h}`, org: (h) => `o:${h}`,
  };
  const allKeys = (m) => {
    const keys = [k.race(m.id), k.course(m.id), k.last(m.id), k.pass(m.id), k.det(m.id)];
    for (const p of m.participants) keys.push(k.pos(m.id, p.id), k.dev(p.deviceHash));
    if (m.viewHash) keys.push(k.view(m.viewHash));
    if (m.orgHash) keys.push(k.org(m.orgHash));
    return keys;
  };

  return {
    kind: store.kind,

    // ----- gare -----
    getRace: (id) => getJSON(store, k.race(id)),
    saveRace: (m, ttl) => store.cmd(['SET', k.race(m.id), JSON.stringify(m), 'EX', ttl]),
    getCourse: (id) => getJSON(store, k.course(id)),
    // prima scrittura di una gara: elenco delle attive, traccia e link dell'organizzatore
    async initRace(m, course, ttl) {
      const ops = [['SADD', 'races', m.id]];
      if (course) ops.push(['SET', k.course(m.id), JSON.stringify(course), 'EX', ttl]);
      if (m.orgHash) ops.push(['SET', k.org(m.orgHash), m.id, 'EX', ttl]);
      await store.pipeline(ops);
    },
    activeRaceIds: () => store.cmd(['SMEMBERS', 'races']),
    dropActive: (id) => store.cmd(['SREM', 'races', id]),
    archiveQueue: () => store.cmd(['SMEMBERS', 'archq']),
    queueArchive: (id, pending) => store.cmd([pending ? 'SADD' : 'SREM', 'archq', id]),
    // cancella ogni dato live di una gara
    deleteRace: (m) => store.pipeline([...allKeys(m).map((key) => ['DEL', key]), ['SREM', 'races', m.id], ['SREM', 'archq', m.id]]),
    expireRace: (m, secs) => store.pipeline(allKeys(m).map((key) => ['EXPIRE', key, secs])),

    // ----- credenziali (si salvano solo gli hash) -----
    raceIdByOrg: (hash) => store.cmd(['GET', k.org(hash)]),
    raceIdByView: (hash) => store.cmd(['GET', k.view(hash)]),
    deviceRef: (hash) => getJSON(store, k.dev(hash)),
    putDevice: (hash, ref, ttl) => store.cmd(['SET', k.dev(hash), JSON.stringify(ref), 'EX', ttl]),
    replaceDevice: (newHash, ref, oldHash, ttl) =>
      store.pipeline([['SET', k.dev(newHash), JSON.stringify(ref), 'EX', ttl], ['DEL', k.dev(oldHash)]]),
    // nuovo link di visualizzazione: il precedente (se c'è) smette di funzionare
    setViewLink: (raceId, hash, oldHash, ttl) =>
      store.pipeline([['SET', k.view(hash), raceId, 'EX', ttl], ...(oldHash ? [['DEL', k.view(oldHash)]] : [])]),
    delView: (hash) => store.cmd(['DEL', k.view(hash)]),
    expireView: (hash, secs) => store.cmd(['EXPIRE', k.view(hash), secs]),

    // ----- posizioni e stato dei corridori -----
    async getLast(raceId, pid) { const v = await store.cmd(['HGET', k.last(raceId), pid]); return v ? JSON.parse(v) : null; },
    async getAllLast(raceId) { return parseAll(await store.cmd(['HGETALL', k.last(raceId)])); },
    deleteParticipant: (raceId, p) =>
      store.pipeline([['DEL', k.dev(p.deviceHash)], ['DEL', k.pos(raceId, p.id)], ['HDEL', k.last(raceId), p.id]]),
    // passaggi ai checkpoint e rilevazioni in corso
    async getPassDet(raceId) {
      const [pa, de] = await store.pipeline([['HGETALL', k.pass(raceId)], ['HGETALL', k.det(raceId)]]);
      return { pass: toObj(pa), det: toObj(de) };
    },
    async setPassage(raceId, key, t) {
      await store.cmd(['HSET', k.pass(raceId), key, String(t)]);
      await store.cmd(['EXPIRE', k.pass(raceId), safetyTtl]);
    },
    // lettura per statistiche e riepilogo: passaggi, righe di posizione per corridore, ultimi punti
    async readRace(raceId, pids) {
      const r = await store.pipeline([['HGETALL', k.pass(raceId)], ...pids.map((p) => ['LRANGE', k.pos(raceId, p), 0, -1]), ['HGETALL', k.last(raceId)]]);
      return { pass: toObj(r[0]), rows: pids.map((_, i) => r[i + 1]), last: parseAll(r[pids.length + 1]) };
    },
    // scrittura di un invio: ultimo punto, nuove righe (storico limitato), passaggi e rilevazioni
    async commitIngest(raceId, pid, { rec, rows, passSet = [], detSet = [], detDel = [] }) {
      const ops = [['HSET', k.last(raceId), pid, JSON.stringify(rec)], ['EXPIRE', k.last(raceId), safetyTtl]];
      for (const [key, v] of passSet) ops.push(['HSET', k.pass(raceId), key, v]);
      for (const [key, v] of detSet) ops.push(['HSET', k.det(raceId), key, v]);
      for (const key of detDel) ops.push(['HDEL', k.det(raceId), key]);
      if (rows.length) ops.push(['RPUSH', k.pos(raceId, pid), ...rows], ['LTRIM', k.pos(raceId, pid), -maxHistory, -1], ['EXPIRE', k.pos(raceId, pid), safetyTtl]);
      await store.pipeline(ops);
    },

    // ----- contatori e blocchi (anti-abuso) -----
    async count(key, ttl) { const [n] = await store.pipeline([['INCR', key], ['EXPIRE', key, ttl]]); return n; },
    async hit(key, ttl) { const n = await store.cmd(['INCR', key]); if (n === 1) await store.cmd(['EXPIRE', key, ttl]); return n; },
    penalize: (key, n) => store.cmd(['INCRBY', key, n]),
    async tryLock(key, ttl) { return !!(await store.cmd(['SET', key, '1', 'NX', 'EX', ttl])); },
    unlock: (key) => store.cmd(['DEL', key]),
  };
}
