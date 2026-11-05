"""Configurazione via variabili d'ambiente (tutto locale, nessuna chiave API)."""
import os
from pathlib import Path

DB_PATH = Path(os.environ.get("SURFER_DB", "data/surfer.db"))
# Proxy opzionale per raggiungere le piattaforme cinesi dall'estero.
#  VPN di sistema: non serve nulla.
#  Tor:  SURFER_PROXY=socks5://127.0.0.1:9050   (richiede httpx[socks])
#  HTTP: SURFER_PROXY=http://127.0.0.1:8080
PROXY = os.environ.get("SURFER_PROXY") or None
INTERVAL_MIN = int(os.environ.get("SURFER_INTERVAL_MIN", "60"))
AUTO_COLLECT = os.environ.get("SURFER_AUTO_COLLECT", "1") == "1"
TIMEOUT = float(os.environ.get("SURFER_TIMEOUT", "20"))
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
