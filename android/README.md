# App Surfer Live (Android)

App nativa per il corridore: invia la posizione GPS a Surfer anche a schermo spento, senza browser né app di terzi. Stessa logica dell'app iPhone (`ios/`): frequenza adattiva 15 s (corsa) / 30 s (lento) / 60 s (sosta), coda su disco senza rete, consenso esplicito, «Interrompi» cancella i punti non inviati.

> **Provata su emulatore (25/11/2026)**: compila (serve JDK 17 per Gradle), collegamento, consenso, invio dei punti e visualizzazione in `/live` funzionano. **Non ancora provata su telefono reale**: schermo spento a lungo, rete assente, risparmio energetico, batteria.

## Struttura (fase B)
- `HomeActivity`: scelta del ruolo (Spettatore, Runner, Organizzatore); ricorda l'ultima scelta e la riapre da sola. «Torna alla scelta» è in ogni schermata di ruolo.
- `RunnerActivity`: il corridore (collegamento, consenso, condivisione). Un link `/track` lo apre direttamente.
- `ViewerActivity`, `OrganizerActivity`: per ora solo titolo e ritorno alla scelta; il contenuto arriva nelle fasi C e D della `ROADMAP.md`. I loro link (`/live`, `/gestisci`) non sono ancora intercettati dall'app e si aprono nel browser.
- `BaseActivity`: grafica comune; `Role`: ruolo salvato; testi della schermata iniziale in `res/values/strings.xml` (le frasi sotto i pulsanti sono vuote finché non vengono scritte).

## Come funziona (corridore)
- **Collegamento**: tre modi. 1) *Scansiona il QR code* dentro l'app (scanner di Google, serve Google Play Services, nessun permesso fotocamera). 2) Il QR di `/gestisci` è un link `…/track#codice`: con la fotocamera del telefono Android propone di aprirlo con *Surfer Live*. 3) Incolla il link o il codice nel campo.
- **Consenso** dato nell'app (stesso testo e stessa API del sito: `/api/device/consent`).
- **Condivisione**: servizio in primo piano con notifica sempre visibile; il token è salvato solo nello spazio privato dell'app. Dopo un riavvio del telefono **non riparte da sola**.
- **Cancella i miei dati**: `DELETE /api/device/me` e scollegamento.
- Una sola libreria: lo scanner QR di Google. Nessun tracker, nessun account Google. Senza Play Services resta il collegamento da link.

## Compilare
1. Android Studio → *Open* → cartella `android/` (il wrapper Gradle viene generato da Studio).
2. Telefono Android con *Opzioni sviluppatore → Debug USB*, poi **Run ▶**.
3. Per distribuire un APK: *Build → Generate Signed Bundle / APK*.

## Da provare sul telefono
Schermo spento 30 minuti, galleria/tunnel senza rete e ripristino, risparmio energetico, telefoni con gestione batteria aggressiva (Xiaomi, Samsung, Huawei: usa il pulsante «Consenti uso batteria senza limiti»), autonomia.

## Passi successivi
- Dominio: il link è agganciato a `surfer-eta.vercel.app` (`AndroidManifest.xml`); cambiando dominio va aggiornato.
- Link verificati (apertura diretta senza scelta): servono `/.well-known/assetlinks.json` e `android:autoVerify`, dopo aver fissato la firma dell'app.
- Icona definitiva, pubblicazione su Play Store o APK dal sito.
