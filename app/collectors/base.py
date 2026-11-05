from dataclasses import dataclass
import httpx
from .. import config

@dataclass
class Item:
    topic: str
    rank: int | None = None
    heat: float | None = None
    url: str | None = None
    label: str | None = None

class Collector:
    platform = ""
    url = ""
    headers: dict = {}

    def client(self) -> httpx.Client:
        h = {"User-Agent": config.UA, "Accept": "application/json, text/plain, */*", **self.headers}
        return httpx.Client(headers=h, proxy=config.PROXY, timeout=config.TIMEOUT,
                            follow_redirects=True)

    def fetch(self) -> list[Item]:
        with self.client() as c:
            r = c.get(self.url)
            r.raise_for_status()
            return self.parse(r.json())

    def parse(self, data: dict) -> list[Item]:  # pragma: no cover
        raise NotImplementedError
