# Proposta: modalità Allenamento ed Escursione (e nuovo nome)

Stato: pianificazione del 28 novembre 2026. Nessuna modifica al codice. Le stime di costo sono ordini di grandezza da verificare.

## L'idea in breve

Una persona esce ad allenarsi o a fare un'escursione e decide di farsi seguire, come un «condividi posizione» sempre aggiornato, con quota e dati utili. Nessun organizzatore, nessun account. Una gara è già un gruppo di corridori che condividono la posizione con consenso: un'attività è la stessa cosa con **un solo corridore che fa tutto da sé**. Il motore (link per chi segue, posizione live, cancellazione dei dati) c'è già.

In più, il progetto cambia nome, perché «Surfer» e «gare» non descrivono più tutto.

## Decisioni prese (28 novembre 2026)

1. **Due modalità nuove**: Allenamento ed Escursione, accanto alle gare.
2. **Schermata iniziale dell'app**: «Gara», «Allenamento / Escursione» e «Segui» (per chi ha ricevuto un link o un codice). Chi vuole solo guardare può usare il link, senza installare nulla.
3. **Nell'escursione** si vedono quota e **coordinate**; **nell'allenamento** gli stessi dati delle gare (tempo, velocità, distanza, dislivello).
4. **GPX facoltativo** in entrambe le modalità.
5. **Dati cancellati** quando si preme «Termina condivisione» oppure **12 ore dopo l'avvio**, con possibilità di **prolungare**. Si usa lo stesso criterio delle gare (scadenza fissa dall'avvio): un solo meccanismo da gestire.
6. **Idee incluse**: rientro previsto, ultima posizione nota, batteria, zona privata in allenamento, copia locale della traccia, avviso «non è un servizio di soccorso». **Esclusi**: messaggi rapidi e SOS.
7. **Il nome nuovo si sceglie insieme** nei prossimi passi.
8. Resta valido il resto: Vercel, tetto di 20 corridori per le gare, prima Android, iOS quando c'è budget, Kotlin nativo.

## Come funziona per l'utente

**Avvio** (app o sito): scelgo la modalità → carico un GPX o no → do un nome all'uscita → facoltativo: ora di rientro previsto → do il consenso → avvio → ricevo il link da mandare (WhatsApp o altro) → «Termina condivisione».

| | Allenamento | Escursione |
|---|---|---|
| Chi segue vede | Tempo, velocità o passo, distanza, dislivello | Quota, **coordinate**, ora dell'ultimo segnale, batteria, ora di rientro |
| Con GPX | Avanzamento e arrivo stimato | Avanzamento e avviso «fuori percorso» |
| Senza GPX | Solo il percorso fatto finora | Solo il percorso fatto finora |
| Privacy | I primi e gli ultimi 200 m sono nascosti (per non rivelare dove si abita) | Nessun nascondimento: serve a chi deve poter arrivare dove sei |

**Rientro previsto**: se l'orario passa e l'uscita non è terminata, chi segue vede un avviso sulla pagina. Non serve nessuna notifica (quelle arrivano dopo).

**Ultima posizione nota**: senza rete le coordinate restano all'ultimo punto ricevuto, con l'orario bene in vista.

**Prolungamento**: poco prima della scadenza l'app avvisa («la condivisione finisce tra 30 minuti: prolungare di 12 ore?»). Sul sito il pulsante è nella pagina del corridore.

**Chiusura**: «Termina» cancella subito posizioni, link e nome. Chi apre il link vede per pochi minuti «Attività conclusa» (senza alcun dato di posizione), poi più nulla. Prima della cancellazione l'app offre di salvare la traccia sul telefono (GPX).

## Regole dei dati

| | Gare (oggi) | Attività (proposta) |
|---|---|---|
| Durata | Fino a 36 ore dall'avvio (chiusura automatica), poi 24 ore | 12 ore dall'avvio, prolungabili di 12 in 12 |
| Dopo la fine | Link 24 ore; tempi e statistiche 3 giorni nell'archivio | **Tutto cancellato subito** (salvo l'avviso «conclusa» di pochi minuti) |
| Archivio (Neon) e report | Sì | **No**: niente report, niente archivio |
| Chi decide | Organizzatore e corridore | Solo la persona che esce |

### Frequenza di registrazione (decisione 28/11)

Per contenere i costi Redis le attività registrano **meno punti** delle gare. Valori di partenza, fissi (non modificabili dall'utente) e da tarare con prove vere:

| | Gara (oggi) | Allenamento | Escursione |
|---|---|---|---|
| Un punto ogni | pochi secondi | circa 10 s | circa 60 s |
| Invio al servizio ogni | pochi secondi | circa 30 s | circa 2 minuti (più punti insieme) |
| Aggiornamento per chi segue | 5 s | 15 s | 30 s |

Effetto stimato: un'uscita di 3 ore passa da 5.000–15.000 comandi a circa 1.000–2.500 in escursione e 2.500–5.000 in allenamento, cioè **da 3 a 10 volte meno**. Il costo di ogni invio è quasi lo stesso a prescindere da quanti punti contiene, quindi conta soprattutto inviare di rado. Le soglie le applica anche il servizio (rifiuta invii più frequenti del previsto per quella modalità), così un'app modificata non le aggira.

Limite: in escursione la velocità e il filtro dei salti sono meno precisi (punti distanti un minuto), e «fuori percorso» reagisce con qualche decina di secondi di ritardo. Va bene per chi deve solo sapere dove ti trovi.

La scadenza si fa con la scadenza automatica dei dati su Redis, non con l'attività notturna: oggi quest'ultima gira **una volta al giorno** (limite del piano gratuito di Vercel) e chiuderebbe un'attività con ore di ritardo.

## Piano a fasi

Gli sforzi sono relativi (piccolo, medio, grande), non in giorni.

| Fase | Contenuto | Sforzo |
|---|---|---|
| **0. Nome** | Scegliere il nome insieme; verificare dominio, nome sugli store e marchio | Piccolo |
| **1. Rinomina** | Cambiare il nome ovunque in un solo passaggio, **prima** della pubblicazione dell'app e prima che circolino link con il nome nuovo; vecchio indirizzo che rimanda al nuovo | Medio |
| **2. Backend attività** | Nuovo tipo di attività (un corridore, senza organizzatore, consenso dato da chi esce); scadenza 12 ore con prolungamento; «Termina» che cancella tutto; statistiche anche senza GPX; zona privata; campi ora di rientro, batteria; limiti dedicati; test | Medio |
| **3. Sito** | Pagina di avvio dell'attività; pagina live adattata alle due modalità (dati, coordinate, avvisi); testi di privacy e condizioni; copia GPX in locale | Medio |
| **4. App Android** | Schermata iniziale con tre ingressi; **per prima l'attività**, perché è il flusso più semplice (niente QR, niente organizzatore) e permette di fare subito la prova tecnica del GPS a schermo spento per 3 ore; poi gara e «Segui» | Grande |
| **5. Sicurezza e notifiche** | Notifiche a chi segue (partenza, rientro in ritardo, segnale perso) e «prolunga» nell'app | Medio |
| **6. Più avanti** | iPhone, smartwatch, design system, bici, password facoltativa del link | — |

Le fasi 1–3 possono avanzare in parallelo alla bozza dell'app; la rinomina va coordinata con l'altra sessione Android, perché tocca anche i suoi file.

## Impatti sul progetto

| Area | Cosa cambia | Rischio | Come gestirlo |
|---|---|---|---|
| **Costi Redis** | Ogni invio costa circa 10–15 comandi; ogni pagina live aperta circa 3 ogni 5 secondi (con cache). Un'uscita di 3 ore vale 5.000–15.000 comandi. Il piano gratuito ne dà 500.000 al mese: bastano **poche decine di uscite** | **Alto** | Frequenza di invio più bassa (60 s in escursione), aggiornamento più lento per chi segue, misura con uscite vere prima del lancio. Oltre una certa soglia serve il piano a pagamento (stima: decine di € al mese per mille uscite) |
| **Privacy e legge** | Posizione precisa di una persona condivisa con chi riceve il link. Ci sono anche i minorenni. Il titolare e la base giuridica cambiano rispetto alle gare | **Alto** | Aggiornare `docs/pre-dpia.md`; testo di consenso nuovo; età minima da decidere con un professionista; durata breve (12 ore) già a favore |
| **Link = chiave** | Chi ha il link vede coordinate precise. Se il link finisce a persone sbagliate, la posizione è esposta | **Medio-alto** | Scadenza breve, avviso chiaro alla creazione, possibilità di revocare il link; password facoltativa più avanti |
| **Rinomina** | Circa 90 occorrenze in 30 file: pagine, testi legali, logo, mappa del sito, documenti, app Android e iPhone. Il pacchetto Android `it.surfer.live` **non si cambia dopo la pubblicazione** | **Medio** | Rinominare prima della pubblicazione. Le chiavi di Redis non contengono il nome e non si toccano. Indirizzo attuale mantenuto con rimando |
| **Limiti anti-abuso** | Oggi 5 gare al giorno per rete e 500 attive. Sulla rete del telefono molte persone condividono lo stesso indirizzo: i limiti bloccherebbero utenti normali | **Medio** | Limiti dedicati alle attività (per dispositivo), con tetto totale separato dalle gare |
| **Filtro velocità** | Oggi scarta i salti oltre 43 km/h: adatto a chi corre, non a bici o sci | **Medio** | Prima versione solo a piedi; bici e altro in seguito con soglie per sport |
| **Statistiche senza GPX** | Oggi senza traccia le statistiche non esistono | **Medio** | Calcolare distanza, dislivello, velocità e tempo dai soli punti ricevuti |
| **Pulizia notturna** | Gira una sola volta al giorno | **Medio** | Non usarla per le attività: scadenza diretta sui dati |
| **Archivio (Neon)** | Le attività non vi entrano | Basso (positivo) | Nessun carico in più |
| **Dati disponibili** | Quota e coordinate ci sono già nei dati; la **batteria** e l'ora di rientro no | Basso | Un campo in più; la batteria arriva dall'app (alcune app esterne la inviano, il browser su iPhone no) |
| **App Android** | Schermata iniziale e flusso nuovo: l'app crea l'attività da sola, senza collegamento con QR | Medio | Nuovo accesso all'API che restituisce subito chiave del telefono e link per chi segue |
| **Pagine pubbliche e documenti** | Testi che parlano solo di gare (home, privacy, condizioni, README) | Basso | Aggiornarli in fase 3 |
| **Sicurezza percepita** | Chi segue potrebbe fidarsi troppo («lo vedo, quindi sta bene») | Medio | Avviso fisso: non è un servizio di soccorso; ultima posizione e orario sempre visibili |

## Rischi principali

1. **Costi che crescono con gli utenti**: le attività sono molto più numerose delle gare. Il tetto di Redis è il vincolo vero del progetto, non il codice.
2. **Fiducia e privacy**: più dato personale, in mano a persone diverse da un organizzatore. Va comunicato bene e fatto rivedere.
3. **Rinomina troppo tardi**: dopo la pubblicazione sullo store il pacchetto Android non si cambia.

## Domande aperte

- Nome nuovo (si sceglie insieme).
- Età minima e testo di consenso (professionista).
- Password facoltativa sul link: serve già in prima versione?
- Allenamento ed escursione solo a piedi all'inizio?
- Il pulsante «Segui» nell'app: link, codice, o entrambi?
- Dopo «Termina», quanto resta visibile «Attività conclusa» (suggerito: pochi minuti)?
