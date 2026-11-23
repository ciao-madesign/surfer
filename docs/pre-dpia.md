# Valutazione preliminare d'impatto (pre-DPIA) — Surfer · Live

Versione 1 · novembre 2026 · documento interno, da confermare con un legale o DPO prima del lancio pubblico.

## Trattamento
Condivisione in tempo reale della posizione GPS di un corridore, con il suo consenso, a chi ha il link della gara.

## Dati
Nome o pseudonimo; posizione GPS e orario; data e versione del consenso; tempi e statistiche. Nessuna email, nessun telefono, nessun profilo (per ora).

## Scala e durata
Piccoli eventi: fino a 20 corridori per gara, anche con iscrizione autonoma tramite link. Posizioni cancellate entro 24 ore dalla fine; tempi e statistiche 3 giorni; bozze 15 giorni.

## Misure già presenti
Consenso esplicito del corridore (non retroattivo, età minima 14 anni o consenso del genitore); link privati non indicizzabili; cancellazione da parte di corridore e organizzatore; nessuna API che restituisce lo storico GPS; nessun profilo o tracciamento pubblicitario; limiti anti-abuso con indirizzi di rete pseudonimizzati e cancellati dopo 2 giorni.

## Criteri di rischio considerati
Dati di localizzazione (rischio elevato per natura), possibili minori, trattamento su piccola scala, nessun profilo, nessun trattamento automatizzato con effetti giuridici, nessun dato particolare (art. 9).

## Valutazione preliminare
Una DPIA formale non appare obbligatoria oggi (piccola scala, conservazione breve, nessuna profilazione), ma non è esclusa: va verificato l'elenco dei trattamenti del Garante. [da confermare con legale/DPO]

## Quando rifarla
Una DPIA completa va fatta prima di introdurre: profili con email o chiave personale, tracciamento regolare di minori, più di pochi partecipanti per gara o eventi di grandi dimensioni, nuove integrazioni (Traccar, OwnTracks, GPSLogger) o conservazione più lunga.

## Punti aperti
- Regione del database live (Upstash): da verificare per iscritto.
- Retention dei log di Vercel e dei backup di Neon e Upstash: da verificare.
- Contatto: oggi una casella personale; da sostituire con una dedicata.
- Ruolo giuridico dell'organizzatore (titolare autonomo, contitolare o uso domestico): dipende dal contesto, da definire con un professionista.
