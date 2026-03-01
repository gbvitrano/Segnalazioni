/* ═══════════════════════════════════════════════════════
   SegnalaOra — Mappa segnalazioni civiche
   Logica JavaScript della pagina index.html
   ═══════════════════════════════════════════════════════ */

// ─────────────────────────────────────────────────────────
//  CONFIGURAZIONE
// ─────────────────────────────────────────────────────────
const SHEETS_CSV_APERTE  = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSsv5emsudeZOCiaREWWRFP14r5ZSmMW-WzwBTNv-aUitRaEb8mOy5dbm4KmBjpSwSSn2A-GAL7UGYz/pub?gid=1984873064&single=true&output=csv';
const SHEETS_CSV_RISOLTE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSsv5emsudeZOCiaREWWRFP14r5ZSmMW-WzwBTNv-aUitRaEb8mOy5dbm4KmBjpSwSSn2A-GAL7UGYz/pub?gid=790985167&single=true&output=csv';

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwiLYj4k102Vamc5PuqYp6euSVnYJh61RtkgTGvXufbLV3R_r-j2MRCdlavPu2nCFvpmw/exec';

// Posizione default della mappa
const MAP_DEFAULT = { lat: 38.1157, lng: 13.3615, zoom: 13 };

// ─────────────────────────────────────────────────────────
//  STATO
// ─────────────────────────────────────────────────────────
let allReports      = [];
let filteredReports = [];
let markers         = [];
let map;
let activeFilters = { urgenza: 'all', stato: 'all' };
let highlightedId = null;
let viewMode      = 'aperte';   // 'aperte' | 'risolte'

// ─────────────────────────────────────────────────────────
//  MAPPA INIT
// ─────────────────────────────────────────────────────────
function initMap() {
  map = L.map('map', { zoomControl: true, maxZoom: 20 }).setView(
    [MAP_DEFAULT.lat, MAP_DEFAULT.lng], MAP_DEFAULT.zoom
  );
  new L.Hash(map);

  const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 20
  });

  const satelliteLayer = L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
    attribution: '© <a href="https://maps.google.com" target="_blank">Google Maps</a>',
    maxZoom: 20
  });

  osmLayer.addTo(map);

  // Toggle grafico OSM / Satellite
  const LayerToggleControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd(m) {
      const wrap   = L.DomUtil.create('div', 'map-layer-toggle leaflet-control');
      const btnOsm = L.DomUtil.create('button', 'mlt-btn active', wrap);
      btnOsm.innerHTML = '<i class="fa-solid fa-map"></i> Mappa';
      const btnSat = L.DomUtil.create('button', 'mlt-btn', wrap);
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
}

function goHome() {
  if (markers.length > 0) {
    map.fitBounds(L.featureGroup(markers).getBounds().pad(0.15), { animate: true });
  } else {
    map.setView([MAP_DEFAULT.lat, MAP_DEFAULT.lng], MAP_DEFAULT.zoom, { animate: true });
  }
}

// ─────────────────────────────────────────────────────────
//  CARICAMENTO CSV
// ─────────────────────────────────────────────────────────
async function loadData() {
  const url = viewMode === 'risolte' ? SHEETS_CSV_RISOLTE : SHEETS_CSV_APERTE;
  if (!url) {
    showDemoData();
    return;
  }

  try {
    const res  = await fetch(url + '&t=' + Date.now());
    const text = await res.text();
    allReports = parseCSV(text);
    renderAll();
  } catch(e) {
    showError('Impossibile caricare i dati da Google Sheets.');
  }

  document.getElementById('loadingOverlay').style.display = 'none';
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
      obj[h.trim()] = (vals[idx] !== undefined ? vals[idx] : '').trim();
    });
    // Salta righe senza latitudine valida
    if (!obj.Lat || isNaN(parseFloat(obj.Lat))) continue;
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
  notice.textContent = '⚠ Dati demo — configura SHEETS_CSV_APERTE/RISOLTE per dati reali';
  document.querySelector('.app-body').appendChild(notice);

  renderAll();
}

function showError(msg) {
  document.getElementById('loadingOverlay').innerHTML =
    `<p style="color:#c0392b;padding:1rem;text-align:center;">${msg}</p>`;
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

function setViewMode(mode) {
  viewMode = mode;
  document.getElementById('tabAperte').classList.toggle('active', mode === 'aperte');
  document.getElementById('tabRisolte').classList.toggle('active', mode === 'risolte');
  document.getElementById('tabRisolte').classList.toggle('active-resolved', mode === 'risolte');
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
  updateStats();
  renderMarkers();
  renderList();
}

function updateStats() {
  const tot  = allReports.length;
  const wait = allReports.filter(r => r.Stato === 'Nuova' || r.Stato === 'In lavorazione').length;
  const res  = allReports.filter(r => r.Stato === 'Risolta').length;
  document.getElementById('statTot').textContent  = tot;
  document.getElementById('statWait').textContent = wait;
  document.getElementById('statRes').textContent  = res;
}

const URGENCY_COLORS = { Alta: '#e53535', Normale: '#ff9900', Bassa: '#3cb4d8' };

function makeMarkerIcon(urgenza, stato) {
  if (stato === 'Risolta') {
    return L.divIcon({
      className: '',
      html: `<svg width="28" height="36" viewBox="0 0 28 36" xmlns="http://www.w3.org/2000/svg">
        <path d="M14 0C6.3 0 0 6.3 0 14c0 9.8 14 22 14 22S28 23.8 28 14C28 6.3 21.7 0 14 0z" fill="#3d5a47"/>
        <path d="M8 14l4 4 8-8" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      </svg>`,
      iconSize: [28, 36], iconAnchor: [14, 36], popupAnchor: [0, -36]
    });
  }
  const color = URGENCY_COLORS[urgenza] || '#d4820a';
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
  markers = [];

  filteredReports.forEach(report => {
    const lat = parseFloat(report.Lat);
    const lng = parseFloat(report.Long);
    if (isNaN(lat) || isNaN(lng)) return;

    const m = L.marker([lat, lng], { icon: makeMarkerIcon(report.Urgenza, report.Stato) });
    m.bindPopup(makePopupHTML(report), { maxWidth: 300 });
    m.on('click', () => highlightListItem(report.ID_Segnalazione));
    m.addTo(map);
    markers.push(m);
  });

  if (markers.length > 0) {
    map.fitBounds(L.featureGroup(markers).getBounds().pad(0.15));
  }
}

function makePopupHTML(r) {
  const urgColor  = URGENCY_COLORS[r.Urgenza] || '#d4820a';
  const addrShort = (r.Via ? r.Via + (r.Numero_Civico ? ' ' + r.Numero_Civico : '') + ', ' : '') +
                    (r.Comune || r.Indirizzo_Completo || '');

  let html = `<div class="popup-cat">${r.Categoria_Emoji || '📌'} ${r.Categoria}</div>`;
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

function makeStatoBadge(stato) {
  const cls = { Nuova: 'stato-nuova', 'In lavorazione': 'stato-lavorazione', Risolta: 'stato-risolta', Chiusa: 'stato-chiusa' };
  return `<span class="stato-badge ${cls[stato] || 'stato-nuova'}">${stato || 'Nuova'}</span>`;
}

function renderList() {
  const list = document.getElementById('reportList');

  if (filteredReports.length === 0) {
    list.innerHTML = '<div class="no-results">Nessuna segnalazione trovata con i filtri selezionati.</div>';
    return;
  }

  list.innerHTML = filteredReports.map(r => {
    const addrShort = r.Via || r.Comune || r.Indirizzo_Completo || 'Posizione non specificata';
    const urg = (r.Urgenza || 'Normale').toLowerCase();
    return `<div class="report-item" id="ri-${r.ID_Segnalazione}" onclick="focusReport('${r.ID_Segnalazione}')">
      <div class="ri-top">
        <span class="ri-emoji">${r.Categoria_Emoji || '📌'}</span>
        <span class="ri-cat">${r.Categoria}</span>
        <div class="urgency-dot ${urg}"></div>
      </div>
      <div class="ri-addr">${addrShort}</div>
      <div class="ri-meta">
        <span class="ri-date">${r.Data || ''}</span>
        ${makeStatoBadge(r.Stato)}
      </div>
    </div>`;
  }).join('');
}

function focusReport(id) {
  const report = filteredReports.find(r => r.ID_Segnalazione === id);
  if (!report) return;

  const lat = parseFloat(report.Lat);
  const lng = parseFloat(report.Long);
  if (!isNaN(lat) && !isNaN(lng)) {
    map.setView([lat, lng], 17, { animate: true });
    const idx = filteredReports.indexOf(report);
    if (markers[idx]) markers[idx].openPopup();
  }
  highlightListItem(id);
}

function highlightListItem(id) {
  document.querySelectorAll('.report-item').forEach(el => el.classList.remove('highlighted'));
  const el = document.getElementById('ri-' + id);
  if (el) {
    el.classList.add('highlighted');
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// ─────────────────────────────────────────────────────────
//  MODALI — Info / Lightbox / Risoluzione
// ─────────────────────────────────────────────────────────
function openInfo()  { document.getElementById('infoOverlay').classList.add('open'); }
function closeInfo() { document.getElementById('infoOverlay').classList.remove('open'); }

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

  fetch(APPS_SCRIPT_URL, {
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
  if (e.key === 'Escape') { closeInfo(); closeResolve(); closeLightbox(); }
});

// Rileva ?risolvi=TOKEN nell'URL e apre il modal automaticamente
const _urlId = new URLSearchParams(location.search).get('risolvi');
if (_urlId) openResolve(_urlId);
