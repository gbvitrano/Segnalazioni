/* ═══════════════════════════════════════════════════════
   SegnalaOra — Mappa segnalazioni civiche
   Logica JavaScript della pagina index.html
   ═══════════════════════════════════════════════════════ */

// ─────────────────────────────────────────────────────────
//  CONFIGURAZIONE — valori letti da js/config.js (APP_CONFIG)
// ─────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────
//  REGISTRO UTILIZZI (progetto originale)
//  Invia l'hostname di questa istanza all'autore del progetto
//  una volta al giorno per browser, tramite il foglio "Utilizzi".
//  Per non partecipare: lascia SEGNALAORA_REGISTRY_URL vuoto
//  oppure rimuovi questo blocco.
// ─────────────────────────────────────────────────────────
const SEGNALAORA_REGISTRY_URL = '';   // ← incolla qui l'URL /exec del tuo Apps Script

// ─────────────────────────────────────────────────────────
//  STATO
// ─────────────────────────────────────────────────────────
let allReports      = [];
let filteredReports = [];
let markers         = [];
let markerById      = {};   // ID_Segnalazione → Leaflet marker
let map;
let activeFilters = { urgenza: 'all', stato: 'all' };
let highlightedId = null;
let viewMode      = 'aperte';   // 'aperte' | 'risolte'
let _focusTimer   = null;       // timer per apertura popup da focusReport
let currentPage   = 1;
const PAGE_SIZE   = APP_CONFIG.mappa.pageSize;

// ─────────────────────────────────────────────────────────
//  MAPPA INIT
// ─────────────────────────────────────────────────────────
function initMap() {
  map = L.map('map', { zoomControl: true, maxZoom: APP_CONFIG.mappa.maxZoom }).setView(
    [APP_CONFIG.mappa.lat, APP_CONFIG.mappa.lng], APP_CONFIG.mappa.zoomPubblica
  );
  new L.Hash(map);

  const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> By <a href="https://opendatasicilia.it/" title="@opendatasicilia" target="_blank">@opendatasicilia</a>',
    maxZoom: 19
  });

  const satelliteLayer = L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
    attribution: '© <a href="https://maps.google.com" target="_blank">Google Maps</a>',
    maxZoom: 19
  });

  osmLayer.addTo(map);

  // Toggle grafico OSM / Satellite
  const LayerToggleControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd(m) {
      const wrap   = L.DomUtil.create('div', 'map-layer-toggle leaflet-control');
      const btnRow = L.DomUtil.create('div', 'mlt-btns', wrap);
      const btnOsm = L.DomUtil.create('button', 'mlt-btn active', btnRow);
      btnOsm.innerHTML = '<i class="fa-solid fa-map"></i> Mappa';
      const btnSat = L.DomUtil.create('button', 'mlt-btn', btnRow);
      btnSat.innerHTML = '<i class="fa-solid fa-satellite"></i> Satellite';
    
      L.DomEvent.disableClickPropagation(wrap);

      L.DomEvent.on(btnOsm, 'click', () => {
        m.removeLayer(satelliteLayer);
        osmLayer.addTo(m);
        btnOsm.classList.add('active');
        btnSat.classList.remove('active');
      });
      L.DomEvent.on(btnSat, 'click', () => {
        m.removeLayer(osmLayer);
        satelliteLayer.addTo(m);
        btnSat.classList.add('active');
        btnOsm.classList.remove('active');
      });
      return wrap;
    }
  });
  new LayerToggleControl().addTo(map);

  // Pulsante Home — riporta la vista su tutti i marker visibili
  const HomeControl = L.Control.extend({
    options: { position: 'topleft' },
    onAdd() {
      const wrap = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
      const btn  = L.DomUtil.create('button', 'map-home-btn', wrap);
      btn.innerHTML = '<i class="fa-solid fa-house"></i>';
      btn.title     = 'Panoramica — tutte le segnalazioni';
      L.DomEvent.disableClickPropagation(btn);
      L.DomEvent.on(btn, 'click', goHome);
      return wrap;
    }
  });
  new HomeControl().addTo(map);

  // Legenda urgenza come controllo Leaflet (bottomleft)
  const LegendControl = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd() {
      const div = L.DomUtil.create('div', 'legend');
      div.innerHTML =
        '<div class="legend-title">Urgenza</div>' +
        '<div class="legend-row"><div class="legend-dot" style="background:#e53535"></div> Alta</div>' +
        '<div class="legend-row"><div class="legend-dot" style="background:#ff9900"></div> Normale</div>' +
        '<div class="legend-row"><div class="legend-dot" style="background:#3cb4d8"></div> Bassa</div>';
      L.DomEvent.disableClickPropagation(div);
      return div;
    }
  });
  new LegendControl().addTo(map);

  // Credits / logo — Leaflet-Control-Credits (L.controlCredits)
  L.controlCredits({
    position:      'bottomright',
    imageurl:      'img/opendatasicilia.png',
    imagealt:      'SegnalaOra — OpenDataSicilia',
    tooltip:       'SegnalaOra — OpenDataSicilia',
    width:         '50px',
    height:        '58px',
    expandcontent: APP_CONFIG.app.bannerCrediti,
  }).addTo(map);
}

function goHome() {
  if (markers.length > 0) {
    map.fitBounds(L.featureGroup(markers).getBounds().pad(APP_CONFIG.mappa.fitBoundsPad), { animate: true });
  } else {
    map.setView([APP_CONFIG.mappa.lat, APP_CONFIG.mappa.lng], APP_CONFIG.mappa.zoomPubblica, { animate: true });
  }
}

// ─────────────────────────────────────────────────────────
//  CARICAMENTO CSV
// ─────────────────────────────────────────────────────────
async function loadData() {
  const url = viewMode === 'risolte' ? APP_CONFIG.sheetsCsvRisolte : APP_CONFIG.sheetsCsvAperte;
  if (!url) {
    showDemoData();
    return;
  }

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), APP_CONFIG.mappa.loadTimeout);

  try {
    const cacheBust = url.startsWith('http') ? '&t=' : '?t=';
    const res  = await fetch(url + cacheBust + Date.now(), { signal: controller.signal });
    const text = await res.text();
    clearTimeout(timeoutId);
    allReports = parseCSV(text);
    renderAll();
    document.getElementById('loadingOverlay').style.display = 'none';
  } catch(e) {
    clearTimeout(timeoutId);
    const msg = e.name === 'AbortError'
      ? '⏱ Caricamento troppo lento. Controlla la connessione o riprova.'
      : '❌ Impossibile caricare le segnalazioni. Controlla la connessione o riprova tra qualche minuto.';
    showError(msg);
  }
}

function parseCSV(text) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const rows = splitCSVRows(normalized);
  if (rows.length < 2) return [];

  const headers = parseCSVLine(rows[0]);
  const reports = [];

  for (let i = 1; i < rows.length; i++) {
    if (!rows[i].trim()) continue;
    const vals = parseCSVLine(rows[i]);
    const obj  = {};
    headers.forEach((h, idx) => {
      obj[h.trim().replace(/^\uFEFF/, '')] = (vals[idx] !== undefined ? vals[idx] : '').trim();
    });
    // Salta righe senza latitudine valida
    if (!obj.Lat || isNaN(parseFloat(obj.Lat))) continue;
    // Fallback ID univoco se la colonna ID_Segnalazione manca nel foglio
    if (!obj.ID_Segnalazione) {
      obj.ID_Segnalazione = obj.Timestamp_UTC
        ? 'SGN-' + obj.Timestamp_UTC.replace(/\W/g, '')
        : 'row-' + i;
    }
    reports.push(obj);
  }

  return reports;
}

// Divide il testo CSV in righe logiche rispettando i campi quoted multiriga
function splitCSVRows(text) {
  const rows = [];
  let rowStart = 0;
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') { i++; } // "" escaped quote
      else inQuotes = !inQuotes;
    } else if (ch === '\n' && !inQuotes) {
      rows.push(text.slice(rowStart, i));
      rowStart = i + 1;
    }
  }
  const last = text.slice(rowStart);
  if (last.trim()) rows.push(last);
  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let current  = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ─────────────────────────────────────────────────────────
//  DATI DEMO (quando gli URL CSV non sono configurati)
// ─────────────────────────────────────────────────────────
function showDemoData() {
  const now = new Date();
  const fmt = d => d.toLocaleDateString('it-IT');

  allReports = [
    { ID_Segnalazione:'SGN-demo1', Data: fmt(now),                    Categoria:'Buche e dissesti stradali',    Categoria_Emoji:'🕳️', Urgenza:'Alta',    Descrizione:'Buca profonda 30cm in mezzo alla carreggiata',    Nome_Segnalante:'Mario R.',  Indirizzo_Completo:'Via Maqueda 100, Palermo',      Via:'Via Maqueda',       Comune:'Palermo', Lat:'38.1144', Long:'13.3614', Stato:'Nuova',        Fonte_Posizione:'GPS'     },
    { ID_Segnalazione:'SGN-demo2', Data: fmt(new Date(now-86400000)),  Categoria:'Illuminazione pubblica guasta',Categoria_Emoji:'💡',  Urgenza:'Normale', Descrizione:'Lampione spento da 3 giorni',                     Nome_Segnalante:'Anna B.',   Indirizzo_Completo:'Via Roma 45, Palermo',          Via:'Via Roma',          Comune:'Palermo', Lat:'38.1172', Long:'13.3644', Stato:'In lavorazione',Fonte_Posizione:'GPS'     },
    { ID_Segnalazione:'SGN-demo3', Data: fmt(new Date(now-172800000)), Categoria:'Rifiuti abbandonati',          Categoria_Emoji:'🗑️', Urgenza:'Normale', Descrizione:'Cumulo di rifiuti ingombranti sul marciapiede',    Nome_Segnalante:'Luca M.',   Indirizzo_Completo:'Piazza Politeama, Palermo',     Via:'Piazza Politeama',  Comune:'Palermo', Lat:'38.1196', Long:'13.3568', Stato:'Risolta',      Fonte_Posizione:'EXIF'    },
    { ID_Segnalazione:'SGN-demo4', Data: fmt(new Date(now-259200000)), Categoria:'Segnaletica danneggiata',      Categoria_Emoji:'🚧', Urgenza:'Bassa',   Descrizione:'Cartello stradale divelta dal vento',             Nome_Segnalante:'Sara T.',   Indirizzo_Completo:'Via Libertà 120, Palermo',      Via:'Via Libertà',       Comune:'Palermo', Lat:'38.1241', Long:'13.3583', Stato:'Nuova',        Fonte_Posizione:'Manuale' },
    { ID_Segnalazione:'SGN-demo5', Data: fmt(new Date(now-345600000)), Categoria:'Alberi e verde pubblico',      Categoria_Emoji:'🌳', Urgenza:'Alta',    Descrizione:'Albero pericolante dopo la tempesta',             Nome_Segnalante:'Paolo G.',  Indirizzo_Completo:'Corso Calatafimi 80, Palermo',  Via:'Corso Calatafimi',  Comune:'Palermo', Lat:'38.1098', Long:'13.3412', Stato:'Risolta',      Fonte_Posizione:'GPS'     },
  ];

  document.getElementById('loadingOverlay').style.display = 'none';

  const notice = document.createElement('div');
  notice.style.cssText = 'position:absolute;top:1rem;left:50%;transform:translateX(-50%);background:#fff8e1;border:1.5px solid #ffd54f;border-radius:8px;padding:0.6rem 1rem;font-size:0.75rem;z-index:300;color:#5a4000;white-space:nowrap;';
  notice.textContent = '⚠ Dati demo — assicurati che dati/segnalazioni.csv esista nel repository';
  document.querySelector('.app-body').appendChild(notice);

  renderAll();
}

function showError(msg) {
  document.getElementById('loadingOverlay').innerHTML = `
    <div style="text-align:center;padding:1.5rem 1rem;">
      <p style="color:#c0392b;margin-bottom:0.85rem;font-size:0.9rem;line-height:1.5;">${msg}</p>
      <button onclick="loadData()"
        style="background:none;border:1.5px solid #c0392b;border-radius:8px;padding:0.4rem 1rem;
               font-size:0.85rem;cursor:pointer;color:#c0392b;font-family:'DM Sans',sans-serif;">
        🔄 Riprova
      </button>
    </div>`;
}

// ─────────────────────────────────────────────────────────
//  FILTRI
// ─────────────────────────────────────────────────────────
function setFilter(type, val, el) {
  activeFilters[type] = val;
  el.parentElement.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  renderAll();
}

function resetFilters() {
  activeFilters = { urgenza: 'all', stato: 'all' };
  document.querySelectorAll('.chip').forEach(c => {
    if (c.dataset.val === 'all') c.classList.add('active');
    else c.classList.remove('active');
  });
  renderAll();
}

function setViewMode(mode) {
  viewMode = mode;
  document.getElementById('tabAperte').classList.toggle('active', mode === 'aperte');
  document.getElementById('tabRisolte').classList.toggle('active', mode === 'risolte');
  document.getElementById('tabRisolte').classList.toggle('active-resolved', mode === 'risolte');
  document.getElementById('statsAperte').style.display  = mode === 'aperte'  ? '' : 'none';
  document.getElementById('statsRisolte').style.display = mode === 'risolte' ? '' : 'none';
  document.getElementById('filtersPanel').style.display = mode === 'risolte' ? 'none' : '';
  loadData();
}

function applyFilters() {
  return allReports.filter(r => {
    if (viewMode === 'aperte') {
      if (activeFilters.urgenza !== 'all' && r.Urgenza !== activeFilters.urgenza) return false;
      if (activeFilters.stato   !== 'all' && r.Stato   !== activeFilters.stato)   return false;
    }
    return true;
  });
}

// ─────────────────────────────────────────────────────────
//  RENDER
// ─────────────────────────────────────────────────────────
function renderAll() {
  filteredReports = applyFilters();
  currentPage = 1;
  updateStats();
  renderMarkers();
  renderList();
}

function updateStats() {
  if (viewMode === 'risolte') {
    document.getElementById('statRes').textContent = allReports.length;
  } else {
    document.getElementById('statNuove').textContent = allReports.filter(r => r.Stato === 'Nuova').length;
    document.getElementById('statLav').textContent   = allReports.filter(r => r.Stato === 'In lavorazione').length;
    document.getElementById('statTot').textContent   = allReports.length;
  }
}

function makeMarkerIcon(urgenza, stato) {
  if (stato === 'Risolta') {
    return L.divIcon({
      className: '',
      html: `<svg width="28" height="36" viewBox="0 0 28 36" xmlns="http://www.w3.org/2000/svg">
        <path d="M14 0C6.3 0 0 6.3 0 14c0 9.8 14 22 14 22S28 23.8 28 14C28 6.3 21.7 0 14 0z" fill="${APP_CONFIG.marker.Risolta}"/>
        <path d="M8 14l4 4 8-8" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      </svg>`,
      iconSize: [28, 36], iconAnchor: [14, 36], popupAnchor: [0, -36]
    });
  }
  const color = APP_CONFIG.marker[urgenza] || APP_CONFIG.marker.default;
  return L.divIcon({
    className: '',
    html: `<svg width="28" height="36" viewBox="0 0 28 36" xmlns="http://www.w3.org/2000/svg">
      <path d="M14 0C6.3 0 0 6.3 0 14c0 9.8 14 22 14 22S28 23.8 28 14C28 6.3 21.7 0 14 0z" fill="${color}"/>
      <circle cx="14" cy="14" r="6" fill="white" opacity="0.9"/>
    </svg>`,
    iconSize: [28, 36], iconAnchor: [14, 36], popupAnchor: [0, -36]
  });
}

function renderMarkers() {
  markers.forEach(m => map.removeLayer(m));
  markers    = [];
  markerById = {};

  filteredReports.forEach(report => {
    const lat = parseFloat(report.Lat);
    const lng = parseFloat(report.Long);
    if (isNaN(lat) || isNaN(lng)) return;

    const m = L.marker([lat, lng], { icon: makeMarkerIcon(report.Urgenza, report.Stato) });
    m.bindPopup(makePopupHTML(report), { maxWidth: 300 });
    m.on('click', () => {
      if (window.innerWidth <= 768) {
        m.closePopup();
        expandReportItem(report.ID_Segnalazione);
      } else {
        highlightListItem(report.ID_Segnalazione);
      }
    });
    m.addTo(map);
    markers.push(m);
    markerById[report.ID_Segnalazione] = m;
  });

  if (markers.length > 0) {
    map.fitBounds(L.featureGroup(markers).getBounds().pad(APP_CONFIG.mappa.fitBoundsPad));
  }
}

function makePopupHTML(r) {
  const urgColor  = APP_CONFIG.marker[r.Urgenza] || APP_CONFIG.marker.default;
  const addrShort = (r.Via ? r.Via + (r.Numero_Civico ? ' ' + r.Numero_Civico : '') + ', ' : '') +
                    (r.Comune || r.Indirizzo_Completo || '');

  let html = `<div class="popup-cat">${catIcon(r.Categoria_Emoji)} ${r.Categoria}</div>`;
  html += `<div class="popup-row"><span>📌</span><span>${addrShort || r.Indirizzo_Completo}</span></div>`;
  html += `<div class="popup-row"><span>📅</span><span>${r.Data} ${r.Ora || ''}</span></div>`;
  html += `<div class="popup-row">
    <span style="color:${urgColor};font-weight:600">${
      r.Urgenza === 'Alta' ? '🔴' : r.Urgenza === 'Bassa' ? '🔵' : '🟠'
    } ${r.Urgenza}</span>
    <span style="margin-left:0.5rem">${makeStatoBadge(r.Stato)}</span>
  </div>`;
  if (r.Nome_Segnalante) {
    html += `<div class="popup-row"><span>👤</span><span>${r.Nome_Segnalante}</span></div>`;
  }
  if (r.Descrizione) {
    html += `<div class="popup-descr">${r.Descrizione.substring(0, 120)}${r.Descrizione.length > 120 ? '...' : ''}</div>`;
  }
  if (r.URL_Immagine) {
    html += `<img class="popup-img-thumb" src="${r.URL_Immagine}"
      loading="lazy" title="Clicca per ingrandire"
      onclick="openLightbox('${r.URL_Immagine}')"
      onerror="this.style.display='none'">`;
  }
  return html;
}

function catIcon(val) {
  if (!val) return '📌';
  return val.startsWith('fa-')
    ? `<i class="${val}"></i>`
    : val;
}

function makeStatoBadge(stato) {
  const cls = { Nuova: 'stato-nuova', 'In lavorazione': 'stato-lavorazione', Risolta: 'stato-risolta', Chiusa: 'stato-chiusa' };
  return `<span class="stato-badge ${cls[stato] || 'stato-nuova'}">${stato || 'Nuova'}</span>`;
}

function renderList() {
  const list = document.getElementById('reportList');

  if (filteredReports.length === 0) {
    const hasFilters = activeFilters.urgenza !== 'all' || activeFilters.stato !== 'all';
    list.innerHTML = `<div class="no-results">
      🔍 Nessuna segnalazione trovata${hasFilters ? ' con i filtri selezionati' : ''}.
      ${hasFilters ? '<br><button class="no-results-reset" onclick="resetFilters()">Rimuovi filtri</button>' : ''}
    </div>`;
    return;
  }

  const totalPages = Math.ceil(filteredReports.length / PAGE_SIZE);
  const start      = (currentPage - 1) * PAGE_SIZE;
  const pageItems  = filteredReports.slice(start, start + PAGE_SIZE);

  list.innerHTML = '';
  pageItems.forEach(r => {
    const addrShort = r.Via || r.Comune || r.Indirizzo_Completo || 'Posizione non specificata';
    const urg = (r.Urgenza || 'Normale').toLowerCase();
    const el = document.createElement('div');
    el.className = 'report-item';
    el.id = 'ri-' + r.ID_Segnalazione;
    const urgColor  = APP_CONFIG.marker[r.Urgenza] || APP_CONFIG.marker.default;
    const urgLabel  = r.Urgenza === 'Alta' ? '🔴 Urgente' : r.Urgenza === 'Bassa' ? '🔵 Bassa' : '🟠 Normale';
    const imgUrls   = (r.URL_Immagini || r.URL_Immagine || '').split(',').map(u => u.trim()).filter(Boolean);
    const imgsHtml  = imgUrls.length > 0
      ? `<div class="rid-imgs">${imgUrls.map(u =>
          `<img src="${u}" loading="lazy" onerror="this.style.display='none'" onclick="openLightbox('${u}')">`
        ).join('')}</div>`
      : '';
    el.innerHTML = `
      <div class="ri-top">
        <span class="ri-emoji">${catIcon(r.Categoria_Emoji)}</span>
        <span class="ri-cat">${r.Categoria}</span>
        <div class="urgency-dot ${urg}"></div>
      </div>
      <div class="ri-addr">${addrShort}</div>
      <div class="ri-meta">
        <span class="ri-date">${r.Data || ''}</span>
        ${makeStatoBadge(r.Stato)}
      </div>
      <div class="ri-detail" id="rid-${r.ID_Segnalazione}">
        ${r.Descrizione ? `<div class="rid-descr">${r.Descrizione}</div>` : ''}
        <div class="rid-row"><i class="fa-solid fa-clock"></i> ${r.Data || ''} ${r.Ora || ''}</div>
        ${r.Nome_Segnalante ? `<div class="rid-row"><i class="fa-solid fa-user"></i> ${r.Nome_Segnalante}</div>` : ''}
        <div class="rid-row" style="color:${urgColor}"><i class="fa-solid fa-circle-exclamation"></i> ${urgLabel}</div>
        ${imgsHtml}
        <div class="rid-id">${r.ID_Segnalazione}</div>
      </div>`;
    el.addEventListener('click', () => {
      if (window.innerWidth <= 768) {
        expandReportItem(r.ID_Segnalazione);
        const m = markerById[r.ID_Segnalazione];
        if (m) map.setView([parseFloat(r.Lat), parseFloat(r.Long)], 17, { animate: true });
      } else {
        focusReport(r.ID_Segnalazione);
      }
    });
    list.appendChild(el);
  });

  if (totalPages > 1) {
    const pag = document.createElement('div');
    pag.className = 'list-pagination';
    pag.innerHTML = `
      <button class="lpag-btn" onclick="goToPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>
        <i class="fa-solid fa-chevron-left"></i>
      </button>
      <span class="lpag-info">${currentPage} / ${totalPages}</span>
      <button class="lpag-btn" onclick="goToPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>
        <i class="fa-solid fa-chevron-right"></i>
      </button>`;
    list.appendChild(pag);
  }
}

function goToPage(page) {
  const totalPages = Math.ceil(filteredReports.length / PAGE_SIZE);
  if (page < 1 || page > totalPages) return;
  currentPage = page;
  renderList();
  document.getElementById('reportList').scrollTop = 0;
}

function focusReport(id) {
  const report = filteredReports.find(r => r.ID_Segnalazione === id);
  if (!report) return;

  highlightListItem(id);

  const lat = parseFloat(report.Lat);
  const lng = parseFloat(report.Long);
  if (isNaN(lat) || isNaN(lng)) return;

  const m = markerById[id];
  map.setView([lat, lng], 17, { animate: true });

  if (m && window.innerWidth > 768) {
    clearTimeout(_focusTimer);
    _focusTimer = setTimeout(() => m.openPopup(), APP_CONFIG.mappa.popupDelay);
  }
}

function expandReportItem(id) {
  // Naviga alla pagina corretta nella sidebar
  const idx = filteredReports.findIndex(r => r.ID_Segnalazione === id);
  if (idx !== -1) {
    const page = Math.floor(idx / PAGE_SIZE) + 1;
    if (page !== currentPage) { currentPage = page; renderList(); }
  }

  // Chiudi tutti i dettagli aperti e deseleziona
  document.querySelectorAll('.report-item').forEach(el => {
    el.classList.remove('highlighted');
    const det = el.querySelector('.ri-detail');
    if (det) det.classList.remove('open');
  });

  // Apri il dettaglio dell'item selezionato
  const el = document.getElementById('ri-' + id);
  if (el) {
    el.classList.add('highlighted');
    const det = el.querySelector('.ri-detail');
    if (det) det.classList.add('open');

    // Scrolla la sidebar in vista, poi scrolla sull'item
    const panel = document.querySelector('.side-panel');
    if (panel) {
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 250);
    } else {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
}

function highlightListItem(id) {
  const idx = filteredReports.findIndex(r => r.ID_Segnalazione === id);
  if (idx !== -1) {
    const page = Math.floor(idx / PAGE_SIZE) + 1;
    if (page !== currentPage) { currentPage = page; renderList(); }
  }
  document.querySelectorAll('.report-item').forEach(el => el.classList.remove('highlighted'));
  const el = document.getElementById('ri-' + id);
  if (el) {
    el.classList.add('highlighted');
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// ─────────────────────────────────────────────────────────
//  MODALI — Lightbox / Risoluzione
// ─────────────────────────────────────────────────────────
function openLightbox(url) {
  document.getElementById('lightboxImg').src = url;
  document.getElementById('lightbox').classList.add('open');
}
function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
  document.getElementById('lightboxImg').src = '';
}

function openResolve(id) {
  const input = document.getElementById('resolveIdDisplay');
  input.value = id || '';
  const res = document.getElementById('resolveResult');
  res.className  = 'resolve-result';
  res.textContent = '';
  const btn = document.getElementById('resolveConfirmBtn');
  btn.disabled    = false;
  btn.textContent = '✅ Conferma risoluzione';
  document.getElementById('resolveOverlay').classList.add('open');
  if (!id) setTimeout(() => input.focus(), 80);
}

function closeResolve() {
  document.getElementById('resolveOverlay').classList.remove('open');
  history.replaceState({}, '', location.pathname);
}

function confirmResolve() {
  const id  = document.getElementById('resolveIdDisplay').value.trim();
  const res = document.getElementById('resolveResult');

  if (!id) {
    res.className   = 'resolve-result err';
    res.textContent = '⚠️ Inserisci l\'ID della segnalazione.';
    document.getElementById('resolveIdDisplay').focus();
    return;
  }

  const btn = document.getElementById('resolveConfirmBtn');
  btn.disabled    = true;
  btn.textContent = 'Invio in corso…';
  res.className   = 'resolve-result';
  res.textContent = '';

  fetch(APP_CONFIG.appsScriptUrl, {
    method: 'POST',
    mode:   'no-cors',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'risolvi', token: id, ID_Segnalazione: id })
  })
  .then(() => {
    res.className   = 'resolve-result ok';
    res.textContent = '✅ Richiesta inviata. La mappa si aggiornerà a breve…';
    btn.textContent = 'Inviato ✓';
    setTimeout(() => {
      loadData();
      res.textContent = '✅ Mappa aggiornata. La segnalazione è ora nella sezione Risolte.';
    }, 4000);
  })
  .catch(() => {
    res.className   = 'resolve-result err';
    res.textContent = '❌ Errore di rete. Riprova tra qualche istante.';
    btn.disabled    = false;
    btn.textContent = '✅ Conferma risoluzione';
  });
}

// ─────────────────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────────────────
initMap();
loadData();

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeResolve(); closeLightbox(); }
});

// Rileva ?risolvi=TOKEN nell'URL e apre il modal automaticamente
const _urlId = new URLSearchParams(location.search).get('risolvi');
if (_urlId) openResolve(_urlId);

// ─────────────────────────────────────────────────────────
//  PING REGISTRO UTILIZZI — una volta al giorno per browser
// ─────────────────────────────────────────────────────────
(function pingRegistry() {
  if (!SEGNALAORA_REGISTRY_URL) return;
  const h = location.hostname;
  if (!h || h === 'localhost' || h === '127.0.0.1') return;
  const key   = 'segnalaora_ping';
  const today = new Date().toDateString();
  if (localStorage.getItem(key) === today) return;
  localStorage.setItem(key, today);
  fetch(SEGNALAORA_REGISTRY_URL + '?action=ping&host=' + encodeURIComponent(h), { mode: 'no-cors' });
})();
