const SECRET_TOKEN = 'PASTE_YOUR_TOKEN_HERE';

const ITEMS_SHEET = 'Items';
const CHECKINS_SHEET = 'Checkins';
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function doGet(e) {
  if (!isAuthorized(e)) return json({ ok: false, error: 'Unauthorized' });

  const action = e.parameter.action;
  if (action === 'bootstrap') return bootstrap();
  if (action === 'items') return getItems();
  if (action === 'checkins') return getCheckins();

  return json({ ok: false, error: 'Unknown action' });
}

function doPost(e) {
  if (!isAuthorized(e)) return json({ ok: false, error: 'Unauthorized' });

  const body = JSON.parse(e.postData.contents || '{}');
  if (body.action === 'saveCheckin') return saveCheckin(body);

  return json({ ok: false, error: 'Unknown action' });
}

function bootstrap() {
  const itemsData = readItemsData_();
  ensureCurrentCheckinsBlock_(itemsData);
  return json({
    ok: true,
    items: itemsData.items,
    checkins: readLatestCheckins_(),
  });
}

function getItems() {
  return json({ ok: true, items: readItemsData_().items });
}

function getCheckins() {
  const itemsData = readItemsData_();
  ensureCurrentCheckinsBlock_(itemsData);
  return json({ ok: true, checkins: readLatestCheckins_() });
}

function saveCheckin(body) {
  const itemsData = readItemsData_();
  ensureCurrentCheckinsBlock_(itemsData);

  const sheet = SpreadsheetApp.getActive().getSheetByName(CHECKINS_SHEET);
  if (!sheet) return json({ ok: false, error: 'Checkins sheet not found' });

  const values = sheet.getDataRange().getValues();
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

function ensureCurrentCheckinsBlock_(itemsData) {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(CHECKINS_SHEET);
  if (!sheet) sheet = ss.insertSheet(CHECKINS_SHEET);

  const existingValues = sheet.getDataRange().getValues();
  const headerRowIndex = findHeaderRow_(existingValues);
  const latestVersion = getLatestVersion_(existingValues, headerRowIndex);

  if (headerRowIndex !== -1 && latestVersion === itemsData.version) return;

  const previous = headerRowIndex === -1 ? {} : parseCheckinsBlock_(existingValues, headerRowIndex);
  const block = buildCheckinsBlock_(itemsData, previous);

  if (sheet.getLastRow() > 0) {
    sheet.insertRowsBefore(1, block.length + 1);
  }

  sheet.getRange(1, 1, block.length, 8).setValues(block);
  formatLatestBlock_(sheet, block.length);
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
    const itemName = String(values[r][0] || '').trim();
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

function readLatestCheckins_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(CHECKINS_SHEET);
  if (!sheet) return {};

  const values = sheet.getDataRange().getDisplayValues();
  const headerRowIndex = findHeaderRow_(values);
  if (headerRowIndex === -1) return {};

  return parseCheckinsBlock_(values, headerRowIndex);
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

function parseCheckinsBlock_(values, headerRowIndex) {
  const header = values[headerRowIndex].map(String);
  const dayColumns = getDayColumns_(header);
  const checkins = {};

  for (let r = headerRowIndex + 1; r < values.length; r += 2) {
    const first = String(values[r][0] || '').trim();
    if (!first) break;
    if (first === 'WEEK' || first === 'Item') break;
    if (first.toLowerCase() === 'update time') continue;

    const itemId = makeId_(first);
    checkins[itemId] = {};

    DAYS.forEach(day => {
      const col = dayColumns[day];
      if (col == null) return;
      const checkedValue = String(values[r][col] || '').trim().toUpperCase();
      const updatedAt = values[r + 1] ? String(values[r + 1][col] || '').trim() : '';
      checkins[itemId][day] = {
        checked: checkedValue === 'Y',
        updatedAt,
      };
    });
  }

  return checkins;
}

function formatLatestBlock_(sheet, rowCount) {
  sheet.getRange(1, 1, rowCount, 8).setBorder(true, true, true, true, true, true);
  sheet.getRange(1, 1, 1, 8).setFontWeight('bold').setBackground('#EAF4F1');
  sheet.getRange(2, 1, 1, 8).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#24766B');
  sheet.getRange(3, 1, rowCount - 2, 8).setWrap(true);
  sheet.autoResizeColumns(1, 8);
}

function getLatestVersion_(values, headerRowIndex) {
  if (headerRowIndex <= 0) return '';
  const meta = values[headerRowIndex - 1] || [];
  for (let i = 0; i < meta.length; i++) {
    if (String(meta[i] || '').trim() === 'ITEMS VERSION') {
      return String(meta[i + 1] || '').trim();
    }
  }
  return '';
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
