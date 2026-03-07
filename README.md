# SegnalaOra — Segnalazioni Civiche

Strumento open source per segnalare problemi del territorio al proprio Comune: buche stradali, rifiuti abbandonati, illuminazione pubblica guasta, verde incurato e molto altro.

**Zero backend** — gira interamente su GitHub Pages. I dati vengono salvati su Google Sheets tramite Google Apps Script e pubblicati come Open Data in formato CSV.

---

## Funzionalità principali

### 📷 Form di segnalazione (`index.html`)

Wizard a 4 step guidato:

1. **Foto** — scatta o carica un'immagine; il GPS viene estratto automaticamente dai metadati EXIF
2. **Posizione** — marker trascinabile su mappa Leaflet/OpenStreetMap; geocoding inverso automatico con Nominatim
3. **Dettagli** — categoria (13 tipologie), livello di urgenza, descrizione, nome ed e-mail obbligatori
4. **Invio** — trasmette i dati a Google Sheets (Apps Script), apre i canali selezionati (email Comune, Polizia Locale, WhatsApp, Twitter/X, Facebook) e invia una **e-mail di conferma** automatica al segnalante

Ogni segnalazione riceve un **ID univoco** (`SGN-<timestamp>`) copiabile con un clic e un **token segreto** monouso usato per la risoluzione sicura.

### 🗺️ Mappa pubblica (`mappa.html`)

- Visualizza tutte le segnalazioni su mappa interattiva con marker colorati per urgenza
- **Tab Aperte / Risolte** — alterna tra segnalazioni attive e già risolte
- Filtri per urgenza e stato nel pannello laterale
- Popup per ogni segnalazione con dettagli, foto (se disponibile) e badge di stato
- Ricerca/zoom automatico al click sulla lista laterale

### ✅ Workflow di risoluzione

La PA riceve nell'e-mail un link con token che apre un modal di conferma. La risoluzione:

1. Aggiorna `Stato → Risolta` e `Data_Risoluzione` direttamente nel foglio Google Sheets tramite Apps Script
2. Ricarica automaticamente la mappa dopo 4 secondi

Il **token** di risoluzione non è mai esposto nel CSV pubblico (rimosso automaticamente dal workflow di sincronizzazione).

### 📸 Upload immagini su GitHub

Le foto caricate vengono inviate in base64 ad Apps Script, che le scrive direttamente nella cartella `img/` del repository tramite GitHub API. L'URL di GitHub Pages viene memorizzato in `URL_Immagine` e mostrato nel popup della mappa.

### 📊 Statistiche (`statistiche.html`)

Dashboard con grafici interattivi aggiornati in tempo reale:

- **Schede riepilogative** — totale, aperte, alta urgenza, risolte (con filtro per categoria attivo)
- **Filtro per categoria** — chip interattivi per filtrare tutti i grafici simultaneamente
- **Grafici** — segnalazioni per categoria (barre orizzontali), per urgenza e per stato (doughnut), andamento nel tempo (barre verticali)
- Supporto **dark mode** con aggiornamento automatico dei colori degli assi

### 🗃️ Open Data & Download (`statistiche.html`)

Tutti i dati sono pubblici e scaricabili liberamente in formato CSV:

- **Tabella dati** — visualizza in un'unica tabella le segnalazioni di entrambi i fogli (*Segnalazioni* e *Risolte*), con colonna `Foglio` che indica la provenienza di ogni riga
- **Selezione colonne** — menu a tendina con checkbox individuali e "Seleziona tutte"; le colonne non significative sono escluse di default
- **Esporta CSV** — scarica istantaneamente solo le colonne visibili, con encoding UTF-8 (BOM per compatibilità Excel)
- **File CSV diretti** — `dati/segnalazioni.csv` e `dati/risolte.csv` aggiornati automaticamente ogni 30 minuti da GitHub Actions

---

## Architettura

```text
index.html  ──── POST JSON ──▶  Apps Script  ──▶  Google Sheets (foglio Segnalazioni)
                                              └── Gmail (conferma al segnalante)
                                              └── GitHub API (img/{ID}.jpg)

mappa.html       ◀── fetch CSV ──┐
statistiche.html ◀── fetch CSV ──┤  dati/segnalazioni.csv
                                 │  dati/risolte.csv
                                 └── (sync ogni 30 min via GitHub Actions)
```

| File                                  | Ruolo                                                                         |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| `js/config.js`                      | **Unico file da modificare al fork** — tutte le costanti configurabili |
| `index.html`                        | Form wizard segnalazione — 4 step                                            |
| `mappa.html`                        | Mappa pubblica segnalazioni interattiva                                       |
| `statistiche.html`                  | Dashboard grafici + Open Data (tabella + export CSV)                          |
| `profilo.html`                      | Profilo utente — storico segnalazioni del dispositivo                        |
| `info.html`                         | Informazioni sul progetto, istruzioni download Open Data                      |
| `privacy.html`                      | Privacy Policy & Cookie Policy                                                |
| `dati/apps-script.gs`               | Google Apps Script (backend serverless)                                       |
| `dati/template-google-sheets.csv`   | Template intestazioni foglio (34 colonne)                                     |
| `dati/segnalazioni.csv`             | CSV segnalazioni aperte (generato da GitHub Actions)                          |
| `dati/risolte.csv`                  | CSV segnalazioni risolte (generato da GitHub Actions)                         |
| `.github/workflows/sync-sheets.yml` | Sincronizza entrambi i CSV ogni 30 minuti                                     |
| `.github/workflows/sync-images.yml` | Scarica/ottimizza immagini (attivazione manuale)                              |
| `img/`                              | Immagini delle segnalazioni caricate via GitHub API                           |

---

## Setup

> Guida dettagliata passo passo in `doc/guida-setup.md`. Di seguito il riepilogo rapido.

### 1. Fork del repository

Clicca **Fork** su GitHub e scegli il tuo account come destinazione.

### 2. Google Sheets

- Crea un foglio con tre tab: **Main**, **Aperte**, **Risolte**
- Nel tab *Aperte* e *Risolte* incolla le formule `FILTER` descritte in `doc/guida-setup.md`
- **File → Pubblica sul Web → CSV** per ciascun tab → copia i due URL CSV

### 3. Google Apps Script

- Vai su **Estensioni → Apps Script** dal tuo foglio
- Incolla il contenuto di `dati/apps-script.gs`
- Imposta `SHEET_ID`, `GITHUB_OWNER`, `GITHUB_REPO` con i tuoi valori
- **Distribuisci → Nuova distribuzione → App web** — Esegui come: Me | Accesso: Chiunque
- Copia l'URL `/exec` generato

### 4. Compila `js/config.js` — **unico file da modificare**

Apri `js/config.js` e inserisci i valori raccolti nei passi precedenti:

```js
const APP_CONFIG = {
  appsScriptUrl:    'https://script.google.com/macros/s/.../exec',
  sheetsCsvAperte:  'https://docs.google.com/spreadsheets/d/e/.../pub?...&output=csv',
  sheetsCsvRisolte: 'https://docs.google.com/spreadsheets/d/e/.../pub?...&output=csv',

  app: {
    nome:    'SegnalaOra',
    siteUrl: 'https://TUO-USERNAME.github.io/Segnalazioni/',
    hashtag: '#SegnalaOra',
    // ...
  },

  pa: {
    nome:         'Comune di [Nome Comune]',
    sito:         'https://www.comune.[nome].it',
    emailDefault: 'protocollo@comune.[nome].it',
  },

  mappa: {
    lat: 38.1157,  // latitudine centro comune
    lng: 13.3615,  // longitudine centro comune
    // ...
  },

  destinatari: [
    // modifica le email con quelle reali del tuo comune
    { id:'strade', nome:'Buche stradali', email:'lavori@comune.[nome].it', /* ... */ },
    // ...
  ],
};
```

Tutti gli altri file JS leggono da `APP_CONFIG` — non vanno toccati.

### 5. Upload immagini (opzionale)

- Genera un **GitHub Personal Access Token** (Fine-grained, scope `Contents: Read and write`)
- In Apps Script → Impostazioni progetto → Proprietà script → aggiungi `GITHUB_TOKEN = <token>`
- Il token non va mai scritto nel codice sorgente

### 6. Workflow GitHub Actions

Apri `.github/workflows/sync-sheets.yml` e aggiorna le variabili `CSV_APERTE`, `CSV_RISOLTE`, `CSV_MAIN` con i tuoi URL CSV.

### 7. GitHub Pages

- Repository → Settings → Pages → Branch: `master` / `(root)`
- Il sito sarà disponibile su `https://TUO-USERNAME.github.io/Segnalazioni/`

---

## Librerie utilizzate

- [Leaflet.js](https://leafletjs.com/) 1.9.4 — mappe OpenStreetMap
- [Chart.js](https://www.chartjs.org/) 4.4.0 + chartjs-plugin-datalabels — grafici statistiche
- [exifr](https://github.com/MikeKovarik/exifr) — estrazione GPS da EXIF foto
- [Font Awesome](https://fontawesome.com/) 6.5.2 — icone
- [Nominatim](https://nominatim.org/) (OpenStreetMap) — geocoding inverso
- Google Fonts: Titillium Web

---

## Licenza

I dati e i contenuti sono rilasciati con licenza [**CC BY 4.0**](https://creativecommons.org/licenses/by/4.0/deed.it) — liberi di condividere e adattare citando la fonte.

---

## Crediti

Idea di **Andrea Borruso**, **Salvatore Fiandaca**, **Ciro Spataro** e **Giovan Battista Vitrano**
By [@opendatasicilia](https://opendatasicilia.it)

Sviluppo tecnico: Web app progettata e sviluppata da [**@gbvitrano**](https://www.linkedin.com/in/gbvitrano/) in collaborazione con [**Claude AI**](https://www.anthropic.com/claude) (Anthropic), che ha affiancato le scelte architetturali, l'ottimizzazione del codice e lo sviluppo delle funzionalità di visualizzazione geospaziale.

<img width="430" height="932" alt="2026-03-06_15h47_51" src="https://github.com/user-attachments/assets/d0740be9-4fd8-430e-a6e4-3c8c4ae0f017" /> <img width="430" height="932" alt="2026-03-06_15h47_42" src="https://github.com/user-attachments/assets/45818975-3a87-4066-81ec-e1c18612442b" /> <img width="430" height="932" alt="2026-03-06_15h48_09" src="https://github.com/user-attachments/assets/34e4cd8e-3bd7-4c65-ab20-3bc6a6e56cd9" />
<img width="430" height="932" alt="2026-03-06_15h48_22" src="https://github.com/user-attachments/assets/1119e6a2-48ec-4e12-b099-52e2f95222bb" /> <img width="430" height="932" alt="2026-03-06_15h48_29" src="https://github.com/user-attachments/assets/091e4e4d-7f17-439c-aab4-161061ab1e9b" />

---

[![GitHub stars](https://img.shields.io/github/stars/gbvitrano/Segnalazioni?style=flat&logo=github&label=stars)](https://github.com/gbvitrano/Segnalazioni/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/gbvitrano/Segnalazioni?style=flat&logo=github&label=forks)](https://github.com/gbvitrano/Segnalazioni/forks)
[![GitHub last commit](https://img.shields.io/github/last-commit/gbvitrano/Segnalazioni?style=flat&label=ultimo%20aggiornamento)](https://github.com/gbvitrano/Segnalazioni/commits/master)
[![Sync CSV](https://img.shields.io/github/actions/workflow/status/gbvitrano/Segnalazioni/sync-sheets.yml?style=flat&label=sync%20CSV)](https://github.com/gbvitrano/Segnalazioni/actions/workflows/sync-sheets.yml)
[![License: CC BY 4.0](https://img.shields.io/badge/license-CC%20BY%204.0-lightgrey?style=flat)](https://creativecommons.org/licenses/by/4.0/deed.it)

[![GitHub Pages](https://img.shields.io/badge/hosted-GitHub%20Pages-blue?style=flat&logo=github)](https://gbvitrano.github.io/Segnalazioni/)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES6-yellow?style=flat&logo=javascript&logoColor=white)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Leaflet](https://img.shields.io/badge/Leaflet-1.9.4-green?style=flat&logo=leaflet)](https://leafletjs.com/)
[![Chart.js](https://img.shields.io/badge/Chart.js-4.4-pink?style=flat&logo=chart.js)](https://www.chartjs.org/)
