"""Sincronizzazione incrementale collector (Wyse) -> replica locale (PC di analisi)."""
import httpx
from . import config, db

SNAP_COLS = ["id", "run_id", "platform", "topic", "topic_key", "rank", "heat", "url", "label",
             "collected_at", "method", "reliability"]
RUN_COLS = ["id", "platform", "method", "started_at", "ok", "n_items", "error"]

def export_since(after_snap: int, after_run: int, limit: int = 5000) -> dict:
    """Lato collector: righe nuove dopo gli id indicati."""
    with db.conn() as c:
        s = c.execute("SELECT * FROM snapshots WHERE id>? ORDER BY id LIMIT ?", (after_snap, limit)).fetchall()
        r = c.execute("SELECT * FROM runs WHERE id>? ORDER BY id LIMIT ?", (after_run, limit)).fetchall()
    return {"snapshots": [dict(x) for x in s], "runs": [dict(x) for x in r]}

def client(**kw) -> httpx.Client:
    auth = ("surfer", config.REMOTE_PASSWORD) if config.REMOTE_PASSWORD else None
    return httpx.Client(base_url=config.REMOTE, auth=auth, timeout=60, **kw)  # LAN: nessun proxy

def pull() -> dict:
    """Lato analyst: scarica tutto il nuovo e lo inserisce nella replica locale (idempotente)."""
    if not config.REMOTE:
        return {"ok": False, "error": "SURFER_REMOTE non impostato"}
    total = 0
    try:
        with client() as http, db.conn() as c:
            while True:
                a = c.execute("SELECT COALESCE(MAX(id),0) FROM snapshots").fetchone()[0]
                b = c.execute("SELECT COALESCE(MAX(id),0) FROM runs").fetchone()[0]
                r = http.get("/api/sync", params={"after_snapshot": a, "after_run": b})
                r.raise_for_status()
                d = r.json()
                if not d["snapshots"] and not d["runs"]:
                    break
                c.executemany(f"INSERT OR IGNORE INTO runs({','.join(RUN_COLS)}) VALUES({','.join('?'*len(RUN_COLS))})",
                              [[x[k] for k in RUN_COLS] for x in d["runs"]])
                c.executemany(f"INSERT OR IGNORE INTO snapshots({','.join(SNAP_COLS)}) VALUES({','.join('?'*len(SNAP_COLS))})",
                              [[x[k] for k in SNAP_COLS] for x in d["snapshots"]])
                c.commit()
                total += len(d["snapshots"])
        return {"ok": True, "new_snapshots": total}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"[:300]}
