from .weibo import Weibo
from .douyin import Douyin
from .bilibili import Bilibili

COLLECTORS = {c.platform: c for c in (Weibo(), Douyin(), Bilibili())}
