import os, tempfile, pathlib
os.environ["SURFER_DB"] = str(pathlib.Path(tempfile.mkdtemp()) / "t.db")
os.environ["SURFER_AUTO_COLLECT"] = "0"
os.environ["SURFER_ROLE"] = "analyst"
from fastapi.testclient import TestClient
from app import analysis, service
from app.collectors import COLLECTORS
from app.collectors.base import Item
from app.main import app
from app.normalize import topic_key

def test_parsers():
    w = COLLECTORS["weibo"].parse({"data": {"realtime": [
        {"word": "测试", "num": 123, "rank": 0, "label_name": "热"}, {"word": "广告", "is_ad": 1}]}})
    assert [(i.topic, i.rank, i.heat) for i in w] == [("测试", 1, 123)]
    d = COLLECTORS["douyin"].parse({"data": {"word_list": [{"word": "a", "position": 2, "hot_value": 9}]}})
    assert d[0].rank == 2
    b1 = COLLECTORS["bilibili"].parse({"list": [{"keyword": "k", "show_name": "显示", "pos": 1}]})
    b2 = COLLECTORS["bilibili"].parse({"data": {"trending": {"list": [{"keyword": "k"}]}}})
    assert b1[0].topic == "显示" and b2[0].topic == "k"

def test_normalize():
    assert topic_key("#Hello 世界!#") == topic_key("hello世界")

def test_trend_needs_three_observations():
    with service.db.conn() as c:
        for i, ts in enumerate(["2099-01-01T00:00:00+00:00", "2099-01-01T01:00:00+00:00"]):
            service.save_items(c, "weibo", [Item("话题", 10 - i)], "auto", "Verified", ts=ts)
    analysis._since = lambda h: "2000-01-01"
    t = [x for x in analysis.topics() if x["key"] == topic_key("话题")][0]
    assert t["direction"] is None and t["reliability"] == "Estimated"
    with service.db.conn() as c:
        service.save_items(c, "weibo", [Item("话题", 1)], "auto", "Verified", ts="2099-01-01T02:00:00+00:00")
    t = [x for x in analysis.topics() if x["key"] == topic_key("话题")][0]
    assert t["direction"] == "rising" and t["reliability"] == "Supported"

def test_cross_platform_and_import_api(monkeypatch):
    import importlib
    from app import config
    monkeypatch.setattr(config, "ROLE", "collector")
    import app.main as m
    c = TestClient(importlib.reload(m).app)
    monkeypatch.setattr(config, "ROLE", "analyst")
    c2 = TestClient(importlib.reload(m).app)
    csv = "platform,topic,rank\nrednote,#咖啡节#,3\ndouyin,咖啡节,5\n"
    r = c.post("/api/import", files={"file": ("x.csv", csv)}, data={"platform": ""})
    assert r.json()["imported"] == 2
    cross = [x for x in c2.get("/api/cross").json() if x["key"] == topic_key("咖啡节")]
    assert cross and set(cross[0]["platforms"]) == {"rednote", "douyin"}
    assert c2.get("/api/export.csv").status_code == 200

def test_failed_collection_is_reported(monkeypatch):
    monkeypatch.setattr(COLLECTORS["weibo"], "fetch", lambda: (_ for _ in ()).throw(RuntimeError("blocked")))
    assert service.collect("weibo")["ok"] is False
    h = {s["platform"]: s for s in analysis.health()}
    assert "blocked" in h["weibo"]["last_error"]

def test_password_protection(monkeypatch):
    from app import config
    monkeypatch.setattr(config, "PASSWORD", "segreto")
    c = TestClient(app)
    assert c.get("/api/health").status_code == 401
    assert c.get("/api/health", auth=("x", "segreto")).status_code == 200


def test_roles_and_sync(tmp_path, monkeypatch):
    """Il collector espone solo raccolta/sync; la replica dell'analyst è identica e idempotente."""
    import importlib, sqlite3
    from app import config, sync, db
    # collector con DB proprio
    monkeypatch.setattr(config, "ROLE", "collector")
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "wyse.db")
    import app.main as m
    m = importlib.reload(m)
    col = TestClient(m.app)
    assert col.get("/api/topics").status_code == 404 and col.get("/").status_code == 404
    with db.conn() as c:
        service.save_items(c, "weibo", [Item("甲", 1), Item("乙", 2)], "auto", "Verified")
    data = col.get("/api/sync").json()
    assert len(data["snapshots"]) == 2
    assert col.get("/api/sync", params={"after_snapshot": 2}).json()["snapshots"] == []
    # replica analyst: pull via client collegato al collector in-process
    monkeypatch.setattr(config, "ROLE", "analyst")
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "pc.db")
    monkeypatch.setattr(config, "REMOTE", "http://wyse")
    class Remote:  # il "Wyse" in-process: legge dal proprio DB
        def __enter__(self): return self
        def __exit__(self, *a): pass
        def get(self, path, params=None):
            old = config.DB_PATH; config.DB_PATH = tmp_path / "wyse.db"
            try: return col.get(path, params=params)
            finally: config.DB_PATH = old
    monkeypatch.setattr(sync, "client", lambda **k: Remote())
    assert sync.pull() == {"ok": True, "new_snapshots": 2}
    assert sync.pull() == {"ok": True, "new_snapshots": 0}
    with db.conn() as c:
        assert c.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0] == 2
