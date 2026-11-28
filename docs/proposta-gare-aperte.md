# Proposta: gare aperte con iscrizione dei corridori

Stato: idea per sviluppo futuro, con valutazione di novembre 2026 (sotto). Nessuna modifica al codice.

## Valutazione (novembre 2026)

**Giudizio**: buona direzione di lungo periodo, ma troppo grande per essere un'evoluzione immediata. Si fa un primo passo piccolo, si misura, e il resto si rimanda.

**Cosa funziona**
- Dice con onestà che il «Via» non accende il GPS dei telefoni.
- L'iscrizione autonoma si adatta bene al consenso: è il corridore ad agire e a dare il consenso; l'organizzatore non deve più configurare ogni telefono.
- L'ordine in fasi è sensato.

**Cosa cambia davvero**
1. **Privacy e legge**: con molte persone e iscrizione pubblica la DPIA diventa probabilmente obbligatoria (vedi `docs/pre-dpia.md`). Revisione legale prima di aprire, non dopo.
2. **«Gratis» non regge su larga scala**: ogni invio costa circa 10–15 comandi Redis; una gara da 200 corridori supera i 500.000 comandi mensili del piano gratuito di Upstash. Costo basso (pochi euro), ma non più zero.
3. **Pubblicità**: contraddice «senza cookie» e rende il progetto commerciale (fuori da Vercel Hobby). Sconsigliata; gli sponsor diretti senza tracciamento sono compatibili.
4. **Limiti attuali non adatti a un evento**: 120 richieste al minuto per rete (sul Wi-Fi della griglia di partenza bloccherebbe i corridori), tetto di 5 corridori nel codice, risposta `live` in cache per link (con un link per gruppo serve la «fotografia unica»).
5. **Garmin MapShare**: non verificato, i termini d'uso per terzi vanno controllati; invia una posizione ogni 2–10 minuti mentre Orme dà «senza connessione» dopo 3: servirebbe una soglia per sorgente.
6. **App nostra**: impegno e manutenzione sottostimati; l'approvazione degli store per la posizione in background è difficile.

**Da rimandare**: pubblicità, Garmin, app nostra, Cloudflare, mappa pubblica, gruppi.

## Primo passo: iscrizione autonoma (piano)

Obiettivo: il corridore si iscrive da solo con un link, dà il consenso e riceve il proprio tracker. Nessun gruppo, nessuna nuova infrastruttura; tetto da 5 a 20 corridori.

**Decisioni prese (novembre 2026)**: tetto 20; un solo link di gara che mostra tutti; iscrizioni aperte con tetto; nessuna iscrizione per conto di altri. Realizzato: interventi 1–8 (vedi sotto); restano le verifiche pre-lancio.

**Decisioni da prendere prima di iniziare (storico)**
1. Tetto di corridori per gara aperta (proposta: 20).
2. Chi segue: un solo link di gara che mostra tutti (proposta, semplice) oppure un link per corridore (più lavoro, rimandato).
3. Iscrizioni: aperte con tetto (proposta) o con approvazione dell'organizzatore.
4. Minori: dichiarazione già presente nel consenso (14 anni o genitore); nessuna iscrizione per conto di altri nel primo passo.

**Interventi, in ordine (senza sovrapposizioni)**
| # | Intervento | File | Note |
|---|---|---|---|
| 1 | Tetto di corridori per gara configurabile (oggi fisso a 5) e UI di gestione per 20 righe | `server/config.js`, `races.js`, `public/js/gestisci.js` | Solo numeri e layout; nessun cambio ai dati |
| 2 | Le richieste dei corridori (`device/*`) non contano nel limite per rete, ma restano limitate per corridore e per credenziale errata | `server/handler.js` | Serve prima di tutto il resto: il Wi-Fi della griglia |
| 3 | Link di iscrizione dell'organizzatore (si crea, si disattiva, si rigenera), salvato come hash | `server/races.js`, `server/repo.js` | Stesso schema del link di visualizzazione |
| 4 | `POST /api/enroll` con token di iscrizione: crea il corridore, registra il consenso, restituisce il codice una sola volta; limite per rete; tetto rispettato | `server/races.js` | Il consenso è dato nello stesso gesto |
| 5 | Pagina `/iscriviti#token`: nome, consenso, poi QR/link del tracker e istruzioni iPhone/Android | `public/iscriviti.html`, `public/js/iscriviti.js` | Riusa testi e componenti di `/track` e `/gestisci` |
| 6 | Pannello organizzatore: link di iscrizione, elenco, stato «pronto», rimozione, «Via» | `public/js/gestisci.js` | Già in gran parte presente |
| 7 | Privacy e condizioni: iscrizione autonoma, ruolo dell'organizzatore, chi vede cosa | `public/privacy.html`, `public/condizioni.html` | Per ultimo, dopo il codice |
| 8 | Test (iscrizione, tetto, consenso, limiti), documentazione in `docs/API.md` | `tests/`, `docs/` | Ogni intervento con i suoi test |

**Prima di aprirlo al pubblico**: revisione legale, misura reale del consumo Redis con una gara vera, controllo dei termini dei servizi gratuiti.
**Criterio di completamento**: un'iscrizione di prova da iPhone e una da un altro telefono, con consenso registrato, tracker collegato e corridore visibile a chi segue; test automatici verdi.

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
- avvio gara: il comando dell'organizzatore esiste già lato server. I punti prima del «Via» però non vengono scartati: sono salvati e mostrati, e contano solo per i checkpoint e per il tempo di gara;
- controllo «Segnale ricevuto ✓» per corridore;
- app Overland (schermo spento) e tracker da browser.

Cosa manca: pagina di iscrizione pubblica, concetto di «gruppo», pannello organizzatore per molti corridori, avviso di partenza, e una gestione del carico diversa.

## Il punto critico: il «Via» non accende i telefoni

Non si può avviare a distanza il GPS di un telefono (né da browser né con Overland). Il comando dell'organizzatore può solo **avvisare** e **far partire il cronometro**.

Approccio consigliato, più semplice e affidabile:

1. I corridori accendono il tracking **prima** della partenza (in griglia, 10–15 minuti prima).
2. Il pannello dell'organizzatore mostra chi è «pronto» (segnale ricevuto) e chi no.
3. L'organizzatore preme «Via»: da quel momento i punti contano. Quelli precedenti restano visibili ma non contano per checkpoint e tempo (oggi; scartarli del tutto è una scelta da fare).
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
- **Vercel Hobby è per uso non commerciale**: pubblicità o accordi con gli organizzatori rendono il progetto commerciale anche se l'app resta gratuita. A quel punto serve il piano a pagamento oppure la migrazione (vedi sotto).

In sintesi: per corridori, spettatori e organizzatori il servizio resta gratuito. Per chi lo gestisce è gratis fino a qualche decina di corridori, poi ci sono costi piccoli ma reali, da coprire con pubblicità o accordi.

## Modello: servizio gratuito

L'app resta gratuita per tutti, senza piani a pagamento. Le entrate, se ci saranno, vengono da fuori:

- **Pubblicità** sulla pagina degli spettatori, che è quella più vista. Va tenuta discreta: banner sotto la mappa, mai sopra. Niente pubblicità per i corridori né nel pannello dell'organizzatore. Attenzione: i circuiti pubblicitari usano cookie di profilazione, quindi serve il banner di consenso. In alternativa si possono usare sponsor diretti senza tracciamento, più semplici dal punto di vista della privacy.
- **Accordi con gli organizzatori**: logo e sponsor della gara sulla mappa, link al sito della gara. L'organizzatore può portare i propri sponsor.
- **Tetti tecnici, non commerciali**: un limite di corridori per gara serve solo a tenere sotto controllo i costi. Si alza man mano che le entrate lo permettono, oppure su accordo con l'organizzatore.

## Migrazione fuori da Vercel (da valutare)

La struttura attuale lo rende semplice: le API sono una sola funzione indipendente da Vercel, le pagine sono file statici e i dati stanno su Upstash e Neon, che restano dove sono.

| Opzione | Pro | Contro |
|---|---|---|
| **Cloudflare (Pages + Workers)** | Piano gratuito generoso, uso commerciale ammesso, cache vicina agli spettatori | Ambiente diverso da Node, servono piccoli adattamenti |
| **Netlify** | Molto simile a Vercel, migrazione rapida | Limiti gratuiti simili, da verificare |
| **Piccolo server (VPS, pochi euro al mese)** | Costo fisso e prevedibile, nessun limite di richieste. È anche l'unica strada per i tracker GPS dedicati (vedi sotto) | Va tenuto aggiornato e monitorato |

Consiglio: Cloudflare per pagine e API. Un piccolo server va aggiunto solo se si decide di supportare i tracker GPS dedicati.

## Smartwatch e tracker GPS

Oggi la posizione arriva solo dal telefono. Altri dispositivi risolverebbero i problemi principali: batteria, schermo spento e copertura.

| Dispositivo | Come si collega | Fattibilità |
|---|---|---|
| **Garmin con inReach / Garmin Messenger** (satellitare) | Garmin pubblica una pagina «MapShare» con un indirizzo dati leggibile: il servizio la legge ogni pochi minuti | **Alta.** Funziona anche senza rete cellulare, ideale in montagna. Posizioni ogni 2–10 minuti |
| **Altri satellitari** (SPOT, Zoleo) | Simile: indirizzo dati pubblico da leggere periodicamente | Media, da verificare caso per caso |
| **Orologi Garmin** (senza satellitare) | Una piccola app per orologio (Connect IQ) che invia la posizione tramite il telefono abbinato | **Media.** Va sviluppata e pubblicata sullo store Garmin. Garmin LiveTrack non ha un accesso ufficiale per terzi |
| **Apple Watch** | App nativa (c'è già una bozza per iPhone in `ios/`) | Media-bassa: serve sviluppo e pubblicazione su App Store |
| **Wear OS (Android)** | App per orologio, oppure app generiche di tracking | Media |
| **Coros, Suunto, Polar** | Nessun accesso pubblico alla posizione in tempo reale | **Bassa** per ora |
| **Tracker GPS economici** (20–40 €, con SIM) | Parlano protocolli propri: serve un server sempre acceso che li riceva (es. Traccar) e inoltri le posizioni | Media: richiede il piccolo server. Utile per un organizzatore che vuole un kit di tracker da prestare |

Consiglio, in ordine: 1) satellitari Garmin tramite MapShare (poco lavoro, grande valore in montagna); 2) app per orologi Garmin; 3) tracker economici, solo se si passa a un server proprio.

Per il corridore cambia poco: in iscrizione sceglie «telefono», «orologio Garmin» o «satellitare» e segue le istruzioni dedicate.

## App nostra per il tracking (più avanti)

Invece di affidarsi a Overland o al browser, il tracking lo fa un'app nostra per iPhone e Android. Non è troppo complesso da sviluppare: la parte impegnativa è mantenerla e farla approvare dagli store.

**Vantaggi**
- Tracking a schermo spento su entrambe le piattaforme, senza app esterne.
- Posizioni conservate senza segnale e inviate appena torna (il browser oggi non lo fa).
- Frequenza di invio regolata da noi in base a batteria e gara.
- Un solo percorso per il corridore: iscrizione, collegamento e «Pronto», senza QR né configurazioni.
- Notifiche vere («la gara parte tra 15 minuti, attiva il tracking»).
- Base per le app su orologio (Apple Watch, Wear OS).

**Permessi: non serve «sempre»**
Se il corridore preme «Avvia» con l'app aperta, basta il permesso «mentre usi l'app»:
- iPhone: il tracking continua a schermo spento, con l'indicatore blu della posizione in alto.
- Android: l'app mostra una notifica fissa («Orme sta registrando la gara») e continua a funzionare.

Meno problemi con l'approvazione degli store e più fiducia da parte del corridore.

**Solo per i corridori**
Spettatori e organizzatori restano sul sito, senza installare nulla: è il punto di forza del progetto. Anche per il corridore il tracker da browser resta come alternativa.

**Come costruirla**

| Strada | Impegno | Note |
|---|---|---|
| Sito esistente impacchettato in un'app (Capacitor) + modulo nativo per il GPS | Basso | Riusa le pagine attuali; nativa è solo la parte del GPS. Adatta a un progetto senza framework |
| App multipiattaforma (React Native, Flutter) | Medio | Più «app vera», ma l'interfaccia va riscritta |
| Due app native (Swift e Kotlin) | Alto | Massimo controllo, doppio lavoro. In `ios/` c'è già una bozza Swift |

Consiglio: la prima strada.

**Limiti che restano**
- Il GPS non si accende da solo all'ora del via: il corridore tocca comunque «Avvia», ma la notifica lo ricorda.
- Su Android alcune marche (Xiaomi, Huawei, Samsung) chiudono le app in background: servono guide dedicate per marca.

**Costi e impegno**
- Sviluppo: una sola base di codice per iPhone e Android; prima versione in alcune settimane di lavoro. In `ios/` c'è già una bozza per iPhone, mai compilata.
- Store: Apple circa 99 $ l'anno, Google circa 25 $ una tantum. Entrambi controllano con attenzione le app che usano la posizione in background: va giustificato bene, possibili rifiuti.
- Manutenzione: ogni anno iOS e Android cambiano le regole sulla posizione; senza aggiornamenti l'app smette di funzionare.
- Privacy: dati uguali a oggi, ma la responsabilità diventa interamente nostra.

**Quando farla**
1. Prima: Traccar Client (iPhone e Android, una sola guida) e OwnTracks (configurazione con un link) come alternative a Overland, subito disponibili e quasi a costo zero. Per Android anche OsmAnd e Locus Map, spesso già installate (invio verso Orme da verificare).
2. Poi: l'app Orme, quando le gare aperte hanno un utilizzo reale. Diventa l'unica app consigliata; le altre restano per chi le usa già.

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

**Fase 4: dispositivi**
- Satellitari Garmin via MapShare.
- App per orologi Garmin.

**Fase 5: app nostra**
- App per iPhone e Android con tracking in background, notifiche di partenza e invio differito senza segnale.
- Poi app per Apple Watch e Wear OS.

**Fase 6: extra**
- Notifiche push, lista pettorali importata, vista allenatore con tempi intermedi della squadra.
- Spazio sponsor della gara e pubblicità sulla pagina degli spettatori.
- Eventuale migrazione (Cloudflare) e piccolo server per i tracker economici.

## Domande aperte
- Tetto iniziale di corridori per gara aperta: 30? 50?
- Pubblicità con circuito esterno o solo sponsor diretti?
- Quando migrare: prima di introdurre la pubblicità?
- Email obbligatoria, facoltativa o assente?
- Gara pubblica (mappa con tutti) da subito o solo più avanti?
- Chi è titolare dei dati: va deciso con un professionista prima del lancio.
