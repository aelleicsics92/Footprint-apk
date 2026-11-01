# Footprint: risposte per "Sicurezza dei dati" (Play Console)

Percorso: Play Console > Contenuti dell'app > Sicurezza dei dati. URL informativa privacy: https://aelleicsics92.github.io/Footprint-apk/privacy.html

## Domande generali
- L'app raccoglie o condivide tipi di dati utente richiesti? **Sì**
- Tutti i dati sono criptati in transito? **Sì** (HTTPS)
- Gli utenti possono chiedere la cancellazione dei dati? **Sì** (in app: Impostazioni > Backup online > Elimina i miei dati dal cloud; oppure via email)
- Link per richiedere la cancellazione: stessa pagina privacy

## Tipi di dati dichiarati
| Categoria | Tipo | Raccolto | Condiviso | Obbligatorio o facoltativo | Scopo |
|---|---|---|---|---|---|
| Posizione | Posizione precisa | Sì (waypoint e tracce nel backup) | No | **Facoltativo** (solo con consenso al backup) | Funzionalità dell'app, backup |
| Posizione | Posizione approssimativa | Sì | **Sì** (Open-Meteo, mappe: coordinate per il meteo) | Facoltativo (solo se usi meteo e previsioni) | Funzionalità dell'app |
| Foto e video | Foto | Sì (backup) | **Sì** se usi il riconoscimento (Google Gemini, Groq, OpenRouter) | Facoltativo | Funzionalità dell'app, backup |
| Audio | File audio / registrazioni vocali | Sì (memo nel backup) | **Sì** se usi la trascrizione (Groq) | Facoltativo | Funzionalità dell'app, backup |
| ID dispositivo o altri ID | ID utente (anonimo) | Sì | No | Facoltativo | Backup, gestione dell'account |
| Informazioni personali | Indirizzo email | Sì, solo se colleghi l'email | No | Facoltativo | Gestione dell'account |

Non raccolti: nome, contatti, cronologia di navigazione, messaggi, dati finanziari, salute, pubblicità, analisi.

## Note per i servizi esterni (condivisione)
- "Condiviso" va selezionato per i dati inviati a terzi che non sono semplici "fornitori di servizi" sotto contratto: per le richieste ad Open-Meteo, mappe e AI conviene dichiararli come **condivisi** con scopo "Funzionalità dell'app", marcati come facoltativi.
- Il radar compagni scambia dati solo tra telefoni degli utenti (Nearby), non con server tuoi.

## Altri moduli da compilare
- **Autorizzazioni sensibili**: posizione in background (spiega: registrazione traccia con schermo spento, serve un breve video dimostrativo), foreground service di tipo posizione.
- **Pubblico di destinazione**: 18+ (o 13+), non per bambini.
- **Annunci**: l'app non contiene annunci.
- **Informativa sulla privacy**: URL sopra.
