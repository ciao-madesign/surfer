# Surfer · Live

**Segui una gara in diretta, da casa.** Un link privato mostra su una mappa dove si trova chi corre, quando passa ai checkpoint e quando arriverà. Gratuito, senza account e senza app per chi guarda.

Pensato per famiglia, amici e allenatori di chi corre (oggi trail, altri sport in futuro) e per i piccoli eventi: ognuno crea la propria gara (percorso GPX, checkpoint, fino a 5 corridori) in pochi minuti. Il corridore decide: condivide la posizione solo dopo il suo consenso e può fermarsi e cancellare i propri dati quando vuole.

Il progetto è autonomo e fa parte della famiglia [WizTrail](https://github.com/ciao-madesign/WizTrail): stesso design system e font, logo derivato da quello di WizTrail, parser GPX di [Simule](https://github.com/ciao-madesign/Simule).

Produzione: <https://surfer-eta.vercel.app>

## Come funziona

1. **Crea la gara** (`/crea`): carichi il GPX, scegli il nome e i checkpoint. Ricevi un indirizzo segreto per gestirla (`/gestisci#…`): va salvato tra i preferiti.
2. **Percorso guidato** (`/gestisci`): aggiungi i corridori, collega ogni telefono con un QR code (istruzioni per iPhone e Android), crea il link da condividere e avvia la gara.
3. **Il corridore** apre il suo link, legge le informazioni e dà il consenso; poi avvia la condivisione dal browser o dall'app Overland.
4. **Chi guarda** apre `/live#…` da qualsiasi browser.
5. A fine gara le posizioni si cancellano entro 24 ore; il report con i tempi resta 3 giorni.

### Come il corridore invia la posizione
- **Browser del telefono** (`/track`): nessuna installazione. Lo schermo deve restare acceso.
- **App Overland** (iOS, gratuita): invia anche a schermo spento. Il consenso si dà comunque dal link del corridore.
- **App Android nativa** (`android/`, da compilare e provare): GPS a schermo spento, coda offline, consenso nell'app.
- **Traccar Client** (Android e iOS), **OwnTracks** e **GPSLogger**: indirizzi pronti in [`docs/API.md`](docs/API.md); `/gestisci` guida Traccar Client. Da provare su un telefono Android.

## Architettura

| Parte | Dove | Note |
|---|---|---|
| API (una sola funzione Vercel, regione Francoforte) | `api/index.js` (adattatore), `server/` (`handler`, `common`, `races`, `ingest`, `finish`, `views`) | Node.js, una sola dipendenza (driver Neon); documentata in `docs/API.md` |
| Dati in tempo reale | Upstash Redis (`server/store.js`, interfaccia in `server/repo.js`) | Posizioni, ultimo punto, link: scadenza automatica. In locale: memoria |
| Archivio di fine gara | Postgres su Neon (`server/archive.js`, schema in `db/migrations/`) | Solo tempi, statistiche, checkpoint, data del consenso; mai lo storico GPS |
| Sito e pagine | `public/` | HTML e JavaScript senza framework né bundler |
| Documentazione interna | `ROADMAP.md`, `docs/pre-dpia.md` | Prossimi passi e valutazione preliminare d'impatto |

Scelte di semplicità: nessun framework; risposte `live` in cache sulla CDN; dati temporanei e permanenti separati (si cambia il database permanente senza toccare il resto); `store` e `archive` sono interfacce iniettate nell'handler, che non dipende da Vercel.

## Privacy e sicurezza (in sintesi)
- Il link è una credenziale: chi lo ha vede la gara. I token stanno dopo `#` o in intestazioni, hashati sul server.
- Quattro credenziali distinte: corridore, chi guarda, organizzatore, gestore del servizio.
- Consenso esplicito del corridore (non retroattivo, età minima 14 anni o consenso del genitore); il corridore può cancellare i propri dati (`DELETE /api/device/me`); l'organizzatore può eliminare la gara, anche dall'archivio.
- Link del report revocabile; link di chi guarda con durata legata alla gara (24 ore dopo la fine; 7 giorni dall'avvio; 15 giorni se la gara non parte).
- Limiti anti-abuso (120 richieste al minuto per rete, indirizzi pseudonimizzati con sale giornaliero), CSP e Permissions-Policy.
- Pagine operative non indicizzabili: solo home, privacy e condizioni.
- Informativa in `/privacy`, condizioni in `/condizioni`, valutazione preliminare in `docs/pre-dpia.md`: da far rivedere a un legale o DPO prima del lancio pubblico.

## Limiti del servizio gratuito
5 corridori e 30 checkpoint per gara; 5 gare create al giorno per rete e 500 attive (`CREATE_PER_DAY`, `MAX_ACTIVE_RACES`); 120 punti per richiesta, 30 richieste al minuto per corridore.

## Provarlo in locale
```bash
npm test          # test automatici (60)
npm run migrate   # applica le migrazioni del database (DATABASE_URL; --dry per provare)
npm run dev       # ADMIN_KEY=dev, archivio in memoria, http://localhost:3000
```

## Pubblicarlo (gratis)
1. **Upstash Redis**: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (prefisso chiavi `trail:`).
2. **Neon**: `DATABASE_URL`; `npm run migrate` applica le migrazioni in `db/migrations/`.
3. **Vercel**: importa il repository (ramo `main`) e imposta `ADMIN_KEY`, `REPORT_SECRET` (due password lunghe diverse), `CRON_SECRET` e le variabili sopra. Facoltative: `CREATE_PER_DAY`, `MAX_ACTIVE_RACES`.
4. Cambiando dominio, aggiorna l'indirizzo del sito in `canonical`, `og:url`, `og:image`, `public/sitemap.xml`, `public/robots.txt` e nei dati strutturati di `public/index.html`.

## Mappe e licenze (da rivalutare prima di aprire a molti utenti)
Sorgenti in `public/js/config.js`: Esri World Imagery e OpenTopoMap con attribuzione, rilievo AWS Terrain Tiles, meteo Open-Meteo (CC BY 4.0, uso non commerciale). Vercel Hobby: solo uso non commerciale. Surfer è oggi gratuito e senza scopo di lucro; prima di un uso commerciale vedi `ROADMAP.md`.

## Logo (provvisorio)
`public/logo-surfer.svg`: una «S» morbida che simula una traccia GPX, senza sfondo, con un pallino verde acqua in apertura e uno in chiusura del percorso. Nel footer resta il simbolo bianco di WizTrail (`public/logo-mark.svg`).

## Stato
- Provati con test automatici: API, gare multi-utente, link e scadenze, checkpoint, statistiche, filtri GPS, archivio, report, consenso, cancellazione, limiti (60 test).
- Provato sul campo: Overland su iPhone (oltre 3 ore, stabile), prima dell'introduzione del consenso.
- Da verificare: consenso con Overland su iPhone, archivio su Neon con una gara vera, mappe e meteo in produzione con la CSP, Android.

## Prossimi passi
Vedi [`ROADMAP.md`](ROADMAP.md).
