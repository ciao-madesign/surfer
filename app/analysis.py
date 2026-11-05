"""Trend e confronto tra piattaforme, calcolati solo su rilevazioni storiche."""
from datetime import datetime, timedelta, timezone
from . import db

MIN_OBS = 3  # una singola osservazione non è un trend

def _since(hours):
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat(timespec="seconds")

def reliability(n_obs: int, methods: set) -> str:
    if n_obs < 2:
        return "Insufficient"
    if n_obs < MIN_OBS or "import" in methods and "auto" not in methods:
        return "Estimated"
    return "Supported"

def _strength(rank):  # posizione 1 -> 50, posizione 50 -> 1
    return max(0, 51 - rank) if rank else 0

def topics(hours=24, platform=None, limit=100):
    """Argomenti con serie storica, forza e direzione (solo se >= MIN_OBS)."""
    q = "SELECT * FROM snapshots WHERE collected_at>=?"
    args = [_since(hours)]
    if platform:
        q += " AND platform=?"; args.append(platform)
    q += " ORDER BY collected_at"
    with db.conn() as c:
        rows = c.execute(q, args).fetchall()
    groups: dict[str, list] = {}
    for r in rows:
        groups.setdefault(r["topic_key"], []).append(r)
    out = []
    for key, rs in groups.items():
        by_ts = sorted({r["collected_at"] for r in rs})
        series = []
        for ts in by_ts:
            best = max((_strength(r["rank"]) for r in rs if r["collected_at"] == ts))
            series.append({"t": ts, "strength": best})
        n = len(series)
        direction = None
        if n >= MIN_OBS:
            k = max(1, n // 3)
            first = sum(s["strength"] for s in series[:k]) / k
            last = sum(s["strength"] for s in series[-k:]) / k
            delta = last - first
            direction = "rising" if delta > 5 else "falling" if delta < -5 else "stable"
        platforms = sorted({r["platform"] for r in rs})
        out.append({
            "topic": rs[-1]["topic"], "key": key, "platforms": platforms,
            "observations": n, "first_seen": by_ts[0], "last_seen": by_ts[-1],
            "best_rank": min((r["rank"] for r in rs if r["rank"]), default=None),
            "current_strength": series[-1]["strength"],
            "direction": direction,  # None = dati insufficienti per un trend
            "reliability": reliability(n, {r["method"] for r in rs}),
            "series": series, "url": rs[-1]["url"],
        })
    out.sort(key=lambda t: (len(t["platforms"]), t["current_strength"], t["observations"]), reverse=True)
    return out[:limit]

def cross_platform(hours=24):
    """Temi presenti su >= 2 piattaforme (chiave uguale o una contenuta nell'altra)."""
    ts = topics(hours, limit=100000)
    merged = [t for t in ts if len(t["platforms"]) >= 2]
    seen = {t["key"] for t in merged}
    singles = [t for t in ts if len(t["platforms"]) == 1]
    for i, a in enumerate(singles):
        for b in singles[i + 1:]:
            if a["platforms"] != b["platforms"] and min(len(a["key"]), len(b["key"])) >= 3 \
               and (a["key"] in b["key"] or b["key"] in a["key"]) and a["key"] not in seen:
                merged.append({**a, "topic": f'{a["topic"]} ≈ {b["topic"]}',
                               "platforms": sorted(set(a["platforms"]) | set(b["platforms"])),
                               "match": "partial"})
                seen.add(a["key"])
    return merged

def health():
    with db.conn() as c:
        rows = c.execute("""SELECT platform,
              MAX(CASE WHEN ok=1 THEN started_at END) last_ok,
              MAX(started_at) last_try,
              SUM(ok) oks, COUNT(*) total FROM runs GROUP BY platform""").fetchall()
        errs = {r["platform"]: r["error"] for r in c.execute(
            "SELECT platform,error FROM runs WHERE id IN (SELECT MAX(id) FROM runs GROUP BY platform)")}
    return [{**dict(r), "last_error": errs.get(r["platform"])} for r in rows]
