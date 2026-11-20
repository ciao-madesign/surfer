# Proposta: gare aperte con iscrizione dei corridori

Stato: idea per sviluppo futuro. Nessuna modifica al codice.

## L'idea in breve

Oggi chi crea la gara fa tutto: aggiunge i corridori, collega i telefoni, crea il link per chi segue (massimo 5 corridori).

La proposta sposta il lavoro sui partecipanti:

| Ruolo | Cosa fa | Cosa riceve |
|---|---|---|
| **Organizzatore** | Crea la gara, carica GPX e checkpoint, condivide un solo link di iscrizione, preme «Via» | Pannello con chi è iscritto e chi è pronto |
| **Corridore** (o capitano di squadra) | Apre il link di iscrizione, inserisce nome/pettorale per sé o per più persone, collega il telefono | Un link da girare a parenti, amici o allenatore |
| **Spettatore** | Apre il link ricevuto | Mappa con *solo* le persone di quel gruppo |

Il gruppo è l'unità di base: un corridore singolo è un gruppo da 1; una squadra è un gruppo da N. Allenatore e compagni seguono tutta la squadra con un solo link.

Il valore: tracking live per gare piccole senza noleggiare tracker GPS. Il costo hardware resta sui telefoni dei partecipanti.

## Fattibilità

**Buona.** Gran parte esiste già:

- gare, GPX, checkpoint, link separati per corridore e per chi guarda;
- avvio gara: i punti prima del «Via» vengono già ignorati, quindi il comando dell'organizzatore esiste già lato server;
- controllo «Segnale ricevuto ✓» per corridore;
- app Overland (schermo spento) e tracker da browser.

Cosa manca: pagina di iscrizione pubblica, concetto di «gruppo», pannello organizzatore per molti corridori, avviso di partenza, e una gestione del carico diversa.

## Il punto critico: il «Via» non accende i telefoni

Non si può avviare a distanza il GPS di un telefono (né da browser né con Overland). Il comando dell'organizzatore può solo **avvisare** e **far partire il cronometro**.

Approccio consigliato, più semplice e affidabile:

1. I corridori accendono il tracking **prima** della partenza (in griglia, 10–15 minuti prima).
2. Il pannello dell'organizzatore mostra chi è «pronto» (segnale ricevuto) e chi no.
3. L'organizzatore preme «Via»: da quel momento i punti contano. Quelli precedenti vengono scartati (già oggi).
4. L'avviso «accendi il tracking» parte in automatico X minuti prima dell'orario di partenza, non al «Via».

### Come avvisare i corridori

| Canale | Pro | Contro |
|---|---|---|
| Pagina del corridore con conto alla rovescia | Gratis, nessun dato in più | Funziona solo se la pagina è aperta |
| Email | Semplice, affidabile | Serve l'email (dato personale in più); piani gratuiti con limiti giornalieri bassi |
| Notifiche push del browser | Gratis, immediate | Su iPhone solo se il sito è aggiunto alla schermata Home; molti non lo fanno |
| Messaggio nel gruppo WhatsApp della gara (lo manda l'organizzatore) | Zero sviluppo, lo leggono tutti | Manuale |
| SMS | Raggiunge tutti | A pagamento |

Consiglio: conto alla rovescia + email facoltativa nella prima versione; push in un secondo momento.

## Limiti e criticità

### Lato corridori (i più seri)
- **iPhone da browser**: serve lo schermo acceso. Per gare lunghe non è realistico: bisogna spingere Overland (o altre app). Questo va detto chiaramente in iscrizione.
- **Batteria**: per gare oltre 6–8 ore serve un powerbank o una frequenza di invio più bassa.
- **Copertura**: in montagna mancano tratti di segnale. Overland conserva i punti e li invia dopo; il browser no.
- **Affidabilità percepita**: è un servizio «al meglio possibile», non un cronometraggio. Va scritto ovunque, per evitare che un parente si allarmi per un punto fermo da 20 minuti.

### Lato organizzatore
- **Iscrizioni false o doppie**: un link pubblico può essere usato da chiunque. Rimedi: tetto massimo di iscritti, lista pettorali caricata dall'organizzatore (opzionale), possibilità di rimuovere iscritti.
- **Supporto il giorno della gara**: con 100 persone qualcuno avrà problemi col telefono. Serve una pagina di aiuto molto chiara e un «test del segnale» da fare il giorno prima.

### Privacy
- Oggi i dati restano tra pochi amici. Con gare aperte l'organizzatore raccoglie posizioni di molte persone: chi è titolare dei dati va chiarito (probabilmente l'organizzatore, con il servizio come fornitore). Serve una revisione legale prima del lancio.
- Consenso esplicito di ogni corridore; chi iscrive altri (capitano di squadra) deve dichiarare di avere il loro consenso.
- Minorenni: iscrizione solo da un genitore.
- Scelta dell'organizzatore: **gara privata** (ogni link vede solo il suo gruppo) oppure **gara pubblica** (esiste anche una mappa con tutti). La privata è il default.

### Carico e costi
Ordini di grandezza, da verificare sui listini attuali:

- **Invii dei corridori**: 200 corridori × 1 invio al minuto × 6 ore ≈ 70.000 invii, cioè qualche centinaio di migliaia di operazioni su Redis. Una sola gara così può consumare buona parte del piano gratuito mensile di Upstash. A consumo, il costo resta basso (indicativamente pochi euro a gara).
- **Spettatori**: oggi la risposta `live` è in cache 5 secondi *per link*. Con un link per gruppo, 200 gruppi = 200 risposte diverse: il numero di spettatori pesa poco, il numero di gruppi molto. Soluzione: una sola «fotografia» della gara aggiornata ogni 10–15 secondi, da cui ogni link legge solo il proprio gruppo.
- **Pannello organizzatore**: deve reggere 200 righe, con aggiornamento meno frequente.
- **Vercel Hobby è per uso non commerciale**: se il servizio è offerto a gare con quota di iscrizione, quasi certamente serve il piano a pagamento.

In sintesi: «praticamente gratis» per l'utente sì; per chi gestisce il servizio, gratis fino a qualche decina di corridori, poi costi piccoli ma reali.

## Opzioni di prodotto

1. **Tutto gratis con tetto** (es. 30 corridori): adatto a gare di paese, nessun costo da coprire.
2. **Gratis fino a N, a pagamento oltre**: l'organizzatore paga una piccola cifra per gara grande. Copre i costi e il piano Vercel commerciale.
3. **Sponsor/organizzatore paga, corridori gratis**: lo stesso modello di 2, venduto come servizio per la gara.

Consiglio: partire da 1 con un tetto basso, misurare costi reali su 2–3 gare, poi decidere.

## Percorso consigliato (a fasi)

**Fase 1: gara aperta minima**
- Link di iscrizione con tetto di iscritti.
- Iscrizione di sé o di un gruppo (nome o pseudonimo, pettorale facoltativo, consenso).
- Al termine: link del gruppo per chi segue + percorso guidato già esistente per collegare il telefono (QR, Overland).
- Pannello organizzatore: elenco, stato «pronto», rimozione iscritti, «Via».

**Fase 2: partenza e affidabilità**
- Orario di partenza con conto alla rovescia sulla pagina del corridore.
- Email di promemoria facoltativa.
- «Test del segnale» da fare il giorno prima.

**Fase 3: scala**
- Fotografia unica della gara per servire tutti i link.
- Frequenza di invio adattiva in base al numero di corridori.
- Mappa pubblica facoltativa con classifica per checkpoint.

**Fase 4: extra**
- Notifiche push, lista pettorali importata, vista allenatore con tempi intermedi della squadra.

## Domande aperte
- Tetto iniziale di corridori per gara aperta: 30? 50?
- Email obbligatoria, facoltativa o assente?
- Gara pubblica (mappa con tutti) da subito o solo più avanti?
- Chi è titolare dei dati: va deciso con un professionista prima del lancio.
