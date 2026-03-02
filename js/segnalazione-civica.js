/* ═══════════════════════════════════════════════════════
   SegnalaOra — Form segnalazione civica (single-page)
   ═══════════════════════════════════════════════════════ */

// ─────────────────────────────────────────────
//  CONFIGURAZIONE — compila con i dati del tuo comune
// ─────────────────────────────────────────────
const CONFIG = {
  // URL del Google Apps Script distribuito come Web App
  appsScriptUrl: 'https://script.google.com/macros/s/AKfycbwve06JZu-6pGn0KQXMlZR6OCelS_3SWlxjAtK9CTM1De-26D-YXFUVAdQfR8w8OUts/exec',

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
let _selectedDests   = [];   // [{ id, nome, descrizione, email, icon, custom? }, …]
let _emailDebounce   = null;
let _ticketCopied    = false;
let _positionSet     = false;
const _socialPlatforms = new Set();

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
  const VISIBLE = 6;
  grid.innerHTML = _destinatari.map((d, i) => `
    <button type="button" class="dest-btn${i >= VISIBLE ? ' dest-extra' : ''}" id="dest-${d.id}" onclick="selectDest('${d.id}')"${i >= VISIBLE ? ' style="display:none"' : ''}>
      <span class="dest-icon"><i class="${d.icon}"></i></span>
      <span class="dest-nome">${d.nome}</span>
      <span class="dest-sub">${d.descrizione}</span>
    </button>
  `).join('');

  const extra = _destinatari.length - VISIBLE;
  const expandBtn = document.getElementById('destExpandBtn');
  if (expandBtn && extra > 0) {
    expandBtn.style.display = 'block';
    expandBtn.textContent = `＋ Mostra altri (${extra})`;
  }
}

function toggleDestExpand() {
  const extras = document.querySelectorAll('.dest-extra');
  const btn    = document.getElementById('destExpandBtn');
  const isOpen = extras[0] && extras[0].style.display !== 'none';
  extras.forEach(e => e.style.display = isOpen ? 'none' : 'flex');
  btn.textContent = isOpen ? `＋ Mostra altri (${extras.length})` : '− Meno';
}

function selectDest(id) {
  const dest = _destinatari.find(d => d.id === id);
  if (!dest) return;

  const idx = _selectedDests.findIndex(d => d.id === id);
  if (idx === -1) {
    _selectedDests.push(dest);
    document.getElementById('dest-' + id).classList.add('selected');
  } else {
    _selectedDests.splice(idx, 1);
    document.getElementById('dest-' + id).classList.remove('selected');
  }

  // Mostra campo email custom solo se "Altro" è tra i selezionati
  const hasCustom = _selectedDests.some(d => d.custom);
  const customRow = document.getElementById('customEmailRow');
  if (customRow) customRow.style.display = hasCustom ? 'block' : 'none';
  if (!hasCustom) clearFieldError('customEmail');

  document.getElementById('dest-error').classList.remove('visible');
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
      clearFieldError('photoZone');
      document.getElementById('photoZone-error').classList.remove('visible');

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
  // La mappa è sempre visibile — questa funzione rimane per compatibilità
  if (!map) setTimeout(initMap, 100);
  else map.invalidateSize();
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
    if (geoText) geoText.textContent = 'GPS non disponibile — Clicca sulla mappa per posizionare il marker';
    return;
  }
  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;
    setPosition(lat, lng, 'GPS', Math.round(accuracy));
    if (geoText) geoText.textContent = `✓ Posizione GPS rilevata (±${Math.round(accuracy)} m)`;
  }, () => {
    if (geoText) geoText.textContent = '⚠ GPS non disponibile — Clicca sulla mappa per posizionare il marker';
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
//  INVIO
// ─────────────────────────────────────────────
async function sendReport() {
  const btn = document.getElementById('sendBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Controllo in corso…';

  // Validazioni
  let hasError = false;

  const descr = document.getElementById('descr').value.trim();

  if (!reportData.hasPhoto) {
    document.getElementById('photoZone').classList.add('invalid');
    document.getElementById('photoZone-error').classList.add('visible');
    if (!hasError) document.getElementById('photoZone').scrollIntoView({ behavior: 'smooth', block: 'center' });
    hasError = true;
  }

  if (_selectedDests.length === 0) {
    document.getElementById('dest-error').classList.add('visible');
    if (!hasError) document.querySelector('.form-section:has(#destGrid)') && document.querySelector('.form-section:has(#destGrid)').scrollIntoView({ behavior: 'smooth', block: 'center' });
    hasError = true;
  }

  // Raccolta email: una per ogni destinatario + eventuale email custom
  const toEmails = _selectedDests.filter(d => !d.custom && d.email).map(d => d.email);
  if (_selectedDests.some(d => d.custom)) {
    const customEmail = document.getElementById('customEmail').value.trim();
    if (!customEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customEmail)) {
      showFieldError('customEmail', 'Inserisci un indirizzo email valido.');
      hasError = true;
    } else {
      toEmails.push(customEmail);
    }
  }

  if (!descr) {
    showFieldError('descr', 'Inserisci una breve descrizione del problema.');
    hasError = true;
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

  // Posizione non confermata → avvisa e scrolla alla mappa
  if (!_positionSet) {
    const geoStatus = document.getElementById('geoStatus');
    if (geoStatus) {
      geoStatus.classList.add('geo-warn');
      setTimeout(() => geoStatus.classList.remove('geo-warn'), 3000);
      geoStatus.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
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

  const cat      = _selectedDests.length > 0
    ? _selectedDests.map(d => d.categoria || d.nome).join(', ')
    : 'Altro';
  const catEmoji = _selectedDests.length > 0 ? _selectedDests[0].icon : '📌';
  const urgenza  = document.getElementById('urgenza').value;
  const addr     = document.getElementById('addressInput').value || reportData.address;
  const urgLabel = urgenza === 'Alta' ? '🔴 URGENTE — ' : urgenza === 'Bassa' ? '🟢 ' : '🟡 ';

  const siteUrl = CONFIG.siteUrl
    || window.location.href.replace('index.html', '').split('?')[0];

  const siteBase = siteUrl.replace(/\/?$/, '/');
  const predictedImgUrl = reportData.hasPhoto ? siteBase + 'img/' + ticketId + '.jpg' : null;

  const resolveUrl = siteBase + 'mappa.html?risolvi=' + token;

  const destNome = _selectedDests.map(d => d.nome).join(', ');
  const testoMessaggio = [
    `📍 Segnalazione Civica — ${urgLabel}${cat}`,
    `📌 Luogo: ${addr}`,
    `📝 Descrizione: ${descr}`,
    destNome ? `🏛️ Destinatari: ${destNome}` : '',
    `👤 Segnalato da: ${nome}`,
    `📧 Email: ${emailSegnalante}`,
    `🕐 ${now.toLocaleString('it-IT')}`,
    predictedImgUrl ? `📷 Foto: ${predictedImgUrl}` : '',
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
      CC_Destinatari:     toEmails.slice(1).join(', '),
      Destinatari:        destNome,
      Canale_Email:       toEmails.length > 0 ? 'Sì' : 'No',
      Canale_WhatsApp:    'No',
      Canale_Twitter:     'No',
      Canale_Facebook:    'No',
      Ha_Immagine:        reportData.hasPhoto ? 'Sì' : 'No',
      Dimensioni_Immagine: reportData.photoDims,
      Testo_Messaggio:    testoMessaggio,
      URL_Segnalazione:   siteUrl,
      Email_Destinatario: toEmails[0] || '',
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

    // Salva nel profilo locale (localStorage)
    try {
      const profilo = JSON.parse(localStorage.getItem('segnalaora_profilo') || '[]');
      profilo.unshift({ ticketId, token, categoria: cat, catEmoji, indirizzo: addr,
        data: now.toLocaleDateString('it-IT'),
        ora: now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
        urgenza, nome, email: emailSegnalante, stato: 'Nuova' });
      localStorage.setItem('segnalaora_profilo', JSON.stringify(profilo.slice(0, 50)));
    } catch(e) {}
  }

  // 2. Canali di invio
  const channelsBadges = [];
  if (toEmails.length > 0) {
    _selectedDests.forEach(d => {
      channelsBadges.push('🏛️ ' + d.nome);
    });
  }

  // 3. Social sharing (se selezionato)
  if (_socialPlatforms.size > 0) {
    const rawTags = (document.getElementById('socialTags')?.value || '').trim();
    const tags = rawTags.split(',').map(t => t.trim()).filter(Boolean)
      .map(t => t.startsWith('@') ? t : '@' + t).join(' ');
    const socialMsg = [
      `${urgLabel}${cat} — ${addr}`,
      descr ? `📝 ${descr}` : '',
      tags,
      `#SegnalaOra #${cat.replace(/[^a-zA-Z0-9]/g, '')}`,
      siteBase + 'mappa.html',
    ].filter(Boolean).join('\n');
    const mapUrl = encodeURIComponent(siteBase + 'mappa.html');
    const txt    = encodeURIComponent(socialMsg);
    const urls = {
      twitter:  `https://twitter.com/intent/tweet?text=${txt}`,
      whatsapp: `https://wa.me/?text=${txt}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${mapUrl}&quote=${txt}`,
      telegram: `https://t.me/share/url?url=${mapUrl}&text=${txt}`,
      bluesky:  `https://bsky.app/intent/compose?text=${txt}`,
    };
    const names = { twitter: 'X/Twitter', whatsapp: 'WhatsApp', facebook: 'Facebook', telegram: 'Telegram', bluesky: 'Bluesky' };
    let delay = 200;
    for (const p of _socialPlatforms) {
      setTimeout(() => window.open(urls[p], '_blank'), delay);
      channelsBadges.push('📱 ' + names[p]);
      delay += 600;
    }
  }

  // 4. Schermata di successo
  _ticketCopied = false;
  document.getElementById('ticketId').textContent     = ticketId;
  document.getElementById('resolveToken').textContent = token;
  document.getElementById('copyReminder').classList.remove('visible');
  document.getElementById('successDetail').textContent =
    'Segnalazione registrata nell\'archivio. L\'ufficio competente è stato contattato.';

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
//  SOCIAL SHARING
// ─────────────────────────────────────────────
function toggleSocial(platform) {
  _socialPlatforms.has(platform)
    ? _socialPlatforms.delete(platform)
    : _socialPlatforms.add(platform);
  document.querySelectorAll('.social-chip').forEach(btn =>
    btn.classList.toggle('active', _socialPlatforms.has(btn.dataset.platform))
  );
  const row = document.getElementById('socialTagsRow');
  if (row) row.style.display = _socialPlatforms.size > 0 ? 'block' : 'none';
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
document.addEventListener('DOMContentLoaded', () => { setTimeout(initMap, 150); });
