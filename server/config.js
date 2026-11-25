// Costanti di configurazione condivise dai moduli del server.
export const DAY = 86400;
export const KEEP_AFTER_END = DAY;          // 24 ore dalla fine della gara
export const SAFETY_TTL = 3 * DAY;          // rete di sicurezza: posizioni GPS di gare mai chiuse e archiviazioni da ripetere
export const DRAFT_TTL = 15 * DAY;          // gara non avviata: link e bozza durano 15 giorni dalla creazione
export const LIVE_TTL = 7 * DAY;            // gara avviata e mai chiusa: 7 giorni dall'avvio (poi 24 ore dopo la fine)
export const MAX_PARTICIPANTS = 20;   // corridori per gara (modificabile con la variabile MAX_PARTICIPANTS)
export const CONSENT_VERSION = '1';   // versione del testo di consenso mostrato al corridore
export const MAX_HISTORY = 9000;     // punti per corridore: copre le 36 ore di una gara a un punto ogni 15 s
export const STALE_MS = 180000;      // senza segnale oltre 3 minuti: stato «senza connessione» e stima d'arrivo sospesa
export const MAX_BATCH = 120;
export const RATE_PER_MIN = 30;
export const IP_PER_DEVICE_MIN = 600;   // richieste al minuto per rete dalle app dei corridori (stessa rete alla partenza)
export const IP_PER_MIN = 120;       // richieste al minuto per rete (gli accessi con credenziali sbagliate ne valgono 6)
export const ANON_REPORT_DAYS = 3;  // gare senza profilo: tempi e statistiche restano 3 giorni
export const AUTO_END_HOURS = 36;   // chiusura automatica di una gara dimenticata aperta
export const MAX_ACC = 150;        // m: precisione peggiore accettata
export const MAX_SPEED = 12;       // m/s: oltre, un salto di posizione è considerato anomalo
export const MAX_ANOM = 3;         // salti consecutivi scartati prima di fidarsi della nuova posizione
export const OFF_COURSE_M = 300;   // m: oltre, il punto non fa avanzare la progressiva sul percorso
export const MAX_PROG_ANOM = 5;    // avanzamenti irreali consecutivi prima di accettarli
export const BACK_KM = 0.5;        // km: se la posizione sul percorso è più indietro di tanto rispetto alla progressiva…
export const MAX_BACK_ANOM = 8;    // …per tanti invii consecutivi (≈2 min in corsa), la progressiva viene riallineata (mai dopo l'arrivo)
export const COLORS = ['#e91e63', '#2bb7da', '#f4c20d', '#34a853', '#8e24aa', '#ff7043', '#00bfa5', '#5c6bc0', '#c0ca33', '#d81b60', '#26c6da', '#8d6e63'];
export const STATUS_LABEL = { waiting: 'In attesa', tracking: 'Segnale attivo', paused: 'In pausa',
  no_gps: 'Senza segnale GPS', offline: 'Senza connessione', finished: 'Gara conclusa' };
