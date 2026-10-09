import {
  parseIcs,
  projectDay,
  makeDemoEvents,
  formatMinutes,
} from './calendar-core.js';

const $ = (id) => document.getElementById(id);
const root = document.body;
const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const pct = (minute) => `${clamp((minute / 1440) * 100, 0, 100)}%`;
const escXml = (value = '') => String(value).replace(/[<>&'\"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[char]));
const sourceLabel = (source = 'ics') => ({ demo: 'пример / событие', manual: 'вручную / событие', ics: 'ICS / событие' }[source] || 'событие');

const state = {
  dayKey: todayKey(),
  timeZone: 'local',
  mode: 'calm',
  rawEvents: [],
  completed: {},
  selectedEventId: null,
  errors: [],
  projection: null,
  now: new Date(),
  editingEventId: null,
  undoSnapshot: null,
  focusEventId: null,
};

let toastTimer;
let lastFocus;

function storageKey(dayKey = state.dayKey) { return `dayflow:${dayKey}`; }
const sourceStorageKey = 'dayflow:source';
const settingsStorageKey = 'dayflow:settings';
function resolvedZone() { return state.timeZone === 'local' ? localZone : state.timeZone; }
function isDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const [y, m, d] = String(value).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
function isDescriptor(value) {
  if (typeof value === 'string') return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value);
  if (!value || typeof value !== 'object') return false;
  if (value.allDay) return isDateKey(value.dateKey);
  return isDateKey(value.dateKey) && Number.isInteger(Number(value.hour)) && Number(value.hour) >= 0 && Number(value.hour) <= 23 && Number.isInteger(Number(value.minute)) && Number(value.minute) >= 0 && Number(value.minute) <= 59;
}
function validRawEvent(event) {
  return Boolean(event && typeof event === 'object' && typeof event.id === 'string' && event.id.trim() && event.id.length <= 512 && typeof event.title === 'string' && event.title.length <= 500 && isDescriptor(event.start) && isDescriptor(event.end));
}
function validTimeZone(zone) {
  if (zone === 'local' || zone === 'UTC') return true;
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(); return true; } catch { return false; }
}
function pushStateError(text, isError = true) {
  if (!text) return;
  state.errors = [{ text: String(text), isError }, ...state.errors.filter((item) => item.text !== String(text))].slice(0, 8);
}
function readJson(key, fallback, label = key) {
  let stored;
  try { stored = localStorage.getItem(key); }
  catch { pushStateError(`не удалось прочитать ${label}: хранилище браузера недоступно.`, true); return fallback; }
  if (stored === null) return fallback;
  try { return JSON.parse(stored); }
  catch { pushStateError(`не удалось прочитать ${label}: запись повреждена.`, true); return fallback; }
}
function validCompletionMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, completed]) => key.length <= 512 && typeof completed === 'boolean'));
}
function restoreEvents(raw, source = 'хранилища') {
  if (!Array.isArray(raw)) return [];
  return raw.filter((event) => {
    if (validRawEvent(event)) return true;
    pushStateError(`событие из ${source} пропущено: повреждённая запись.`, true);
    return false;
  });
}
function readStore(dayKey = state.dayKey) {
  const saved = readJson(storageKey(dayKey), null, 'сохранённый день');
  const source = readJson(sourceStorageKey, [], 'источник событий');
  const settings = readJson(settingsStorageKey, null, 'настройки');
  const candidate = saved && typeof saved === 'object' && Array.isArray(saved.rawEvents) ? saved.rawEvents : source;
  state.rawEvents = restoreEvents(candidate, saved ? 'хранилища' : 'источника');
  state.completed = validCompletionMap(saved?.completed);
  const zone = settings?.timeZone || saved?.timeZone;
  if (validTimeZone(zone)) state.timeZone = zone;
  if (settings?.mode === 'arcade' || saved?.mode === 'arcade') state.mode = 'arcade';
  else if (settings?.mode === 'calm' || saved?.mode === 'calm') state.mode = 'calm';
}
function saveSource(events) {
  try { localStorage.setItem(sourceStorageKey, JSON.stringify(events)); } catch { /* private mode can still use the live session */ }
}
function saveStore() {
  try {
    localStorage.setItem(storageKey(), JSON.stringify({ rawEvents: state.rawEvents, completed: state.completed, mode: state.mode, timeZone: state.timeZone }));
    localStorage.setItem(settingsStorageKey, JSON.stringify({ mode: state.mode, timeZone: state.timeZone }));
  } catch {
    showMessage('состояние не сохранилось: хранилище браузера недоступно.', true);
  }
}
function dayDate() {
  const [year, month, day] = state.dayKey.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}
function formatDay() {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }).format(dayDate()).replace('.', '');
}
function formatWeekday() {
  return new Intl.DateTimeFormat('ru-RU', { weekday: 'long' }).format(dayDate());
}
function minuteNow() {
  const now = state.now;
  const dayParts = new Intl.DateTimeFormat('en', { timeZone: resolvedZone(), year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const dayMap = Object.fromEntries(dayParts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const currentDay = `${dayMap.year}-${dayMap.month}-${dayMap.day}`;
  if (state.dayKey !== currentDay) return null;
  if (state.timeZone === 'UTC') return now.getUTCHours() * 60 + now.getUTCMinutes();
  if (state.timeZone === 'local') return now.getHours() * 60 + now.getMinutes();
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: resolvedZone(), hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(now);
    const h = Number(parts.find((part) => part.type === 'hour')?.value || 0);
    const m = Number(parts.find((part) => part.type === 'minute')?.value || 0);
    return h * 60 + m;
  } catch { return now.getHours() * 60 + now.getMinutes(); }
}
function timeNow() {
  const options = { hour: '2-digit', minute: '2-digit', hour12: false };
  if (state.timeZone !== 'local') options.timeZone = resolvedZone();
  return new Intl.DateTimeFormat('ru-RU', options).format(state.now);
}
function durationText(minutes = 0) {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
  }
  return `${minutes} мин`;
}
function metricDuration(minutes = 0) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourPart = `${String(hours).padStart(2, '0')}<span class=\"metric-unit\">ч</span>`;
  return rest ? `${hourPart} ${String(rest).padStart(2, '0')}<span class=\"metric-unit\">м</span>` : hourPart;
}
function showToast(text, isError = false) {
  const toast = $('toast');
  toast.replaceChildren();
  const label = document.createElement('span'); label.textContent = text; toast.appendChild(label);
  toast.classList.toggle('is-error', isError);
  toast.classList.add('is-visible');
  toast.style.pointerEvents = 'none';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3200);
}
function showMessage(text, isError = false) {
  state.errors = [{ text, isError }, ...state.errors.filter((item) => item.text !== text)].slice(0, 4);
  renderMessages();
}
function clearMessages() { state.errors = []; renderMessages(); }
function renderMessages() {
  $('message-stack').replaceChildren(...state.errors.map((item) => {
    const row = document.createElement('div');
    row.className = `message${item.isError ? ' is-error' : ''}`;
    row.textContent = item.text;
    return row;
  }));
}
function announce(text) { $('board-status').textContent = text; $('toast').setAttribute('aria-label', text); }
function announceAction(text, isError = false, undo = false) {
  announce(text);
  showToast(text, isError);
  if (undo && state.undoSnapshot) {
    const toast = $('toast');
    const button = document.createElement('button');
    button.type = 'button'; button.id = 'undo-action'; button.className = 'button button-paper'; button.textContent = 'отменить';
    button.addEventListener('click', restoreUndo);
    toast.appendChild(button); toast.style.pointerEvents = 'auto';
  }
}
function takeUndo(label) {
  state.undoSnapshot = { label, rawEvents: state.rawEvents.map((event) => ({ ...event })), completed: { ...state.completed }, selectedEventId: state.selectedEventId, dayKey: state.dayKey, timeZone: state.timeZone, mode: state.mode };
}
function restoreUndo() {
  const snapshot = state.undoSnapshot;
  if (!snapshot) return;
  state.rawEvents = snapshot.rawEvents;
  state.completed = snapshot.completed;
  state.selectedEventId = snapshot.selectedEventId;
  state.dayKey = snapshot.dayKey;
  state.timeZone = snapshot.timeZone;
  state.mode = snapshot.mode;
  state.undoSnapshot = null;
  saveSource(state.rawEvents);
  saveStore(); render(); announceAction('последнее действие отменено.');
}

function withCompletion(projection) {
  if (!projection) return projection;
  const mark = (event) => ({ ...event, completed: state.completed[event.id] ?? Boolean(event.completed) });
  return { ...projection, events: projection.events.map(mark), timedEvents: projection.timedEvents.map(mark), allDayEvents: projection.allDayEvents.map(mark) };
}
function refreshProjection() {
  try {
    state.projection = withCompletion(projectDay(state.rawEvents, state.dayKey, resolvedZone()));
    if (state.projection.errors?.length) {
      state.projection.errors.forEach((text) => pushStateError(text, true));
    }
  } catch (error) {
    state.projection = { events: [], timedEvents: [], allDayEvents: [], freeWindows: [{ startMinute: 0, endMinute: 1440, duration: 1440 }], occupiedMinutes: 0, freeMinutes: 1440, laneCount: 1 };
    showMessage(`не удалось построить трассу: ${error.message}`, true);
  }
}

function renderHeader() {
  $('day-picker').value = state.dayKey;
  $('timezone-picker').value = state.timeZone;
  $('readout-weekday').textContent = formatWeekday();
  $('readout-date').textContent = formatDay();
  $('readout-now').textContent = timeNow();
  root.dataset.mode = state.mode;
  document.querySelectorAll('[data-mode-choice]').forEach((button) => {
    const active = button.dataset.modeChoice === state.mode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}
function renderMetrics() {
  const events = state.projection?.events || [];
  const complete = events.filter((event) => event.completed).length;
  const busy = state.projection?.occupiedMinutes || 0;
  const free = state.projection?.freeMinutes ?? 1440;
  $('metric-events').textContent = String(events.length).padStart(2, '0');
  $('metric-done').textContent = String(complete).padStart(2, '0');
  $('metric-busy').innerHTML = metricDuration(busy);
  $('metric-free').innerHTML = metricDuration(free);
  const lanes = state.projection?.laneCount || 1;
  $('route-note').textContent = `${lanes} ${laneWord(lanes)} / 24 часа`;
}
function laneWord(count) {
  const n = Math.abs(Number(count)) % 100;
  if (n >= 11 && n <= 14) return 'рядов';
  const one = n % 10;
  return one === 1 ? 'ряд' : one >= 2 && one <= 4 ? 'ряда' : 'рядов';
}
function renderAxis() {
  const axis = $('route-axis');
  const children = [];
  for (let hour = 0; hour <= 24; hour += 1) {
    if (hour % 2 === 0 || hour === 24) {
      const label = document.createElement('span');
      label.className = 'axis-label';
      label.style.left = `${(hour / 24) * 100}%`;
      label.textContent = hour === 24 ? '24:00' : `${String(hour).padStart(2, '0')}:00`;
      children.push(label);
    }
    if (hour < 24) {
      const line = document.createElement('i');
      line.className = 'axis-line';
      line.style.left = `${(hour / 24) * 100}%`;
      line.setAttribute('aria-hidden', 'true');
      children.push(line);
    }
  }
  axis.replaceChildren(...children);
}
function createStation(event, index) {
  const station = document.createElement('button');
  station.type = 'button';
  station.className = `station${event.completed ? ' is-complete' : ''}${event.overlap ? ' is-overlap' : ''}${state.selectedEventId === event.id ? ' is-selected' : ''}`;
  station.dataset.eventId = event.id;
  station.style.left = pct(event.startMinute);
  if (event.duration < 30) station.classList.add('is-compact');
  station.style.width = `${Math.max((event.duration / 1440) * 100, 2.2)}%`;
  station.style.setProperty('--station-min-width', event.duration < 30 ? '46px' : '62px');
  station.setAttribute('aria-pressed', String(state.selectedEventId === event.id));
  station.setAttribute('aria-label', `${event.title}, ${formatMinutes(event.startMinute)}–${formatMinutes(event.endMinute)}`);
  const token = document.createElement('span');
  token.className = 'station-token';
  token.textContent = event.completed ? '✓' : String(index + 1).padStart(2, '0');
  const copy = document.createElement('span');
  copy.className = 'station-copy';
  const title = document.createElement('span');
  title.className = 'station-title';
  title.textContent = event.title || 'без названия';
  const time = document.createElement('span');
  time.className = 'station-time';
  time.textContent = `${formatMinutes(event.startMinute)} — ${formatMinutes(event.endMinute)} · ${durationText(event.duration)}`;
  copy.append(title, time);
  station.append(token, copy);
  station.addEventListener('click', () => { state.selectedEventId = event.id; state.focusEventId = event.id; render(); announceAction(`выбрано событие: ${event.title || 'без названия'}.`); });
  return station;
}
function renderRoute() {
  const projection = state.projection || { events: [], timedEvents: [], allDayEvents: [], freeWindows: [], laneCount: 1 };
  renderAxis();
  const gridLines = [];
  for (let hour = 1; hour < 24; hour += 1) {
    const line = document.createElement('i');
    line.className = 'route-grid-line';
    line.style.left = `${(hour / 24) * 100}%`;
    gridLines.push(line);
  }
  $('route-grid-lines').replaceChildren(...gridLines);
  const allDayRow = $('all-day-row');
  const allDayBlocks = [Object.assign(document.createElement('span'), { className: 'all-day-label', textContent: 'весь день' })];
  allDayRow.style.minHeight = `${Math.max(31, Math.ceil(projection.allDayEvents.length / 2) * 31)}px`;
  projection.allDayEvents.forEach((event, index) => {
    const block = document.createElement('button');
    block.type = 'button';
    block.className = `all-day-block${event.completed ? ' is-complete' : ''}${state.selectedEventId === event.id ? ' is-selected' : ''}`;
    block.style.left = `${8 + (index % 2) * 50}%`;
    block.style.top = `${4 + Math.floor(index / 2) * 31}px`;
    block.style.width = 'calc(50% - 12px)';
    block.textContent = `${event.completed ? '✓ ' : ''}${event.title}`;
    block.title = `${event.title} · ${durationText(event.duration)}`;
    block.setAttribute('aria-pressed', String(state.selectedEventId === event.id));
    block.setAttribute('aria-label', `${event.title || 'без названия'}, весь день${event.completed ? ', выполнено' : ''}`);
    block.addEventListener('click', () => { state.selectedEventId = event.id; state.focusEventId = event.id; render(); announceAction(`выбрано событие: ${event.title || 'без названия'}.`); });
    allDayBlocks.push(block);
  });
  allDayRow.replaceChildren(...allDayBlocks);
  const freeRow = $('free-row');
  const freeChildren = [Object.assign(document.createElement('span'), { className: 'free-label', textContent: 'свободно' })];
  projection.freeWindows.forEach((window) => {
    if (window.duration < 25) return;
    const item = document.createElement('div');
    item.className = 'free-window';
    item.style.left = pct(window.startMinute);
    item.style.width = `${Math.max((window.duration / 1440) * 100, .8)}%`;
    item.textContent = window.startMinute === 0 && window.endMinute === 1440 ? '' : durationText(window.duration);
    item.title = `${formatMinutes(window.startMinute)} — ${formatMinutes(window.endMinute)} · ${durationText(window.duration)}`;
    freeChildren.push(item);
  });
  freeRow.replaceChildren(...freeChildren);
  const lanes = Array.from({ length: Math.max(projection.laneCount || 1, 1) }, () => {
    const lane = document.createElement('div');
    lane.className = 'lane';
    return lane;
  });
  projection.timedEvents.forEach((event, index) => lanes[event.lane || 0]?.appendChild(createStation(event, index)));
  const eventLaneContainer = $('event-lanes');
  if (!projection.events.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-route';
    const title = document.createElement('strong'); title.textContent = 'день пока пуст';
    const copy = document.createElement('span'); copy.textContent = 'добавьте запись или выберите ICS-файл.';
    empty.append(title, copy);
    eventLaneContainer.replaceChildren(empty);
  } else {
    eventLaneContainer.replaceChildren(...lanes);
  }
  const minute = minuteNow();
  const nowLine = $('now-line');
  if (minute === null) nowLine.hidden = true;
  else { nowLine.hidden = false; nowLine.style.left = pct(minute); }
  const timedCount = projection.timedEvents.length;
  const allDayCount = projection.allDayEvents.length;
  $('route-summary').textContent = `${projection.events.length} событий, ${laneWord(projection.laneCount || 1)} по времени${allDayCount ? `, ${allDayCount} на весь день` : ''}${timedCount ? `, ${timedCount} с расписанием` : ''}. шкала от 00:00 до 24:00.`;
  if (state.focusEventId) {
    const focus = [...document.querySelectorAll('[data-event-id]')].find((node) => node.dataset.eventId === state.focusEventId);
    if (focus) { focus.focus(); state.focusEventId = null; }
  }
}
function renderDetails() {
  const selected = state.projection?.events.find((event) => event.id === state.selectedEventId);
  const empty = $('details-empty');
  const details = $('event-details');
  const panel = $('details-panel');
  if (!selected) { panel.hidden = false; empty.hidden = false; details.hidden = true; return; }
  panel.hidden = false;
  empty.hidden = true; details.hidden = false;
  $('detail-source').textContent = sourceLabel(selected.source);
  $('detail-title').textContent = selected.title || 'без названия';
  $('detail-token').textContent = selected.completed ? '✓' : String((state.projection.events.indexOf(selected) + 1)).padStart(2, '0');
  $('detail-time').textContent = `${formatMinutes(selected.startMinute)} — ${formatMinutes(selected.endMinute)}`;
  const originalStart = selected.originalStart || '';
  const originalEnd = selected.originalEnd || '';
  $('detail-original-time').textContent = originalStart && originalEnd ? `${originalStart} — ${originalEnd}` : (selected.allDay ? 'весь день' : '—');
  $('detail-clip-note').textContent = selected.clippedStart || selected.clippedEnd ? `обрезано границей дня${selected.clippedStart ? ' (начало)' : ''}${selected.clippedEnd ? ' (конец)' : ''}` : '';
  $('detail-duration').textContent = durationText(selected.duration);
  $('detail-location').textContent = selected.location || '—';
  $('detail-repeat').textContent = selected.recurrence?.raw || selected.recurrence || (selected.allDay ? 'весь день' : 'однократно');
  $('detail-description').textContent = selected.description || '';
  $('toggle-complete').textContent = selected.completed ? 'вернуть в день' : 'отметить выполненным';
  $('detail-status').textContent = selected.completed ? 'выполнено' : selected.overlap ? 'пересечение — проверьте порядок' : 'впереди';
  $('edit-event').hidden = false;
  $('delete-event').hidden = false;
}
function render() {
  const active = document.activeElement;
  if (!state.focusEventId && active?.dataset?.eventId) state.focusEventId = active.dataset.eventId;
  refreshProjection();
  renderHeader();
  renderMetrics();
  renderRoute();
  renderDetails();
  renderMessages();
  announce(state.projection?.events.length ? 'день с событиями' : 'пустой день');
}

function importText(text, filename = 'calendar.ics') {
  if (!text || !/VEVENT/i.test(text)) { showMessage('файл не похож на ICS: не найден блок VEVENT.', true); announceAction('не удалось загрузить файл.', true); return; }
  const parsed = parseIcs(text, { fallbackZone: resolvedZone() });
  parsed.errors?.forEach((error) => showMessage(error, true));
  if (parsed.events.length) {
    const valid = parsed.events.filter((event) => validRawEvent(event));
    if (!valid.length) { showMessage('в файле не найдено корректных событий.', true); announceAction('не удалось загрузить файл.', true); return; }
    takeUndo('импорт');
    const previousCompleted = { ...state.completed };
    state.rawEvents = valid;
    saveSource(valid);
    state.completed = Object.fromEntries(valid.filter((event) => previousCompleted[event.id] !== undefined).map((event) => [event.id, previousCompleted[event.id]]));
    state.selectedEventId = null;
    saveStore();
    render();
    announceAction(`добавлено событий: ${valid.length}.`, false, true);
  } else {
    showMessage('в файле не найдено корректных событий.', true);
    announceAction('не удалось загрузить файл.', true);
  }
}
async function handleFile(file) {
  if (!file) return;
  try {
    if (typeof File !== 'undefined' && !(file instanceof File)) { showMessage('не удалось прочитать этот файл. выберите ICS.', true); return; }
    if (Number(file.size) > MAX_IMPORT_BYTES) { showMessage('файл больше 2 МБ. выберите файл поменьше.', true); announceAction('файл слишком большой.', true); return; }
    importText(await file.text(), file.name);
  } catch { showMessage('не удалось прочитать файл. попробуйте другой ICS.', true); }
  finally { const input = $('ics-file'); if (input) input.value = ''; }
}
function setManualError(text, field = null) {
  const error = $('manual-error') || $('manual-form-error');
  if (error) error.textContent = text || '';
  const form = $('manual-form');
  form?.querySelectorAll('input,textarea').forEach((input) => input.removeAttribute('aria-invalid'));
  if (field) field.setAttribute('aria-invalid', 'true');
}
function stableManualId(title, start, end) {
  const base = `${state.dayKey}|${title}|${start}|${end}|manual`;
  let hash = 2166136261;
  for (const char of base) { hash ^= char.codePointAt(0); hash = Math.imul(hash, 16777619); }
  let id = `manual-${(hash >>> 0).toString(16).padStart(8, '0')}`;
  let n = 1;
  while (state.rawEvents.some((event) => event.id === id && event.id !== state.editingEventId)) id = `manual-${(hash >>> 0).toString(16).padStart(8, '0')}-${n++}`;
  return id;
}
function makeManualEvent(form) {
  const data = new FormData(form);
  const titleField = form.querySelector('[name="title"]');
  const title = String(data.get('title') || '').trim();
  const start = String(data.get('start') || '');
  const end = String(data.get('end') || '');
  if (!title) { setManualError('введите название события.', titleField); titleField?.focus(); return null; }
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) { setManualError('укажите время в формате ЧЧ:ММ.', form.querySelector('[name="start"]')); return null; }
  if (end <= start) { setManualError('конец события должен быть позже начала.', form.querySelector('[name="end"]')); return null; }
  const editing = state.editingEventId && state.rawEvents.find((event) => event.id === state.editingEventId);
  return { id: editing?.id || stableManualId(title, start, end), title, description: String(data.get('description') || ''), location: String(data.get('location') || ''), start: `${state.dayKey}T${start}`, end: `${state.dayKey}T${end}`, allDay: false, source: editing?.source || 'manual', originalStart: editing?.originalStart, originalEnd: editing?.originalEnd };
}
function openManual() {
  lastFocus = document.activeElement;
  const form = $('manual-form');
  const title = $('manual-title');
  const submit = form?.querySelector('button[type="submit"]');
  setManualError('');
  if (state.editingEventId) {
    const event = state.rawEvents.find((item) => item.id === state.editingEventId);
    if (event) {
      form.elements.title.value = event.title || '';
      form.elements.location.value = event.location || '';
      form.elements.description.value = event.description || '';
      const start = typeof event.start === 'string' ? event.start.slice(11, 16) : `${String(event.start.hour).padStart(2, '0')}:${String(event.start.minute).padStart(2, '0')}`;
      const end = typeof event.end === 'string' ? event.end.slice(11, 16) : `${String(event.end.hour).padStart(2, '0')}:${String(event.end.minute).padStart(2, '0')}`;
      form.elements.start.value = start; form.elements.end.value = end;
      if (title) title.textContent = 'изменить событие';
      if (submit) submit.textContent = 'сохранить изменения';
    }
  } else {
    form?.reset();
    if (title) title.textContent = 'добавить событие';
    if (submit) submit.textContent = 'добавить в день';
  }
  const dialog = $('manual-dialog');
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.removeAttribute('hidden');
  dialog.querySelector('input[name="title"]').focus();
}
function closeManual() {
  const dialog = $('manual-dialog');
  if (dialog.open && typeof dialog.close === 'function') dialog.close();
  else dialog.setAttribute('hidden', '');
  lastFocus?.focus?.();
  state.editingEventId = null;
}

function buildExportSvg() {
  const projection = state.projection || { events: [], freeWindows: [] };
  const width = 1600; const left = 90; const right = 70; const chartWidth = width - left - right; const chartTop = 270; const rowHeight = 78;
  const x = (minute) => left + (clamp(minute, 0, 1440) / 1440) * chartWidth;
  const eventLanes = Math.max(projection.laneCount || 1, 1);
  const allDayEvents = projection.allDayEvents || [];
  const allDayRows = Math.max(1, Math.ceil(allDayEvents.length / 2));
  const timedTop = chartTop + allDayRows * 62;
  const height = Math.max(900, timedTop + eventLanes * rowHeight + 170);
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`, `<rect width="${width}" height="${height}" fill="#F4E7B2"/>`, `<style>text{font-family:monospace;fill:#171717}.display{font-family:Arial Narrow,sans-serif;font-weight:500}.small{font-size:16px;letter-spacing:1px}.title{font-size:28px}.time{font-size:20px}</style>`, `<text x="${left}" y="72" class="small">линия дня</text>`, `<text x="${left}" y="145" class="display" font-size="70">${escXml(formatDay())}</text>`, `<text x="${left}" y="180" class="small">${escXml(formatWeekday())} · ${escXml(state.timeZone === 'local' ? localZone : state.timeZone)}</text>`, `<text x="${width - right}" y="95" text-anchor="end" class="display" font-size="54">${String(projection.events.length).padStart(2, '0')} событий</text>`];
  for (let hour = 0; hour <= 24; hour += 1) {
    const lineX = x(hour * 60);
    parts.push(`<line x1="${lineX}" y1="${chartTop - 30}" x2="${lineX}" y2="${timedTop + eventLanes * rowHeight + 20}" stroke="#171717" stroke-width="${hour % 3 === 0 ? 2 : 1}" opacity="${hour % 3 === 0 ? .55 : .18}"/>`);
    parts.push(`<text x="${lineX + 4}" y="${chartTop - 42}" class="small">${hour === 24 ? '24:00' : `${String(hour).padStart(2, '0')}:00`}</text>`);
  }
  projection.freeWindows.filter((window) => window.duration >= 25).forEach((window) => parts.push(`<rect x="${x(window.startMinute)}" y="${timedTop - 12}" width="${Math.max(x(window.endMinute) - x(window.startMinute), 4)}" height="${eventLanes * rowHeight + 20}" fill="#B8D952" opacity=".38"/>`));
  allDayEvents.forEach((event, index) => {
    const y = chartTop + Math.floor(index / 2) * 62;
    const fill = event.completed ? '#B8D952' : '#FFF8D9';
    parts.push(`<rect x="${left + 12 + (index % 2) * (chartWidth / 2)}" y="${y}" width="${chartWidth / 2 - 20}" height="48" fill="${fill}" stroke="#171717" stroke-width="3"/>`);
    parts.push(`<text x="${left + 24 + (index % 2) * (chartWidth / 2)}" y="${y + 22}" class="title">${escXml(event.title || 'без названия')}</text>`);
    parts.push(`<text x="${left + 24 + (index % 2) * (chartWidth / 2)}" y="${y + 41}" class="time">${event.completed ? '✓ ' : ''}весь день</text>`);
  });
  projection.timedEvents.forEach((event) => {
    const y = timedTop + (event.lane || 0) * rowHeight;
    const fill = event.completed ? '#B8D952' : event.overlap ? '#E85D3F' : '#FFF8D9';
    parts.push(`<rect x="${x(event.startMinute)}" y="${y}" width="${Math.max(x(event.endMinute) - x(event.startMinute), 8)}" height="52" fill="${fill}" stroke="#171717" stroke-width="3"/>`);
    parts.push(`<text x="${x(event.startMinute) + 12}" y="${y + 23}" class="title">${escXml(event.title || 'без названия')}</text>`);
    const clip = event.clippedStart || event.clippedEnd ? ` · обрезано${event.originalStart && event.originalEnd ? ` (${escXml(String(event.originalStart))} — ${escXml(String(event.originalEnd))})` : ''}` : '';
    parts.push(`<text x="${x(event.startMinute) + 12}" y="${y + 43}" class="time">${event.completed ? '✓ ' : ''}${formatMinutes(event.startMinute)} — ${formatMinutes(event.endMinute)}${clip}</text>`);
  });
  const minute = minuteNow();
  if (minute !== null) { const nowX = x(minute); parts.push(`<line x1="${nowX}" y1="${chartTop - 48}" x2="${nowX}" y2="${timedTop + eventLanes * rowHeight + 20}" stroke="#E85D3F" stroke-width="4"/>`); }
  parts.push(`<line x1="${left}" y1="${height - 95}" x2="${width - right}" y2="${height - 95}" stroke="#171717" stroke-width="3"/>`, `<text x="${left}" y="${height - 58}" class="small">событие</text>`, `<text x="${left + 170}" y="${height - 58}" class="small" fill="#668500">свободно</text>`, `<text x="${left + 430}" y="${height - 58}" class="small" fill="#E85D3F">сейчас</text>`, '</svg>');
  return parts.join('');
}
function downloadBlob(blob, filename) {
  if (!blob || !URL?.createObjectURL) { showMessage('скачивание недоступно в этом браузере.', true); return; }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL?.revokeObjectURL?.(url), 1000);
}
function exportSvg() {
  downloadBlob(new Blob([buildExportSvg()], { type: 'image/svg+xml;charset=utf-8' }), `liniya-dnya-${state.dayKey}.svg`);
  showToast('SVG-табло готово к скачиванию.');
}
function exportPng() {
  const svgBlob = new Blob([buildExportSvg()], { type: 'image/svg+xml;charset=utf-8' });
  if (!URL?.createObjectURL) { showMessage('PNG: не удалось собрать в этом браузере.', true); return; }
  const url = URL.createObjectURL(svgBlob); const image = new Image();
  image.onload = () => {
    const scale = Math.min(window.devicePixelRatio || 1, 2); const canvas = document.createElement('canvas'); const dynamicHeight = Math.max(900, 270 + Math.max(1, Math.ceil((state.projection?.allDayEvents?.length || 0) / 2)) * 62 + Math.max(state.projection?.laneCount || 1, 1) * 78 + 170); canvas.width = 1600 * scale; canvas.height = dynamicHeight * scale;
    const context = canvas.getContext?.('2d');
    if (!context || typeof canvas.toBlob !== 'function') { URL?.revokeObjectURL?.(url); showMessage('PNG: не удалось собрать в этом браузере.', true); return; }
    context.scale(scale, scale); context.drawImage(image, 0, 0, 1600, dynamicHeight); URL?.revokeObjectURL?.(url);
    try { canvas.toBlob((blob) => { if (blob) { downloadBlob(blob, `liniya-dnya-${state.dayKey}.png`); showToast('PNG-табло готово к скачиванию.'); } else showMessage('PNG: не удалось собрать в этом браузере.', true); }, 'image/png'); }
    catch { showMessage('PNG: не удалось собрать в этом браузере.', true); }
  };
  image.onerror = () => { URL?.revokeObjectURL?.(url); showMessage('PNG: не удалось собрать в этом браузере.', true); };
  image.src = url;
}

function bindEvents() {
  $('day-picker').addEventListener('change', (event) => { state.dayKey = event.target.value || todayKey(); state.selectedEventId = null; readStore(); render(); announceAction(`выбран день ${state.dayKey}.`); });
  $('timezone-picker').addEventListener('change', (event) => { state.timeZone = event.target.value; saveStore(); render(); announceAction(`часовой пояс: ${event.target.options[event.target.selectedIndex]?.textContent || state.timeZone}.`); });
  document.querySelectorAll('[data-mode-choice]').forEach((button) => button.addEventListener('click', () => { state.mode = button.dataset.modeChoice; saveStore(); render(); announceAction(`режим: ${state.mode === 'arcade' ? 'аркадный' : 'спокойный'}.`); }));
  $('ics-file').addEventListener('change', (event) => handleFile(event.target.files?.[0]));
  const drop = $('drop-zone');
  ['dragenter', 'dragover'].forEach((type) => drop.addEventListener(type, (event) => { event.preventDefault(); drop.classList.add('is-dragging'); }));
  ['dragleave', 'drop'].forEach((type) => drop.addEventListener(type, (event) => { event.preventDefault(); drop.classList.remove('is-dragging'); }));
  drop.addEventListener('drop', (event) => handleFile(event.dataTransfer.files?.[0]));
  drop.addEventListener('click', () => $('ics-file').click());
  drop.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('ics-file').click(); } });
  $('load-demo').addEventListener('click', () => { takeUndo('пример'); state.rawEvents = makeDemoEvents(state.dayKey, resolvedZone()); state.completed = {}; state.selectedEventId = null; saveStore(); render(); announceAction('пример загружен.', false, true); });
  $('open-manual').addEventListener('click', openManual);
  $('close-manual').addEventListener('click', closeManual);
  $('cancel-manual').addEventListener('click', closeManual);
  $('manual-dialog').addEventListener('cancel', (event) => { event.preventDefault(); closeManual(); });
  $('manual-form').addEventListener('submit', (event) => { event.preventDefault(); const created = makeManualEvent(event.currentTarget); if (!created) return; const editing = state.editingEventId; takeUndo(editing ? 'изменение' : 'создание'); state.rawEvents = editing ? state.rawEvents.map((item) => item.id === editing ? created : item) : [...state.rawEvents, created]; saveStore(); closeManual(); state.selectedEventId = created.id; state.focusEventId = created.id; render(); event.currentTarget.reset(); setManualError(''); announceAction(editing ? 'событие изменено.' : 'событие добавлено.', false, true); });
  $('toggle-complete').addEventListener('click', () => { if (!state.selectedEventId) return; const current = state.completed[state.selectedEventId] ?? false; state.completed[state.selectedEventId] = !current; saveStore(); render(); announceAction(current ? 'событие снова открыто.' : 'событие отмечено выполненным.'); });
  $('edit-event').addEventListener('click', () => { if (!state.selectedEventId) return; state.editingEventId = state.selectedEventId.includes('@') ? state.selectedEventId.slice(0, state.selectedEventId.indexOf('@')) : state.selectedEventId; openManual(); });
  $('delete-event').addEventListener('click', () => { if (!state.selectedEventId || !window.confirm('удалить выбранное событие?')) return; takeUndo('удаление'); const id = state.selectedEventId; const baseId = id.includes('@') ? id.slice(0, id.indexOf('@')) : id; state.rawEvents = state.rawEvents.filter((event) => event.id !== id && event.id !== baseId); delete state.completed[id]; delete state.completed[baseId]; state.selectedEventId = null; saveStore(); render(); $('route-viewport')?.focus(); announceAction('событие удалено.', false, true); });
  $('export-svg').addEventListener('click', () => { exportSvg(); announce('SVG-табло скачивается.'); }); $('export-png').addEventListener('click', () => { exportPng(); announce('PNG-табло готовится.'); });
  setInterval(() => { state.now = new Date(); renderHeader(); renderRoute(); }, 30000);
}

readStore();
$('day-picker').value = state.dayKey;
bindEvents();
render();
