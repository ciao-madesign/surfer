# Prossimi passi

Ordine indicativo. Regola guida: la soluzione più semplice, gratuita e a basso rischio.

## 1. Landing e testi
- Rivedere i testi uno alla volta (microcopy) con il responsabile del progetto.
- Controllare le foto su telefono e computer; decidere se usare la foto dell'escursione (non ancora inserita).
- Demo: percorso e checkpoint di esempio. Citare l'organizzatore del tracciato o chiedere il permesso; sostituire i ristori generici.
- Sostituire l'indirizzo email di contatto con una casella dedicata.

## 2. Creazione guidata
Fatto (`/gestisci`): percorso in 4 passi (corridori, collegamento telefoni con QR code, link per chi segue con QR e pulsante Condividi, avvio), istruzioni separate per iPhone e Android, controllo «Segnale ricevuto ✓» per ogni corridore.
Da fare:
- Provarlo sul campo con un telefono vero (iPhone e Android): QR, permessi di posizione, comportamento a schermo spento.
- Android a schermo spento: aggiungere un'app (vedi punto 3).
- Rivedere i testi di `/crea` e `/gestisci` (rifinitura finale di UX).
- Checkpoint scelti direttamente sulla mappa.

## 3. Altre app di tracciamento
Traccar, OwnTracks, GPSLogger (oltre a browser e Overland), con una breve guida per ciascuna.

## 4. Profilo personale e dashboard
- Con chiave (senza registrazione): scade dopo 90 giorni senza accesso, massimo 1 anno.
- Con email: conferma dopo 1 anno, altrimenti eliminazione a 1 anno + 60 giorni.
- Dashboard «Le mie gare» con storico dei report. Sul database restano solo tempi, statistiche e (per i profili) il percorso; lo storico GPS completo resta su Redis e si cancella dopo 24 ore.

## 5. Verifiche prima dell'apertura al pubblico
- Prova completa dell'archivio su Neon con una gara vera.
- Informativa privacy e condizioni: revisione da parte di un professionista.
- Licenze: Esri, OpenTopoMap, Open-Meteo, Vercel Hobby (uso non commerciale).
- Integrazione con WizTrail: da studiare.

## 5b. Audit di UX, flussi e privacy/consensi
Audit più profondo dopo i testi: percorsi completi (organizzatore, corridore, chi segue), gestione dei consensi (browser e Overland, minorenni), informative, tempi di conservazione, messaggi di errore e casi limite.

## 5b-bis. Decisione mappe
Si tengono Esri World Imagery e OpenTopoMap con attribuzione (decisione di novembre 2026). Da rivalutare prima di aprire a molti utenti: condizioni Esri fuori da ArcGIS e carico su OpenTopoMap non verificati.

## 5b-ter. Dati dopo la gara (decisione di novembre 2026)
Su Neon restano per 3 giorni nome, tempi e statistiche (poi il cron li cancella): la privacy va aggiornata a 3 giorni. Verificato: su Neon nome e statistiche sono legati solo all'id del partecipante dentro la gara (generato alla creazione del codice di accesso), mai a indirizzo IP o a hash del token del dispositivo. L'IP compare solo come hash nel contatore anti-abuso di Redis (2 giorni, non collegato a gare o corridori) e nei log di Vercel. Da fare: hash IP con sale giornaliero (fase 4). Legame con profilo solo per chi è registrato (account_id).

## 5c. Prima di un eventuale uso commerciale
Oggi Surfer è gratuito e senza scopo di lucro (lo dicono le condizioni). Prima di qualsiasi uso commerciale: lasciare Vercel Hobby (solo uso non commerciale), passare a un piano Open-Meteo commerciale o ad altra fonte meteo, rifare la verifica delle licenze delle mappe (Esri, OpenTopoMap) e aggiornare condizioni e privacy.

## 5d. Da fare prima del lancio pubblico
- Verificare per iscritto la regione del database Upstash (la privacy cita Francoforte solo per Vercel e Neon).
- Verificare la retention dei log di Vercel e dei backup di Neon e Upstash.
- Sostituire il contatto con una casella dedicata (oggi cia.madesign@gmail.com).
- Far rivedere privacy, condizioni e `docs/pre-dpia.md` da un legale o DPO.
- Prova su iPhone con Overland dopo la fase 5: il corridore deve aprire il suo link e dare il consenso, altrimenti le posizioni non vengono accettate.

## 6. Un solo dominio con WizTrail
Obiettivo: evitare due domini separati.
- Strada consigliata: stesso dominio, due progetti Vercel. WizTrail inoltra a Surfer un percorso (regola di rinvio); i due progetti si pubblicano separatamente.
- Alternativa: un solo progetto Vercel. Più ordinato, ma sul piano gratuito c'è un limite di funzioni serverless e vanno fusi archivi e attività programmate.
- Da decidere prima del lancio (i link già condivisi non devono rompersi): percorso (`/surfer/…`) oppure sottodominio, e dominio proprio al posto di `wiz-trail.vercel.app`.

## Fuori dalla versione attuale
Cronometraggio ufficiale, smartwatch, frequenza cardiaca, storico GPS permanente.
- Trama di sfondo (`public/css/app.css`, opacity): ora 9%, da confermare prima del go-live.
