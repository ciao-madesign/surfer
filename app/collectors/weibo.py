from urllib.parse import quote
from .base import Collector, Item

class Weibo(Collector):
    platform = "weibo"
    url = "https://weibo.com/ajax/side/hotSearch"
    headers = {"Referer": "https://weibo.com/"}

    def parse(self, data):
        items = []
        for i, e in enumerate((data.get("data") or {}).get("realtime") or [], 1):
            w = e.get("word") or e.get("note")
            if not w or e.get("is_ad"):
                continue
            items.append(Item(w, e.get("rank", i - 1) + 1 if "rank" in e else i,
                              e.get("num") or e.get("raw_hot"),
                              f"https://s.weibo.com/weibo?q={quote('#' + w + '#')}",
                              e.get("label_name")))
        return items
