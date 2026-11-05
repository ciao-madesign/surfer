from urllib.parse import quote
from .base import Collector, Item

class Douyin(Collector):
    platform = "douyin"
    url = "https://www.douyin.com/aweme/v1/web/hot/search/list/"
    headers = {"Referer": "https://www.douyin.com/hot"}

    def parse(self, data):
        items = []
        for i, e in enumerate((data.get("data") or {}).get("word_list") or [], 1):
            w = e.get("word")
            if not w:
                continue
            items.append(Item(w, e.get("position") or i, e.get("hot_value"),
                              f"https://www.douyin.com/search/{quote(w)}", e.get("label")))
        return items
