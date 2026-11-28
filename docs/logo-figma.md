# Logo Orme: prossimo passo (Figma)

**Stato:** passo obbligatorio, da fare. Il logo attuale è l'immagine fornita dal responsabile, usata così com'è come soluzione provvisoria (PNG, non vettoriale).

**Base di partenza:** l'immagine del responsabile: cinque impronte di animale con artigli che salgono in diagonale e crescono, l'ultima verde acqua; sotto la scritta «orme» in minuscolo (carattere tondo, nero); icona bianca con angoli arrotondati. File attuale: `public/logo-orme.png`.

## Da realizzare in Figma
1. Ridisegnare il logo in vettoriale partendo dalla base (stesso stile, più pulito, stesse proporzioni).
2. Tre versioni:
   - **Completa** (impronte + scritta «orme»), per icone e condivisione.
   - **Solo impronte**, leggibile a 16–36 px (favicon, intestazioni di sito e app).
   - **Per sfondo scuro** (impronte e scritta chiare, ultima impronta verde acqua `#4fd1c5`): il sito e l'app sono scuri, oggi il logo compare come quadrato bianco.
3. Verificare la leggibilità a piccole dimensioni (favicon 16/32 px, icona Android in zona sicura circolare).
4. Colori: verde acqua del sito (`#4fd1c5` su scuro, `#14b8a6` su chiaro), nero/bianco per il resto.

## File da produrre e sostituire
- `public/logo-orme.png` (o SVG) e `public/favicon.png` (SVG possibile)
- `public/apple-touch-icon.png` (180 px, senza trasparenza)
- `public/og-image.png` (1200×630, ha ancora il vecchio logo)
- App Android: `android/app/src/main/res/drawable-nodpi/logo_mark.png` (intestazione), `ic_launcher_art.png` (icona; preferibile tornare a un vettoriale adattivo)
- Aggiornare i riferimenti se cambiano formato o nome (`public/*.html`, `vercel.json`).

## Note
- Il nome «Orme» è definitivo. Il dominio resta da decidere (oggi `surfer-eta.vercel.app`).
- Il logo di WizTrail nel footer (`public/logo-mark.svg`) non va toccato.
