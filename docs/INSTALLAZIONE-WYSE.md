# Installazione su Dell Wyse (accanto a home-hub e learning-lab)

| | home-hub | learning-lab | surfer |
|---|---|---|---|
| Porte | 80, 443, 53, 3001, 8096, 2283 | 3100 | **3200** |
| Utente | — | learninglab | **surfer** |
| Dati | infra/data | /mnt/data/learning-lab | **/mnt/data/surfer** |
| Servizio | systemd + Docker | systemd | **systemd `surfer`** |

Isolamento: utente, cartelle, porta e servizio dedicati; sandbox systemd (`ProtectSystem=strict`,
`ProtectHome`), `MemoryMax=256M`, `CPUQuota=30%`, `Nice=10`. Nessun accesso a Docker, DNS, WireGuard o iptables.

## Rete verso la Cina
**Non installare una VPN di sistema sul Wyse**: cambierebbe le rotte e il DNS di home-hub (AdGuard, WireGuard).
Usa un proxy solo per Surfer: `SURFER_PROXY=socks5://127.0.0.1:9050` (Tor, installato a parte) oppure un proxy
HTTP/SOCKS fornito dalla tua VPN. Senza `SURFER_PROXY` Surfer esce con la connessione normale.

## Passi
```bash
sudo git clone https://github.com/ciao-madesign/surfer /opt/surfer && cd /opt/surfer
git checkout claude/wonderful-galileo-1ekc0t
SURFER_HOST=192.168.1.8 ./deploy/install-wyse.sh
```
Lo script controlla porta, spazio (eMMC) e cartelle, e si ferma prima di modificare qualcosa se un controllo fallisce.
Aggiornare: `git pull && .venv/bin/pip install -r requirements.txt && sudo systemctl restart surfer`.
Il database elimina i dati più vecchi di `SURFER_RETENTION_DAYS` (default 365) per non riempire l'eMMC.
