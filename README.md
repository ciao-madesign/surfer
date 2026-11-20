# Trail Live

Segui un corridore di trail su una mappa, in tempo reale, con un link privato. Gratuito, senza account e senza app per chi guarda. Pensato per famiglia e amici di chi corre.

Ognuno può creare le proprie gare (percorso GPX, checkpoint, fino a 5 corridori) in pochi minuti e condividere il link.

Il progetto è autonomo e fa parte della famiglia [WizTrail](https://github.com/ciao-madesign/WizTrail): usa lo stesso design system, i font e il logo, e riusa il parser GPX di [Simule](https://github.com/ciao-madesign/Simule).

## Come funziona

1. **Crea la gara** (`/crea`): carichi il GPX, scegli il nome e i checkpoint. Ricevi un indirizzo segreto per gestirla (`/gestisci#…`): va salvato tra i preferiti.
2. **Aggiungi i corridori**: ognuno ottiene un codice per collegare il proprio telefono.
3. **Condividi il link**: chi guarda apre `/live#…` da qualsiasi browser.
4. A fine gara le posizioni vengono cancellate automaticamente dopo 24 ore.

### Come il corridore invia la posizione
- **Browser del telefono** (`/track`): nessuna installazione. Su iPhone serve lo schermo acceso.
- **App Overland** (gratuita): invia anche a schermo spento. Endpoint `/api/device/overland`.
- In arrivo: altre app gratuite (Traccar, OwnTracks, GPSLogger).

## Architettura

| Parte | Dove | Note |
|---|---|---|
| API (una sola funzione Vercel) | `api/index.js`, `server/` | Node.js, nessuna dipendenza |
| Dati in tempo reale | Upstash Redis | Posizioni, ultimo punto, link: scadenza automatica. In locale: memoria |
| Archivio di fine gara | Postgres su Neon (`server/archive.js`, schema in `db/migrations/`) | Solo tempi, statistiche e checkpoint; la traccia del percorso solo per chi ha un profilo. Mai lo storico GPS |
| Home e privacy | `public/index.html`, `public/privacy.html` | HTML statico |
| Creazione e gestione gara | `public/crea.html`, `public/admin.html` | `/gestisci` per gli organizzatori, `/admin` per il gestore del servizio |
| Pagina osservatori | `public/live.html`, `public/js/live.js` | MapLibre 2D/3D, profilo altimetrico, meteo |
| Tracker web | `public/track.html` | |
| App iPhone (facoltativa) | `ios/TrailTrack/` | Swift, mai compilata, non necessaria |

Scelte di semplicità: nessun framework né bundler; risposte `live` in cache sulla CDN per non far crescere le letture con il numero di osservatori; dati temporanei e dati permanenti tenuti separati, così il database permanente si può cambiare senza toccare il resto.

## Limiti del servizio gratuito
- 5 corridori per gara, 30 checkpoint.
- Massimo 5 gare create al giorno per indirizzo IP e 500 gare attive in tutto (configurabili con `CREATE_PER_DAY` e `MAX_ACTIVE_RACES`).
- 120 punti per richiesta, 30 richieste al minuto per dispositivo.

## Fine gara e archivio
Alla chiusura (manuale, o automatica dopo 36 ore) il riepilogo passa su Neon in una sola transazione ripetibile, poi viene verificato. Redis si svuota entro 24 ore **solo dopo la conferma**: se Neon non risponde i dati restano più a lungo e si riprova (pulsante di nuovo tentativo e attività giornaliera `/api/cron/archive`). Senza profilo il report resta 3 giorni, poi viene cancellato. Lo storico GPS completo non lascia mai Redis. Senza `DATABASE_URL` l'archivio è spento e tutto scade dopo 24 ore.

Variabili: `DATABASE_URL` (stringa di connessione Neon), `CRON_SECRET` (password lunga per l'attività giornaliera).

## Provarlo in locale

```bash
npm test          # test automatici
npm run dev       # ADMIN_KEY=dev, archivio in memoria, http://localhost:3000
```

## Pubblicarlo (gratis)

1. **Upstash Redis**: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`. Le chiavi hanno il prefisso `trail:` (variabile `REDIS_PREFIX`), quindi il database può essere condiviso con altri progetti.
2. **Vercel**: importa il repository e imposta `ADMIN_KEY` (password lunga) più le due variabili Upstash. Il ramo di produzione è `main`.
3. Apri `/crea` per creare una gara, `/admin` con `ADMIN_KEY` per amministrare tutte le gare.

## Privacy e sicurezza
- Il link è una credenziale: chi lo ha vede la gara. Il token sta dopo `#`, quindi non finisce nei log delle pagine né nei referrer.
- Credenziale del corridore, link degli osservatori, indirizzo dell'organizzatore e chiave del gestore sono quattro cose distinte.
- Dati personali ridotti al minimo: nome o pseudonimo, posizione durante il tracciamento, impronta dell'IP per un giorno.
- Il corridore dà il consenso prima di iniziare e può interrompere in ogni momento. Per i minorenni serve un genitore.
- Le pagine operative non sono indicizzabili; solo home e privacy lo sono.
- Informativa in `/privacy`: è una bozza da far rivedere prima del lancio pubblico.

## Mappe e licenze (da verificare prima dell'uso pubblico)
Le sorgenti sono in `public/js/config.js`.
- **Esri World Imagery**: controllare le condizioni d'uso.
- **OpenTopoMap**: uso leggero con attribuzione.
- **Rilievo 3D**: Terrain Tiles aperti su AWS.
- **Open-Meteo**: gratuito per uso non commerciale; è una stima di modello.
- **Vercel Hobby**: solo uso non commerciale.

## Stato
- Provati con test automatici: API, gare multi-utente, link, scadenze, checkpoint, statistiche, limiti (24 test).
- Provato sul campo: collegamento con Overland.
- Da verificare: mappe e meteo in un browser reale, avanzamento e checkpoint su un percorso vero, frequenza di invio a schermo spento, carico con molti osservatori.

## Prossimi passi
Rifinitura della creazione guidata, altre app di tracciamento, report di fine gara con tempi per settore e confronto tra partecipanti, profilo personale con chiave (senza registrazione) e con email, dashboard.

## Fuori dalla versione attuale
Cronometraggio ufficiale, smartwatch, frequenza cardiaca, storico GPS permanente.
