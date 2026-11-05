#!/usr/bin/env bash
# Installazione ISOLATA di Surfer sul Wyse, accanto a home-hub e learning-lab.
# Non tocca Docker, nginx, AdGuard/DNS, WireGuard, iptables, altri utenti, servizi o porte.
# Uso:  SURFER_HOST=<IP del Wyse> ./deploy/install-wyse.sh   (dopo clone in /opt/surfer)
# Si ferma a ogni controllo che non passa. Nessuna VPN di sistema: il proxy e' solo per questo processo.
set -euo pipefail
PORT="${SURFER_PORT:-3200}"            # 3100 = learning-lab, 80/443/53/3001/8096/2283 = home-hub
HOST="${SURFER_HOST:-127.0.0.1}"       # LAN: IP del Wyse (mai 0.0.0.0)
DATA="${SURFER_DATA:-/mnt/data/surfer}"
SERVICE=surfer; RUN_USER=surfer
DIR="$(cd "$(dirname "$0")/.." && pwd)"
fail() { echo "STOP: $*" >&2; exit 1; }

echo "== Controlli preliminari (nessuna modifica) =="
command -v python3 >/dev/null || fail "serve python3"
python3 -c 'import sys; sys.exit(sys.version_info<(3,10))' || fail "serve Python 3.10 o successivo"
python3 -c 'import venv, ensurepip' 2>/dev/null || fail "installa il pacchetto python3-venv (apt install python3-venv)"
case "$DIR" in /home/*|/root/*) fail "ProtectHome=true: installa fuori da /home (es. /opt/surfer)";; esac
case "$DIR$DATA" in *home-hub*|*learning-lab*|*personalhub*) fail "cartelle di altri progetti: usa percorsi dedicati";; esac
[ ! -e /etc/systemd/system/$SERVICE.service ] || fail "il servizio $SERVICE esiste gia'"
ss -ltn "sport = :$PORT" | grep -q LISTEN && fail "porta $PORT occupata: usa SURFER_PORT=..."
if [ -d "$DATA" ] && [ -n "$(ls -A "$DATA" 2>/dev/null)" ] && [ ! -f "$DATA/.surfer" ]; then fail "$DATA non e' di Surfer"; fi
AVAIL=$(df -Pm "$(dirname "$DATA")" | awk 'NR==2{print $4}'); [ "$AVAIL" -gt 500 ] || fail "meno di 500 MB liberi (eMMC): usa SURFER_DATA su altro disco"
echo "Porta $PORT libera, cartelle e utente dedicati: ok."
read -r -p "Procedere? [s/N] " ok; [ "$ok" = "s" ] || exit 0

echo "== 1/4 Ambiente Python (solo dentro $DIR/.venv, nessuna installazione globale) =="
python3 -m venv "$DIR/.venv"
"$DIR/.venv/bin/pip" install -q -r "$DIR/requirements.txt" "httpx[socks]"

echo "== 2/4 Utente e dati dedicati =="
id $RUN_USER >/dev/null 2>&1 || sudo useradd --system --no-create-home --shell /usr/sbin/nologin $RUN_USER
sudo mkdir -p "$DATA"; sudo touch "$DATA/.surfer"
sudo chown -R $RUN_USER:$RUN_USER "$DATA"; sudo chmod 700 "$DATA"
if [ -z "${SURFER_PASSWORD:-}" ]; then read -r -s -p "Password di accesso (lunga): " SURFER_PASSWORD; echo; fi
sudo install -m 600 -o root -g root /dev/null /etc/$SERVICE.env
sudo tee /etc/$SERVICE.env >/dev/null <<ENV
SURFER_HOST=$HOST
SURFER_PORT=$PORT
SURFER_DB=$DATA/surfer.db
SURFER_PASSWORD=$SURFER_PASSWORD
SURFER_INTERVAL_MIN=${SURFER_INTERVAL_MIN:-60}
${SURFER_PROXY:+SURFER_PROXY=$SURFER_PROXY}
ENV

echo "== 3/4 Servizio dedicato =="
sed -e "s|__CARTELLA__|$DIR|g" -e "s|__DATI__|$DATA|" "$DIR/deploy/surfer.service" | sudo tee /etc/systemd/system/$SERVICE.service >/dev/null
sudo systemctl daemon-reload; sudo systemctl enable --now $SERVICE

echo "== 4/4 Verifica =="; sleep 3
curl -fsS -u "x:$SURFER_PASSWORD" "http://$HOST:$PORT/api/health" && echo
echo "Surfer attivo su http://$HOST:$PORT  (rimozione: ./deploy/uninstall-wyse.sh)"
