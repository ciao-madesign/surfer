# Private Trail Live Tracking

Portale web per seguire in tempo reale fino a 5 corridori durante una gara di trail, con un link privato, senza account e senza installare app (per chi guarda). Specifica: V1.1 (6 novembre 2026).

Riusa asset di [WizTrail](https://github.com/ciao-madesign/WizTrail) (design system, font) e [Simule](https://github.com/ciao-madesign/Simule) (parser GPX, impostazione MapLibre).

## Come è fatto

| Parte | Cartella | Note |
|---|---|---|
| API (una sola funzione Vercel) | `api/index.js`, `server/` | Node.js, nessuna dipendenza |
| Archivio | Upstash Redis (gratuito) | Le posizioni scadono da sole: nessun cron. In locale: memoria |
| Portale osservatori | `public/live.html`, `public/js/live.js` | HTML+JS puro, MapLibre self-hosted |
| Pagina organizzatore | `public/admin.html` | Crea gare, partecipanti, link |
| Tracker web per il corridore | `public/track.html` | Safari, senza app né Xcode. Limite iOS: serve lo schermo acceso |
| Compatibilità app Overland | `/api/device/overland` | Tracking a schermo spento con app gratuita dell'App Store, senza Xcode |
| App iPhone (facoltativa) | `ios/TrailTrack/` | Swift/SwiftUI, richiede Xcode: non necessaria |

Scelte di semplicità: nessun framework né bundler (come WizTrail e Simule); Redis al posto di Neon (le scadenze a 24 ore sono native e non serve un cron, che su Vercel Hobby gira al massimo una volta al giorno); risposte `live` in cache di 5 secondi sulla CDN, così il numero di osservatori non aumenta le letture sul database.

## Provarlo in locale (2 minuti)

```bash
npm test          # 18 test automatici
npm run dev       # ADMIN_KEY=dev, archivio in memoria
```
Apri http://localhost:3000/admin, chiave `dev`.

## Pubblicarlo (gratis)

1. **Upstash**: puoi usare lo stesso database di WizTrail (il piano gratuito ne consente uno): le chiavi di questo progetto iniziano con `trail:`, quelle di WizTrail con `wiztrail:`, quindi non si mescolano. Copia `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` dal database esistente.
2. **Vercel**: importa questo repository (progetto separato da WizTrail) e imposta le variabili: `ADMIN_KEY` (una password lunga), `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.
3. Apri `https://<tuo-progetto>.vercel.app/admin`, entra con `ADMIN_KEY`.

## Prima di una gara

1. In `/admin`: carica il GPX, scrivi i checkpoint (`Nome @ km`), crea la gara.
2. Aggiungi i corridori: per ognuno compare un **codice di collegamento** (visibile una volta). Incollalo nell'app sul suo iPhone.
3. «Genera link» e invia il link ai familiari. «Avvia gara» alla partenza, «Termina gara» all'arrivo.
4. Il link si può revocare o rigenerare in qualsiasi momento. Dopo «Termina gara» i dati vengono cancellati in 24 ore.

## Come i corridori inviano la posizione (senza Xcode)

1. **Tracker web** (`/track`): apri la pagina in Safari, incolla il codice di collegamento, avvia. Funziona finché lo **schermo resta acceso** e la pagina è aperta; blocco schermo o altra app in primo piano fermano il GPS (limite di iOS, non aggirabile da una pagina web). Il portale mostra allora «Connessione assente» con l'età dell'ultimo dato.
2. **App Overland** (App Store, gratuita): invia la posizione anche con lo schermo spento. In `/admin`, dopo «Aggiungi» o «Nuovo codice», compare l'indirizzo da inserire in Overland come *Receiver Endpoint*. La frequenza di invio la decide Overland: da verificare in prova.
3. **App Swift** (`ios/`): solo se un giorno si avrà un Mac con Xcode.

## App iPhone nativa (facoltativa)

Vedi [`ios/README.md`](ios/README.md).

## Privacy e sicurezza

- Il link è una credenziale: chi lo ha può vedere la gara. Nel link il token sta dopo `#`, quindi non compare nei log delle pagine né nei referrer. Le richieste ai dati lo includono però come parametro (serve per la cache di 5 secondi): può comparire nei log delle API su Vercel, visibili solo a te.
- Credenziali del dispositivo, link degli osservatori e chiave amministratore sono tre cose distinte.
- Il corridore attiva e interrompe la condivisione dall'app, con consenso esplicito; con «Interrompi» i punti non ancora inviati vengono cancellati.
- Limiti: 5 partecipanti, 120 punti per richiesta, 30 richieste al minuto per dispositivo.
- Le pagine non sono indicizzabili (`noindex`, `robots.txt`).

## Mappe e licenze (da verificare prima dell'uso pubblico)

Le sorgenti sono in `public/js/config.js` e si sostituiscono in un punto solo.
- **Satellite Esri World Imagery** (come in Simule): controllare le condizioni d'uso per il tuo caso.
- **OpenTopoMap**: uso leggero consentito con attribuzione; non adatto a traffico elevato.
- **Rilievo 3D**: Terrain Tiles aperti su AWS (formato Terrarium).
- **Meteo Open-Meteo**: gratuito solo per uso non commerciale. È la stima di un modello, non una misura sul posto.
- **Vercel Hobby**: solo uso personale e non commerciale. Se il progetto diventasse uno spin-off a pagamento, serve un altro piano.

## Stato di verifica (onestà)

| Cosa | Stato |
|---|---|
| API: gare, link, invio, checkpoint, statistiche, scadenza 24 h | Provato con 18 test automatici (archivio in memoria) |
| Portale e pagina organizzatore | Provati in un browser di prova con dati simulati; **mappe e meteo non verificati**: il mio ambiente non raggiunge i server delle mappe |
| Deploy su Vercel e Upstash reale | **Non provato**: la riscrittura `/api/*` → `api/index` e i comandi Redis reali vanno confermati al primo deploy |
| App iOS | **Non compilata né provata** (nessun Xcode qui). Test T01–T06 della specifica da fare sul telefono |
| Limiti dei piani gratuiti con 20 osservatori | Da misurare in una prova con più persone (test T15) |

## Fuori dalla V1
Classifiche e cronometraggio ufficiali, smartwatch, Android, frequenza cardiaca, account per gli osservatori, storico GPS permanente.
