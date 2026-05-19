const API_URL = 'https://script.google.com/macros/s/AKfycbzXpTB8SIGhSercSETJVZH_mXGIIP7EKMsXsJVHdygqZw9lO7G0wKzkE4O-ieiJwl6p/exec';
const TOKEN_STORAGE_KEY = 'sophia_tracker_access_token';
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

let items = [];
let checkins = {};

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

                const updatedAt = checkins[item.id]?.[day]?.updatedAt;
                if (updatedAt) {
                    const time = document.createElement('span');
                    time.className = 'update-time';
                    time.textContent = updatedAt;
                    cell.appendChild(time);
                }
            }

            row.appendChild(cell);
        });

        tbody.appendChild(row);
    });
}

async function handleToggle(button, item, day) {
    const checked = !button.classList.contains('checked');
    button.classList.toggle('checked', checked);
    button.disabled = true;

    checkins[item.id] = checkins[item.id] || {};
    checkins[item.id][day] = checkins[item.id][day] || {};
    checkins[item.id][day].checked = checked;
    updateSummary();
    setSaveStatus('Saving...', 'saving');

    try {
        await saveToSheet(item, day, checked);
        const fresh = await getJson('checkins');
        checkins = fresh.checkins || {};
        setSaveStatus('Saved to Sheet', 'saved');
        renderBody(getWeekDates());
        updateSummary();
    } catch (error) {
        checkins[item.id][day].checked = !checked;
        button.classList.toggle('checked', !checked);
        updateSummary();
        setSaveStatus('Save failed', 'error');
        showError(error.message);
    } finally {
        button.disabled = false;
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
    const [itemsResponse, checkinsResponse] = await Promise.all([
        getJson('items'),
        getJson('checkins'),
    ]);

    items = itemsResponse.items || [];
    checkins = checkinsResponse.checkins || {};
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
