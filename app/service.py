"""Raccolta, salvataggio e import."""
import csv, io, json
from datetime import datetime, timedelta, timezone
from .collectors import COLLECTORS
from .normalize import topic_key
from . import db

def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")

def save_items(c, platform, items, method, reliability, run_id=None, ts=None):
    ts = ts or now()
    c.executemany(
        "INSERT INTO snapshots(run_id,platform,topic,topic_key,rank,heat,url,label,collected_at,method,reliability)"
        " VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        [(run_id, platform, i.topic, topic_key(i.topic), i.rank, i.heat, i.url, i.label,
          ts, method, reliability) for i in items if topic_key(i.topic)])

def collect(platform: str) -> dict:
    col = COLLECTORS[platform]
    ts = now()
    with db.conn() as c:
        try:
            items = col.fetch()
            if not items:
                raise ValueError("risposta vuota: formato cambiato o accesso bloccato")
            cur = c.execute("INSERT INTO runs(platform,method,started_at,ok,n_items) VALUES(?,?,?,1,?)",
                            (platform, "auto", ts, len(items)))
            save_items(c, platform, items, "auto", "Verified", cur.lastrowid, ts)
            return {"platform": platform, "ok": True, "items": len(items)}
        except Exception as e:  # il fallimento è un dato: finisce in "Salute delle fonti"
            err = f"{type(e).__name__}: {e}"[:300]
            c.execute("INSERT INTO runs(platform,method,started_at,ok,error) VALUES(?,?,?,0,?)",
                      (platform, "auto", ts, err))
            return {"platform": platform, "ok": False, "error": err}

def collect_all() -> list[dict]:
    return [collect(p) for p in COLLECTORS]

def _num(v):
    try:
        return float(str(v).replace(",", "")) if v not in (None, "") else None
    except ValueError:
        return None

def import_rows(rows: list[dict], default_platform: str | None = None) -> int:
    """Righe con: platform, topic, [rank, heat, url, collected_at]. Dati importati = 'Estimated'."""
    by_platform: dict[tuple, list] = {}
    n = 0
    from .collectors.base import Item
    for r in rows:
        topic = (r.get("topic") or r.get("keyword") or "").strip()
        plat = (r.get("platform") or default_platform or "").strip().lower()
        if not topic or not plat:
            continue
        ts = r.get("collected_at") or now()
        rank = _num(r.get("rank"))
        by_platform.setdefault((plat, ts), []).append(
            Item(topic, int(rank) if rank else None, _num(r.get("heat")), r.get("url") or None))
        n += 1
    with db.conn() as c:
        for (plat, ts), items in by_platform.items():
            save_items(c, plat, items, "import", "Estimated", ts=ts)
    return n

def parse_upload(filename: str, raw: bytes) -> list[dict]:
    text = raw.decode("utf-8-sig")
    if filename.lower().endswith(".json"):
        d = json.loads(text)
        return d if isinstance(d, list) else d.get("items", [])
    return list(csv.DictReader(io.StringIO(text)))

def prune(days: int) -> int:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat(timespec="seconds")
    with db.conn() as c:
        n = c.execute("DELETE FROM snapshots WHERE collected_at<?", (cutoff,)).rowcount
        c.execute("DELETE FROM runs WHERE started_at<?", (cutoff,))
    return n
