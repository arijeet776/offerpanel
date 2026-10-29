/**
 * Digi Sanchaar -> Google Sheets receiver.
 * 1. Open your spreadsheet -> Extensions -> Apps Script -> paste this file.
 * 2. Set SECRET below (same value as SHEETS_SECRET on Render).
 * 3. Deploy -> New deployment -> Web app -> Execute as: Me, Who has access: Anyone.
 * 4. Copy the web app URL into SHEETS_WEBHOOK_URL on Render.
 *
 * Columns are matched by HEADER NAME (case, spaces and underscores ignored), so your
 * existing column order does not matter. Headers it does not know are left untouched.
 * Rows are matched by the key column, so edited rows are UPDATED instead of duplicated.
 */
const SECRET = 'CHANGE_ME';
const SPREADSHEET_ID = ''; // leave empty to use the spreadsheet this script is attached to

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// Text from users must never become a formula.
const safe = v => (typeof v === 'string' && /^[=+\-@\t\r]/.test(v)) ? "'" + v : v;

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() { return out({ ok: true, message: 'alive' }); }

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const body = JSON.parse(e.postData.contents);
    if (body.secret !== SECRET) return out({ ok: false, error: 'unauthorized' });

    const ss = SPREADSHEET_ID ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(body.sheet);
    if (!sheet) return out({ ok: false, error: 'Tab not found: ' + body.sheet });

    const lastCol = sheet.getLastColumn();
    if (lastCol < 1) return out({ ok: false, error: 'Tab has no header row: ' + body.sheet });
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(norm);
    const keyIdx = headers.indexOf(norm(body.key));
    if (keyIdx === -1) return out({ ok: false, error: 'Add a "' + body.key + '" column to tab "' + body.sheet + '"' });

    const lastRow = sheet.getLastRow();
    const body_ = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, lastCol) : null;
    const data = body_ ? body_.getValues() : [];
    const formulas = body_ ? body_.getFormulas() : [];   // so formula columns you added yourself are not turned into plain values
    const changed = {};
    const index = {};
    data.forEach((r, i) => { const k = String(r[keyIdx]).trim(); if (k) index[k] = i; });

    let updated = 0;
    const appended = [];
    body.rows.forEach(obj => {
      const o = {};
      Object.keys(obj).forEach(k => { o[norm(k)] = obj[k]; });
      const k = String(o[norm(body.key)]).trim();
      if (k in index) {
        const row = data[index[k]];
        headers.forEach((h, c) => { if (h in o && o[h] !== null && o[h] !== undefined) { row[c] = safe(o[h]); changed[index[k] + ':' + c] = true; } });
        updated++;
      } else {
        appended.push(headers.map(h => (h in o && o[h] !== null && o[h] !== undefined) ? safe(o[h]) : ''));
      }
    });

    if (updated) sheet.getRange(2, 1, data.length, lastCol).setValues(data.map((row, i) => row.map((v, c) => (!changed[i + ':' + c] && formulas[i][c]) ? formulas[i][c] : v)));
    if (appended.length) sheet.getRange(sheet.getLastRow() + 1, 1, appended.length, lastCol).setValues(appended);
    SpreadsheetApp.flush();
    return out({ ok: true, appended: appended.length, updated: updated });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}
