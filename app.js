const API_URL = 'https://script.google.com/macros/s/AKfycbzXpTB8SIGhSercSETJVZH_mXGIIP7EKMsXsJVHdygqZw9lO7G0wKzkE4O-ieiJwl6p/exec';
const TOKEN_STORAGE_KEY = 'sophia_tracker_access_token';
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

let items = [];
let checkins = {};
const pendingSaves = new Map();

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

async function getJson(action) {
    const response = await fetch(buildUrl(action));
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || `Unable to load ${action}`);
    return data;
}

async function loadBootstrap() {
    try {
        return await getJson('bootstrap');
    } catch (error) {
        const [itemsResponse, checkinsResponse] = await Promise.all([
            getJson('items'),
            getJson('checkins'),
        ]);
        return {
            ok: true,
            items: itemsResponse.items || [],
            checkins: checkinsResponse.checkins || {},
        };
    }
}

async function saveToSheet(item, day, checked) {
    const url = new URL(API_URL);
    url.searchParams.set('token', getApiToken());

    const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
            action: 'saveCheckin',
            itemLabel: item.label,
            day,
            checked,
        }),
    });

    if (!response.ok) throw new Error(`Save failed: ${response.status}`);
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || 'Save failed');
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
        renderEmpty('No tracker items found in the Items sheet.');
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

async function handleToggle(button, item, day) {
    clearError();
    const checked = !button.classList.contains('checked');
    const previous = itemIsChecked(item.id, day);
    const previousUpdatedAt = checkins[item.id]?.[day]?.updatedAt || '';
    const saveKey = `${item.id}|${day}`;
    const saveVersion = (pendingSaves.get(saveKey) || 0) + 1;
    pendingSaves.set(saveKey, saveVersion);

    button.classList.toggle('checked', checked);

    checkins[item.id] = checkins[item.id] || {};
    checkins[item.id][day] = checkins[item.id][day] || {};
    checkins[item.id][day].checked = checked;
    checkins[item.id][day].updatedAt = checked ? formatDisplayDateTime(new Date()) : '';
    updateSummary();

    try {
        await saveToSheet(item, day, checked);
        if (pendingSaves.get(saveKey) === saveVersion) {
            pendingSaves.delete(saveKey);
        }
    } catch (error) {
        if (pendingSaves.get(saveKey) !== saveVersion) return;
        pendingSaves.delete(saveKey);

        checkins[item.id][day].checked = previous;
        checkins[item.id][day].updatedAt = previousUpdatedAt;
        button.classList.toggle('checked', previous);
        updateSummary();
        showError('\u65e0\u7f51\u7edc\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5');
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

async function loadFromSheet() {
    clearError();
    if (!getApiToken()) {
        showAccessGate();
        setSaveStatus('Access needed', 'error');
        return false;
    }

    hideAccessGate();
    setSaveStatus('Loading Sheet...', 'saving');
    const data = await loadBootstrap();

    items = data.items || [];
    checkins = data.checkins || {};
    setSaveStatus('Connected to Sheet', 'saved');
    return true;
}

async function render() {
    const weekDates = getWeekDates();
    document.getElementById('weekRange').textContent =
        `${formatShortDate(weekDates[0].date)} - ${formatShortDate(weekDates[6].date)}`;
    renderHeader(weekDates);
    renderEmpty('Loading from Google Sheet...');

    try {
        const loaded = await loadFromSheet();
        if (!loaded) return;
        renderBody(weekDates);
        updateSummary();
    } catch (error) {
        if (String(error.message).toLowerCase().includes('unauthorized')) {
            resetApiToken();
            showAccessGate();
        }
        setSaveStatus('Sheet error', 'error');
        showError(error.message);
        renderEmpty('Could not load Google Sheet data.');
    }
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
        render();
    });
}

document.addEventListener('DOMContentLoaded', () => {
    setupAccessForm();
    render();
});
