// Archivio permanente di fine gara. Contiene SOLO: evento, checkpoint, tempi di passaggio, statistiche finali
// (e la traccia del percorso, ma solo per le gare di chi ha un profilo). Mai lo storico GPS dei corridori.
// Il resto del codice parla solo con questa interfaccia: per cambiare database basta riscrivere questo file.
//
//   saveRace(summary) -> { ok, counts }   scrittura atomica e ripetibile (nessun duplicato se si ripete)
//   getRace(id)       -> summary | null
//   purgeExpired(ms)  -> numero di gare eliminate
//
// summary = { id, name, accountId|null, startedAt, endedAt, totalKm, course|null, expiresAt|null,
//   checkpoints: [{ idx, name, km, radius }],
//   participants: [{ id, name, color, stats|null, passages: [{ cp, t }] }] }

const countsOf = (s) => ({
  checkpoints: s.checkpoints.length,
  participants: s.participants.length,
  passages: s.participants.reduce((n, p) => n + p.passages.length, 0),
});
const same = (a, b) => a.checkpoints === b.checkpoints && a.participants === b.participants && a.passages === b.passages;

// Nessun database configurato: l'archiviazione è disattivata (i dati scadono come prima, dopo 24 ore).
export const noArchive = () => ({ kind: 'none', enabled: false });

// In memoria: sviluppo locale e test.
export function memoryArchive() {
  const races = new Map();
  return {
    kind: 'memory', enabled: true, races,
    async saveRace(s) {
      races.set(s.id, structuredClone(s));
      const counts = countsOf(races.get(s.id));
      return { ok: same(counts, countsOf(s)), counts };
    },
    async getRace(id) { const r = races.get(id); return r ? structuredClone(r) : null; },
    async purgeExpired(ms) {
      let n = 0;
      for (const [id, r] of races) if (r.expiresAt != null && r.expiresAt < ms) { races.delete(id); n++; }
      return n;
    },
  };
}

// Neon (Postgres) via HTTPS: nessuna connessione persistente, adatto alle funzioni serverless.
export function neonArchive(databaseUrl) {
  let sqlPromise;
  const db = () => (sqlPromise ??= import('@neondatabase/serverless').then(({ neon }) => neon(databaseUrl)));
  const ts = (ms) => (ms == null ? null : new Date(ms).toISOString());
  const dbId = (raceId, pid) => `${raceId}:${pid}`;   // gli id dei partecipanti sono unici solo dentro la gara

  async function counts(sql, id) {
    const [r] = await sql.query(
      `SELECT (SELECT count(*)::int FROM checkpoints WHERE race_id = $1) AS checkpoints,
              (SELECT count(*)::int FROM participants WHERE race_id = $1) AS participants,
              (SELECT count(*)::int FROM passages WHERE race_id = $1) AS passages`, [id]);
    return r;
  }

  return {
    kind: 'neon', enabled: true,
    async saveRace(s) {
      const sql = await db();
      const ps = s.participants;
      const flat = ps.flatMap((p) => p.passages.map((x) => ({ pid: dbId(s.id, p.id), cp: x.cp, t: x.t })));
      // Una sola transazione: o si scrive tutto o niente. Ripetibile: prima si svuotano i figli della gara.
      await sql.transaction((tx) => [
        tx.query(
          `INSERT INTO races (id, account_id, name, status, course, total_km, started_at, ended_at, archived_at, expires_at, meta)
           VALUES ($1, $2, $3, 'ended', $4::jsonb, $5, $6, $7, now(), $8, $9::jsonb)
           ON CONFLICT (id) DO UPDATE SET account_id = EXCLUDED.account_id, name = EXCLUDED.name, status = 'ended',
             course = EXCLUDED.course, total_km = EXCLUDED.total_km, started_at = EXCLUDED.started_at,
             ended_at = EXCLUDED.ended_at, archived_at = now(), expires_at = EXCLUDED.expires_at, meta = EXCLUDED.meta`,
          [s.id, s.accountId ?? null, s.name, s.course ? JSON.stringify(s.course) : null, s.totalKm ?? null,
            ts(s.startedAt), ts(s.endedAt), ts(s.expiresAt), s.meta ? JSON.stringify(s.meta) : null]),
        tx.query('DELETE FROM participants WHERE race_id = $1', [s.id]),   // elimina a cascata anche i passaggi
        tx.query('DELETE FROM checkpoints WHERE race_id = $1', [s.id]),
        tx.query(
          `INSERT INTO checkpoints (race_id, idx, name, km, radius)
           SELECT $1, a, b, c, d FROM unnest($2::int[], $3::text[], $4::float8[], $5::int[]) AS t(a, b, c, d)`,
          [s.id, s.checkpoints.map((c) => c.idx), s.checkpoints.map((c) => c.name), s.checkpoints.map((c) => c.km),
            s.checkpoints.map((c) => c.radius)]),
        tx.query(
          `INSERT INTO participants (id, race_id, name, color, stats)
           SELECT a, $1, b, c, d::jsonb FROM unnest($2::text[], $3::text[], $4::text[], $5::text[]) AS t(a, b, c, d)`,
          [s.id, ps.map((p) => dbId(s.id, p.id)), ps.map((p) => p.name), ps.map((p) => p.color ?? null),
            ps.map((p) => (p.stats ? JSON.stringify(p.stats) : null))]),
        tx.query(
          `INSERT INTO passages (race_id, participant_id, cp_idx, t)
           SELECT $1, a, b, to_timestamp(c / 1000.0) FROM unnest($2::text[], $3::int[], $4::float8[]) AS t(a, b, c)`,
          [s.id, flat.map((x) => x.pid), flat.map((x) => x.cp), flat.map((x) => x.t)]),
      ]);
      const got = await counts(sql, s.id);        // verifica dopo la scrittura
      return { ok: same(got, countsOf(s)), counts: got };
    },
    async getRace(id) {
      const sql = await db();
      const [rows, cps, parts, pass] = await sql.transaction((tx) => [
        tx.query('SELECT id, name, account_id, total_km, course, meta, extract(epoch FROM started_at) * 1000 AS started, extract(epoch FROM ended_at) * 1000 AS ended, extract(epoch FROM expires_at) * 1000 AS expires FROM races WHERE id = $1', [id]),
        tx.query('SELECT idx, name, km, radius FROM checkpoints WHERE race_id = $1 ORDER BY idx', [id]),
        tx.query('SELECT id, name, color, stats FROM participants WHERE race_id = $1 ORDER BY id', [id]),
        tx.query('SELECT participant_id, cp_idx, extract(epoch FROM t) * 1000 AS t FROM passages WHERE race_id = $1 ORDER BY cp_idx', [id]),
      ]);
      const r = rows[0];
      if (!r) return null;
      return {
        id: r.id, name: r.name, accountId: r.account_id, totalKm: r.total_km, course: r.course, meta: r.meta,
        startedAt: r.started == null ? null : Math.round(r.started), endedAt: r.ended == null ? null : Math.round(r.ended),
        expiresAt: r.expires == null ? null : Math.round(r.expires),
        checkpoints: cps.map((c) => ({ idx: c.idx, name: c.name, km: c.km, radius: c.radius })),
        participants: parts.map((p) => ({ id: p.id.slice(id.length + 1), name: p.name, color: p.color, stats: p.stats,
          passages: pass.filter((x) => x.participant_id === p.id).map((x) => ({ cp: x.cp_idx, t: Math.round(x.t) })) })),
      };
    },
    async purgeExpired(ms) {
      const sql = await db();
      const rows = await sql.query('DELETE FROM races WHERE expires_at IS NOT NULL AND expires_at < $1 RETURNING id', [ts(ms)]);
      return rows.length;
    },
  };
}

export function createArchive(env = process.env) {
  return env.DATABASE_URL ? neonArchive(env.DATABASE_URL) : noArchive();
}
