import sqlite3
from contextlib import contextmanager
from . import config

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs(
  id INTEGER PRIMARY KEY, platform TEXT NOT NULL, method TEXT NOT NULL,
  started_at TEXT NOT NULL, ok INTEGER NOT NULL, n_items INTEGER DEFAULT 0, error TEXT);
CREATE TABLE IF NOT EXISTS snapshots(
  id INTEGER PRIMARY KEY, run_id INTEGER REFERENCES runs(id),
  platform TEXT NOT NULL, topic TEXT NOT NULL, topic_key TEXT NOT NULL,
  rank INTEGER, heat REAL, url TEXT, label TEXT,
  collected_at TEXT NOT NULL,
  method TEXT NOT NULL,          -- auto | import | manual
  reliability TEXT NOT NULL      -- Verified | Estimated
);
CREATE INDEX IF NOT EXISTS ix_snap_key ON snapshots(topic_key, collected_at);
CREATE INDEX IF NOT EXISTS ix_snap_plat ON snapshots(platform, collected_at);
CREATE TABLE IF NOT EXISTS watchlist(keyword TEXT PRIMARY KEY, topic_key TEXT NOT NULL);
"""

def connect():
    config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(config.DB_PATH, check_same_thread=False)
    c.row_factory = sqlite3.Row
    c.executescript(SCHEMA)
    return c

@contextmanager
def conn():
    c = connect()
    try:
        yield c
        c.commit()
    finally:
        c.close()
