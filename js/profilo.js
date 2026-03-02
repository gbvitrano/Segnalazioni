/* ═══════════════════════════════════════════════════════
   SegnalaOra — Profilo utente
   Legge dal localStorage e incrocia con i CSV pubblici
   ═══════════════════════════════════════════════════════ */

const SHEETS_CSV_APERTE  = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRzGnyHVzcSbnLKsp1gkFi5a8xJeeFTK8YhmA67XJUEGaJIQ5sMNwqG4Jdhxg9DqaAWU2bdWGHGfnpR/pub?gid=144049557&single=true&output=csv';
const SHEETS_CSV_RISOLTE = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRzGnyHVzcSbnLKsp1gkFi5a8xJeeFTK8YhmA67XJUEGaJIQ5sMNwqG4Jdhxg9DqaAWU2bdWGHGfnpR/pub?gid=707341479&single=true&output=csv';
const LS_KEY = 'segnalaora_profilo';

// ─────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────
async function init() {
  const reports = loadLocal();
  if (reports.length > 0) {
    renderList(reports);                  // mostra subito i dati locali
    updateSummary(reports);
    document.getElementById('clearSection').style.display = 'block';
    await refreshStatuses(reports);       // poi aggiorna stati dal CSV
  } else {
    document.getElementById('profileList').innerHTML = `
      <div class="no-reports">
        <i class="fa-solid fa-inbox"></i>
        Nessuna segnalazione salvata su questo dispositivo.<br>
        <small style="margin-top:0.5rem;display:block">Le segnalazioni inviate da questo browser appariranno qui automaticamente.</small>
      </div>`;
  }
}

// ─────────────────────────────────────────────
//  LOCALSTORAGE
// ─────────────────────────────────────────────
function loadLocal() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); }
  catch(e) { return []; }
}

function saveLocal(reports) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(reports)); }
  catch(e) {}
}

// ─────────────────────────────────────────────
//  AGGIORNAMENTO STATI DAL CSV
// ─────────────────────────────────────────────
async function refreshStatuses(reports) {
  try {
    const [t1, t2] = await Promise.all([
      fetch(SHEETS_CSV_APERTE  + '&t=' + Date.now()).then(r => r.text()).catch(() => ''),
      fetch(SHEETS_CSV_RISOLTE + '&t=' + Date.now()).then(r => r.text()).catch(() => ''),
    ]);
    const rows  = [...parseCSV(t1), ...parseCSV(t2)];
    const byId  = {};
    rows.forEach(r => { if (r.ID_Segnalazione) byId[r.ID_Segnalazione] = r; });

    let updated = false;
    reports.forEach(r => {
      const live = byId[r.ticketId];
      if (live && live.Stato && live.Stato !== r.stato) {
        r.stato = live.Stato;
        updated = true;
      }
    });

    if (updated) {
      saveLocal(reports);
      renderList(reports);
      updateSummary(reports);
    }
  } catch(e) {}
}

// ─────────────────────────────────────────────
//  RENDER LISTA
// ─────────────────────────────────────────────
function renderList(reports, header) {
  const list = document.getElementById('profileList');
  list.innerHTML = (header ? `<div class="search-results-header">${header}</div>` : '')
    + reports.map(renderCard).join('');
}

function renderCard(r) {
  const icon = r.catEmoji
    ? (r.catEmoji.startsWith('fa-') ? `<i class="${r.catEmoji}"></i>` : r.catEmoji)
    : '📌';
  const urg   = (r.urgenza || 'Normale').toLowerCase();
  const stato = r.stato || 'Nuova';
  const clsMap = { Nuova: 'stato-nuova', 'In lavorazione': 'stato-lavorazione', Risolta: 'stato-risolta', Chiusa: 'stato-chiusa' };
  return `
    <div class="profile-card">
      <div class="pc-top">
        <span class="pc-icon">${icon}</span>
        <span class="pc-cat">${r.categoria || '—'}</span>
        <div class="urgency-dot ${urg}"></div>
      </div>
      <div class="pc-addr">${r.indirizzo || '—'}</div>
      <div class="pc-meta">
        <span class="pc-date">${r.data || ''} ${r.ora || ''}</span>
        <span class="stato-badge ${clsMap[stato] || 'stato-nuova'}">${stato}</span>
      </div>
      <div class="pc-id">${r.ticketId || ''}</div>
    </div>`;
}

// ─────────────────────────────────────────────
//  RIEPILOGO
// ─────────────────────────────────────────────
function updateSummary(reports) {
  const el = document.getElementById('profileSummary');
  if (!reports.length) { el.style.display = 'none'; return; }

  const nuove    = reports.filter(r => r.stato === 'Nuova').length;
  const lav      = reports.filter(r => r.stato === 'In lavorazione').length;
  const risolte  = reports.filter(r => r.stato === 'Risolta').length;

  el.style.display = 'grid';
  el.innerHTML = `
    <div class="summary-stat">
      <span class="summary-num">${reports.length}</span>
      <span class="summary-lbl">Totali</span>
    </div>
    <div class="summary-stat urgent">
      <span class="summary-num">${nuove}</span>
      <span class="summary-lbl">Nuove</span>
    </div>
    <div class="summary-stat">
      <span class="summary-num">${lav}</span>
      <span class="summary-lbl">Lavoraz.</span>
    </div>
    <div class="summary-stat resolved">
      <span class="summary-num">${risolte}</span>
      <span class="summary-lbl">Risolte</span>
    </div>`;
}

// ─────────────────────────────────────────────
//  CERCA PER EMAIL
// ─────────────────────────────────────────────
function toggleEmailSearch() {
  const form = document.getElementById('emailSearchForm');
  const isOpen = form.style.display !== 'none';
  form.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) setTimeout(() => document.getElementById('searchEmail').focus(), 80);
}

async function searchByEmail() {
  const email = (document.getElementById('searchEmail').value || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    document.getElementById('searchEmail').focus();
    return;
  }

  const btn = document.getElementById('searchBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Ricerca…';

  try {
    const [t1, t2] = await Promise.all([
      fetch(SHEETS_CSV_APERTE  + '&t=' + Date.now()).then(r => r.text()).catch(() => ''),
      fetch(SHEETS_CSV_RISOLTE + '&t=' + Date.now()).then(r => r.text()).catch(() => ''),
    ]);
    const rows = [...parseCSV(t1), ...parseCSV(t2)]
      .filter(r => (r.Email_Segnalante || '').trim().toLowerCase() === email);

    if (!rows.length) {
      renderList([], `<i class="fa-solid fa-magnifying-glass"></i> Nessuna segnalazione trovata per <strong>${email}</strong>`);
    } else {
      const converted = rows.map(r => ({
        ticketId:  r.ID_Segnalazione,
        categoria: r.Categoria,
        catEmoji:  r.Categoria_Emoji,
        indirizzo: r.Via || r.Indirizzo_Completo,
        data: r.Data, ora: r.Ora,
        urgenza: r.Urgenza,
        stato:   r.Stato,
        nome:    r.Nome_Segnalante,
      }));
      renderList(converted,
        `<i class="fa-solid fa-magnifying-glass"></i> ${rows.length} segnalazion${rows.length === 1 ? 'e' : 'i'} trovate per <strong>${email}</strong>`);
    }
  } catch(e) {
    document.getElementById('profileList').innerHTML =
      '<div class="no-reports">Errore di rete. Controlla la connessione e riprova.</div>';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Cerca';
  }
}

// ─────────────────────────────────────────────
//  CANCELLA CRONOLOGIA
// ─────────────────────────────────────────────
function confirmClear() {
  if (confirm('Cancellare la cronologia salvata su questo dispositivo?\nQuesta operazione non può essere annullata.')) {
    localStorage.removeItem(LS_KEY);
    location.reload();
  }
}

// ─────────────────────────────────────────────
//  CSV PARSER (identico a map.js)
// ─────────────────────────────────────────────
function parseCSV(text) {
  if (!text) return [];
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const rows = splitCSVRows(normalized);
  if (rows.length < 2) return [];
  const headers = parseCSVLine(rows[0]);
  const result  = [];
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i].trim()) continue;
    const vals = parseCSVLine(rows[i]);
    const obj  = {};
    headers.forEach((h, idx) => {
      obj[h.trim().replace(/^\uFEFF/, '')] = (vals[idx] !== undefined ? vals[idx] : '').trim();
    });
    if (obj.Lat && !isNaN(parseFloat(obj.Lat))) result.push(obj);
  }
  return result;
}

function splitCSVRows(text) {
  const rows = [];
  let rowStart = 0, inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i+1] === '"') i++;
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
  let current = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i+1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current); current = '';
    } else { current += ch; }
  }
  result.push(current);
  return result;
}

// ─────────────────────────────────────────────
init();
