import base64, hmac, threading
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, Request, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from . import analysis, config, db, service, sync
from .collectors import COLLECTORS

STATIC = Path(__file__).parent.parent / "static"

COLLECTOR = config.ROLE == "collector"

def _collect_loop(stop: threading.Event):
    while not stop.is_set():
        service.collect_all()
        service.prune(config.RETENTION_DAYS)
        stop.wait(config.INTERVAL_MIN * 60)

def _sync_loop(stop: threading.Event):
    while not stop.is_set():
        sync.pull()
        stop.wait(config.SYNC_MIN * 60)

@asynccontextmanager
async def lifespan(app):
    stop = threading.Event()
    if COLLECTOR and config.AUTO_COLLECT:
        threading.Thread(target=_collect_loop, args=(stop,), daemon=True).start()
    if not COLLECTOR and config.REMOTE:
        threading.Thread(target=_sync_loop, args=(stop,), daemon=True).start()
    yield
    stop.set()

app = FastAPI(title="Surfer — China Trends", lifespan=lifespan)

@app.middleware("http")
async def basic_auth(request: Request, call_next):
    if config.PASSWORD:
        ok = False
        try:
            u, _, p = base64.b64decode(request.headers.get("authorization", "")[6:]).decode().partition(":")
            ok = hmac.compare_digest(p, config.PASSWORD)
        except Exception:
            pass
        if not ok:
            return Response("Autenticazione richiesta", 401, headers={"WWW-Authenticate": 'Basic realm="Surfer"'})
    return await call_next(request)

# ---------- API comuni ----------
@app.get("/api/health")
def health():
    base = {"role": config.ROLE, "proxy": bool(config.PROXY), "interval_min": config.INTERVAL_MIN,
            "sources": analysis.health()}
    return base

# ---------- ruolo COLLECTOR (Wyse): solo raccolta, storage, sincronizzazione ----------
if COLLECTOR:
    @app.get("/api/sync")
    def sync_export(after_snapshot: int = 0, after_run: int = 0):
        return sync.export_since(after_snapshot, after_run)

    @app.post("/api/collect")
    def collect(platform: str | None = None):
        if platform and platform not in COLLECTORS:
            raise HTTPException(404, "piattaforma sconosciuta")
        return [service.collect(platform)] if platform else service.collect_all()

    @app.post("/api/import")
    async def import_file(file: UploadFile = File(...), platform: str = Form("")):
        try:
            rows = service.parse_upload(file.filename or "", await file.read())
        except Exception as e:
            raise HTTPException(400, f"file non valido: {e}")
        return {"imported": service.import_rows(rows, platform or None)}

# ---------- ruolo ANALYST (altro PC): dashboard, analisi, AI sulla replica locale ----------
else:
    @app.get("/api/topics")
    def topics(hours: int = 24, platform: str | None = None):
        return analysis.topics(hours, platform)

    @app.get("/api/cross")
    def cross(hours: int = 24):
        return analysis.cross_platform(hours)

    @app.post("/api/sync-now")
    def sync_now():
        return sync.pull()

    @app.post("/api/collect")           # inoltra al Wyse, poi ricarica i dati
    def collect_remote():
        if not config.REMOTE:
            raise HTTPException(400, "SURFER_REMOTE non impostato")
        with sync.client() as http:
            r = http.post("/api/collect", timeout=120); r.raise_for_status()
        return {"collect": r.json(), "sync": sync.pull()}

    @app.post("/api/import")            # il Wyse resta l'unica fonte di verità
    async def import_remote(file: UploadFile = File(...), platform: str = Form("")):
        if not config.REMOTE:
            raise HTTPException(400, "SURFER_REMOTE non impostato")
        with sync.client() as http:
            r = http.post("/api/import", files={"file": (file.filename, await file.read())},
                          data={"platform": platform}); r.raise_for_status()
        sync.pull()
        return r.json()

    @app.get("/api/export.{fmt}")
    def export(fmt: str, hours: int = 168):
        ts = analysis.topics(hours, limit=100000)
        if fmt == "json":
            return JSONResponse(ts)
        if fmt == "csv":
            import csv, io
            b = io.StringIO(); w = csv.writer(b)
            w.writerow(["topic", "platforms", "observations", "best_rank", "direction", "reliability", "first_seen", "last_seen"])
            for t in ts:
                w.writerow([t["topic"], "|".join(t["platforms"]), t["observations"], t["best_rank"],
                            t["direction"] or "", t["reliability"], t["first_seen"], t["last_seen"]])
            return Response(b.getvalue(), media_type="text/csv")
        raise HTTPException(404, "formato: json | csv")

    @app.get("/")
    def index():
        return FileResponse(STATIC / "index.html")

    app.mount("/static", StaticFiles(directory=STATIC), name="static")
