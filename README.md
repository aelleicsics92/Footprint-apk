# Footprint

**Traccia il cammino, rispetta il bosco.** App Android per trekking e ricerca funghi/tartufi.

Mappa satellitare e topografica con sentieri CAI, mappe offline, tracce GPS, waypoint, bussola, SOS, meteo, riconoscimento AI (impronte, escrementi, erbe, funghi, versi), previsione crescita funghi su tutta Italia.

## Build

La build parte da sola a ogni push su `main` (GitHub Actions) e pubblica APK e AAB nella sezione **Releases**.

### Chiavi AI (Settings → Secrets and variables → Actions)
`GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`. Non scrivere mai le chiavi nel codice (il repository è pubblico).

### Firma stabile (consigliata per il Play Store)
Aggiungi i secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Senza, le build usano la chiave di sviluppo fissa `android/footprint-dev.keystore` (solo per test, non per il Play Store).

## Sviluppo locale
```
npm install
npm run dev        # anteprima nel browser
npm run sync       # build web + sync Android
npm run icons      # rigenera icone e splash
```
