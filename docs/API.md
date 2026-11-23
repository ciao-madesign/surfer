# API di Surfer · Live

Tutte le rotte iniziano con `/api` (equivale a `/api/v1`, che si può usare per fissare la versione). Le risposte sono JSON. Gli errori hanno la forma `{ "error": "testo" }`.

## Credenziali
| Chi | Come si presenta | Dove si ottiene |
|---|---|---|
| Amministratore del servizio | intestazione `x-admin-key` | variabile `ADMIN_KEY` |
| Organizzatore di una gara | intestazione `x-org-token` | risposta alla creazione (`organizerToken`), mostrata una sola volta |
| Corridore (dispositivo) | `Authorization: Bearer <codice>` oppure `?token=<codice>` | pagina di gestione (QR) o iscrizione |
| Chi segue | parametro `?t=<token>` (nient'altro) | link di visualizzazione dell'organizzatore |
| Iscrizione | `t` nel corpo (POST) o `?t=` (GET informazioni) | link di iscrizione dell'organizzatore |
| Report | parametro `?t=<token>` | link del report (revocabile) |

## Chi segue (sola lettura, in cache sulla CDN)
- `GET /api/live?t=` posizioni e stato dei corridori
- `GET /api/course?t=` traccia e checkpoint
- `GET /api/stats?t=` statistiche, passaggi, stima d'arrivo
- `GET /api/report?t=` report di fine gara (3 giorni)

## Organizzatore
- `POST /api/races` crea una gara `{ name, course: { points: [[lat, lon, quota], …] }, checkpoints: [{ name, lat, lon }] }`
- `GET /api/admin/races/:id` stato · `DELETE` elimina tutto (anche l'archivio)
- `POST …/enroll` crea (o rigenera) il link di iscrizione dei corridori · `DELETE …/enroll` lo chiude. Le iscrizioni valgono solo prima della partenza
- `POST …/participants` `{ name, color }` · `DELETE …/participants/:pid` · `POST …/participants/:pid/token` nuovo codice
- `POST …/link` nuovo link di visualizzazione · `DELETE …/link` lo disattiva
- `POST …/start` · `POST …/end` · `POST …/archive` riprova l'archiviazione · `POST …/report` nuovo link del report · `POST …/passage` passaggio manuale

## Corridore
- `GET /api/enroll?t=` informazioni sul link di iscrizione (nome gara, se è aperta o al completo)
- `POST /api/enroll` `{ t, name, accept: true, ageOk: true }` iscrizione: crea il corridore, registra il consenso e restituisce il codice una sola volta
- `GET /api/device/me` cosa è salvato su di lui · `DELETE` cancella i suoi dati
- `POST /api/device/consent` `{ accept: true, ageOk: true }` consenso (senza, le posizioni non vengono accettate)
- `POST /api/device/positions` `{ points: [{ t, lat, lon, ele?, acc? }], status? }` (t in millisecondi, al massimo 120 punti)

## App di tracciamento (indirizzi da inserire nell'app)
Il codice del corridore è il «token» (QR, pagina di gestione o iscrizione). Le posizioni passano dagli stessi controlli di `/api/device/positions` (consenso, limiti, filtri GPS).

| App | Indirizzo | Note |
|---|---|---|
| Overland (iOS) | `POST /api/device/overland?token=` | GeoJSON; provata su iPhone |
| Traccar Client (Android, iOS) e app OsmAnd | `GET`/`POST /api/device/osmand` con `id=<codice>`, `lat`, `lon`, `timestamp`, `altitude`, `accuracy` | non provata su telefono |
| OwnTracks (modalità HTTP) | `POST /api/device/owntracks?token=` | JSON `_type: "location"`; non provata |
| GPSLogger (Android) | `GET`/`POST /api/device/gpslogger?token=&lat=%LAT&lon=%LON&time=%TIME&acc=%ACC&alt=%ALT` | segnaposto dell'app; non provata |

Nota: in queste app il codice sta nell'indirizzo e può comparire nei log del provider; si cambia con «Nuovo QR code».

## Limiti
120 richieste al minuto per rete (un accesso con credenziali sbagliate ne vale 6; le app dei corridori `device/*` hanno un limite di 600, per la stessa rete alla partenza), 30 al minuto per corridore, 120 punti per richiesta, 20 corridori (`MAX_PARTICIPANTS`) e 30 checkpoint per gara, 40 iscrizioni al giorno per rete. Superati: `429`.

## Dati e scadenze
Posizioni: cancellate entro 24 ore dalla fine. Report (nome, tempi, statistiche): 3 giorni. Link di visualizzazione: fino a 24 ore dopo la fine (al massimo 7 giorni dall'avvio, 15 se la gara non parte).
