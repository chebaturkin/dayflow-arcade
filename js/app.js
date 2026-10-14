import '../i18n.js';
const t = (...args) => globalThis.I18n.t(...args);
I18n.apply();
import {
  parseIcs,
  projectDay,
  makeDemoEvents,
  formatMinutes,
  findAvailableSlots,
  getEventFormValues,
  createTimedEvent,
  updateOccurrence,
  removeOccurrence,
} from './calendar-core.js';
import { createMotion } from './motion.js';

const $ = (id) => document.getElementById(id);
const root = document.body;
const motion = createMotion(root);
const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const pct = (minute) => `${clamp((minute / 1440) * 100, 0, 100)}%`;
const escXml = (value = '') => String(value).replace(/[<>&'\"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[char]));
const sourceLabel = (source = 'ics') => ({ demo: t("s90"), manual: t("s91"), ics: 'ics' }[source] || t("s48"));

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
  focusSurface: 'route',
  focusShouldScroll: false,
  slotDuration: 30,
};

let toastTimer;
let lastFocus;
let renderedContentKey;
let importRequest = 0;
let pngPending = false;
const setText = (node, text) => { if (node.textContent !== String(text)) node.textContent = text; };

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
  if (typeof zone !== 'string' || !zone.trim()) return false;
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
  catch { pushStateError(t("s92", label), true); return fallback; }
  if (stored === null) return fallback;
  try { return JSON.parse(stored); }
  catch { pushStateError(t("s93", label), true); return fallback; }
}
function validCompletionMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, completed]) => key.length <= 512 && typeof completed === 'boolean'));
}
function restoreEvents(raw, source = t("s94")) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((event) => {
    if (validRawEvent(event)) return true;
    pushStateError(t("s95", source), true);
    return false;
  });
}
function readStore(dayKey = state.dayKey) {
  const saved = readJson(storageKey(dayKey), null, t("s96"));
  const source = readJson(sourceStorageKey, null, t("s97"));
  const settings = readJson(settingsStorageKey, null, t("s98"));
  const candidate = settings?.eventStoreVersion === 2 && Array.isArray(source) ? source : (Array.isArray(saved?.rawEvents) ? saved.rawEvents : source);
  state.rawEvents = restoreEvents(candidate, saved ? t("s94") : t("s99"));
  state.completed = validCompletionMap(saved?.completed);
  const zone = settings?.timeZone || saved?.timeZone;
  if (validTimeZone(zone)) state.timeZone = zone;
  const mode = settings?.mode ?? saved?.mode;
  if (mode === 'arcade' || mode === 'calm') state.mode = mode;
  if (settings?.eventStoreVersion !== 2) mergeLegacyEvents();
}
function mergeLegacyEvents() {
  // Older releases kept edits in date snapshots. Prefer each visible day's
  // version; keep the current day's version when the same record spans it.
  const events = new Map(state.rawEvents.map(event => [event.id, event]));
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!/^dayflow:\d{4}-\d{2}-\d{2}$/.test(key) || key === storageKey()) continue;
      let saved;
      try { saved = JSON.parse(localStorage.getItem(key)); } catch { continue; }
      if (!Array.isArray(saved?.rawEvents)) continue;
      const day = key.slice('dayflow:'.length);
      const zone = validTimeZone(saved.timeZone) && saved.timeZone !== 'local' ? saved.timeZone : localZone;
      saved.rawEvents.filter(validRawEvent).forEach(event => {
        try {
          const visible = projectDay([event], day, zone).events;
          if (!visible.length) return;
          const current = events.get(event.id);
          if (!current || JSON.stringify(current) === JSON.stringify(event)) { if (!current) events.set(event.id, event); return; }
          if (current.recurrence) {
            const excluded = projectDay([current], day, zone).events.map(item => item.start);
            events.set(current.id, { ...current, exdates: [...(current.exdates || []), ...excluded] });
            visible.forEach((item, occurrence) => events.set(`${event.id}@legacy-${day}-${occurrence}`, {
              ...event, id: `${event.id}@legacy-${day}-${occurrence}`, start: item.start, end: item.end,
              originalStart: item.start, originalEnd: item.end, recurrence: null, exdates: [], durationSeconds: null,
            }));
          } else if (!projectDay([current], state.dayKey, resolvedZone()).events.length) {
            events.set(event.id, event);
          }
        } catch { /* Preserve valid snapshots even if an unrelated record is malformed. */ }
      });
    }
  } catch { /* A restricted browser can still use the current session. */ }
  state.rawEvents = [...events.values()];
}
function saveStore(sourceChanged = false) {
  try {
    const settings = readJson(settingsStorageKey, null, t("s98"));
    if (sourceChanged || settings?.eventStoreVersion !== 2) localStorage.setItem(sourceStorageKey, JSON.stringify(state.rawEvents));
    localStorage.setItem(storageKey(), JSON.stringify({ rawEvents: state.rawEvents, completed: state.completed, mode: state.mode, timeZone: state.timeZone }));
    localStorage.setItem(settingsStorageKey, JSON.stringify({ mode: state.mode, timeZone: state.timeZone, eventStoreVersion: 2 }));
  } catch {
    showMessage(t("s100"), true);
  }
}
function dayDate() {
  const [year, month, day] = state.dayKey.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}
function formatDay() {
  return new Intl.DateTimeFormat(I18n.intlLocale, { day: 'numeric', month: 'long' }).format(dayDate()).toLocaleLowerCase(I18n.intlLocale);
}
function formatWeekday() {
  return new Intl.DateTimeFormat(I18n.intlLocale, { weekday: 'long' }).format(dayDate()).toLocaleLowerCase(I18n.intlLocale);
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
  return new Intl.DateTimeFormat(I18n.intlLocale, options).format(state.now);
}
function durationText(minutes = 0) {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? t("s101", hours, rest) : t("s102", hours);
  }
  return t("s103", minutes);
}
function metricDuration(minutes = 0) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourPart = t("s104", hours);
  return rest ? t("s105", hourPart, rest) : hourPart;
}
function showToast(text, isError = false) {
  const toast = $('toast');
  toast.replaceChildren();
  const label = document.createElement('span'); label.textContent = text; toast.appendChild(label);
  toast.classList.toggle('is-error', isError);
  toast.classList.add('is-visible');
  toast.inert = false;
  toast.style.pointerEvents = 'none';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 3200);
}
function hideToast() {
  const toast = $('toast');
  if (toast.contains(document.activeElement)) return;
  toast.classList.remove('is-visible');
  toast.inert = true;
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
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 8000);
    const toast = $('toast');
    const button = document.createElement('button');
    button.type = 'button'; button.id = 'undo-action'; button.className = 'button button-quiet'; button.textContent = t("s106");
    button.addEventListener('click', restoreUndo);
    toast.appendChild(button); toast.style.pointerEvents = 'auto';
  }
}
function takeUndo(label) {
  const active = $('manual-dialog').open ? lastFocus : document.activeElement;
  state.undoSnapshot = { label, rawEvents: state.rawEvents.map((event) => ({ ...event })), completed: { ...state.completed }, selectedEventId: state.selectedEventId, dayKey: state.dayKey, timeZone: state.timeZone, mode: state.mode,
    focusControlId: active?.id, focusEventId: active?.dataset?.eventId, focusSurface: active?.dataset?.surface, focusSlot: active?.dataset?.slotStart,
    focusSlotSurface: active?.classList.contains('free-window') ? 'route' : 'availability' };
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
  cancelImport();
  saveStore(true); render({ type: 'undo' });
  const source = snapshot.focusControlId && $(snapshot.focusControlId);
  const eventSource = [...document.querySelectorAll('[data-event-id]')].find(node => node.dataset.eventId === snapshot.focusEventId && node.dataset.surface === snapshot.focusSurface);
  const slots = snapshot.focusSlotSurface === 'route' ? '.free-window' : '.availability-slot';
  const slotSource = [...document.querySelectorAll(slots)].find(node => node.dataset.slotStart === snapshot.focusSlot);
  const selected = [...document.querySelectorAll('.agenda-select')].find(node => node.dataset.eventId === state.selectedEventId);
  (source || eventSource || slotSource || selected || $('route-viewport')).focus({ preventScroll: true });
  announceAction(t("s107"));
}

function withCompletion(projection) {
  if (!projection) return projection;
  const demoTitles = { 'demo-departure': 's213', 'demo-focus': 's214', 'demo-lunch': 's215', 'demo-review': 's216', 'demo-all-day': 's217' };
  const mark = (event) => ({ ...event, title: event.source === 'demo' && demoTitles[event.baseId || event.id] && ['ru', 'en'].some(language => I18n.messages[language][demoTitles[event.baseId || event.id]] === event.title) ? t(demoTitles[event.baseId || event.id]) : event.title, completed: state.completed[event.id] ?? Boolean(event.completed) });
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
    showMessage(t("s108", error.message), true);
  }
}

function renderHeader() {
  $('day-picker').value = state.dayKey;
  $('date-picker-label').textContent = new Intl.DateTimeFormat(I18n.intlLocale, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(dayDate());
  const zonePicker = $('timezone-picker');
  if (![...zonePicker.options].some(option => option.value === state.timeZone)) zonePicker.add(new Option(state.timeZone, state.timeZone));
  zonePicker.value = state.timeZone;
  setText($('readout-weekday'), formatWeekday());
  setText($('readout-date'), formatDay());
  setText($('readout-now'), timeNow());
  $('today').disabled = state.dayKey === todayInZone();
  $('focus-now').disabled = minuteNow() === null;
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
  $('route-note').textContent = t("s109", lanes, laneWord(lanes));
}
function laneWord(count) {
  if (I18n.locale === 'en') return Number(count) === 1 ? t('s111') : t('s110');
  const n = Math.abs(Number(count)) % 100;
  if (n >= 11 && n <= 14) return t("s110");
  const one = n % 10;
  return one === 1 ? t("s111") : one >= 2 && one <= 4 ? t("s112") : t("s110");
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
  station.dataset.surface = 'route';
  station.title = `${event.title} · ${formatMinutes(event.startMinute)} - ${formatMinutes(event.endMinute)}`;
  station.style.left = pct(event.startMinute);
  if (event.duration < 30) station.classList.add('is-compact');
  station.style.width = `${Math.max((event.duration / 1440) * 100, .7)}%`;
  station.style.setProperty('--station-min-width', event.duration < 30 ? '28px' : '34px');
  station.setAttribute('aria-pressed', String(state.selectedEventId === event.id));
  station.setAttribute('aria-label', `${event.title}, ${formatMinutes(event.startMinute)} - ${formatMinutes(event.endMinute)}`);
  const token = document.createElement('span');
  token.className = 'station-token';
  token.textContent = event.completed ? '✓' : String(index + 1).padStart(2, '0');
  const copy = document.createElement('span');
  copy.className = 'station-copy';
  const title = document.createElement('span');
  title.className = 'station-title';
  title.textContent = event.title || t("s64");
  const time = document.createElement('span');
  time.className = 'station-time';
  time.textContent = `${formatMinutes(event.startMinute)} - ${formatMinutes(event.endMinute)}`;
  copy.append(title, time);
  station.append(token, copy);
  station.addEventListener('click', () => selectEvent(event.id, 'route'));
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
  const allDayBlocks = [Object.assign(document.createElement('span'), { className: 'all-day-label', textContent: t("s113") })];
  allDayRow.hidden = !projection.allDayEvents.length;
  allDayRow.style.minHeight = `${Math.ceil(projection.allDayEvents.length / 2) * 39}px`;
  projection.allDayEvents.forEach((event, index) => {
    const block = document.createElement('button');
    block.type = 'button';
    block.className = `all-day-block${event.completed ? ' is-complete' : ''}${state.selectedEventId === event.id ? ' is-selected' : ''}`;
    block.dataset.eventId = event.id;
    block.dataset.surface = 'route';

    block.textContent = `${event.completed ? '✓ ' : ''}${event.title}`;
    block.title = `${event.title} · ${durationText(event.duration)}`;
    block.setAttribute('aria-pressed', String(state.selectedEventId === event.id));
    block.setAttribute('aria-label', t("s115", event.title || t("s64"), event.completed ? t("s114") : ''));
    block.addEventListener('click', () => selectEvent(event.id, 'route'));
    allDayBlocks.push(block);
  });
  allDayRow.replaceChildren(...allDayBlocks);
  const freeRow = $('free-row');
  const freeChildren = [Object.assign(document.createElement('span'), { className: 'free-label', textContent: t("s35") })];
  projection.freeWindows.forEach((window) => {
    if (window.duration < 25) return;
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'free-window';
    item.dataset.slotStart = window.startMinute;
    item.style.left = pct(window.startMinute);
    item.style.width = `${Math.max((window.duration / 1440) * 100, .8)}%`;
    item.textContent = durationText(window.duration);
    item.title = `${formatMinutes(window.startMinute)} - ${formatMinutes(window.endMinute)} · ${durationText(window.duration)}`;
    item.setAttribute('aria-label', t("s116", formatMinutes(window.startMinute), formatMinutes(window.endMinute)));
    item.addEventListener('click', () => openSlot(window));
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
    const title = document.createElement('strong'); title.textContent = t("s117");
    const copy = document.createElement('span'); copy.textContent = t("s118");
    empty.append(title, copy);
    eventLaneContainer.replaceChildren(empty);
  } else {
    eventLaneContainer.replaceChildren(...lanes);
  }
  updateNowLine();
  const timedCount = projection.timedEvents.length;
  const allDayCount = projection.allDayEvents.length;
  $('route-summary').textContent = t("s121", I18n.count('summary.events', projection.events.length), projection.laneCount || 1, laneWord(projection.laneCount || 1), allDayCount ? t("s119", allDayCount) : '', timedCount ? t("s120", timedCount) : '');
}
function renderAvailability() {
  const slots = findAvailableSlots(state.projection?.timedEvents || [], state.slotDuration);
  $('slot-duration').value = String(state.slotDuration);
  $('availability-list').replaceChildren(...slots.map(window => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'availability-slot';
    button.dataset.slotStart = window.startMinute;
    button.setAttribute('aria-label', t("s122", formatMinutes(window.startMinute), formatMinutes(window.slotEndMinute), formatMinutes(window.endMinute)));
    const range = document.createElement('span'); range.className = 'availability-time';
    range.textContent = `${formatMinutes(window.startMinute)} - ${formatMinutes(window.endMinute)}`;
    const duration = document.createElement('span'); duration.className = 'availability-duration';
    duration.textContent = durationText(window.duration);
    button.append(range, duration);
    button.addEventListener('click', () => openSlot(window));
    return button;
  }));
  const empty = $('availability-empty');
  empty.hidden = slots.length > 0;
  empty.textContent = slots.length ? '' : t("s123", state.slotDuration);
}

function openSlot(window) {
  state.editingEventId = null;
  openManual({ startMinute: window.startMinute, endMinute: window.startMinute + Math.min(state.slotDuration, window.duration) });
}

function todayInZone() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: resolvedZone(), year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function changeDay(dayKey) {
  if (!isDateKey(dayKey)) { $('day-picker').value = state.dayKey; return; }
  if (dayKey === state.dayKey) return;
  const direction = dayKey > state.dayKey ? 1 : -1;
  cancelImport();
  state.dayKey = dayKey;
  state.selectedEventId = null;
  readStore(); render({ type: 'day', direction, focusTimeline: true });
  announce(t("s124", formatDay()));
}
function stepDay(offset) {
  const date = dayDate();
  date.setDate(date.getDate() + offset);
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  changeDay(key);
}
function updateNowLine() {
  const minute = minuteNow();
  const line = $('now-line');
  line.classList.toggle('is-near-end', minute !== null && minute > 1320);
  line.hidden = minute === null;
  if (minute !== null) line.style.left = pct(minute);
}
function focusTimeline(target = 'events', smooth = true) {
  motion.cancel();
  const panel = document.querySelector('.route-panel');
  const fit = target === 'fit';
  panel.classList.toggle('is-fit', fit);
  $('fit-day').setAttribute('aria-pressed', String(fit));
  $('focus-events').setAttribute('aria-pressed', String(!fit));
  const viewport = $('route-viewport');
  const minute = fit ? 0 : target === 'now' ? minuteNow() : state.projection?.timedEvents[0]?.startMinute;
  const start = minute == null ? 0 : Math.max(0, minute - (target === 'now' ? 240 : 90));
  const left = start / 1440 * $('route-stage').offsetWidth;
  viewport.scrollTo({ left, behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant' });
}
function selectEvent(id, surface = 'agenda') {
  if (state.selectedEventId === id) return;
  state.selectedEventId = id;
  state.focusEventId = id;
  state.focusSurface = surface;
  render({ type: 'select', id });
  const title = state.projection.events.find(event => event.id === id)?.title || t("s64");
  announce(t("s125", title));
}
function toggleCompletion(id) {
  const event = state.projection.events.find(item => item.id === id);
  if (!event) return;
  takeUndo(t("s126"));
  state.completed[id] = !event.completed;
  const surface = document.activeElement?.dataset?.surface;
  saveStore(); render({ type: 'complete', id, completed: !event.completed, surface });
  announceAction(event.completed ? t("s127") : t("s128"), false, true);
}
function renderAgenda() {
  const events = state.projection?.events || [];
  $('agenda-count').textContent = String(events.length);
  if (!events.length) {
    const empty = document.createElement('p');
    empty.className = 'agenda-empty'; empty.textContent = t("s129");
    $('agenda-list').replaceChildren(empty); return;
  }
  const rows = events.map(event => {
    const row = document.createElement('div'); row.className = `agenda-row${event.completed ? ' is-complete' : ''}`;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'agenda-select';
    button.dataset.eventId = event.id; button.dataset.surface = 'agenda';
    button.setAttribute('aria-pressed', String(state.selectedEventId === event.id));
    const time = document.createElement('span'); time.className = 'agenda-time';
    const start = document.createElement('span'); start.textContent = event.allDay ? t("s130") : formatMinutes(event.startMinute);
    const end = document.createElement('span'); end.textContent = event.allDay ? t("s131") : formatMinutes(event.endMinute);
    time.append(start, end);
    const copy = document.createElement('span'); copy.className = 'agenda-copy';
    const title = document.createElement('span'); title.className = 'agenda-name'; title.textContent = event.title || t("s64");
    const meta = document.createElement('span'); meta.className = `agenda-meta${event.overlap ? ' agenda-overlap' : ''}`;
    meta.textContent = [event.allDay ? t("s132") : durationText(event.duration), event.overlap ? t("s133") : event.location].filter(Boolean).join(' · ');
    copy.append(title, meta); button.append(time, copy);
    button.addEventListener('click', () => selectEvent(event.id, 'agenda'));
    const check = document.createElement('button'); check.type = 'button'; check.className = 'agenda-check';
    check.setAttribute('aria-label', `${event.completed ? t("s134") : t("s71")}: ${event.title || t("s64")}`);
    check.setAttribute('aria-pressed', String(event.completed));
    check.dataset.eventId = event.id; check.dataset.surface = 'check';
    renderCheck(check, event.completed);
    check.addEventListener('click', () => toggleCompletion(event.id));
    row.append(button, check); return row;
  });
  $('agenda-list').replaceChildren(...rows);
}
function renderCheck(check, completed) {
  if (!completed) { check.replaceChildren(); return; }
  if (check.firstChild) return;
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.classList.add('icon'); icon.setAttribute('aria-hidden', 'true'); icon.setAttribute('viewBox', '0 0 24 24');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'm5 12 4 4L19 6');
  icon.append(path); check.append(icon);
}
function renderEventState() {
  const events = new Map(state.projection.events.map(event => [event.id, event]));
  const timedIndices = new Map(state.projection.timedEvents.map((event, index) => [event.id, index]));
  document.querySelectorAll('[data-event-id]').forEach(node => {
    const event = events.get(node.dataset.eventId);
    if (!event) return;
    const selected = event.id === state.selectedEventId;
    const surface = node.dataset.surface;
    if (surface === 'check') {
      node.setAttribute('aria-pressed', String(event.completed));
      node.setAttribute('aria-label', `${event.completed ? t("s134") : t("s71")}: ${event.title || t("s64")}`);
      node.parentElement.classList.toggle('is-complete', event.completed);
      renderCheck(node, event.completed);
    } else {
      node.setAttribute('aria-pressed', String(selected));
      node.classList.toggle('is-selected', selected);
      if (surface === 'route') {
        node.classList.toggle('is-complete', event.completed);
        node.setAttribute('aria-label', `${event.title || t("s64")}, ${event.allDay ? t("s113") : `${formatMinutes(event.startMinute)} - ${formatMinutes(event.endMinute)}`}${event.completed ? t("s114") : ''}`);
        if (event.allDay) setText(node, `${event.completed ? '✓ ' : ''}${event.title}`);
        else setText(node.querySelector('.station-token'), event.completed ? '✓' : String(timedIndices.get(event.id) + 1).padStart(2, '0'));
      }
    }
  });
}
function renderDetails() {
  const selected = state.projection?.events.find((event) => event.id === state.selectedEventId);
  const empty = $('details-empty');
  const details = $('event-details');
  const panel = $('details-panel');
  if (!selected) { panel.hidden = false; empty.hidden = false; details.hidden = true; return; }
  panel.hidden = false;
  empty.hidden = true; details.hidden = false;
  setText($('detail-source'), sourceLabel(selected.source));
  setText($('detail-title'), selected.title || t("s64"));
  setText($('detail-token'), selected.completed ? '✓' : String((state.projection.events.indexOf(selected) + 1)).padStart(2, '0'));
  setText($('detail-time'), selected.allDay ? t("s113") : `${formatMinutes(selected.startMinute)} - ${formatMinutes(selected.endMinute)}`);
  const originalStart = selected.originalStart || '';
  const originalEnd = selected.originalEnd || '';
  setText($('detail-original-time'), originalStart && originalEnd ? `${originalStart} - ${originalEnd}` : (selected.allDay ? t("s113") : t("s66")));
  setText($('detail-clip-note'), selected.clippedStart || selected.clippedEnd ? t("s137", selected.clippedStart ? t("s135") : '', selected.clippedEnd ? t("s136") : '') : '');
  $('original-time-row').hidden = !selected.clippedStart && !selected.clippedEnd && selected.source !== 'ics';
  setText($('detail-duration'), selected.allDay ? t("s113") : durationText(selected.duration));
  setText($('detail-location'), selected.location || t("s66"));
  setText($('detail-repeat'), selected.recurrence?.raw || selected.recurrence || (selected.allDay ? t("s113") : t("s138")));
  setText($('detail-description'), selected.description || '');
  setText($('toggle-complete'), selected.completed ? t("s134") : t("s71"));
  setText($('detail-status'), selected.completed ? t("s139") : selected.overlap ? t("s140") : t("s141"));
  $('edit-event').hidden = Boolean(selected.allDay);
  $('delete-event').hidden = false;
}
function render(effect = {}) {
  motion.cancel();
  const before = effect.type === 'edit' ? motion.capture(effect.id) : null;
  const metrics = ['metric-events', 'metric-done', 'metric-busy', 'metric-free'];
  const oldMetrics = metrics.map(id => $(id).textContent);
  const active = document.activeElement;
  if (!state.focusEventId && active?.dataset?.eventId) { state.focusEventId = active.dataset.eventId; state.focusSurface = active.dataset.surface || 'route'; }
  refreshProjection();
  renderHeader();
  renderMetrics();
  // Keep targets connected when only selection, completion or mode changes.
  const contentKey = JSON.stringify([state.dayKey, state.timeZone, I18n.locale, state.projection.events.map(({ completed, ...event }) => event)]);
  if (contentKey !== renderedContentKey) {
    renderRoute(); renderAgenda(); renderAvailability(); renderedContentKey = contentKey;
  }
  renderEventState();
  renderDetails();
  renderMessages();
  if (state.focusEventId) {
    const focus = [...document.querySelectorAll('[data-event-id]')].find(node => node.dataset.eventId === state.focusEventId && node.dataset.surface === state.focusSurface);
    focus?.focus({ preventScroll: !state.focusShouldScroll });
    state.focusShouldScroll = false;
    state.focusEventId = null;
  }
  announce(state.projection?.events.length ? t("s142") : t("s143"));
  if (effect.focusTimeline) focusTimeline('events', false);
  motion.play(effect, before, metrics.filter((id, index) => $(id).textContent !== oldMetrics[index]));
}

function importText(text, filename = 'calendar.ics') {
  if (!text || !/VEVENT/i.test(text)) { showMessage(t("s144"), true); announceAction(t("s145"), true); return; }
  const parsed = parseIcs(text, { fallbackZone: resolvedZone() });
  parsed.errors?.forEach((error) => showMessage(error, true));
  if (parsed.events.length) {
    const valid = parsed.events.filter((event) => validRawEvent(event));
    if (!valid.length) { showMessage(t("s146"), true); announceAction(t("s145"), true); return; }
    takeUndo(t("s147"));
    const previousCompleted = { ...state.completed };
    state.rawEvents = valid;
    state.completed = Object.fromEntries(valid.filter((event) => previousCompleted[event.id] !== undefined).map((event) => [event.id, previousCompleted[event.id]]));
    state.selectedEventId = null;
    saveStore(true);
    render({ type: 'import', focusTimeline: true });
    announceAction(t("s148", valid.length), false, true);
  } else {
    showMessage(t("s146"), true);
    announceAction(t("s145"), true);
  }
}
async function handleFile(file) {
  if (!file) return;
  const request = ++importRequest;
  try {
    if (typeof File !== 'undefined' && !(file instanceof File)) { showMessage(t("s149"), true); return; }
    if (Number(file.size) > MAX_IMPORT_BYTES) { showMessage(t("s150"), true); announceAction(t("s151"), true); return; }
    setImportBusy(true);
    const text = await file.text();
    if (request !== importRequest) return;
    importText(text, file.name);
  } catch {
    if (request === importRequest) { showMessage(t("s152"), true); announceAction(t("s153"), true); }
  } finally {
    if (request === importRequest) { setImportBusy(false); $('ics-file').value = ''; }
  }
}
function setImportBusy(busy) {
  $('drop-zone').setAttribute('aria-busy', String(busy));
  setText($('drop-zone').querySelector('strong'), busy ? t("s154") : t("s57"));
}
function cancelImport() {
  importRequest += 1;
  setImportBusy(false);
  $('ics-file').value = '';
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
  const start = `${data.get('startDate')}T${data.get('start') || ''}`;
  const end = `${data.get('endDate')}T${data.get('end') || ''}`;
  if (!title) { setManualError(t("s155"), titleField); titleField?.focus(); return null; }
  const editing = state.editingEventId && state.projection.events.find(event => event.id === state.editingEventId);
  try {
    return createTimedEvent({ id: editing?.id || stableManualId(title, start, end), title, start, end,
      description: String(data.get('description') || ''), location: String(data.get('location') || ''), source: editing?.source || 'manual' }, resolvedZone(), editing || null);
  } catch (error) { setManualError(error.message); return null; }
}
function openManual(slot = null) {
  motion.cancel();
  lastFocus = document.activeElement;
  const form = $('manual-form');
  const title = $('manual-title');
  const submit = form?.querySelector('button[type="submit"]');
  setManualError('');
  if (state.editingEventId) {
    const event = state.projection.events.find(item => item.id === state.editingEventId);
    if (event) {
      form.elements.title.value = event.title || '';
      form.elements.location.value = event.location || '';
      form.elements.description.value = event.description || '';
      const values = getEventFormValues(event, resolvedZone());
      for (const [name, value] of Object.entries(values)) form.elements[name].value = value;
      if (title) title.textContent = t("s156");
      if (submit) submit.textContent = t("s157");
    }
  } else {
    form?.reset();
    form.elements.startDate.value = state.dayKey;
    form.elements.endDate.value = state.dayKey;
    if (slot) {
      form.elements.start.value = formatMinutes(slot.startMinute);
      form.elements.end.value = formatMinutes(slot.endMinute % 1440);
      if (slot.endMinute === 1440) {
        const [y, m, d] = state.dayKey.split('-').map(Number);
        form.elements.endDate.value = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
      }
    }
    if (title) title.textContent = t("s15");
    if (submit) submit.textContent = t("s89");
  }
  const editing = state.projection.events.find(event => event.id === state.editingEventId);
  const repeatNote = editing?.recurrence && editing.id !== editing.baseId ? t("s158") : '';
  $('manual-context').textContent = t("s159", $('timezone-picker').selectedOptions[0].textContent, repeatNote);
  const dialog = $('manual-dialog');
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.removeAttribute('hidden');
  dialog.querySelector('input[name="title"]').focus();
}
function closeManual() {
  const dialog = $('manual-dialog');
  if (dialog.open && typeof dialog.close === 'function') dialog.close();
  else dialog.setAttribute('hidden', '');
  const focus = lastFocus?.isConnected && lastFocus.getClientRects().length ? lastFocus : $('open-manual');
  focus.focus();
  state.editingEventId = null;
}

function submitManual(event) {
  event.preventDefault();
  const created = makeManualEvent(event.currentTarget);
  if (!created) return;
  const editing = state.editingEventId;
  let events;
  try {
    const selected = state.projection.events.find(item => item.id === editing);
    events = editing ? updateOccurrence(state.rawEvents, selected, created) : [...state.rawEvents, created];
  } catch (error) { setManualError(error.message); return; }
  takeUndo(editing ? t("s160") : t("s161"));
  state.rawEvents = events;
  saveStore(true); closeManual();
  state.selectedEventId = created.id;
  state.focusEventId = created.id; state.focusSurface = 'agenda'; state.focusShouldScroll = true;
  cancelImport();
  render({ type: editing ? 'edit' : 'create', id: created.id }); event.currentTarget.reset(); setManualError('');
  announceAction(editing ? t("s162") : t("s163"), false, true);
}

function deleteSelectedEvent() {
  const selected = state.projection.events.find(event => event.id === state.selectedEventId);
  if (!selected) return;
  const repeating = selected.recurrence && selected.id !== selected.baseId;
  if (!window.confirm(repeating ? t("s164") : t("s165"))) return;
  let events;
  try { events = removeOccurrence(state.rawEvents, selected); }
  catch (error) { announceAction(error.message, true); return; }
  takeUndo(t("s166"));
  state.rawEvents = events;
  delete state.completed[selected.id]; state.selectedEventId = null;
  cancelImport();
  saveStore(true); render({ type: 'delete' }); $('route-viewport').focus();
  announceAction(repeating ? t("s167") : t("s168"), false, true);
}

function buildExportSvg() {
  const projection = state.projection || { events: [], timedEvents: [], allDayEvents: [], freeWindows: [] };
  const width = 1600, left = 64, chartWidth = 1472, chartTop = 240;
  const allDayRows = Math.ceil(projection.allDayEvents.length / 2);
  const timedTop = chartTop + 62 + allDayRows * 42;
  const chartBottom = timedTop + Math.max(projection.laneCount, 1) * 76 + 42;
  const listTop = chartBottom + 86;
  const height = Math.max(900, listTop + Math.ceil(projection.events.length / 2) * 62 + 100);
  const x = minute => left + clamp(minute, 0, 1440) / 1440 * chartWidth;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="dayflow arcade, ${escXml(formatDay())}">`,
    `<rect width="${width}" height="${height}" fill="#F8F6F0"/>`,
    `<style>text{font-family:sans-serif;fill:#242821}.mono{font-family:monospace}.muted{fill:#74786e}.chart{fill:#B6BCAD}.small{font-size:16px}.title{font-size:24px}</style>`,
    `<g transform="translate(64 40)"><rect width="48" height="48" rx="13" fill="#E96840"/><g transform="scale(.75)"><path d="M19 44V19h13c10 0 17 7 17 16S42 51 32 51H19" fill="none" stroke="#242821" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 35h23" stroke="#F8F6F0" stroke-width="6" stroke-linecap="round"/><circle cx="35" cy="35" r="5" fill="#F8F6F0"/></g></g>`,
    `<text x="126" y="72" font-size="28" font-weight="700">dayflow arcade</text>`,
    `<line x1="64" y1="114" x2="1536" y2="114" stroke="#DEDFD5"/>`,
    `<text x="64" y="180" font-size="42">${escXml(formatDay())}</text>`,
    `<text x="64" y="210" class="small muted">${escXml(formatWeekday())} · ${escXml(state.dayKey.slice(0, 4))} · ${escXml(resolvedZone())}</text>`,
    t("s169", projection.events.length, projection.events.filter(event => event.completed).length),
    t("s170", durationText(projection.occupiedMinutes), durationText(projection.freeMinutes)),
    `<rect x="48" y="${chartTop}" width="1504" height="${chartBottom - chartTop}" rx="12" fill="#292D26"/>`,
  ];
  for (let hour = 0; hour <= 24; hour += 1) {
    const lineX = x(hour * 60);
    parts.push(`<line x1="${lineX}" y1="${chartTop + 42}" x2="${lineX}" y2="${chartBottom - 18}" stroke="#FFFFFF" opacity=".08"/>`);
    if (hour % 2 === 0) parts.push(`<text x="${lineX}" y="${chartTop + 28}" text-anchor="${hour === 0 ? 'start' : hour === 24 ? 'end' : 'middle'}" class="mono small chart">${formatMinutes(hour * 60)}</text>`);
  }
  projection.allDayEvents.forEach((event, index) => {
    const blockX = left + index % 2 * chartWidth / 2, y = chartTop + 51 + Math.floor(index / 2) * 42;
    parts.push(`<clipPath id="allday-${index}"><rect x="${blockX + 10}" y="${y}" width="${chartWidth / 2 - 36}" height="32"/></clipPath>`, `<rect x="${blockX}" y="${y}" width="${chartWidth / 2 - 12}" height="32" rx="5" fill="#404836"/>`, t("s171", blockX + 12, y + 22, index, event.completed ? '✓ ' : '', escXml(event.title)));
  });
  projection.freeWindows.forEach(window => parts.push(`<rect x="${x(window.startMinute)}" y="${timedTop}" width="${x(window.endMinute) - x(window.startMinute)}" height="${chartBottom - timedTop - 18}" fill="#C8DD9B" opacity=".06"/>`));
  projection.timedEvents.forEach((event, index) => {
    const y = timedTop + 16 + (event.lane || 0) * 76, eventX = x(event.startMinute), eventWidth = Math.max(10, x(event.endMinute) - eventX);
    parts.push(`<clipPath id="event-${index}"><rect x="${eventX + 7}" y="${y}" width="${Math.max(0, eventWidth - 14)}" height="52"/></clipPath>`, `<rect x="${eventX}" y="${y}" width="${eventWidth}" height="52" rx="5" fill="${event.completed ? '#C8DD9B' : '#EFEEDE'}"/>`, `<rect x="${eventX}" y="${y}" width="3" height="52" fill="${event.overlap ? '#E96840' : '#B6C7A0'}"/>`, `<g clip-path="url(#event-${index})"><text x="${eventX + 9}" y="${y + 23}" class="small">${escXml(event.title)}</text><text x="${eventX + 9}" y="${y + 42}" class="mono" font-size="11">${formatMinutes(event.startMinute)} - ${formatMinutes(event.endMinute)}</text></g>`);
  });
  const minute = minuteNow();
  if (minute !== null) parts.push(`<line x1="${x(minute)}" y1="${chartTop + 38}" x2="${x(minute)}" y2="${chartBottom - 18}" stroke="#E96840" stroke-width="2"/>`);
  parts.push(t("s172", listTop - 24));
  projection.events.forEach((event, index) => {
    const column = index % 2, row = Math.floor(index / 2), listX = left + column * 756, y = listTop + row * 62;
    parts.push(`<clipPath id="list-${index}"><rect x="${listX + 180}" y="${y - 23}" width="540" height="35"/></clipPath>`, `<line x1="${listX}" y1="${y + 24}" x2="${listX + 720}" y2="${y + 24}" stroke="#DEDFD5"/>`, `<text x="${listX}" y="${y}" class="mono small muted">${event.allDay ? t("s113") : `${formatMinutes(event.startMinute)} - ${formatMinutes(event.endMinute)}`}</text>`, `<text x="${listX + 180}" y="${y}" font-size="20" clip-path="url(#list-${index})">${event.completed ? '✓ ' : ''}${escXml(event.title)}</text>`);
  });
  if (!projection.events.length) parts.push(t("s173", listTop));
  parts.push(t("s174", height - 38), '</svg>');
  return parts.join('');
}
function downloadBlob(blob, filename) {
  if (!blob || !URL?.createObjectURL) { showMessage(t("s175"), true); return false; }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
function exportSvg() {
  if (downloadBlob(new Blob([buildExportSvg()], { type: 'image/svg+xml;charset=utf-8' }), `dayflow-arcade-${state.dayKey}.svg`)) {
    announceAction(t("s176"));
  }
}
function exportPng() {
  if (pngPending) return;
  if (!URL?.createObjectURL) { showMessage(t("s177"), true); announceAction(t("s178"), true); return; }
  // Capture both the content and date before the asynchronous image/canvas work.
  const filename = `dayflow-arcade-${state.dayKey}.png`;
  const svgBlob = new Blob([buildExportSvg()], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  const image = new Image();
  const button = $('export-png');
  pngPending = true; button.setAttribute('aria-busy', 'true'); button.setAttribute('aria-disabled', 'true');
  announceAction(t("s179"));
  const finish = (blob = null) => {
    URL.revokeObjectURL(url); image.onload = null; image.onerror = null;
    pngPending = false; button.setAttribute('aria-busy', 'false'); button.removeAttribute('aria-disabled');
    if (blob && downloadBlob(blob, filename)) announceAction(t("s180"));
    else { showMessage(t("s177"), true); announceAction(t("s178"), true); }
  };
  image.onload = () => {
    try {
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth * scale; canvas.height = image.naturalHeight * scale;
      const context = canvas.getContext?.('2d');
      if (!context || typeof canvas.toBlob !== 'function') { finish(); return; }
      context.scale(scale, scale); context.drawImage(image, 0, 0);
      canvas.toBlob(finish, 'image/png');
    } catch { finish(); }
  };
  image.onerror = () => finish();
  image.src = url;
}

function bindEvents() {
  $('day-picker').addEventListener('change', event => changeDay(event.target.value));
  $('previous-day').addEventListener('click', () => stepDay(-1));
  $('next-day').addEventListener('click', () => stepDay(1));
  $('today').addEventListener('click', () => changeDay(todayInZone()));
  $('fit-day').addEventListener('click', () => focusTimeline('fit'));
  $('focus-events').addEventListener('click', () => focusTimeline('events'));
  $('focus-now').addEventListener('click', () => focusTimeline('now'));
  $('slot-duration').addEventListener('change', event => { state.slotDuration = Number(event.target.value); renderAvailability(); announce(t("s181", state.slotDuration)); });
  $('timezone-picker').addEventListener('change', (event) => { state.timeZone = event.target.value; saveStore(); render(); announceAction(t("s182", event.target.options[event.target.selectedIndex]?.textContent || state.timeZone)); });
  document.querySelectorAll('[data-mode-choice]').forEach((button) => button.addEventListener('click', () => { state.mode = button.dataset.modeChoice; saveStore(); render(); announceAction(t("s183", state.mode === 'arcade' ? t("s25") : t("s24"))); }));
  $('ics-file').addEventListener('change', (event) => handleFile(event.target.files?.[0]));
  const drop = $('drop-zone');
  let dragDepth = 0;
  const isFileDrag = (event) => [...(event.dataTransfer?.types || [])].includes('Files');
  drop.addEventListener('dragenter', (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault(); dragDepth += 1; drop.classList.add('is-dragging');
  });
  drop.addEventListener('dragover', (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'copy';
  });
  drop.addEventListener('dragleave', (event) => {
    event.preventDefault(); dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) drop.classList.remove('is-dragging');
  });
  drop.addEventListener('drop', (event) => {
    event.preventDefault(); dragDepth = 0; drop.classList.remove('is-dragging');
    handleFile(event.dataTransfer?.files?.[0]);
  });
  drop.addEventListener('click', () => $('ics-file').click());
  drop.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('ics-file').click(); } });
  $('load-demo').addEventListener('click', () => { cancelImport(); takeUndo(t("s90")); state.rawEvents = makeDemoEvents(state.dayKey, resolvedZone()); state.completed = {}; state.selectedEventId = null; saveStore(true); render({ type: 'import', focusTimeline: true }); announceAction(t("s184"), false, true); });
  $('open-manual').addEventListener('click', () => { state.editingEventId = null; openManual(); });
  $('close-manual').addEventListener('click', closeManual);
  $('cancel-manual').addEventListener('click', closeManual);
  $('manual-dialog').addEventListener('cancel', (event) => { event.preventDefault(); closeManual(); });
  $('manual-form').addEventListener('submit', submitManual);
  $('toggle-complete').addEventListener('click', () => toggleCompletion(state.selectedEventId));
  $('edit-event').addEventListener('click', () => { if (!state.selectedEventId) return; state.editingEventId = state.selectedEventId; openManual(); });
  $('delete-event').addEventListener('click', deleteSelectedEvent);
  $('export-svg').addEventListener('click', exportSvg); $('export-png').addEventListener('click', exportPng);
  window.addEventListener('storage', event => {
    if (event.key === null || [sourceStorageKey, settingsStorageKey, storageKey()].includes(event.key)) {
      state.undoSnapshot = null;
      $('undo-action')?.remove();
      $('toast').classList.remove('is-visible');
      readStore(); render();
    }
  });
  setInterval(() => { state.now = new Date(); renderHeader(); updateNowLine(); }, 30000);
}

I18n.subscribe(() => {
  state.errors = state.errors.map(item => ({ ...item, text: I18n.retext(item.text) }));
  setImportBusy($('drop-zone').getAttribute('aria-busy') === 'true');
  const manualError = $('manual-form-error').textContent;
  const context = $('manual-context').textContent;
  const toast = $('toast').querySelector('span');
  if (toast) toast.textContent = I18n.retext(toast.textContent);
  if ($('undo-action')) $('undo-action').textContent = t('s106');
  render();
  if ($('manual-dialog').open) {
    $('manual-title').textContent = state.editingEventId ? t('s156') : t('s15');
    $('manual-form').querySelector('[type="submit"]').textContent = state.editingEventId ? t('s157') : t('s89');
    $('manual-context').textContent = I18n.retext(context);
    $('manual-form-error').textContent = I18n.retext(manualError);
  }
});
readStore();
$('day-picker').value = state.dayKey;
bindEvents();
render();

requestAnimationFrame(() => focusTimeline('events', false));
