# App TrailTrack (iPhone)

Invia la posizione GPS al portale, anche con lo schermo spento. Frequenza adattiva: 15 s (corsa), 30 s (lento), 60 s (sosta). Senza rete i punti restano in coda sul telefono e partono al ritorno del segnale.

> **Non compilata né provata**: il codice è stato scritto senza Xcode. Se Xcode segnala errori, mandami il testo dell'errore e lo correggo.

## Installazione (Mac con Xcode, account Apple gratuito)

1. Apri Xcode → **File → New → Project → iOS → App**. Nome `TrailTrack`, Interface **SwiftUI**, Language **Swift**. Salva dove vuoi.
2. Elimina i file `TrailTrackApp.swift` e `ContentView.swift` creati da Xcode (Move to Trash).
3. Trascina nel progetto i 5 file `.swift` di questa cartella (spunta «Copy items if needed»).
4. Target **TrailTrack → Signing & Capabilities**: scegli il tuo Apple ID in *Team*. Poi **+ Capability → Background Modes** e spunta **Location updates**.
5. Target **→ Info**: aggiungi le chiavi indicate in `Info-additions.plist.txt`.
6. Collega l'iPhone, selezionalo in alto e premi **Run (▶)**. Sull'iPhone: Impostazioni → Generali → VPN e gestione dispositivo → autorizza il tuo Apple ID.
7. Con l'account gratuito l'app **scade dopo 7 giorni**: reinstalla da Xcode prima di ogni gara.

## Uso
1. Apri l'app, incolla il **codice di collegamento** dato dall'organizzatore, premi *Collega*.
2. *Avvia condivisione* → leggi e accetta l'avviso. Alla richiesta scegli posizione **«Sempre»** (oppure dopo, da Impostazioni → TrailTrack → Posizione).
3. Durante la gara tieni l'app aperta almeno una volta all'avvio, poi puoi spegnere lo schermo. La barra blu di iOS resta visibile: è normale.
4. *Interrompi condivisione* ferma subito tutto e cancella i punti non ancora inviati.

## Da provare sul telefono (test T01–T06)
Schermo spento per 30 minuti, uso di altre app, galleria o tunnel senza rete e ripristino, autonomia della batteria. Con la modalità risparmio energetico di iOS il GPS può rallentare: va disattivata durante la gara.
