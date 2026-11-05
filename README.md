# Surfer — China Trends (locale e gratuito)

Raccoglie ogni ora le classifiche pubbliche di **Weibo, Douyin e Bilibili**, costruisce una serie storica
locale (SQLite) e mostra trend e temi presenti su più piattaforme. **RedNote e WeChat** si aggiungono
importando CSV/JSON (`platform,topic,rank,heat,url,collected_at`).

## Due ruoli
`SURFER_ROLE=collector` (Wyse: solo raccolta e storage, vedi `docs/INSTALLAZIONE-WYSE.md`) e
`SURFER_ROLE=analyst` (altro PC: replica i dati, dashboard, analisi, AI). Default: collector.

## Avvio (analyst, in locale)
```bash
pip install -r requirements.txt
SURFER_ROLE=analyst SURFER_REMOTE=http://<ip-wyse>:3200 SURFER_REMOTE_PASSWORD=... python -m app   # http://127.0.0.1:3200
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
