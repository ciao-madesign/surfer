# Prossimi passi

Regola guida: la soluzione più semplice, gratuita e a basso rischio. Ordine di priorità: privacy e sicurezza, flussi, modularità e portabilità, integrazioni.

## Fatto (audit di novembre 2026, fasi 0–6)
- Ritocchi UX e accessibilità; validazioni, regione UE, attribuzione meteo; segreto del report dedicato.
- Dati live: storico più lungo, invii non sovrapposti, stima d'arrivo sospesa dopo 3 minuti senza segnale, «Ultimo segnale» per corridore, tessere ridotte.
- Scadenza link: 24 ore dopo la fine; 7 giorni dall'avvio; 15 giorni se la gara non parte.
- Cancellazione completa (anche su Neon), link del report revocabile, diritti del corridore (`/api/device/me`).
- Limiti anti-abuso, hash IP con sale giornaliero, token solo nell'indirizzo.
- Consenso esplicito del corridore (browser e Overland), non retroattivo, registrato su Neon.
- Privacy e condizioni allineate, pre-DPIA (`docs/pre-dpia.md`), CSP e Permissions-Policy.
- SEO di base e nuovo logo.

## Basi per gli sviluppi futuri: a che punto siamo

| Sviluppo | Base già pronta | Cosa manca |
|---|---|---|
| Altre app di tracciamento (OsmAnd/Traccar, OwnTracks, GPSLogger) | Funzione di invio unica con validazioni, consenso, limiti, token del corridore; adattatore Overland già scritto come modello | Un piccolo adattatore per formato (stesso schema di `overland()`), guida per Android |
| Profilo personale e dashboard | Tabelle `accounts`, `races.account_id`, scadenze per profilo nello schema; cancellazione e consenso già agganciati ai dati | Nessun flusso di profilo: chiave/email, dashboard, conferme, DPIA completa |
| API stabile / app ufficiali | Interfacce `store` e `archive` separate; handler indipendente da Vercel | Prefisso `/api/v1` con alias, documentazione dell'API, esportazione JSON/GPX |
| Portabilità (altri hosting, Cloudflare, self-hosting) | Handler senza dipendenze da Vercel, archivio dietro interfaccia | I comandi Redis sono ancora nell'handler: serve un'interfaccia di dominio e una suite di test comune per store e archive |
| Un solo dominio con WizTrail | Nessun vincolo tecnico; pagine su percorsi propri | Decisione su percorso o sottodominio (sezione 6) |
| Scalare | Cache CDN per chi guarda, limiti, archivio ripetibile | Misurare i comandi Redis con una gara vera; cache per istanza |

## Fase 7: stato
Fatto:
- Dati live dietro un'interfaccia (`server/repo.js`): nessun comando Redis nell'handler; suite di conformità comune per repo e archivio (`tests/conformance.test.js`).
- Handler diviso in moduli: `common`, `races`, `ingest`, `finish`, `views` e lo smistamento in `handler.js`.
- `/api/v1` (alias dei percorsi attuali) e documentazione in `docs/API.md`.
- Adattatori per Traccar Client/OsmAnd, OwnTracks e GPSLogger, con guida per Android in `/gestisci` (Traccar Client). **Non ancora provati su un telefono Android: nella pagina di gestione la guida è segnata «sperimentale» finché non c'è una prova.**
- Script delle migrazioni: `npm run migrate` (`--dry` per vedere cosa farebbe).

Rimandato (con motivo):
- `endRace` asincrono: oggi l'archiviazione dura pochi secondi al massimo e ha un nuovo tentativo giornaliero; si rivede se i tempi crescono.
- Esportazione JSON/GPX: l'unico dato non già nel report sarebbe lo storico GPS, che per scelta di privacy non esce dal sistema.
- Cache per istanza per ridurre i comandi Redis: prima misurare il consumo con una gara vera (rischio di dati vecchi, ad esempio sul consenso).
- Link di gestione rigenerabile e anteprima «come lo vede chi segue».
- Altri formati di tracciamento oltre ai quattro attuali; Cloudflare, app native, integrazioni con Strava/Garmin/Apple/Health Connect, LoRa.

## Da fare prima del lancio pubblico
- Prova su iPhone con Overland: il corridore apre il suo link, dà il consenso, poi parte l'app.
- Controllare in produzione mappe, meteo e pagine con la CSP; provare l'archivio su Neon con una gara vera.
- Verificare per iscritto la regione del database Upstash (la privacy cita Francoforte solo per Vercel e Neon).
- Verificare la retention dei log di Vercel e dei backup di Neon e Upstash.
- Sostituire il contatto con una casella dedicata (oggi ciao.madesign@gmail.com).
- Far rivedere privacy, condizioni e `docs/pre-dpia.md` da un legale o DPO.
- Rivalutare le licenze delle mappe (Esri, OpenTopoMap) e i limiti dei servizi gratuiti.
- Confermare l'opacità della trama di sfondo (`public/css/app.css`, oggi 9%).
- Cambiando dominio: aggiornare canonical, `og:url`, `og:image`, sitemap, robots e dati strutturati.

## Prima di un eventuale uso commerciale
Surfer è oggi gratuito e senza scopo di lucro. Prima di un uso commerciale: lasciare Vercel Hobby (solo uso non commerciale), passare a un piano Open-Meteo commerciale o ad altra fonte meteo, rifare la verifica delle licenze delle mappe e aggiornare condizioni e privacy.

## Altre attività
- Logo: il simbolo attuale è provvisorio. Per sostituirlo basta cambiare `public/logo-surfer.svg`, `public/favicon.svg`, `public/apple-touch-icon.png` (180 px) e `public/og-image.png` (1200×630).
- Landing: controllare le foto su telefono e computer; decidere se usare la foto dell'escursione; demo con percorso e checkpoint di esempio (citare l'organizzatore del tracciato o chiedere il permesso).
- Checkpoint scelti direttamente sulla mappa.
- Android a schermo spento: richiede un'app (vedi sopra).
- Profilo con chiave (scade dopo 90 giorni senza accesso, massimo 1 anno) o con email (conferma dopo 1 anno, eliminazione a 1 anno + 60 giorni) e dashboard «Le mie gare»: sul database solo tempi, statistiche e, per i profili, il percorso.

## 6. Un solo dominio con WizTrail
Obiettivo: evitare due domini separati.
- Strada consigliata: stesso dominio, due progetti Vercel. WizTrail inoltra a Surfer un percorso (regola di rinvio); i due progetti si pubblicano separatamente.
- Alternativa: un solo progetto Vercel. Più ordinato, ma sul piano gratuito c'è un limite di funzioni serverless e vanno fusi archivi e attività programmate.
- Da decidere prima del lancio (i link già condivisi non devono rompersi): percorso (`/surfer/…`) oppure sottodominio, e dominio proprio al posto di `wiz-trail.vercel.app`.

## Decisioni prese
- Mappe: si tengono Esri World Imagery e OpenTopoMap con attribuzione (da rivalutare prima di aprire a molti utenti).
- Dati dopo la gara: su Neon nome, tempi, statistiche e consenso restano 3 giorni, legati solo all'id del partecipante nella gara (mai a IP o dispositivo); l'IP compare solo come hash con sale giornaliero nel contatore anti-abuso (2 giorni) e nei log di Vercel.

## Fuori dalla versione attuale
Cronometraggio ufficiale, smartwatch, frequenza cardiaca, storico GPS permanente, SOS, classifiche, social.
