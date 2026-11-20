# Prossimi passi

Ordine indicativo. Regola guida: la soluzione più semplice, gratuita e a basso rischio.

## 1. Landing e testi
- Rivedere i testi uno alla volta (microcopy) con il responsabile del progetto.
- Controllare le foto su telefono e computer; decidere se usare la foto dell'escursione (non ancora inserita).
- Demo: percorso e checkpoint di esempio. Citare l'organizzatore del tracciato o chiedere il permesso; sostituire i ristori generici.
- Sostituire l'indirizzo email di contatto con una casella dedicata.

## 2. Creazione guidata (priorità alta)
Percorso a passi, pensato per chi non è tecnico:
1. Gara: nome, GPX, checkpoint (anche scelti sulla mappa).
2. Partecipanti: nome e colore, fino a 5.
3. Collegamento del telefono di ogni corridore con **QR code** (apre la pagina di tracciamento già collegata, senza copiare codici).
4. **Istruzioni separate per iPhone e Android** (browser con schermo acceso; app per l'invio a schermo spento), con un controllo «sta arrivando il segnale».
5. Link per chi guarda, con QR e pulsante di condivisione.

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

## Fuori dalla versione attuale
Cronometraggio ufficiale, smartwatch, frequenza cardiaca, storico GPS permanente.
- Trama di sfondo (`public/css/app.css`, opacity): ora 9%, da confermare prima del go-live.
