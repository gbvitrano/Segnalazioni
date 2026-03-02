/* ═══════════════════════════════════════════════════════
   SegnalaOra — Form segnalazione civica (single-page)
   ═══════════════════════════════════════════════════════ */

// ─────────────────────────────────────────────
//  CONFIGURAZIONE — compila con i dati del tuo comune
// ─────────────────────────────────────────────
const CONFIG = {
  // URL del Google Apps Script distribuito come Web App
  appsScriptUrl: 'https://script.google.com/macros/s/AKfycbwiLYj4k102Vamc5PuqYp6euSVnYJh61RtkgTGvXufbLV3R_r-j2MRCdlavPu2nCFvpmw/exec',

  // URL pubblico dell'app (lascia vuoto per auto-rilevamento)
  siteUrl: '',

  // Centro mappa di default (usato quando GPS non disponibile)
  mapDefault: { lat: 38.1157, lng: 13.3615, zoom: 14 },
};

// ─────────────────────────────────────────────
//  STATO APP
// ─────────────────────────────────────────────
let map, marker;
let _destinatari     = [];   // da dati/destinatari.json
let _selectedDest    = null; // { id, nome, descrizione, email, icon, custom? }
let _mapOpen         = false;
let _emailDebounce   = null;
let _ticketCopied    = false;
let _positionSet     = false;

let reportData = {
  lat: CONFIG.mapDefault.lat,
  lng: CONFIG.mapDefault.lng,
  address: '',
  via: '',
  civico: '',
  cap: '',
  comune: '',
  provincia: '',
  regione: '',
  fontePosizione: 'Manuale',
  accuratezza: '',
  exifLat: null,
  exifLng: null,
  photoResized: null,
  photoDims: '',
  hasPhoto: false,
};

// ─────────────────────────────────────────────
//  CARICAMENTO DESTINATARI
// ─────────────────────────────────────────────
async function loadDestinatari() {
  try {
    const r    = await fetch('dati/destinatari.json');
    const data = await r.json();
    _destinatari = data.destinatari || [];
    buildDestGrid();
  } catch(e) {
    console.warn('destinatari.json non caricato:', e);
    // Griglia vuota — utente vede solo "dest-error" se prova a inviare
  }
}

function buildDestGrid() {
  const grid = document.getElementById('destGrid');
  if (!grid) return;
  grid.innerHTML = _destinatari.map(d => `
    <button type="button" class="dest-btn" id="dest-${d.id}" onclick="selectDest('${d.id}')">
      <span class="dest-icon">${d.icon}</span>
      <span class="dest-nome">${d.nome}</span>
      <span class="dest-sub">${d.descrizione}</span>
    </button>
  `).join('');
}

function selectDest(id) {
  _selectedDest = _destinatari.find(d => d.id === id) || null;

  document.querySelectorAll('.dest-btn').forEach(b => b.classList.remove('selected'));
  if (_selectedDest) document.getElementById('dest-' + id).classList.add('selected');

  // Nascondi/mostra campo email custom
  const customRow = document.getElementById('customEmailRow');
  if (customRow) customRow.style.display = (_selectedDest && _selectedDest.custom) ? 'block' : 'none';

  // Pulisci eventuali errori
  document.getElementById('dest-error').classList.remove('visible');
  if (!_selectedDest || !_selectedDest.custom) clearFieldError('customEmail');
}

function onCustomEmailInput() {
  clearFieldError('customEmail');
}

// ─────────────────────────────────────────────
//  FOTO + RESIZE + EXIF
// ─────────────────────────────────────────────
function openCamera() {
  const input = document.getElementById('fileInput');
  input.setAttribute('capture', 'environment');
  input.click();
}

function openGallery() {
  const input = document.getElementById('fileInput');
  input.removeAttribute('capture');
  input.click();
}

document.getElementById('fileInput').addEventListener('change', async function(e) {
  const file = e.target.files[0];
  if (!file) return;

  // 1. Leggi EXIF GPS
  let exifInfo = '';
  try {
    const gps = await exifr.gps(file);
    if (gps && gps.latitude && gps.longitude) {
      reportData.exifLat = gps.latitude;
      reportData.exifLng = gps.longitude;
      document.getElementById('btnExif').style.display = 'flex';
      exifInfo = ' · 📸 GPS EXIF trovato!';
      // Se la mappa è già aperta, usa EXIF immediatamente
      if (map) useExifGps();
    }
  } catch(err) {
    // exifr non disponibile o nessun EXIF
  }

  // 2. Ridimensiona a max 1280px
  const img    = new Image();
  const reader = new FileReader();
  reader.onload = ev => {
    img.onload = () => {
      const MAX = 1280;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else       { w = Math.round(w * MAX / h); h = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const resized = canvas.toDataURL('image/jpeg', 0.85);
      reportData.photoResized = resized;
      reportData.photoDims    = `${w}x${h}`;
      reportData.hasPhoto     = true;

      document.getElementById('previewImg').src             = resized;
      document.getElementById('photoZone').style.display    = 'none';
      document.getElementById('photoPreview').style.display = 'block';

      const info = document.getElementById('photoInfo');
      info.textContent = `✓ ${w}×${h}px${exifInfo} · ${(resized.length * 0.75 / 1024).toFixed(0)} KB`;
      info.classList.add('visible');
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});

// ─────────────────────────────────────────────
//  MAPPA + GPS + GEOCODING
// ─────────────────────────────────────────────
function toggleMap() {
  _mapOpen = !_mapOpen;
  const wrap = document.getElementById('mapCollapsible');
  wrap.style.display = _mapOpen ? 'block' : 'none';

  const btn   = document.getElementById('geoStatus');
  const caret = btn ? btn.querySelector('.geo-bar-caret') : null;
  if (btn)   btn.setAttribute('aria-expanded', _mapOpen ? 'true' : 'false');
  if (caret) caret.textContent = (_mapOpen ? '▴' : '▾') + ' Mappa';

  if (_mapOpen && !map) {
    setTimeout(initMap, 100);
  } else if (_mapOpen && map) {
    map.invalidateSize();
  }
}

function initMap() {
  if (map) { map.invalidateSize(); return; }

  const zoom = _positionSet ? 17 : CONFIG.mapDefault.zoom;
  map = L.map('map', { maxZoom: 20 }).setView([reportData.lat, reportData.lng], zoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19
  }).addTo(map);

  marker = L.marker([reportData.lat, reportData.lng], {
    draggable: true,
    opacity: _positionSet ? 1 : 0.35
  }).addTo(map);

  marker.on('dragend', e => {
    const p = e.target.getLatLng();
    setPosition(p.lat, p.lng, 'Manuale');
  });

  map.on('click', e => {
    marker.setLatLng(e.latlng);
    setPosition(e.latlng.lat, e.latlng.lng, 'Manuale');
  });

  // Priorità: EXIF → usa GPS già rilevato (in reportData)
  if (reportData.exifLat && !_positionSet) {
    useExifGps();
  } else if (_positionSet) {
    map.setView([reportData.lat, reportData.lng], 17);
  }
}

function setPosition(lat, lng, fonte, accuratezza) {
  reportData.lat            = lat;
  reportData.lng            = lng;
  reportData.fontePosizione = fonte || 'Manuale';
  reportData.accuratezza    = accuratezza || '';
  _positionSet = true;
  if (map) {
    map.setView([lat, lng], 17);
    marker.setLatLng([lat, lng]);
    marker.setOpacity(1);
  }
  reverseGeocode(lat, lng);
}

function getGPS() {
  const geoText = document.getElementById('geoText');
  if (geoText) geoText.textContent = 'Rilevamento GPS in corso…';
  if (!navigator.geolocation) {
    if (geoText) geoText.textContent = 'GPS non disponibile — apri la mappa per posizionare';
    return;
  }
  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;
    setPosition(lat, lng, 'GPS', Math.round(accuracy));
    if (geoText) geoText.textContent = `✓ Posizione GPS rilevata (±${Math.round(accuracy)} m)`;
  }, () => {
    if (geoText) geoText.textContent = '⚠ GPS non disponibile — apri la mappa per posizionare';
  }, { enableHighAccuracy: true, timeout: 10000 });
}

function useExifGps() {
  if (!reportData.exifLat) return;
  setPosition(reportData.exifLat, reportData.exifLng, 'EXIF');
  const geoText = document.getElementById('geoText');
  if (geoText) geoText.textContent = '✓ Coordinate estratte dai metadati EXIF della foto';
  const banner = document.getElementById('exifBanner');
  if (banner) banner.style.display = 'block';
}

function dismissExifBanner() {
  const banner = document.getElementById('exifBanner');
  if (banner) banner.style.display = 'none';
  getGPS();
}

function reverseGeocode(lat, lng) {
  fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`)
    .then(r => r.json())
    .then(data => {
      const a = data.address || {};
      reportData.via       = a.road || a.pedestrian || a.footway || '';
      reportData.civico    = a.house_number || '';
      reportData.cap       = a.postcode || '';
      reportData.comune    = a.city || a.town || a.village || a.municipality || '';
      reportData.provincia = a.county || a.state_district || '';
      reportData.regione   = a.state || '';
      reportData.address   = data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      const addrInput = document.getElementById('addressInput');
      if (addrInput) addrInput.value = reportData.address;
    })
    .catch(() => {
      reportData.address = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      const addrInput = document.getElementById('addressInput');
      if (addrInput) addrInput.value = reportData.address;
    });
}

// ─────────────────────────────────────────────
//  VALIDAZIONE INLINE CAMPI
// ─────────────────────────────────────────────
function showFieldError(fieldId, msg) {
  const el  = document.getElementById(fieldId);
  const err = document.getElementById(fieldId + '-error');
  if (el)  el.classList.add('invalid');
  if (err) { if (msg) err.textContent = msg; err.classList.add('visible'); }
}

function clearFieldError(fieldId) {
  const el  = document.getElementById(fieldId);
  const err = document.getElementById(fieldId + '-error');
  if (el)  el.classList.remove('invalid');
  if (err) err.classList.remove('visible');
}

function onEmailInput() {
  clearFieldError('email');
  clearTimeout(_emailDebounce);
  _emailDebounce = setTimeout(validateEmailField, 650);
}

function validateEmailField() {
  const val   = document.getElementById('email').value.trim();
  const el    = document.getElementById('email');
  const errEl = document.getElementById('email-error');
  if (!val) {
    el.classList.remove('invalid', 'valid');
    errEl.classList.remove('visible', 'ok');
    return;
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
    el.classList.remove('invalid'); el.classList.add('valid');
    errEl.textContent = '✓ Email valida';
    errEl.classList.remove('visible'); errEl.classList.add('ok');
  } else {
    el.classList.add('invalid'); el.classList.remove('valid');
    errEl.textContent = 'Inserisci un indirizzo email valido (es: nome@dominio.it).';
    errEl.classList.add('visible'); errEl.classList.remove('ok');
  }
}

// ─────────────────────────────────────────────
//  TOOLTIP CATEGORIA
// ─────────────────────────────────────────────
function updateCatHint() {
  const sel  = document.getElementById('categoria');
  const hint = document.getElementById('catHint');
  if (!hint) return;
  const opt  = sel.selectedOptions[0];
  hint.textContent = (opt && opt.title) ? opt.title : '';
}

// ─────────────────────────────────────────────
//  INVIO
// ─────────────────────────────────────────────
async function sendReport() {
  const btn = document.getElementById('sendBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Controllo in corso…';

  // Validazioni
  let hasError = false;

  const cat = document.getElementById('categoria').value;
  if (!cat) {
    showFieldError('categoria', 'Seleziona una categoria.');
    document.getElementById('categoria').scrollIntoView({ behavior: 'smooth', block: 'center' });
    hasError = true;
  }

  if (!_selectedDest) {
    document.getElementById('dest-error').classList.add('visible');
    if (!hasError) document.getElementById('sectionDest') && document.querySelector('.form-section:has(#destGrid)').scrollIntoView({ behavior: 'smooth', block: 'center' });
    hasError = true;
  }

  // Se destinatario custom, verifica email custom
  let toEmail = _selectedDest ? _selectedDest.email : '';
  if (_selectedDest && _selectedDest.custom) {
    const customEmail = document.getElementById('customEmail').value.trim();
    if (!customEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customEmail)) {
      showFieldError('customEmail', 'Inserisci un indirizzo email valido.');
      hasError = true;
    } else {
      toEmail = customEmail;
    }
  }

  const nome = document.getElementById('nome').value.trim();
  if (!nome) {
    showFieldError('nome', 'Inserisci il tuo nome o nickname.');
    hasError = true;
  }

  const emailSegnalante = document.getElementById('email').value.trim();
  if (!emailSegnalante || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailSegnalante)) {
    showFieldError('email', emailSegnalante
      ? 'Indirizzo email non valido (es: nome@dominio.it).'
      : 'L\'email è obbligatoria per ricevere la conferma di invio.');
    hasError = true;
  }

  if (hasError) {
    btn.disabled = false;
    btn.textContent = '✉️ Invia Segnalazione';
    return;
  }

  // Posizione non confermata → apri mappa e avvisa
  if (!_positionSet) {
    const geoStatus = document.getElementById('geoStatus');
    if (geoStatus) {
      geoStatus.classList.add('geo-warn');
      setTimeout(() => geoStatus.classList.remove('geo-warn'), 3000);
    }
    if (!_mapOpen) toggleMap();
    document.getElementById('geoStatus').scrollIntoView({ behavior: 'smooth', block: 'center' });
    btn.disabled = false;
    btn.textContent = '✉️ Invia Segnalazione';
    return;
  }

  btn.textContent = '⏳ Invio in corso…';

  const now      = new Date();
  const ticketId = 'SGN-' + now.getTime();

  const token = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'xxxx-xxxx-xxxx-xxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16));

  const descr   = document.getElementById('descr').value;
  const urgenza = document.getElementById('urgenza').value;
  const addr    = document.getElementById('addressInput').value || reportData.address;

  const emojiMap = {
    'Buche e dissesti stradali': '🕳️', 'Illuminazione pubblica guasta': '💡',
    'Rifiuti abbandonati': '🗑️',        'Alberi e verde pubblico': '🌳',
    'Perdite idriche': '🚰',             'Deiezioni non raccolte': '🐕',
    'Segnaletica danneggiata': '🚧',     'Immobile pericolante': '🏚️',
    'Barriere architettoniche': '♿',    'Inquinamento acustico': '🔊',
    'Veicoli abbandonati': '🛺',         'Degrado e sicurezza': '💊',
    'Altro': '📦'
  };
  const catEmoji = emojiMap[cat] || '📌';
  const urgLabel = urgenza === 'Alta' ? '🔴 URGENTE — ' : urgenza === 'Bassa' ? '🟢 ' : '🟡 ';

  const siteUrl = CONFIG.siteUrl
    || window.location.href.replace('segnalazione-civica.html', 'index.html').split('?')[0];

  const siteBase = siteUrl.endsWith('index.html')
    ? siteUrl.slice(0, -'index.html'.length)
    : siteUrl.replace(/\/?$/, '/');
  const predictedImgUrl = reportData.hasPhoto ? siteBase + 'img/' + ticketId + '.jpg' : null;

  const resolveUrl = siteBase + 'index.html?risolvi=' + token;

  const destNome = _selectedDest ? _selectedDest.nome : '';
  const testoMessaggio = [
    `📍 Segnalazione Civica — ${urgLabel}${cat}`,
    `📌 Luogo: ${addr}`,
    descr ? `📝 Note: ${descr}` : '',
    destNome ? `🏛️ Destinatario: ${destNome}` : '',
    `👤 Segnalato da: ${nome}`,
    `🕐 ${now.toLocaleString('it-IT')}`,
    `#SegnalaOra #${cat.replace(/[^a-zA-Z]/g,'')}`,
    ticketId,
    `\n──────────────────────────────────────`,
    `Per segnare questa segnalazione come RISOLTA:`,
    resolveUrl,
    `──────────────────────────────────────`
  ].filter(Boolean).join('\n');

  // 1. POST JSON ad Apps Script
  if (CONFIG.appsScriptUrl) {
    const payload = {
      ID_Segnalazione:    ticketId,
      Timestamp_UTC:      now.toISOString(),
      Data:               now.toLocaleDateString('it-IT'),
      Ora:                now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
      Categoria:          cat,
      Categoria_Emoji:    catEmoji,
      Urgenza:            urgenza,
      Descrizione:        descr,
      Nome_Segnalante:    nome,
      Email_Segnalante:   emailSegnalante,
      Lat:                reportData.lat.toFixed(6),
      Long:               reportData.lng.toFixed(6),
      Indirizzo_Completo: addr,
      Via:                reportData.via,
      Numero_Civico:      reportData.civico,
      CAP:                reportData.cap,
      Comune:             reportData.comune,
      Provincia:          reportData.provincia,
      Regione:            reportData.regione,
      Fonte_Posizione:    reportData.fontePosizione,
      Accuratezza_GPS_m:  String(reportData.accuratezza),
      Area_Destinataria:  destNome,
      CC_Destinatari:     '',
      Destinatari:        destNome,
      Canale_Email:       toEmail ? 'Sì' : 'No',
      Canale_WhatsApp:    'No',
      Canale_Twitter:     'No',
      Canale_Facebook:    'No',
      Ha_Immagine:        reportData.hasPhoto ? 'Sì' : 'No',
      Dimensioni_Immagine: reportData.photoDims,
      Testo_Messaggio:    testoMessaggio,
      URL_Segnalazione:   siteUrl,
      Stato:              'Nuova',
      Token_Risoluzione:  token,
      ...(predictedImgUrl ? { URL_Immagine: predictedImgUrl } : {}),
      ...(reportData.photoResized ? { imageBase64: reportData.photoResized } : {}),
    };
    try {
      await fetch(CONFIG.appsScriptUrl, {
        method: 'POST', mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch(e) {}
  }

  // 2. Apri email
  const channelsBadges = [];
  if (toEmail) {
    const subject = encodeURIComponent(`[SegnalaOra] ${cat} — ${ticketId}`);
    const body    = encodeURIComponent(testoMessaggio + '\n\nInviato tramite SegnalaOra');
    window.location.href = `mailto:${toEmail}?subject=${subject}&body=${body}`;
    const nomeBreve = destNome.length > 40 ? destNome.substring(0, 40) + '…' : destNome;
    channelsBadges.push('🏛️ ' + (nomeBreve || toEmail));
    await new Promise(r => setTimeout(r, 800));
  }

  // 3. Schermata di successo
  _ticketCopied = false;
  document.getElementById('ticketId').textContent     = ticketId;
  document.getElementById('resolveToken').textContent = token;
  document.getElementById('copyReminder').classList.remove('visible');
  document.getElementById('successDetail').textContent =
    'Segnalazione registrata nell\'archivio. L\'ufficio competente è stato contattato.';

  const warnBanner = document.getElementById('emailWarnBanner');
  if (warnBanner) warnBanner.style.display = toEmail ? 'block' : 'none';

  const badgesEl = document.getElementById('channelsSent');
  badgesEl.innerHTML = channelsBadges.map(b => `<span class="channel-badge">✓ ${b}</span>`).join('');

  document.getElementById('successOverlay').classList.add('open');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ─────────────────────────────────────────────
//  SUCCESSO
// ─────────────────────────────────────────────
function resetAll() { location.reload(); }

function closeSuccess() {
  if (!_ticketCopied) {
    document.getElementById('copyReminder').classList.add('visible');
    return;
  }
  location.reload();
}

function forceClose() { location.reload(); }

function copyTicketId() {
  const id = document.getElementById('ticketId').textContent;
  navigator.clipboard.writeText(id).then(() => {
    _ticketCopied = true;
    document.getElementById('copyReminder').classList.remove('visible');
    const btn = document.getElementById('copyIdBtn');
    btn.textContent = '✓ Copiato';
    setTimeout(() => { btn.textContent = '📋 Copia'; }, 1800);
  });
}

function copyToken() {
  const token = document.getElementById('resolveToken').textContent;
  navigator.clipboard.writeText(token).then(() => {
    const btn = document.getElementById('copyTokenBtn');
    btn.textContent = '✓ Copiato';
    setTimeout(() => { btn.textContent = '📋 Copia'; }, 1800);
  });
}

// ─────────────────────────────────────────────
//  INFO MODAL
// ─────────────────────────────────────────────
function openInfo()  { document.getElementById('infoOverlay').classList.add('open'); }
function closeInfo() { document.getElementById('infoOverlay').classList.remove('open'); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeInfo(); });

// ─────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────
loadDestinatari();
getGPS();
