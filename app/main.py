import threading, time
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from . import analysis, config, db, service
from .collectors import COLLECTORS

STATIC = Path(__file__).parent.parent / "static"

def _loop(stop: threading.Event):
    while not stop.is_set():
        service.collect_all()
        stop.wait(config.INTERVAL_MIN * 60)

@asynccontextmanager
async def lifespan(app):
    stop = threading.Event()
    if config.AUTO_COLLECT:
        threading.Thread(target=_loop, args=(stop,), daemon=True).start()
    yield
    stop.set()

app = FastAPI(title="Surfer — China Trends", lifespan=lifespan)

@app.get("/api/topics")
def topics(hours: int = 24, platform: str | None = None):
    return analysis.topics(hours, platform)

@app.get("/api/cross")
def cross(hours: int = 24):
    return analysis.cross_platform(hours)

@app.get("/api/health")
def health():
    return {"proxy": bool(config.PROXY), "interval_min": config.INTERVAL_MIN,
            "sources": analysis.health()}

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
