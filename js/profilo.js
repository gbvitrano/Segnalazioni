/* ═══════════════════════════════════════════════════════
   SegnalaOra — Profilo utente
   Legge dal localStorage e incrocia con i CSV pubblici
   ═══════════════════════════════════════════════════════ */

const SHEETS_CSV_APERTE  = APP_CONFIG.sheetsCsvAperte;
const SHEETS_CSV_RISOLTE = APP_CONFIG.sheetsCsvRisolte;
const APPS_SCRIPT_URL    = APP_CONFIG.appsScriptUrl;
const LS_KEY       = 'segnalaora_profilo';
const LS_EMAIL_KEY = 'segnalaora_email';

// Stato filtri profilo
let profiloAllReports = [];
let profiloFilters    = { periodo: 'all' };
let pfActiveCats      = null;   // null = tutte; Set = solo queste

// ─────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────
async function init() {
  const reports    = loadLocal();
  const savedEmail = localStorage.getItem(LS_EMAIL_KEY) || '';

  // Pre-popola il campo email se salvato
  if (savedEmail) {
    const emailInput = document.getElementById('searchEmail');
    if (emailInput) emailInput.value = savedEmail;
  }

  if (reports.length > 0) {
    renderList(reports);
    updateSummary(reports);
    document.getElementById('clearSection').style.display = 'block';
    await refreshStatuses(reports);
    // Sincronizza nuove segnalazioni in background tramite email salvata
    if (savedEmail) syncFromEmail(savedEmail, false);
  } else if (savedEmail) {
    // Nessun dato locale ma email salvata: sincronizza subito mostrando il feedback
    document.getElementById('emailSearchForm').style.display = 'block';
    await syncFromEmail(savedEmail, true);
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
    const bust = (u) => u + (u.includes('?') ? '&' : '?') + 't=' + Date.now();
    const [t1, t2] = await Promise.all([
      fetch(bust(SHEETS_CSV_APERTE)).then(r => r.text()).catch(() => ''),
      fetch(bust(SHEETS_CSV_RISOLTE)).then(r => r.text()).catch(() => ''),
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
//  MERGE + SYNC DA EMAIL
// ─────────────────────────────────────────────

// Unisce newReports nel localStorage: aggiorna stato/token, aggiunge nuovi
function mergeIntoLocal(newReports) {
  const existing = loadLocal();
  const byId = {};
  existing.forEach(r => { byId[r.ticketId] = r; });

  let changed = false;
  newReports.forEach(nr => {
    if (byId[nr.ticketId]) {
      const local = byId[nr.ticketId];
      if (nr.stato && nr.stato !== local.stato) { local.stato = nr.stato; changed = true; }
      if (nr.token && !local.token) { local.token = nr.token; changed = true; }
    } else {
      existing.push(nr);
      byId[nr.ticketId] = nr;
      changed = true;
    }
  });

  if (changed) {
    existing.sort((a, b) => (b.ticketId || '').localeCompare(a.ticketId || ''));
    saveLocal(existing);
  }
  return existing;
}

// Recupera segnalazioni per email tramite Apps Script, le merge e aggiorna la UI
async function syncFromEmail(email, showFeedback) {
  if (showFeedback) {
    const btn = document.getElementById('searchBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Ricerca…'; }
  }

  try {
    const url  = APPS_SCRIPT_URL + '?action=cerca&email=' + encodeURIComponent(email) + '&t=' + Date.now();
    const resp = await fetch(url);
    const json = await resp.json();

    if (!json.ok) throw new Error(json.error || 'Errore server');

    const rows = json.data || [];
    const converted = rows.map(r => ({
      ticketId:  r.ID_Segnalazione,
      categoria: r.Categoria,
      catEmoji:  r.Categoria_Emoji,
      indirizzo: r.Via || r.Indirizzo_Completo,
      data: r.Data, ora: r.Ora,
      urgenza: r.Urgenza,
      stato:   r.Stato,
      nome:    r.Nome_Segnalante,
      token:   r.Token_Risoluzione || '',
    }));

    const merged = mergeIntoLocal(converted);

    if (showFeedback) {
      if (!rows.length) {
        renderList([], `<i class="fa-solid fa-magnifying-glass"></i> Nessuna segnalazione trovata per <strong>${email}</strong>`);
      } else {
        renderList(merged,
          `<i class="fa-solid fa-magnifying-glass"></i> ${rows.length} segnalazion${rows.length === 1 ? 'e' : 'i'} trovate per <strong>${email}</strong>`);
        updateSummary(merged);
        document.getElementById('clearSection').style.display = 'block';
      }
    } else if (merged.length > 0) {
      renderList(merged);
      updateSummary(merged);
      document.getElementById('clearSection').style.display = 'block';
    }
  } catch(e) {
    if (showFeedback) {
      document.getElementById('profileList').innerHTML =
        '<div class="no-reports">Errore di rete. Controlla la connessione e riprova.</div>';
    }
  } finally {
    if (showFeedback) {
      const btn = document.getElementById('searchBtn');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Cerca'; }
    }
  }
}

// ─────────────────────────────────────────────
//  FILTRI PROFILO
// ─────────────────────────────────────────────
function parseItalianDate(str) {
  if (!str) return null;
  const parts = str.split('/');
  if (parts.length !== 3) return null;
  return new Date(+parts[2], +parts[1] - 1, +parts[0]);
}

function buildPfCatPanel() {
  const container = document.getElementById('pfCatChecks');
  if (!container) return;

  const cats = [...new Set(profiloAllReports.map(r => r.categoria).filter(Boolean))].sort();
  container.innerHTML = '';

  cats.forEach(cat => {
    const div = document.createElement('div');
    div.className = 'col-panel-option';
    const sel     = pfActiveCats === null || pfActiveCats.has(cat);
    div.innerHTML = `<span class="col-chk${sel ? ' checked' : ''}"></span>`
                  + `<span class="col-opt-label${sel ? ' selected' : ''}">${cat}</span>`;
    div.addEventListener('click', () => {
      if (pfActiveCats === null) pfActiveCats = new Set(cats);
      if (pfActiveCats.has(cat)) pfActiveCats.delete(cat);
      else pfActiveCats.add(cat);
      if (pfActiveCats.size === cats.length) pfActiveCats = null;
      const isSel = pfActiveCats === null || pfActiveCats.has(cat);
      div.querySelector('.col-chk').className       = 'col-chk'       + (isSel ? ' checked' : '');
      div.querySelector('.col-opt-label').className = 'col-opt-label' + (isSel ? ' selected' : '');
      syncPfCatCheckbox(cats);
      updatePfFilterActiveBar();
      applyProfiloFilters();
    });
    container.appendChild(div);
  });

  syncPfCatCheckbox(cats);
}

function syncPfCatCheckbox(cats) {
  const total    = cats.length;
  const selCount = pfActiveCats === null ? total : pfActiveCats.size;
  const badge    = document.getElementById('pfCatDdBadge');
  if (badge) badge.textContent = selCount;

  const chk = document.getElementById('pfCatChkAll');
  if (!chk) return;
  const allSel  = pfActiveCats === null;
  const noneSel = pfActiveCats !== null && pfActiveCats.size === 0;
  chk.className = 'col-chk' + (allSel ? ' checked' : noneSel ? '' : ' indeterminate');
  const lbl = document.querySelector('#pfCatOptAll .col-opt-label');
  if (lbl) lbl.className = 'col-opt-label col-opt-all-label' + (allSel ? ' selected' : '');
}

function togglePfCatPanel() {
  const panel   = document.getElementById('pfCatPanel');
  const chevron = document.getElementById('pfCatPanelChevron');
  const open    = panel.style.display === 'block';
  panel.style.display = open ? 'none' : 'block';
  chevron.className   = 'col-dd-chevron fa-solid ' + (open ? 'fa-chevron-down' : 'fa-chevron-up');
}

function toggleAllPfCatsClick() {
  const cats   = [...document.querySelectorAll('#pfCatChecks .col-panel-option')]
                   .map(d => d.querySelector('.col-opt-label').textContent);
  pfActiveCats = pfActiveCats === null ? new Set() : null;
  document.querySelectorAll('#pfCatChecks .col-panel-option').forEach(div => {
    const sel = pfActiveCats === null;
    div.querySelector('.col-chk').className       = 'col-chk'       + (sel ? ' checked' : '');
    div.querySelector('.col-opt-label').className = 'col-opt-label' + (sel ? ' selected' : '');
  });
  syncPfCatCheckbox(cats);
  updatePfFilterActiveBar();
  applyProfiloFilters();
}

function clearPfCatFilter(e) {
  e.stopPropagation();
  pfActiveCats = null;
  buildPfCatPanel();
  updatePfFilterActiveBar();
  applyProfiloFilters();
}

function updatePfFilterActiveBar() {
  const bar  = document.getElementById('pfFilterActiveBar');
  const text = document.getElementById('pfFilterActiveText');
  if (!bar || !text) return;

  const parts = [];
  if (pfActiveCats !== null) {
    parts.push('<strong>Categoria:</strong> '
      + (pfActiveCats.size === 0 ? 'nessuna' : [...pfActiveCats].join(', ')));
  }
  const pSel = document.getElementById('pfPeriodo');
  if (pSel && pSel.value !== 'all') {
    const pLabels = { '7': 'Ultimi 7 giorni', '30': 'Ultimi 30 giorni', '90': 'Ultimi 90 giorni' };
    parts.push('<strong>Periodo:</strong> ' + (pLabels[pSel.value] || pSel.value));
  }
  bar.style.display = parts.length ? 'flex' : 'none';
  text.innerHTML    = parts.join(' &nbsp;·&nbsp; ');
}

function resetProfiloFilters() {
  pfActiveCats       = null;
  profiloFilters.periodo = 'all';
  const pSel = document.getElementById('pfPeriodo');
  if (pSel) pSel.value = 'all';
  buildPfCatPanel();
  updatePfFilterActiveBar();
  applyProfiloFilters();
}

function applyProfiloFilters() {
  profiloFilters.periodo = document.getElementById('pfPeriodo')?.value || 'all';

  let filtered = profiloAllReports;

  if (pfActiveCats !== null) {
    filtered = filtered.filter(r => pfActiveCats.has(r.categoria));
  }

  if (profiloFilters.periodo !== 'all') {
    const days   = parseInt(profiloFilters.periodo);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    filtered = filtered.filter(r => {
      const d = parseItalianDate(r.data);
      return d ? d >= cutoff : true;
    });
  }

  updatePfFilterActiveBar();

  const list = document.getElementById('profileList');
  if (filtered.length === 0) {
    list.innerHTML = '<div class="no-reports"><i class="fa-solid fa-filter"></i> Nessuna segnalazione con i filtri selezionati.</div>';
  } else {
    list.innerHTML = filtered.map((r, i) => renderCard(r, i)).join('');
  }
}

// ─────────────────────────────────────────────
//  RENDER LISTA
// ─────────────────────────────────────────────
function renderList(reports, header) {
  profiloAllReports = reports || [];

  // Mostra/nasconde la barra filtri
  const filterBar = document.getElementById('profiloFilters');
  if (filterBar) filterBar.style.display = reports && reports.length > 1 ? 'flex' : 'none';

  // Costruisce il panel categorie (preserva selezione corrente)
  buildPfCatPanel();

  // Applica filtri correnti
  let filtered = profiloAllReports;
  if (pfActiveCats !== null) {
    filtered = filtered.filter(r => pfActiveCats.has(r.categoria));
  }
  if (profiloFilters.periodo !== 'all') {
    const days   = parseInt(profiloFilters.periodo);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    filtered = filtered.filter(r => {
      const d = parseItalianDate(r.data);
      return d ? d >= cutoff : true;
    });
  }

  const list = document.getElementById('profileList');
  list.innerHTML = (header ? `<div class="search-results-header">${header}</div>` : '')
    + filtered.map((r, i) => renderCard(r, i)).join('');
}

function renderCard(r, idx) {
  const icon = r.catEmoji
    ? (r.catEmoji.startsWith('fa-') ? `<i class="${r.catEmoji}"></i>` : r.catEmoji)
    : '📌';
  const urg   = (r.urgenza || 'Normale').toLowerCase();
  const stato = r.stato || 'Nuova';
  const clsMap  = { Nuova: 'stato-nuova', 'In lavorazione': 'stato-lavorazione', Risolta: 'stato-risolta', Chiusa: 'stato-chiusa' };
  const iconMap = { Nuova: 'fa-solid fa-clock', 'In lavorazione': 'fa-solid fa-wrench', Risolta: 'fa-solid fa-circle-check', Chiusa: 'fa-solid fa-circle-xmark' };
  const delay   = idx > 0 ? ` style="animation-delay:${idx * 0.05}s"` : '';
  const canResolve = stato !== 'Risolta' && stato !== 'Chiusa';
  const resolveHtml = canResolve ? (r.token ? `
      <div class="pc-resolve">
        <button class="btn-resolve-card" data-token="${r.token}" onclick="resolveReport(this)">
          <i class="fa-solid fa-circle-check"></i> Segna come risolta
        </button>
        <span class="resolve-inline-msg"></span>
      </div>` : `
      <div class="pc-resolve pc-resolve--input">
        <input class="resolve-token-input" type="text" placeholder="Codice risoluzione (ricevuto via email)…"
          onkeydown="if(event.key==='Enter')this.nextElementSibling.click()">
        <button class="btn-resolve-card" onclick="resolveReport(this)">
          <i class="fa-solid fa-circle-check"></i> Conferma
        </button>
        <span class="resolve-inline-msg"></span>
      </div>`) : '';
  return `
    <div class="profile-card urg-${urg}"${delay}>
      <div class="pc-top">
        <span class="pc-icon-wrap">${icon}</span>
        <span class="pc-cat">${r.categoria || '—'}</span>
      </div>
      <div class="pc-addr">${r.indirizzo || '—'}</div>
      <div class="pc-meta">
        <span class="pc-date">${r.data || ''} ${r.ora || ''}</span>
        <span class="stato-badge ${clsMap[stato] || 'stato-nuova'}"><i class="${iconMap[stato] || 'fa-solid fa-clock'}"></i> ${stato}</span>
      </div>
      <div class="pc-id">${r.ticketId || ''}</div>
      ${resolveHtml}
    </div>`;
}

// ─────────────────────────────────────────────
//  SEGNA COME RISOLTA (inline)
// ─────────────────────────────────────────────
function resolveReport(btn) {
  // Token da data-attribute (locale) oppure dal campo input (ricerca email)
  let token = btn.dataset.token;
  if (!token) {
    const prev = btn.previousElementSibling;
    if (prev && prev.tagName === 'INPUT') token = prev.value.trim();
  }
  const msg = btn.nextElementSibling;

  if (!token) {
    const prev = btn.previousElementSibling;
    if (prev && prev.tagName === 'INPUT') { prev.focus(); prev.classList.add('input-invalid'); }
    return;
  }
  if (btn.previousElementSibling && btn.previousElementSibling.tagName === 'INPUT') {
    btn.previousElementSibling.classList.remove('input-invalid');
  }

  if (!confirm('Sei sicuro di voler segnare questa segnalazione come risolta?\nQuesta operazione non può essere annullata.')) return;

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Invio…';
  msg.className   = 'resolve-inline-msg';
  msg.textContent = '';

  fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    mode:   'no-cors',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'risolvi', token, ID_Segnalazione: token })
  })
  .then(() => {
    msg.className   = 'resolve-inline-msg ok';
    msg.textContent = '✅ Richiesta inviata. La segnalazione sarà aggiornata entro qualche minuto.';
    btn.innerHTML   = '<i class="fa-solid fa-circle-check"></i> Inviata';

    // Aggiorna stato nel localStorage
    const reports = loadLocal();
    const found   = reports.find(r => r.token === token);
    if (found) {
      found.stato = 'Risolta';
      saveLocal(reports);
      const card  = btn.closest('.profile-card');
      const badge = card.querySelector('.stato-badge');
      if (badge) { badge.className = 'stato-badge stato-risolta'; badge.textContent = 'Risolta'; }
    }

    setTimeout(() => { btn.closest('.pc-resolve').style.display = 'none'; }, 5000);
  })
  .catch(() => {
    msg.className   = 'resolve-inline-msg err';
    msg.textContent = '❌ Errore di rete. Riprova.';
    btn.disabled    = false;
    btn.innerHTML   = '<i class="fa-solid fa-circle-check"></i> Segna come risolta';
  });
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
      <i class="summary-icon fa-solid fa-list-ul"></i>
      <span class="summary-num">${reports.length}</span>
      <span class="summary-lbl">Totali</span>
    </div>
    <div class="summary-stat urgent">
      <i class="summary-icon fa-solid fa-clock"></i>
      <span class="summary-num">${nuove}</span>
      <span class="summary-lbl">Nuove</span>
    </div>
    <div class="summary-stat">
      <i class="summary-icon fa-solid fa-wrench"></i>
      <span class="summary-num">${lav}</span>
      <span class="summary-lbl">Lavoraz.</span>
    </div>
    <div class="summary-stat resolved">
      <i class="summary-icon fa-solid fa-circle-check"></i>
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
  localStorage.setItem(LS_EMAIL_KEY, email);
  await syncFromEmail(email, true);
}

// ─────────────────────────────────────────────
//  CANCELLA CRONOLOGIA
// ─────────────────────────────────────────────
function confirmClear() {
  if (confirm('Cancellare la cronologia salvata su questo dispositivo?\nQuesta operazione non può essere annullata.')) {
    localStorage.removeItem(LS_KEY);
    localStorage.removeItem(LS_EMAIL_KEY);
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
    result.push(obj);
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
// Chiude il panel categorie al click fuori
document.addEventListener('click', e => {
  const dd = document.getElementById('pfCatDropdown');
  if (dd && !dd.contains(e.target)) {
    const panel   = document.getElementById('pfCatPanel');
    const chevron = document.getElementById('pfCatPanelChevron');
    if (panel)   panel.style.display = 'none';
    if (chevron) chevron.className   = 'col-dd-chevron fa-solid fa-chevron-down';
  }
});

init();
