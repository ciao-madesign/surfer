from urllib.parse import quote
from .base import Collector, Item

class Bilibili(Collector):
    platform = "bilibili"
    url = "https://s.search.bilibili.com/main/hotword"
    headers = {"Referer": "https://www.bilibili.com/"}

    def parse(self, data):
        # formato hotword: {"list":[{"keyword","show_name","pos","heat_score"?}]}
        # formato search/square: {"data":{"trending":{"list":[...]}}}
        lst = data.get("list") or ((data.get("data") or {}).get("trending") or {}).get("list") or []
        items = []
        for i, e in enumerate(lst, 1):
            w = e.get("show_name") or e.get("keyword")
            if not w:
                continue
            items.append(Item(w, e.get("pos") or e.get("position") or i,
                              e.get("heat_score"),
                              f"https://search.bilibili.com/all?keyword={quote(w)}"))
        return items
