#!/usr/bin/env bash
# Rimuove SOLO Surfer (servizio, configurazione, utente). I dati restano finche' non li cancelli tu.
set -euo pipefail
sudo systemctl disable --now surfer 2>/dev/null || true
sudo rm -f /etc/systemd/system/surfer.service /etc/surfer.env
sudo systemctl daemon-reload
id surfer >/dev/null 2>&1 && sudo userdel surfer || true
echo "Surfer rimosso. Dati in /mnt/data/surfer (cancella a mano se vuoi)."
