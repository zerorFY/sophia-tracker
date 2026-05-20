const SECRET_TOKEN = 'PASTE_YOUR_TOKEN_HERE';

const ITEMS_SHEET = 'Items';
const CHECKINS_SHEET = 'Checkins';
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TOP_BLOCK_MAX_ROWS = 10;

function doGet(e) {
  if (!isAuthorized(e)) return json({ ok: false, error: 'Unauthorized' });

  const action = e.parameter.action;
  if (action === 'bootstrap') return bootstrap();
  if (action === 'items') return getItems();
  if (action === 'checkins') return getCheckins();
  if (action === 'syncStructure') return syncStructure();

  return json({ ok: false, error: 'Unknown action' });
}

function doPost(e) {
  if (!isAuthorized(e)) return json({ ok: false, error: 'Unauthorized' });

  const body = JSON.parse(e.postData.contents || '{}');
  if (body.action === 'saveCheckin') return saveCheckin(body);
  if (body.action === 'saveSnapshot') return saveSnapshot(body);
  if (body.action === 'syncStructure') return syncStructure();

  return json({ ok: false, error: 'Unknown action' });
}

function bootstrap() {
  return json(readTopCheckinsSnapshot_());
}

function getCheckins() {
  return json({ ok: true, checkins: readTopCheckinsSnapshot_().checkins });
}

function getItems() {
  return json({ ok: true, items: readTopCheckinsSnapshot_().items });
}

function saveCheckin(body) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(CHECKINS_SHEET);
  if (!sheet) return json({ ok: false, error: 'Checkins sheet not found' });

  const values = readTopBlockValues_(sheet);
  const headerRowIndex = findHeaderRow_(values);
  if (headerRowIndex === -1) return json({ ok: false, error: 'Checkins header row not found' });

  const itemLabel = String(body.itemLabel || '').trim();
  const day = String(body.day || '').trim();
  const checked = Boolean(body.checked);
  if (!itemLabel || DAYS.indexOf(day) === -1) return json({ ok: false, error: 'Invalid itemLabel or day' });

  const header = values[headerRowIndex].map(String);
  const dayColumns = getDayColumns_(header);
  const dayCol = dayColumns[day];
  const itemRowIndex = findItemRow_(values, headerRowIndex + 1, itemLabel);
  if (dayCol == null) return json({ ok: false, error: 'Day column not found' });
  if (itemRowIndex === -1) return json({ ok: false, error: 'Item row not found' });

  sheet.getRange(itemRowIndex + 1, dayCol + 1).setValue(checked ? 'Y' : '');
  sheet.getRange(itemRowIndex + 2, dayCol + 1).setValue(
    checked ? Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy/M/d HH:mm') : ''
  );

  return json({ ok: true });
}

function saveSnapshot(body) {
  const items = Array.isArray(body.items) ? body.items : [];
  const checkins = body.checkins || {};
  if (!items.length) return json({ ok: false, error: 'No items to save' });

  const sheet = getOrCreateSheet_(CHECKINS_SHEET);
  const values = readTopBlockValues_(sheet);
  const headerRowIndex = findHeaderRow_(values);
  if (headerRowIndex === -1) return json({ ok: false, error: 'Checkins header row not found' });

  const header = values[headerRowIndex].map(String);
  const dayColumns = getDayColumns_(header);

  items.forEach(item => {
    const itemRowIndex = findItemRow_(values, headerRowIndex + 1, item.label);
    if (itemRowIndex === -1) return;

    DAYS.forEach(day => {
      const col = dayColumns[day];
      if (col == null || !item.days || !item.days[day]) return;

      const cell = checkins[item.id] && checkins[item.id][day] ? checkins[item.id][day] : {};
      sheet.getRange(itemRowIndex + 1, col + 1).setValue(cell.checked ? 'Y' : '');
      sheet.getRange(itemRowIndex + 2, col + 1).setValue(cell.checked ? (cell.updatedAt || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy/M/d HH:mm')) : '');
    });
  });

  return json({ ok: true });
}

function syncStructure() {
  const itemsData = readItemsData_();
  const sheet = getOrCreateSheet_(CHECKINS_SHEET);
  const previous = readTopCheckinsSnapshot_().checkins || {};
  const block = buildCheckinsBlock_(itemsData, previous);

  if (sheet.getLastRow() > 0) {
    sheet.insertRowsBefore(1, block.length + 1);
  }

  sheet.getRange(1, 1, block.length, 8).setValues(block);
  formatLatestBlock_(sheet, block.length);

  return json(readTopCheckinsSnapshot_());
}

function readTopCheckinsSnapshot_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(CHECKINS_SHEET);
  if (!sheet) return { ok: true, items: [], checkins: {} };

  const values = readTopBlockDisplayValues_(sheet);
  const headerRowIndex = findHeaderRow_(values);
  if (headerRowIndex === -1) return { ok: true, items: [], checkins: {} };

  const header = values[headerRowIndex].map(String);
  const dayColumns = getDayColumns_(header);
  const items = [];
  const checkins = {};

  for (let r = headerRowIndex + 1; r < values.length; r += 2) {
    const itemLabel = normalizeLabel_(values[r][0]);
    if (!itemLabel) break;
    if (itemLabel === 'WEEK' || itemLabel === 'Item') break;
    if (itemLabel.toLowerCase() === 'update time') continue;

    const itemId = makeId_(itemLabel);
    const itemDays = {};
    checkins[itemId] = {};

    DAYS.forEach(day => {
      const col = dayColumns[day];
      if (col == null) return;

      const value = String(values[r][col] || '').trim().toUpperCase();
      const updatedAt = values[r + 1] ? formatDisplayTime_(values[r + 1][col]) : '';
      const scheduled = value !== 'N/A';

      itemDays[day] = scheduled;
      checkins[itemId][day] = {
        checked: scheduled && value === 'Y',
        updatedAt: scheduled ? updatedAt : '',
      };
    });

    items.push({
      id: itemId,
      label: itemLabel,
      days: itemDays,
    });
  }

  return { ok: true, items, checkins };
}

function readTopBlockValues_(sheet) {
  const rowCount = Math.min(Math.max(sheet.getLastRow(), 1), TOP_BLOCK_MAX_ROWS);
  return sheet.getRange(1, 1, rowCount, 8).getValues();
}

function readTopBlockDisplayValues_(sheet) {
  const rowCount = Math.min(Math.max(sheet.getLastRow(), 1), TOP_BLOCK_MAX_ROWS);
  return sheet.getRange(1, 1, rowCount, 8).getDisplayValues();
}

function readItemsData_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(ITEMS_SHEET);
  if (!sheet) throw new Error('Items sheet not found');

  const values = sheet.getDataRange().getValues();
  if (!values.length) return { items: [], version: hash_('') };

  const header = values[0].map(String);
  const dayColumns = getDayColumns_(header);
  const rowsForVersion = [];
  const items = [];

  for (let r = 1; r < values.length; r++) {
    const itemName = normalizeLabel_(values[r][0]);
    if (!itemName) continue;

    const days = {};
    const versionParts = [itemName];

    DAYS.forEach(day => {
      const col = dayColumns[day];
      const value = col == null ? '' : String(values[r][col] || '').trim().toUpperCase();
      const scheduled = value === 'Y';
      days[day] = scheduled;
      versionParts.push(scheduled ? 'Y' : 'N/A');
    });

    rowsForVersion.push(versionParts.join('|'));
    items.push({
      id: makeId_(itemName),
      label: itemName,
      days,
    });
  }

  return {
    items,
    version: hash_(rowsForVersion.join('\n')),
  };
}

function buildCheckinsBlock_(itemsData, previous) {
  const now = new Date();
  const weekStart = formatWeekStart_(getMonday_(now));
  const createdAt = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy/M/d HH:mm');
  const rows = [
    ['WEEK', weekStart, '', 'ITEMS VERSION', itemsData.version, '', 'CREATED AT', createdAt],
    ['Item'].concat(DAYS),
  ];

  itemsData.items.forEach(item => {
    const itemRow = [item.label];
    const timeRow = ['update time'];
    const oldItem = previous[item.id] || {};

    DAYS.forEach(day => {
      if (!item.days[day]) {
        itemRow.push('N/A');
        timeRow.push('');
        return;
      }

      const oldCell = oldItem[day] || {};
      itemRow.push(oldCell.checked ? 'Y' : '');
      timeRow.push(oldCell.checked ? (oldCell.updatedAt || '') : '');
    });

    rows.push(itemRow);
    rows.push(timeRow);
  });

  return rows;
}

function formatLatestBlock_(sheet, rowCount) {
  sheet.getRange(1, 1, rowCount, 8).setBorder(true, true, true, true, true, true);
  sheet.getRange(1, 1, 1, 8).setFontWeight('bold').setBackground('#EAF4F1');
  sheet.getRange(2, 1, 1, 8).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#24766B');
  sheet.getRange(3, 1, Math.max(rowCount - 2, 1), 8).setWrap(true);
}

function getOrCreateSheet_(name) {
  const ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function getDayColumns_(header) {
  const result = {};
  DAYS.forEach(day => {
    const index = header.findIndex(value => String(value).trim().toLowerCase() === day.toLowerCase());
    if (index !== -1) result[day] = index;
  });
  return result;
}

function findHeaderRow_(values) {
  return values.findIndex(row => {
    const first = String(row[0] || '').trim().toLowerCase();
    const hasMonday = row.some(cell => String(cell || '').trim().toLowerCase() === 'monday');
    return first === 'item' && hasMonday;
  });
}

function findItemRow_(values, startIndex, itemLabel) {
  const wanted = normalizeItem_(itemLabel);
  for (let r = startIndex; r < values.length; r++) {
    const current = normalizeItem_(values[r][0]);
    if (current === wanted) return r;
  }
  return -1;
}

function getMonday_(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function formatWeekStart_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy/MM/dd');
}

function formatDisplayTime_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy/M/d HH:mm');
  }
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeLabel_(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function hash_(value) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, value);
  return bytes.map(byte => {
    const v = byte < 0 ? byte + 256 : byte;
    return (`0${v.toString(16)}`).slice(-2);
  }).join('');
}

function normalizeItem_(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function makeId_(value) {
  return normalizeItem_(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function isAuthorized(e) {
  return e && e.parameter && e.parameter.token === SECRET_TOKEN;
}

function json(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
