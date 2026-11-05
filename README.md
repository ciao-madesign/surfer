# Surfer — China Trends (locale e gratuito)

Raccoglie ogni ora le classifiche pubbliche di **Weibo, Douyin e Bilibili**, costruisce una serie storica
locale (SQLite) e mostra trend e temi presenti su più piattaforme. **RedNote e WeChat** si aggiungono
importando CSV/JSON (`platform,topic,rank,heat,url,collected_at`).

## Avvio
```bash
pip install -r requirements.txt
uvicorn app.main:app --port 8000      # poi apri http://localhost:8000
pytest                                # test
```

## VPN / Tor (variabili d'ambiente)
- **VPN di sistema**: nessuna configurazione, funziona da sola.
- **Tor**: `pip install "httpx[socks]"`, poi `SURFER_PROXY=socks5://127.0.0.1:9050`.
  Attenzione: i nodi di uscita Tor sono spesso bloccati dai siti cinesi; una VPN con uscita in Cina/HK è più affidabile.
- Altre: `SURFER_INTERVAL_MIN` (default 60), `SURFER_AUTO_COLLECT=0`, `SURFER_DB`.

## Limiti
- Sono classifiche, non volumi di ricerca. Un trend richiede ≥3 rilevazioni.
- Gli endpoint sono non ufficiali: possono cambiare. Lo stato di ogni fonte è visibile nella dashboard.
- Gli endpoint non sono stati testati dal vivo (il sandbox di sviluppo li blocca): verifica in locale con «Raccogli ora».
