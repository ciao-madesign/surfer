# Guida passo passo (versione di prova)

Servono due cose: il **Wyse** (server, sempre acceso) e il **tuo PC** (dove guardi e analizzi i dati).
I comandi tra le righe grigie si copiano e si incollano in un terminale.

## Parte 1 — Sul Wyse (una volta sola)

**1. Collegati al Wyse dal tuo PC.** Apri il Terminale (Mac) oppure PowerShell (Windows) e scrivi
(sostituisci `tuo-utente` con l'utente con cui hai installato Ubuntu sul Wyse):
```bash
ssh tuo-utente@192.168.1.8
```
Alla prima volta scrivi `yes`, poi la password del Wyse. Se non risponde, controlla l'IP nel router.

**2. Installa i due programmi di base** (sono già probabilmente presenti):
```bash
sudo apt update && sudo apt install -y git python3 python3-venv
```

**3. Scarica Surfer in una cartella dedicata:**
```bash
sudo git clone -b claude/wonderful-galileo-1ekc0t https://github.com/ciao-madesign/surfer /opt/surfer
sudo chown -R $USER /opt/surfer && cd /opt/surfer
```

**4. Avvia l'installazione guidata** (ti fa scegliere una password e si ferma se qualcosa non va):
```bash
SURFER_HOST=192.168.1.8 ./deploy/install-wyse.sh
```
Quando chiede «Procedere?» scrivi `s`. Annota la password: serve al PC.

**5. Controlla che funzioni:**
```bash
sudo systemctl status surfer
```
Deve esserci scritto `active (running)`. Per uscire premi `q`. Poi scrivi `exit`.

## Parte 2 — Sul tuo PC

**1.** Installa **Python 3.11 o più recente** (python.org; su Windows spunta «Add Python to PATH») e **Git**.

**2.** Scarica Surfer e prepara l'ambiente:
```bash
git clone -b claude/wonderful-galileo-1ekc0t https://github.com/ciao-madesign/surfer
cd surfer
python -m venv .venv
```
Attiva l'ambiente: Mac/Linux `source .venv/bin/activate` — Windows `.venv\Scripts\activate`. Poi:
```bash
pip install -r requirements.txt
```

**3.** Avvia (sostituisci la password):
```bash
SURFER_ROLE=analyst SURFER_REMOTE=http://192.168.1.8:3200 SURFER_REMOTE_PASSWORD=LA_TUA_PASSWORD python -m app
```
Su Windows PowerShell le variabili si impostano prima: `$env:SURFER_ROLE="analyst"` ecc., poi `python -m app`.

**4.** Apri http://127.0.0.1:3200 e premi **«Raccogli ora»**. In alto vedi lo stato di Weibo, Douyin e Bilibili.

## Se qualcosa non va
- «non raggiungibile» su una fonte: il sito blocca il Wyse. Dimmi quale e l'errore mostrato.
- Il PC non vede il Wyse: devono essere sulla stessa rete di casa e l'IP deve essere giusto.
- Per ripartire da zero sul Wyse: `./deploy/uninstall-wyse.sh` (non tocca gli altri progetti).
