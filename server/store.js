// Archivio chiave/valore con comandi Redis. In produzione: Upstash Redis (REST, piano gratuito).
// Senza credenziali (sviluppo e test): implementazione in memoria con scadenze.

export function createStore(env = process.env, clock = Date.now) {
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) return upstash(env);
  return memory(clock);
}

function upstash(env) {
  const url = env.UPSTASH_REDIS_REST_URL.replace(/\/$/, '');
  const auth = { Authorization: `Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`, 'Content-Type': 'application/json' };
  const post = async (path, body) => {
    const r = await fetch(url + path, { method: 'POST', headers: auth, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`Redis ${r.status}`);
    return r.json();
  };
  return {
    kind: 'upstash',
    async cmd(c) {
      const j = await post('', c);
      if (j.error) throw new Error(`Redis: ${j.error}`);
      return j.result;
    },
    async pipeline(cmds) {
      if (!cmds.length) return [];
      const j = await post('/pipeline', cmds);
      return j.map((x) => { if (x.error) throw new Error(`Redis: ${x.error}`); return x.result; });
    },
  };
}

function memory(clock) {
  const data = new Map();   // key -> {type, v, exp}
  const live = (k) => {
    const e = data.get(k);
    if (!e) return null;
    if (e.exp && e.exp <= clock()) { data.delete(k); return null; }
    return e;
  };
  const need = (k, type, init) => {
    let e = live(k);
    if (!e) { e = { type, v: init(), exp: 0 }; data.set(k, e); }
    return e;
  };
  const run = ([op, k, ...a]) => {
    switch (String(op).toUpperCase()) {
      case 'GET': return live(k)?.v ?? null;
      case 'SET': {
        const e = { type: 's', v: String(a[0]), exp: 0 };
        if (String(a[1]).toUpperCase() === 'EX') e.exp = clock() + Number(a[2]) * 1000;
        data.set(k, e); return 'OK';
      }
      case 'DEL': return a.concat(k).reduce((n, key) => n + (data.delete(key) ? 1 : 0), 0);
      case 'EXISTS': return live(k) ? 1 : 0;
      case 'EXPIRE': { const e = live(k); if (!e) return 0; e.exp = clock() + Number(a[0]) * 1000; return 1; }
      case 'TTL': { const e = live(k); return !e ? -2 : e.exp ? Math.ceil((e.exp - clock()) / 1000) : -1; }
      case 'INCR': { const e = need(k, 's', () => '0'); e.v = String(Number(e.v) + 1); return Number(e.v); }
      case 'HSET': { const e = need(k, 'h', () => ({})); let n = 0;
        for (let i = 0; i < a.length; i += 2) { if (!(a[i] in e.v)) n++; e.v[a[i]] = String(a[i + 1]); } return n; }
      case 'HGET': return live(k)?.v[a[0]] ?? null;
      case 'HDEL': { const e = live(k); if (!e) return 0; return a.reduce((n, f) => n + (delete e.v[f] ? 1 : 0), 0); }
      case 'HGETALL': { const e = live(k); return e ? Object.entries(e.v).flat() : []; }
      case 'RPUSH': { const e = need(k, 'l', () => []); e.v.push(...a.map(String)); return e.v.length; }
      case 'LRANGE': { const e = live(k); if (!e) return [];
        const n = e.v.length; let s = Number(a[0]), t = Number(a[1]);
        if (s < 0) s = Math.max(0, n + s); if (t < 0) t = n + t;
        return e.v.slice(s, t + 1); }
      case 'LTRIM': { const e = live(k); if (!e) return 'OK';
        const n = e.v.length; let s = Number(a[0]), t = Number(a[1]);
        if (s < 0) s = Math.max(0, n + s); if (t < 0) t = n + t;
        e.v = e.v.slice(s, t + 1); return 'OK'; }
      case 'LLEN': return live(k)?.v.length ?? 0;
      case 'SADD': { const e = need(k, 'S', () => new Set()); let n = 0; for (const m of a) if (!e.v.has(m)) { e.v.add(m); n++; } return n; }
      case 'SREM': { const e = live(k); return e ? a.reduce((n, m) => n + (e.v.delete(m) ? 1 : 0), 0) : 0; }
      case 'SMEMBERS': return [...(live(k)?.v ?? [])];
      default: throw new Error(`comando non supportato: ${op}`);
    }
  };
  return {
    kind: 'memory',
    async cmd(c) { return run(c); },
    async pipeline(cmds) { return cmds.map(run); },
    _size: () => data.size,
  };
}

// Helper JSON
export const getJSON = async (store, key) => {
  const v = await store.cmd(['GET', key]);
  return v == null ? null : JSON.parse(v);
};
