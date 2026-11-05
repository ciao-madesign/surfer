import re, unicodedata

def topic_key(text: str) -> str:
    """Chiave di confronto tra piattaforme: NFKC, senza #/spazi/punteggiatura, minuscolo."""
    t = unicodedata.normalize("NFKC", text or "").lower()
    return re.sub(r"[\s#\[\]【】《》\"'“”‘’·,.!?:;，。！？：；、\-_]+", "", t)
