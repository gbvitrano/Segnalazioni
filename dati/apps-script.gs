// ═══════════════════════════════════════════════════════════════
//  SegnalaOra — Google Apps Script
//  Incolla questo codice su https://script.google.com
//  poi: Distribuisci → Nuova distribuzione → App web
//       Esegui come: Me  |  Chi ha accesso: Chiunque
// ═══════════════════════════════════════════════════════════════

// ID del tuo Google Sheet (dalla URL: /spreadsheets/d/ID/edit)
const SHEET_ID = '1Wun8u5LG04R_4GuT8XOG5l_QT3NulmULCztNUI4n-E0';

// Nome del foglio (tab in basso nel foglio)
const SHEET_NAME = 'Main';

// ─── Configurazione email ─────────────────────────────────────
const NOME_COMUNE = 'XXXX';           // ← personalizza: es. 'Palermo'
const EMAIL_NOREPLY = '';             // ← es. 'noreply@comune.it'

// ─── Configurazione GitHub per upload immagini ───────────────
const GITHUB_OWNER  = 'gbvitrano';
const GITHUB_REPO   = 'Segnalazioni';
const GITHUB_BRANCH = 'master';

const COLUMNS = [
  'ID_Segnalazione','Timestamp_UTC','Data','Ora','Categoria','Categoria_Emoji',
  'Urgenza','Descrizione','Nome_Segnalante','Email_Segnalante','Lat','Long',
  'Indirizzo_Completo','Via','Numero_Civico','CAP','Comune','Provincia','Regione',
  'Fonte_Posizione','Accuratezza_GPS_m','Destinatari','Canale_Email','CC_Destinatari',
  'Canale_WhatsApp','Canale_Twitter','Canale_Facebook','Ha_Immagine',
  'Num_Foto','Dimensioni_Immagine','Testo_Messaggio','URL_Segnalazione',
  'URL_Immagine','URL_Immagini',
  'Stato','Note_Ufficio','Operatore','Data_Presa_Carico','Data_Risoluzione',
  'Token_Risoluzione',
];

function ensureHeaders(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(COLUMNS);
    const h = sheet.getRange(1, 1, 1, COLUMNS.length);
    h.setFontWeight('bold');
    h.setBackground('#1a1208');
    h.setFontColor('#f5f0e8');
    return;
  }
  const existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const missing  = COLUMNS.filter(col => !existing.includes(col));
  if (missing.length === 0) return;
  const startCol = existing.length + 1;
  const newRange = sheet.getRange(1, startCol, 1, missing.length);
  newRange.setValues([missing]);
  newRange.setFontWeight('bold');
  newRange.setBackground('#1a1208');
  newRange.setFontColor('#f5f0e8');
}

// ─── Anti-spam: verifica MX record del dominio email ─────────────
function hasMXRecord(email) {
  try {
    const domain = email.split('@')[1];
    if (!domain) return false;
    const resp = UrlFetchApp.fetch(
      'https://dns.google/resolve?name=' + encodeURIComponent(domain) + '&type=MX',
      { muteHttpExceptions: true }
    );
    const result = JSON.parse(resp.getContentText());
    return !!(result.Answer && result.Answer.length > 0);
  } catch (e) {
    return true; // in caso di errore DNS non bloccare
  }
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // ─── Anti-spam: honeypot ──────────────────────────────────────
    if (data._hp) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: true, id: 'ok' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // ─── Anti-spam: verifica MX email segnalante ──────────────────
    if (data.Email_Segnalante && !hasMXRecord(data.Email_Segnalante)) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: 'Dominio email non valido' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const sheet = SpreadsheetApp
      .openById(SHEET_ID)
      .getSheetByName(SHEET_NAME);

    if (!sheet) {
      throw new Error('Foglio "' + SHEET_NAME + '" non trovato in SHEET_ID=' + SHEET_ID);
    }

    if (data.action === 'risolvi') {
      return risolviSegnalazione(sheet, data);
    }

    // Upload immagini su GitHub (fino a 4 foto)
    const uploadedUrls = [];
    for (var photoIdx = 1; photoIdx <= 4; photoIdx++) {
      var b64key = 'imageBase64_' + photoIdx;
      if (data[b64key]) {
        try {
          var imgUrl = uploadImageToGitHub(data.ID_Segnalazione, photoIdx, data[b64key]);
          if (imgUrl) uploadedUrls.push(imgUrl);
        } catch(imgErr) {}
      }
    }
    if (uploadedUrls.length > 0) {
      data.URL_Immagine  = uploadedUrls[0];
      data.URL_Immagini  = uploadedUrls.join(', ');
    }

    ensureHeaders(sheet);

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const row = headers.map(col => data[col] !== undefined ? data[col] : '');
    sheet.appendRow(row);

    const mittente   = 'SegnalaOra — Comune di ' + NOME_COMUNE;
    const siteBase   = (data.URL_Segnalazione || '').replace(/\/?$/, '/');
    const resolveUrl = siteBase + 'mappa.html?risolvi=' + data.Token_Risoluzione;

    var photoBlobs = [];
    for (var pi = 1; pi <= 4; pi++) {
      var bkey = 'imageBase64_' + pi;
      if (data[bkey]) {
        try {
          var raw = data[bkey].replace(/^data:image\/\w+;base64,/, '');
          photoBlobs.push(Utilities.newBlob(
            Utilities.base64Decode(raw), 'image/jpeg', 'foto_' + pi + '.jpg'
          ));
        } catch(e) {}
      }
    }

    if (data.Email_Destinatario) {
      try {
        const urgPrefix = data.Urgenza === 'Alta' ? '🔴 URGENTE — ' : '';
        const subjectPA = '[SegnalaOra] ' + urgPrefix + data.Categoria + ' — ' + data.ID_Segnalazione;
        const optsPA = {
          to:       data.Email_Destinatario,
          subject:  subjectPA,
          htmlBody: buildEmailPA(data, mittente, resolveUrl),
          name:     mittente,
          noReply:  true,
          replyTo:  data.Email_Segnalante || '',
        };
        if (data.CC_Destinatari) optsPA.cc = data.CC_Destinatari;
        if (photoBlobs.length > 0) optsPA.attachments = photoBlobs;
        MailApp.sendEmail(optsPA);
      } catch(mailErr) {}
    }

    if (data.Email_Segnalante) {
      try {
        MailApp.sendEmail({
          to:       data.Email_Segnalante,
          subject:  '[SegnalaOra] Segnalazione ricevuta — ' + data.ID_Segnalazione,
          htmlBody: buildEmailSegnalante(data, mittente),
          name:     mittente,
          noReply:  true,
        });
      } catch(mailErr) {}
    }

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, id: data.ID_Segnalazione }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function risolviSegnalazione(sheet, data) {
  const token = (data.token || '').trim();
  const id    = (data.ID_Segnalazione || '').trim();

  if (!token && !id) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: 'Token o ID_Segnalazione mancante' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: 'Nessuna segnalazione nel foglio' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const headers     = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const tokenColIdx = headers.indexOf('Token_Risoluzione') + 1;
  const idColIdx    = headers.indexOf('ID_Segnalazione') + 1;
  const statoColIdx = headers.indexOf('Stato') + 1;
  const dataRisColIdx = headers.indexOf('Data_Risoluzione') + 1;

  if (statoColIdx === 0 || dataRisColIdx === 0) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: 'Colonne Stato/Data_Risoluzione non trovate' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  let foundRow = -1;
  if (token && tokenColIdx > 0) {
    const tokens = sheet.getRange(2, tokenColIdx, lastRow - 1, 1).getValues();
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i][0] === token) { foundRow = i + 2; break; }
    }
  }
  if (foundRow === -1 && id && idColIdx > 0) {
    const ids = sheet.getRange(2, idColIdx, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (ids[i][0] === id) { foundRow = i + 2; break; }
    }
  }

  if (foundRow === -1) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: 'Segnalazione non trovata' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const oggi = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy');
  sheet.getRange(foundRow, statoColIdx).setValue('Risolta');
  sheet.getRange(foundRow, dataRisColIdx).setValue(oggi);

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, data: oggi }))
    .setMimeType(ContentService.MimeType.JSON);
}

function uploadImageToGitHub(id, photoIndex, imageBase64) {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) return null;

  const b64    = imageBase64.replace(/^data:image\/\w+;base64,/, '');
  const path   = 'img/' + id + '/foto_' + photoIndex + '.jpg';
  const apiUrl = 'https://api.github.com/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/contents/' + path;

  const response = UrlFetchApp.fetch(apiUrl, {
    method: 'PUT',
    headers: {
      'Authorization': 'token ' + token,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    payload: JSON.stringify({
      message: 'img: aggiunge ' + id + '/foto_' + photoIndex + ' [skip ci]',
      content: b64,
      branch: GITHUB_BRANCH,
    }),
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() === 201) {
    return 'https://' + GITHUB_OWNER + '.github.io/' + GITHUB_REPO + '/' + path;
  }
  return null;
}

function buildEmailPA(data, mittente, resolveUrl) {
  const urgenza  = data.Urgenza || 'Normale';
  const urgColor = urgenza === 'Alta' ? '#c0392b' : urgenza === 'Bassa' ? '#3d5a47' : '#d4820a';
  const urgLabel = urgenza === 'Alta' ? '🔴 URGENTE' : urgenza === 'Bassa' ? '🟢 Bassa' : '🟡 Normale';

  const tdL = 'padding:9px 14px;background:#f9f6f0;color:#5a5044;font-size:0.82rem;white-space:nowrap;vertical-align:top;border-bottom:1px solid #ede8e0;width:130px;';
  const tdV = 'padding:9px 14px;font-size:0.88rem;border-bottom:1px solid #ede8e0;color:#1a1208;';

  const rows = [
    ['Categoria',    data.Categoria || '—'],
    ['Urgenza',      '<span style="color:' + urgColor + ';font-weight:bold;">' + urgLabel + '</span>'],
    ['Luogo',        data.Indirizzo_Completo || '—'],
    ['Coordinate',   (data.Lat && data.Long) ? data.Lat + ', ' + data.Long : '—'],
    ['Descrizione',  data.Descrizione || '—'],
    ['Destinatario', data.Area_Destinataria || '—'],
    ['Segnalato da', data.Nome_Segnalante || '—'],
    ['Email',        data.Email_Segnalante ? '<a href="mailto:' + data.Email_Segnalante + '" style="color:#d4820a;">' + data.Email_Segnalante + '</a>' : '—'],
    ['Data / ora',   (data.Data || '') + ' ' + (data.Ora || '')],
    ['ID',           '<strong>' + (data.ID_Segnalazione || '—') + '</strong>'],
  ].map(function(r) {
    return '<tr><td style="' + tdL + '">' + r[0] + '</td><td style="' + tdV + '">' + r[1] + '</td></tr>';
  }).join('');

  const photoUrls = (data.URL_Immagini || data.URL_Immagine || '').split(',').map(u => u.trim()).filter(Boolean);
  const photoHtml = photoUrls.length > 0
    ? '<div style="margin:20px 0;display:flex;flex-wrap:wrap;gap:8px;">'
      + photoUrls.map(function(u) {
          return '<a href="' + u + '" style="flex:1;min-width:120px;max-width:200px;"><img src="' + u + '" alt="Foto" style="width:100%;border-radius:8px;border:1px solid #e8e0d4;"></a>';
        }).join('')
      + '</div>'
    : '';

  return '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f0e8;font-family:\'Segoe UI\',Arial,sans-serif;">'
    + '<div style="max-width:620px;margin:24px auto;">'
    + '<div style="background:#1a1208;padding:20px 28px;border-radius:10px 10px 0 0;">'
    + '<h2 style="margin:0;color:#f5f0e8;font-size:1.1rem;">📍 Nuova Segnalazione Civica</h2>'
    + '<p style="margin:5px 0 0;color:#d4820a;font-size:0.8rem;">' + mittente + '</p>'
    + '</div>'
    + '<div style="background:#fff;border:1px solid #e8e0d4;border-top:none;padding:24px 28px;border-radius:0 0 10px 10px;">'
    + '<table style="width:100%;border-collapse:collapse;border:1px solid #ede8e0;">' + rows + '</table>'
    + photoHtml
    + '<div style="margin-top:24px;padding:18px 20px;background:#f5f0e8;border-radius:8px;border:1px solid #e8e0d4;">'
    + '<p style="margin:0 0 12px;font-size:0.83rem;color:#666;">Per segnare come <strong>RISOLTA</strong>:</p>'
    + '<a href="' + resolveUrl + '" style="display:inline-block;padding:10px 22px;background:#3d5a47;color:#fff;text-decoration:none;border-radius:8px;font-size:0.88rem;font-weight:600;">✓ Segna come risolta</a>'
    + '</div>'
    + '<p style="margin:18px 0 0;font-size:0.73rem;color:#aaa;">Generato automaticamente da ' + mittente + '.</p>'
    + '</div></div></body></html>';
}

function buildEmailSegnalante(data, mittente) {
  const tdL = 'padding:8px 14px;background:#f9f6f0;color:#5a5044;font-size:0.82rem;white-space:nowrap;vertical-align:top;border-bottom:1px solid #ede8e0;width:110px;';
  const tdV = 'padding:8px 14px;font-size:0.88rem;border-bottom:1px solid #ede8e0;color:#1a1208;';

  const rows = [
    ['ID',          '<strong>' + (data.ID_Segnalazione || '—') + '</strong>'],
    ['Categoria',   data.Categoria || '—'],
    ['Luogo',       data.Indirizzo_Completo || '—'],
    ['Descrizione', data.Descrizione || '—'],
    ['Inviata a',   data.Area_Destinataria || data.Destinatari || '—'],
    ['Data/ora',    (data.Data || '') + ' ' + (data.Ora || '')],
  ].map(function(r) {
    return '<tr><td style="' + tdL + '">' + r[0] + '</td><td style="' + tdV + '">' + r[1] + '</td></tr>';
  }).join('');

  const photoUrls2 = (data.URL_Immagini || data.URL_Immagine || '').split(',').map(u => u.trim()).filter(Boolean);
  const photoHtml = photoUrls2.length > 0
    ? '<div style="margin:16px 0 0;display:flex;flex-wrap:wrap;gap:8px;">'
      + photoUrls2.map(function(u) {
          return '<a href="' + u + '" style="flex:1;min-width:120px;max-width:180px;"><img src="' + u + '" alt="Foto" style="width:100%;border-radius:8px;border:1px solid #e8e0d4;"></a>';
        }).join('')
      + '</div>'
    : '';

  return '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f5f0e8;font-family:\'Segoe UI\',Arial,sans-serif;">'
    + '<div style="max-width:560px;margin:24px auto;">'
    + '<div style="background:#3d5a47;padding:20px 28px;border-radius:10px 10px 0 0;">'
    + '<h2 style="margin:0;color:#fff;font-size:1.1rem;">✓ Segnalazione ricevuta</h2>'
    + '<p style="margin:5px 0 0;color:#a8d5b5;font-size:0.8rem;">' + mittente + '</p>'
    + '</div>'
    + '<div style="background:#fff;border:1px solid #e8e0d4;border-top:none;padding:24px 28px;border-radius:0 0 10px 10px;">'
    + '<p style="margin:0 0 16px;font-size:0.95rem;">Ciao <strong>' + (data.Nome_Segnalante || 'Cittadino') + '</strong>,</p>'
    + '<p style="margin:0 0 16px;color:#555;font-size:0.88rem;">La tua segnalazione è stata registrata con successo.</p>'
    + '<table style="width:100%;border-collapse:collapse;border:1px solid #ede8e0;margin-bottom:20px;">' + rows + '</table>'
    + photoHtml
    + '<p style="margin:16px 0 0;font-size:0.83rem;color:#555;">Conserva il tuo <strong>ID segnalazione</strong> per seguire l\'evoluzione della pratica.</p>'
    + '<p style="margin:20px 0 0;font-size:0.73rem;color:#aaa;">— ' + mittente + '</p>'
    + '</div></div></body></html>';
}

function doGet(e) {
  const params = (e && e.parameter) || {};

  // ─── Ping registro utilizzi ────────────────────────────────────
  // Ricevuto da istanze fork che caricano la mappa pubblica.
  // Scrive host + timestamp nel foglio "Utilizzi" dello stesso Sheet.
  if (params.action === 'ping') {
    const host = (params.host || 'sconosciuto').slice(0, 200);
    try {
      const ss   = SpreadsheetApp.openById(SHEET_ID);
      let sheet  = ss.getSheetByName('Utilizzi');
      if (!sheet) {
        sheet = ss.insertSheet('Utilizzi');
        sheet.appendRow(['Timestamp', 'Host']);
        const h = sheet.getRange(1, 1, 1, 2);
        h.setFontWeight('bold');
        h.setBackground('#1a1208');
        h.setFontColor('#f5f0e8');
      }
      const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss');
      sheet.appendRow([now, host]);
    } catch(err) {}
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, service: 'SegnalaOra', status: 'attivo' }))
    .setMimeType(ContentService.MimeType.JSON);
}
