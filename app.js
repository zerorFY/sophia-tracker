const API_URL = 'https://script.google.com/macros/s/AKfycbzXpTB8SIGhSercSETJVZH_mXGIIP7EKMsXsJVHdygqZw9lO7G0wKzkE4O-ieiJwl6p/exec';
const TOKEN_STORAGE_KEY = 'sophia_tracker_access_token';
const CACHE_STORAGE_KEY = 'sophia_tracker_cache_v2';
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

let items = [];
let checkins = {};
let dirty = false;

function getMonday(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d;
}

function addDays(date, amount) {
    const d = new Date(date);
    d.setDate(d.getDate() + amount);
    return d;
}

function formatShortDate(date) {
    return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatFullDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatDisplayDateTime(date) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}/${month}/${day} ${hours}:${minutes}`;
}

function getWeekDates() {
    const monday = getMonday(new Date());
    return DAY_NAMES.map((day, index) => ({
        day,
        date: addDays(monday, index),
    }));
}

function isToday(date) {
    return formatFullDate(new Date()) === formatFullDate(date);
}

function buildUrl(action) {
    const url = new URL(API_URL);
    url.searchParams.set('action', action);
    url.searchParams.set('token', getApiToken() || '');
    return url.toString();
}

function getApiToken() {
    return localStorage.getItem(TOKEN_STORAGE_KEY) || '';
}

function setApiToken(token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token.trim());
}

function resetApiToken() {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
}

function loadLocalCache() {
    const raw = localStorage.getItem(CACHE_STORAGE_KEY);
    if (!raw) return false;

    try {
        const data = JSON.parse(raw);
        items = data.items || [];
        checkins = data.checkins || {};
        dirty = Boolean(data.dirty);
        return items.length > 0;
    } catch (error) {
        return false;
    }
}

function saveLocalCache() {
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify({
        items,
        checkins,
        dirty,
        savedAt: new Date().toISOString(),
    }));
}

async function getJson(action) {
    const response = await fetch(buildUrl(action));
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || `Unable to load ${action}`);
    return data;
}

async function postJson(action, payload, keepalive) {
    const url = new URL(API_URL);
    url.searchParams.set('token', getApiToken());

    const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, ...payload }),
        keepalive: Boolean(keepalive),
    });

    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || `${action} failed`);
    return data;
}

function itemIsScheduled(item, day) {
    return Boolean(item.days && item.days[day]);
}

function itemIsChecked(itemId, day) {
    return Boolean(checkins[itemId] && checkins[itemId][day] && checkins[itemId][day].checked);
}

function updateSummary() {
    let total = 0;
    let done = 0;

    items.forEach(item => {
        DAY_NAMES.forEach(day => {
            if (!itemIsScheduled(item, day)) return;
            total += 1;
            if (itemIsChecked(item.id, day)) done += 1;
        });
    });

    document.getElementById('doneCount').textContent = done;
    document.getElementById('totalCount').textContent = total;
    document.getElementById('progressPct').textContent = total ? `${Math.round((done / total) * 100)}%` : '0%';
}

function setSaveStatus(text, state) {
    const el = document.getElementById('saveStatus');
    el.textContent = text;
    el.className = `save-status ${state || ''}`.trim();
}

function updateDirtyStatus() {
    setSaveStatus(dirty ? 'Unsynced changes' : 'Local copy', dirty ? 'saving' : 'saved');
}

function renderHeader(weekDates) {
    const header = document.getElementById('dayHeader');
    header.innerHTML = '<th class="item-col">Item</th>';

    weekDates.forEach(({ day, date }) => {
        const th = document.createElement('th');
        if (isToday(date)) th.classList.add('today');
        th.innerHTML = `<span class="day-name">${day}</span><span class="day-date">${formatShortDate(date)}</span>`;
        header.appendChild(th);
    });
}

function renderEmpty(message) {
    const tbody = document.getElementById('trackerBody');
    tbody.innerHTML = `<tr><td class="empty-row" colspan="8">${message}</td></tr>`;
}

function renderBody(weekDates) {
    const tbody = document.getElementById('trackerBody');
    tbody.innerHTML = '';

    if (!items.length) {
        renderEmpty('No local tracker data. Tap 同步items first.');
        return;
    }

    items.forEach(item => {
        const row = document.createElement('tr');
        const itemCell = document.createElement('td');
        itemCell.className = 'item-cell';
        itemCell.innerHTML = `<span class="item-name">${item.label}</span>`;
        row.appendChild(itemCell);

        weekDates.forEach(({ day, date }) => {
            const cell = document.createElement('td');
            cell.className = 'check-cell';
            if (isToday(date)) cell.classList.add('today');

            if (!itemIsScheduled(item, day)) {
                cell.classList.add('disabled');
                cell.innerHTML = '<span class="not-scheduled">N/A</span>';
            } else {
                const button = document.createElement('button');
                const checked = itemIsChecked(item.id, day);
                button.type = 'button';
                button.className = `check-button ${checked ? 'checked' : ''}`;
                button.setAttribute('aria-label', `${item.label} on ${day}`);
                button.textContent = 'Y';
                button.addEventListener('click', () => handleToggle(button, item, day));
                cell.appendChild(button);
            }

            row.appendChild(cell);
        });

        tbody.appendChild(row);
    });
}

function handleToggle(button, item, day) {
    clearError();
    const checked = !button.classList.contains('checked');
    button.classList.toggle('checked', checked);

    checkins[item.id] = checkins[item.id] || {};
    checkins[item.id][day] = checkins[item.id][day] || {};
    checkins[item.id][day].checked = checked;
    checkins[item.id][day].updatedAt = checked ? formatDisplayDateTime(new Date()) : '';
    dirty = true;
    saveLocalCache();
    updateSummary();
    updateDirtyStatus();
}

async function syncItemsFromSheet() {
    clearError();
    if (!getApiToken()) {
        showAccessGate();
        return;
    }

    if (dirty && !window.confirm('本地有未同步的打卡记录，继续同步items会用Sheet覆盖本地内容。确定继续吗？')) {
        return;
    }

    try {
        setSaveStatus('Syncing items...', 'saving');
        const data = await getJson('bootstrap');
        items = data.items || [];
        checkins = data.checkins || {};
        dirty = false;
        saveLocalCache();
        hideAccessGate();
        renderBody(getWeekDates());
        updateSummary();
        updateDirtyStatus();
    } catch (error) {
        setSaveStatus('Sync failed', 'error');
        showError(error.message);
    }
}

async function syncCheckinsToSheet(options = {}) {
    clearError();
    if (!getApiToken()) {
        showAccessGate();
        return false;
    }

    if (!items.length) return false;
    if (!dirty && !options.force) return true;

    try {
        setSaveStatus('Uploading...', 'saving');
        await postJson('saveSnapshot', { items, checkins }, options.keepalive);
        dirty = false;
        saveLocalCache();
        updateDirtyStatus();
        return true;
    } catch (error) {
        dirty = true;
        saveLocalCache();
        setSaveStatus('Upload pending', 'error');
        if (!options.silent) showError('\u4e0a\u4f20\u5931\u8d25\uff0c\u4e0b\u6b21\u6253\u5f00\u4ecd\u4f1a\u4fdd\u7559\u672c\u5730\u4fee\u6539');
        return false;
    }
}

function showError(message) {
    const el = document.getElementById('errorMessage');
    el.textContent = message;
    el.hidden = false;
}

function clearError() {
    const el = document.getElementById('errorMessage');
    el.textContent = '';
    el.hidden = true;
}

function render() {
    const weekDates = getWeekDates();
    document.getElementById('weekRange').textContent =
        `${formatShortDate(weekDates[0].date)} - ${formatShortDate(weekDates[6].date)}`;
    renderHeader(weekDates);

    if (loadLocalCache()) {
        renderBody(weekDates);
        updateSummary();
        updateDirtyStatus();
        return;
    }

    renderEmpty('No local tracker data. Tap 同步items first.');
    setSaveStatus('Local empty', 'error');
    if (!getApiToken()) showAccessGate();
}

function showAccessGate() {
    document.getElementById('accessGate').hidden = false;
}

function hideAccessGate() {
    document.getElementById('accessGate').hidden = true;
}

function setupAccessForm() {
    document.getElementById('accessForm').addEventListener('submit', event => {
        event.preventDefault();
        const token = document.getElementById('accessToken').value;
        if (!token.trim()) return;
        setApiToken(token);
        hideAccessGate();
        syncItemsFromSheet();
    });
}

function setupSyncButtons() {
    document.getElementById('syncItemsBtn').addEventListener('click', syncItemsFromSheet);
    document.getElementById('syncCheckinsBtn').addEventListener('click', () => syncCheckinsToSheet({ force: true }));
}

function setupCloseSync() {
    const flush = () => {
        if (!dirty || !getApiToken() || !items.length) return;
        syncCheckinsToSheet({ keepalive: true, silent: true });
    };

    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
    });
}

document.addEventListener('DOMContentLoaded', () => {
    setupAccessForm();
    setupSyncButtons();
    setupCloseSync();
    render();
});
