// Applica in ordine le migrazioni di db/migrations/ non ancora registrate. Uso: DATABASE_URL=... npm run migrate
// Con --dry mostra cosa farebbe senza toccare il database. Le migrazioni sono ripetibili (IF NOT EXISTS).
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const statements = (sql) => sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n').split(';').map((x) => x.trim()).filter(Boolean);

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');
const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
const dry = process.argv.includes('--dry');

if (dry && !process.env.DATABASE_URL) {
  for (const f of files) console.log(`${f}: ${statements(await readFile(join(dir, f), 'utf8')).length} istruzioni`);
} else {
  if (!process.env.DATABASE_URL) { console.error('Imposta DATABASE_URL'); process.exit(1); }
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(process.env.DATABASE_URL);
  await sql.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await sql.query('SELECT name FROM schema_migrations')).map((r) => r.name));
  for (const f of files) {
    if (done.has(f)) { console.log(`già applicata: ${f}`); continue; }
    const list = statements(await readFile(join(dir, f), 'utf8'));
    if (dry) { console.log(`da applicare: ${f} (${list.length} istruzioni)`); continue; }
    for (const st of list) await sql.query(st);
    await sql.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
    console.log(`applicata: ${f}`);
  }
}
