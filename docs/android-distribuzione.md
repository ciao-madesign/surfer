# Distribuire l'app Android (Orme Live)

Obiettivo: far installare l'app ad altri. Due strade, si possono fare entrambe.

## 0. La chiave di firma (una volta sola, da conservare per sempre)
Ogni aggiornamento deve essere firmato con la **stessa chiave**: se la perdi, non puoi più aggiornare l'app esistente.

1. Android Studio → *Build → Generate Signed App Bundle / APK* → *Create new…*
2. Scegli un percorso **fuori dal repository** (ad esempio `Documenti/orme-chiavi/orme.jks`), una password robusta, alias `orme`, validità 25+ anni.
3. **Fai almeno due copie** (disco esterno + un archivio cifrato/gestore password) e annota le password.
4. Per compilare da riga di comando crea `android/keystore.properties` (è ignorato da git):
   ```
   storeFile=C:/percorso/orme.jks
   storePassword=…
   keyAlias=orme
   keyPassword=…
   ```
Se usi il Play Store con «Play App Signing» (consigliato) Google custodisce la chiave definitiva e la tua è solo di caricamento, quindi perderla è recuperabile. Scegli comunque di conservarla bene.

## 1. Generare i file
- **APK** (installazione diretta): *Build → Generate Signed App Bundle / APK → APK → release*. File: `android/app/release/app-release.apk`.
- **AAB** (per il Play Store): stessa procedura, scegliendo *Android App Bundle*.
- Prima di ogni nuova versione aumenta `versionCode` (numero intero, sempre crescente) e `versionName` in `android/app/build.gradle.kts`.

## 2. APK dal sito (la più rapida)
1. Metti l'APK in un posto raggiungibile (ad esempio `public/app/orme-live.apk` oppure una release di GitHub) e pubblica un link nella pagina di gestione.
2. Chi lo scarica deve consentire «Installa app sconosciute» per il browser. Android e Play Protect mostrano avvisi: è normale per le app fuori dallo store.
3. Gli aggiornamenti non sono automatici: gli utenti scaricano l'APK nuovo.
4. Mostra l'impronta SHA-256 dell'APK accanto al link, così chi vuole può verificarlo.

## 3. Play Store (la strada per gli utenti comuni)
1. **Account sviluppatore**: play.google.com/console, 25 $ una tantum. Verifica d'identità (documento) e, per account personali, numero di telefono e indirizzo.
2. **Test chiuso obbligatorio per i nuovi account personali**: almeno 12 tester per 14 giorni consecutivi prima di poter chiedere la produzione (regola di Google, da verificare nella Console al momento).
3. **Scheda dell'app**: nome, descrizione breve e lunga, icona 512 px, immagine di presentazione 1024×500, almeno 2 screenshot del telefono.
4. **Privacy**: indirizzo della politica sulla privacy (`https://surfer-eta.vercel.app/privacy`, o quello definitivo).
5. **Sicurezza dei dati** (Data safety): dichiara la posizione precisa, raccolta e condivisa con chi ha il link della gara, cancellata entro 24 ore dalla fine; nome del corridore; possibilità di cancellare i dati dall'app.
6. **Servizio in primo piano di tipo posizione**: la Console chiede di spiegare l'uso di `FOREGROUND_SERVICE_LOCATION` e (se compare) un breve video. Motivo: condividere la posizione in tempo reale durante una gara a schermo spento, avviata e fermata esplicitamente dall'utente, con notifica sempre visibile. L'app **non** usa la posizione in background oltre al servizio (nessun `ACCESS_BACKGROUND_LOCATION`), quindi non servono le verifiche più severe.
7. **Classificazione dei contenuti** e **pubblico**: l'app non è pensata per minori; il consenso richiede almeno 14 anni o un genitore.
8. Carica l'AAB nel *Test chiuso*, invita i tester per email, attendi la revisione (di solito pochi giorni).

## 4. Link che aprono direttamente l'app (App Links)
Servono: dominio definitivo, `https://DOMINIO/.well-known/assetlinks.json` con l'impronta SHA-256 della chiave di firma e `android:autoVerify="true"` nel filtro del `AndroidManifest.xml`. **Da fare solo dopo la scelta del dominio e della firma.** Finché non c'è, il QR si scansiona nell'app o si incolla il link.

## 5. Prima di un uso commerciale
Vedi `ROADMAP.md`: licenze mappe, limiti dei servizi gratuiti, Vercel Hobby, revisione legale di privacy e condizioni.
