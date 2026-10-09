/* Pure, dependency-free calendar model used by the browser UI and Node tests. */

const DAY_MS = 86400000;
const DAY_MINUTES = 1440;
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function validZone(zone) {
  const value = zone || 'UTC';
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(); }
  catch { throw new Error(`неизвестный часовой пояс: ${value}`); }
  return value;
}

function validDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw new Error(`не понимаю дату: ${value}`);
  const [y, m, d] = String(value).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new Error(`не понимаю дату: ${value}`);
  }
  return String(value);
}

function dateParts(value) {
  if (typeof value !== 'string') throw new Error(`не понимаю дату: ${value}`);
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`не понимаю дату: ${value}`);
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error(`не понимаю дату: ${value}`);
  }
  return { year, month, day };
}

function keyFromParts({ year, month, day }) {
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function addDays(key, count) {
  const p = dateParts(key);
  return keyFromParts({ ...p, ...(() => {
    const date = new Date(Date.UTC(p.year, p.month - 1, p.day + count));
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
  })() });
}

function dayDistance(a, b) {
  return Math.round((Date.UTC(dateParts(b).year, dateParts(b).month - 1, dateParts(b).day) -
    Date.UTC(dateParts(a).year, dateParts(a).month - 1, dateParts(a).day)) / DAY_MS);
}

function weekdayOf(key) {
  const p = dateParts(key);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

function wallKey(timeStamp, zone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: validZone(zone), year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(timeStamp));
  const map = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  return { dateKey: `${map.year}-${map.month}-${map.day}`, hour: +map.hour, minute: +map.minute, second: +map.second };
}

function zoneOffsetMillis(timeStamp, zone) {
  const p = wallKey(timeStamp, zone);
  const utcWall = Date.UTC(+p.dateKey.slice(0, 4), +p.dateKey.slice(5, 7) - 1, +p.dateKey.slice(8), p.hour, p.minute, p.second);
  return utcWall - Math.floor(timeStamp / 1000) * 1000;
}

function wallToTimestamp(parts, zone) {
  const tz = validZone(zone);
  const base = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour || 0, parts.minute || 0, parts.second || 0);
  let guess = base;
  for (let i = 0; i < 4; i += 1) guess = base - zoneOffsetMillis(guess, tz);
  return guess;
}

function descriptorFromWall(dateKey, hour, minute, second, zone, extra = {}) {
  const p = dateParts(dateKey);
  const descriptor = {
    allDay: false, floating: !zone, zone: zone || null,
    year: p.year, month: p.month, day: p.day, hour, minute, second,
    dateKey, time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second || 0).padStart(2, '0')}`,
    ...extra
  };
  descriptor.timestamp = descriptor.floating ? null : wallToTimestamp(descriptor, descriptor.zone);
  return descriptor;
}

function allDayDescriptor(dateKey, zone = null) {
  const p = dateParts(dateKey);
  return { allDay: true, floating: true, zone: zone || null, year: p.year, month: p.month, day: p.day,
    hour: 0, minute: 0, second: 0, dateKey, time: '00:00:00', timestamp: null };
}

function descriptorWall(desc, fallbackZone) {
  if (!desc) return null;
  if (desc.allDay) return { dateKey: desc.dateKey || keyFromParts(desc), hour: 0, minute: 0, second: 0 };
  if (typeof desc === 'string') return descriptorWall(parseLocalInput(desc), fallbackZone);
  if (desc.year && desc.month && desc.day) return { dateKey: keyFromParts(desc), hour: desc.hour || 0, minute: desc.minute || 0, second: desc.second || 0 };
  if (Number.isFinite(desc.timestamp)) return wallKey(desc.timestamp, fallbackZone || desc.zone || 'UTC');
  return null;
}

function descriptorTimestamp(desc, fallbackZone) {
  if (!desc) return NaN;
  if (typeof desc === 'string') return descriptorTimestamp(parseLocalInput(desc), fallbackZone);
  if (Number.isFinite(desc.timestamp)) return desc.timestamp;
  const wall = descriptorWall(desc, fallbackZone);
  if (!wall) return NaN;
  const p = dateParts(wall.dateKey);
  return wallToTimestamp({ ...p, hour: wall.hour, minute: wall.minute, second: wall.second }, desc.zone || fallbackZone || 'UTC');
}

function parseLocalInput(value) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) throw new Error(`не понимаю дату: ${value}`);
  return descriptorFromWall(`${match[1]}-${match[2]}-${match[3]}`, +match[4], +match[5], +(match[6] || 0), null);
}

export function unfoldIcs(input) {
  return String(input ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n').reduce((out, line) => {
    if (/^[ \t]/.test(line) && out.length) out[out.length - 1] += line.slice(1);
    else out.push(line);
    return out;
  }, []).join('\n');
}

function splitHeader(header) {
  const parts = []; let current = ''; let quoted = false;
  for (const ch of header) {
    if (ch === '"') quoted = !quoted;
    if (ch === ';' && !quoted) { parts.push(current); current = ''; } else current += ch;
  }
  parts.push(current);
  return parts;
}

function unescapeText(value) {
  return String(value).replace(/\\([nN])/g, '\n').replace(/\\([rR])/g, '\r').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

export function parseProperty(line) {
  let index = -1; let quoted = false;
  for (let i = 0; i < String(line).length; i += 1) {
    const ch = String(line)[i];
    if (ch === '"') quoted = !quoted;
    if (ch === ':' && !quoted) { index = i; break; }
  }
  if (index < 1) throw new Error(`не понимаю строку ICS: ${line}`);
  const header = String(line).slice(0, index);
  const [namePart, ...paramParts] = splitHeader(header);
  const params = {};
  for (const param of paramParts) {
    const eq = param.indexOf('=');
    if (eq < 1) continue;
    const key = param.slice(0, eq).toUpperCase();
    let value = param.slice(eq + 1);
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1).replace(/\\"/g, '"');
    params[key] = value;
  }
  return { name: namePart.toUpperCase(), params, value: unescapeText(String(line).slice(index + 1)), rawValue: String(line).slice(index + 1) };
}

export function parseDuration(value) {
  const text = String(value).trim();
  const match = text.match(/^P(?:(\d+)W|(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?)$/i);
  if (!match || text === 'P' || /^P(?:T)?$/i.test(text)) throw new Error(`не понимаю длительность: ${value}`);
  const seconds = (Number(match[1] || 0) * 7 + Number(match[2] || 0)) * 86400 +
    Number(match[3] || 0) * 3600 + Number(match[4] || 0) * 60 + Number(match[5] || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`не понимаю длительность: ${value}`);
  return seconds;
}

export function parseDateValue(value, params = {}, fallbackZone = 'UTC') {
  const source = String(value).trim();
  const opts = Object.fromEntries(Object.entries(params || {}).map(([k, v]) => [String(k).toUpperCase(), v]));
  if (opts.VALUE === 'DATE' || /^\d{8}$/.test(source)) {
    if (!/^\d{8}$/.test(source)) throw new Error(`не понимаю дату: ${value}`);
    const key = `${source.slice(0, 4)}-${source.slice(4, 6)}-${source.slice(6, 8)}`;
    dateParts(key);
    return allDayDescriptor(key, opts.TZID || null);
  }
  const match = source.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/i);
  if (!match) throw new Error(`не понимаю дату: ${value}`);
  const [, y, mo, d, h, mi, s, z] = match;
  const key = `${y}-${mo}-${d}`;
  dateParts(key);
  if (+h > 23 || +mi > 59 || +s > 59) throw new Error(`не понимаю время: ${value}`);
  const zone = z ? 'UTC' : (opts.TZID || null);
  if (zone) validZone(zone);
  const descriptor = descriptorFromWall(key, +h, +mi, +s, zone);
  if (z) descriptor.timestamp = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  if (!zone) { descriptor.floating = true; descriptor.timestamp = null; }
  return descriptor;
}

function hashId(value) {
  let hash = 2166136261;
  for (const ch of String(value)) { hash ^= ch.codePointAt(0); hash = Math.imul(hash, 16777619); }
  return `evt-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function parseRRule(value, errors) {
  const rule = { invalid: false };
  for (const part of String(value).split(';')) {
    const [rawKey, ...rest] = part.split('='); const key = rawKey?.toUpperCase(); const val = rest.join('=');
    if (!key || !val) continue;
    if (key === 'FREQ') rule.freq = val.toUpperCase();
    else if (key === 'INTERVAL' || key === 'COUNT') rule[key.toLowerCase()] = Number(val);
    else if (key === 'UNTIL') {
      rule.untilRaw = val;
      try { parseDateValue(val); }
      catch { errors.push('UNTIL повторения имеет неверный формат'); rule.invalid = true; }
    }
    else if (key === 'BYDAY') rule.byday = val.split(',').map(v => v.toUpperCase());
    else { errors.push(`параметр RRULE ${key} не поддерживается`); rule.invalid = true; }
  }
  if (!['DAILY', 'WEEKLY'].includes(rule.freq)) { errors.push(`повторение ${rule.freq || 'без частоты'} не поддерживается`); rule.invalid = true; }
  if (rule.interval !== undefined && (!Number.isInteger(rule.interval) || rule.interval < 1)) { errors.push('интервал повторения должен быть положительным'); rule.invalid = true; }
  if (rule.count !== undefined && (!Number.isInteger(rule.count) || rule.count < 1)) { errors.push('COUNT повторения должен быть положительным'); rule.invalid = true; }
  if (rule.byday && rule.byday.some(day => !WEEKDAYS.includes(day))) { errors.push('BYDAY содержит неизвестный день'); rule.invalid = true; }
  return rule;
}

function valueAt(properties, name) { return [...properties].reverse().find(p => p.name === name); }

export function parseIcs(input) {
  const errors = []; const text = unfoldIcs(input); const lines = text.split('\n'); const blocks = [];
  let active = null;
  for (const line of lines) {
    if (line.toUpperCase() === 'BEGIN:VEVENT') { if (active) errors.push('вложенный блок события'); active = []; continue; }
    if (line.toUpperCase() === 'END:VEVENT') { if (!active) errors.push('закрыт незакрытый блок события'); else blocks.push(active); active = null; continue; }
    if (active) active.push(line);
  }
  if (active) errors.push('событие не завершено');
  if (!blocks.length) { if (!/BEGIN:VCALENDAR/i.test(text)) errors.push('это не календарный ICS-файл'); else errors.push('в ICS нет событий'); }
  const events = [];
  const usedIds = new Map();
  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const block = blocks[blockIndex];
    try {
      const properties = [];
      for (const line of block.filter(Boolean)) {
        try { properties.push(parseProperty(line)); }
        catch (error) { errors.push(`строка события пропущена: ${error.message}`); }
      }
      const startProp = valueAt(properties, 'DTSTART');
      if (!startProp) throw new Error('у события нет DTSTART');
      const start = parseDateValue(startProp.rawValue, startProp.params);
      const endProp = valueAt(properties, 'DTEND'); const durationProp = valueAt(properties, 'DURATION');
      let end; let durationSeconds = null;
      if (endProp) {
        end = parseDateValue(endProp.rawValue, endProp.params);
        if (end.allDay !== start.allDay) throw new Error('концы all-day и timed события смешаны');
      } else if (durationProp) {
        durationSeconds = parseDuration(durationProp.value);
        if (start.allDay) end = allDayDescriptor(addDays(start.dateKey, Math.ceil(durationSeconds / 86400)), start.zone);
        else {
          const wall = descriptorWall(start); const total = wall.hour * 3600 + wall.minute * 60 + wall.second + durationSeconds;
          const date = addDays(wall.dateKey, Math.floor(total / 86400)); const rem = ((total % 86400) + 86400) % 86400;
          end = descriptorFromWall(date, Math.floor(rem / 3600), Math.floor((rem % 3600) / 60), rem % 60, start.zone);
        }
      } else if (start.allDay) end = allDayDescriptor(addDays(start.dateKey, 1), start.zone);
      else throw new Error('у события нет DTEND или DURATION');
      const sTs = descriptorTimestamp(start, start.zone || 'UTC'); const eTs = descriptorTimestamp(end, end.zone || start.zone || 'UTC');
      if (start.allDay ? dayDistance(start.dateKey, end.dateKey) <= 0 : !(eTs > sTs)) throw new Error('конец события должен быть позже начала');
      const uid = valueAt(properties, 'UID')?.value?.trim();
      const title = valueAt(properties, 'SUMMARY')?.value || 'без названия';
      const recurrenceProp = valueAt(properties, 'RRULE');
      const recurrence = recurrenceProp ? parseRRule(recurrenceProp.value, errors) : null;
      const exdates = properties.filter(p => p.name === 'EXDATE').map(p => {
        try { return p.value.split(',').map(v => parseDateValue(v, p.params)); } catch { errors.push('не понимаю EXDATE'); return []; }
      }).flat();
      const stable = uid || `${start.dateKey || ''}/${start.time || ''}/${end.dateKey || ''}/${end.time || ''}`;
      const baseId = uid ? hashId(`uid:${uid}`) : hashId(`nouid:${blockIndex}:${stable}`);
      const baseCount = (usedIds.get(baseId) || 0) + 1;
      usedIds.set(baseId, baseCount);
      const id = `${baseId}${baseCount > 1 ? `~${baseCount}` : ''}`;
      events.push({ id, uid: uid || null,
        title, description: valueAt(properties, 'DESCRIPTION')?.value || '', location: valueAt(properties, 'LOCATION')?.value || '',
        source: 'ics', completed: false, allDay: start.allDay, start, end, durationSeconds,
        recurrence: recurrence ? { ...recurrence, raw: recurrenceProp.value } : null, exdates,
        originalStart: start, originalEnd: end });
    } catch (error) { errors.push(`событие пропущено: ${error.message}`); }
  }
  return { events, errors };
}

function recurrenceUntil(rule, event) {
  if (!rule?.untilRaw) return null;
  try { return parseDateValue(rule.untilRaw, {}, event.start.zone || null); } catch { return null; }
}

function countDailyMatches(kMax, startDate, interval, bydays) {
  if (kMax < 0) return 0;
  const total = Math.floor(kMax) + 1;
  if (!bydays?.length) return total;
  const period = 7 / gcd(7, interval);
  let perPeriod = 0;
  for (let i = 0; i < period; i += 1) {
    if (bydays.includes((weekdayOf(startDate) + i * interval) % 7)) perPeriod += 1;
  }
  const full = Math.floor(total / period); const rem = total % period;
  let out = full * perPeriod;
  for (let i = 0; i < rem; i += 1) if (bydays.includes((weekdayOf(startDate) + i * interval) % 7)) out += 1;
  return out;
}

function gcd(a, b) { while (b) { const t = a % b; a = b; b = t; } return Math.abs(a); }

function ceilDiv(a, b) { return Math.floor((a + b - 1) / b); }

function sourceWall(event) {
  return descriptorWall(event.start, event.start.zone || 'UTC');
}

function occurrenceKey(desc) {
  const wall = descriptorWall(desc, desc.zone || 'UTC');
  return `${wall.dateKey}T${String(wall.hour).padStart(2, '0')}:${String(wall.minute).padStart(2, '0')}:${String(wall.second || 0).padStart(2, '0')}`;
}

function makeOccurrence(event, dateKey, sourceZone, sourceWallStart) {
  if (event.start.allDay) {
    const start = allDayDescriptor(dateKey, event.start.zone);
    const days = Math.max(1, dayDistance(event.start.dateKey, event.end.dateKey));
    const end = allDayDescriptor(addDays(dateKey, days), event.end.zone);
    return { ...event, id: `${event.id}@${dateKey}`, occurrenceId: dateKey, start, end, originalStart: start, originalEnd: end };
  }
  const start = descriptorFromWall(dateKey, sourceWallStart.hour, sourceWallStart.minute, sourceWallStart.second, event.start.zone || null);
  const duration = event.durationSeconds || Math.max(1, Math.round((descriptorTimestamp(event.end, sourceZone) - descriptorTimestamp(event.start, sourceZone)) / 1000));
  const total = sourceWallStart.hour * 3600 + sourceWallStart.minute * 60 + sourceWallStart.second + duration;
  const endDate = addDays(dateKey, Math.floor(total / 86400)); const rem = ((total % 86400) + 86400) % 86400;
  const end = descriptorFromWall(endDate, Math.floor(rem / 3600), Math.floor((rem % 3600) / 60), rem % 60, event.end.zone || event.start.zone || null);
  return { ...event, id: `${event.id}@${occurrenceKey(start)}`, occurrenceId: occurrenceKey(start), start, end, originalStart: start, originalEnd: end };
}

function exdateMatches(event, candidate) {
  const candidateKey = occurrenceKey(candidate.start);
  const candidateTimestamp = candidate.start.allDay ? null : descriptorTimestamp(candidate.start, candidate.start.zone || 'UTC');
  return (event.exdates || []).some(date => occurrenceKey(date) === candidateKey ||
    (date.allDay && candidate.start.allDay && date.dateKey === candidate.start.dateKey) ||
    (candidateTimestamp !== null && !date.allDay && Number.isFinite(descriptorTimestamp(date, candidate.start.zone || 'UTC')) && descriptorTimestamp(date, candidate.start.zone || 'UTC') === candidateTimestamp));
}

export function expandEventForDay(event, dayKey, timeZone = 'UTC') {
  validDateKey(dayKey); validZone(timeZone);
  const recurrence = event.recurrence;
  if (!recurrence) {
    const candidate = { ...event, id: event.id, occurrenceId: occurrenceKey(event.start) };
    const startTs = event.start.allDay ? null : descriptorTimestamp(event.start, timeZone);
    const endTs = event.end.allDay ? null : descriptorTimestamp(event.end, timeZone);
    const intersects = event.start.allDay ? dayDistance(event.start.dateKey, dayKey) >= 0 && dayDistance(dayKey, event.end.dateKey) > 0 :
      endTs > wallToTimestamp({ ...dateParts(dayKey), hour: 0, minute: 0, second: 0 }, timeZone) && startTs < wallToTimestamp({ ...dateParts(addDays(dayKey, 1)), hour: 0, minute: 0, second: 0 }, timeZone);
    return intersects ? [candidate] : [];
  }
  const freq = recurrence.freq;
  if (recurrence.invalid || !['DAILY', 'WEEKLY'].includes(freq)) {
    const candidate = { ...event, id: event.id, occurrenceId: occurrenceKey(event.start) };
    const startTs = event.start.allDay ? null : descriptorTimestamp(event.start, timeZone);
    const endTs = event.end.allDay ? null : descriptorTimestamp(event.end, timeZone);
    const intersects = event.start.allDay ? dayDistance(event.start.dateKey, dayKey) >= 0 && dayDistance(dayKey, event.end.dateKey) > 0 :
      endTs > wallToTimestamp({ ...dateParts(dayKey), hour: 0, minute: 0, second: 0 }, timeZone) && startTs < wallToTimestamp({ ...dateParts(addDays(dayKey, 1)), hour: 0, minute: 0, second: 0 }, timeZone);
    return intersects ? [candidate] : [];
  }
  const source = sourceWall(event); const sourceZone = event.start.zone || timeZone;
  const displayStart = wallToTimestamp({ ...dateParts(dayKey), hour: 0, minute: 0, second: 0 }, timeZone);
  const displayEnd = wallToTimestamp({ ...dateParts(addDays(dayKey, 1)), hour: 0, minute: 0, second: 0 }, timeZone);
  const sourceRangeStart = addDays(wallKey(displayStart, sourceZone).dateKey, -2);
  const sourceRangeEnd = addDays(wallKey(displayEnd, sourceZone).dateKey, 2);
  const startDate = source.dateKey; const interval = recurrence.interval || 1; const until = recurrenceUntil(recurrence, event);
  const bydays = recurrence.byday?.map(d => WEEKDAYS.indexOf(d)).filter(n => n >= 0);
  const rangeStart = sourceRangeStart; const rangeEnd = sourceRangeEnd;
  const candidates = [];
  const untilTs = until ? (until.allDay
    ? wallToTimestamp({ ...dateParts(until.dateKey), hour: 23, minute: 59, second: 59 }, sourceZone)
    : descriptorTimestamp(until, sourceZone)) : Infinity;
  const addCandidate = (dateKey, ordinal) => {
    if (dateKey < startDate || dateKey < rangeStart || dateKey > rangeEnd) return;
    if (Number.isInteger(recurrence.count) && recurrence.count > 0 && ordinal >= recurrence.count) return;
    const occurrence = makeOccurrence(event, dateKey, sourceZone, source);
    if (descriptorTimestamp(occurrence.start, sourceZone) > untilTs) return;
    if (!exdateMatches(event, occurrence)) candidates.push(occurrence);
  };

  if (freq === 'DAILY') {
    // Jump directly to the first interval date in the display range. This avoids
    // walking every day for calendars whose DTSTART is years in the past.
    const firstOffset = Math.max(0, dayDistance(startDate, rangeStart));
    let k = Math.max(0, ceilDiv(firstOffset, interval));
    while (true) {
      const dateKey = addDays(startDate, k * interval);
      if (dateKey > rangeEnd) break;
      const weekday = weekdayOf(dateKey);
      if (!bydays?.length || bydays.includes(weekday)) addCandidate(dateKey, countDailyMatches(k - 1, startDate, interval, bydays));
      k += 1;
    }
  } else {
    const startWeek = addDays(startDate, -((weekdayOf(startDate) + 6) % 7));
    const firstWeek = addDays(rangeStart, -((weekdayOf(rangeStart) + 6) % 7));
    const weekOffset = Math.max(0, Math.floor(dayDistance(startWeek, firstWeek) / 7));
    const weekIndex = Math.max(0, ceilDiv(weekOffset, interval));
    const days = (bydays?.length ? bydays : [weekdayOf(startDate)]).slice().sort((a, b) => a - b);
    const firstWeekDays = days.filter(day => day >= weekdayOf(startDate));
    for (let wi = weekIndex; ; wi += 1) {
      const week = addDays(startWeek, wi * interval * 7);
      if (week > rangeEnd) break;
      const allowed = wi === 0 ? firstWeekDays : days;
      for (const weekday of allowed) {
        const dateKey = addDays(week, (weekday + 6) % 7);
        if (dateKey < startDate || dateKey < rangeStart || dateKey > rangeEnd) continue;
        const ordinal = wi === 0
          ? firstWeekDays.indexOf(weekday)
          : firstWeekDays.length + (wi - 1) * days.length + days.indexOf(weekday);
        addCandidate(dateKey, ordinal);
      }
    }
  }
  return candidates.filter(instance => expandEventForDay({ ...instance, recurrence: null }, dayKey, timeZone).length);
}

export function assignLanes(events = []) {
  const sorted = events.map((event, index) => ({ event, index })).sort((a, b) => a.event.startMinute - b.event.startMinute || a.event.endMinute - b.event.endMinute || String(a.event.id).localeCompare(String(b.event.id)));
  const laneEnds = []; const output = [];
  for (const item of sorted) {
    const e = item.event; let lane = laneEnds.findIndex(end => end <= e.startMinute); if (lane < 0) { lane = laneEnds.length; laneEnds.push(0); }
    laneEnds[lane] = e.endMinute;
    const overlap = sorted.some(other => other !== item && other.event.startMinute < e.endMinute && e.startMinute < other.event.endMinute);
    output.push({ ...e, lane, overlap });
  }
  return output;
}

export function computeFreeWindows(events = []) {
  const intervals = events.filter(e => e.endMinute > e.startMinute).map(e => [Math.max(0, e.startMinute), Math.min(DAY_MINUTES, e.endMinute)]).filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const merged = []; for (const [start, end] of intervals) { const last = merged.at(-1); if (last && start <= last[1]) last[1] = Math.max(last[1], end); else merged.push([start, end]); }
  const windows = []; let cursor = 0;
  for (const [start, end] of merged) { if (start > cursor) windows.push({ startMinute: cursor, endMinute: start, duration: start - cursor }); cursor = Math.max(cursor, end); }
  if (cursor < DAY_MINUTES) windows.push({ startMinute: cursor, endMinute: DAY_MINUTES, duration: DAY_MINUTES - cursor });
  return windows;
}

function displayInterval(instance, dayKey, zone) {
  const startTs = descriptorTimestamp(instance.start, zone); const endTs = descriptorTimestamp(instance.end, zone);
  const startWall = wallKey(startTs, zone); const endWall = wallKey(endTs, zone);
  const startMinute = dayDistance(dayKey, startWall.dateKey) * DAY_MINUTES + startWall.hour * 60 + startWall.minute + startWall.second / 60;
  const endMinute = dayDistance(dayKey, endWall.dateKey) * DAY_MINUTES + endWall.hour * 60 + endWall.minute + endWall.second / 60;
  return { startMinute: Math.max(0, Math.floor(startMinute)), endMinute: Math.min(DAY_MINUTES, Math.ceil(endMinute)), clippedStart: startMinute < 0, clippedEnd: endMinute > DAY_MINUTES };
}

function serializedTimestamp(desc, zone) {
  if (!desc) return null;
  if (desc.allDay) return desc.dateKey;
  const timestamp = descriptorTimestamp(desc, zone);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function projectDay(events = [], dayKey, timeZone = 'UTC') {
  validDateKey(dayKey); validZone(timeZone);
  const expanded = events.flatMap(event => expandEventForDay(event, dayKey, timeZone));
  const projectedAllDay = []; const timed = [];
  for (const instance of expanded) {
    const base = { ...instance,
      originalStart: serializedTimestamp(instance.originalStart || instance.start, timeZone),
      originalEnd: serializedTimestamp(instance.originalEnd || instance.end, timeZone) };
    if (instance.start.allDay) {
      projectedAllDay.push({ ...base, allDay: true, startMinute: 0, endMinute: DAY_MINUTES, duration: DAY_MINUTES, lane: 0, overlap: false });
    } else {
      const interval = displayInterval(instance, dayKey, timeZone);
      if (interval.endMinute > interval.startMinute) timed.push({ ...base, allDay: false, ...interval, duration: interval.endMinute - interval.startMinute });
    }
  }
  const timedEvents = assignLanes(timed); const allDayEvents = projectedAllDay; const projected = [...allDayEvents, ...timedEvents];
  const freeWindows = computeFreeWindows([...timedEvents, ...allDayEvents]); const occupiedMinutes = DAY_MINUTES - freeWindows.reduce((sum, item) => sum + item.duration, 0);
  return { events: projected, timedEvents, allDayEvents, freeWindows, occupiedMinutes, freeMinutes: DAY_MINUTES - occupiedMinutes,
    laneCount: timedEvents.reduce((max, event) => Math.max(max, event.lane + 1), 0), errors: [] };
}

export function formatMinutes(minutes) {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  return `${Math.floor(value / 60).toString().padStart(2, '0')}:${(value % 60).toString().padStart(2, '0')}`;
}

export function makeDemoEvents(dayKey, timeZone = 'UTC') {
  validDateKey(dayKey); validZone(timeZone);
  const create = (id, title, start, end, extra = {}) => ({ id, title, source: 'demo', completed: false,
    start: descriptorFromWall(dayKey, ...start, timeZone), end: descriptorFromWall(dayKey, ...end, timeZone), ...extra });
  return [
    create('demo-departure', 'старт дня', [8, 30, 0], [9, 15, 0]),
    create('demo-focus', 'фокусная платформа', [9, 0, 0], [10, 30, 0]),
    create('demo-lunch', 'перерыв на станции', [12, 20, 0], [13, 0, 0]),
    create('demo-review', 'вечерний обзор', [17, 45, 0], [18, 15, 0]),
    { id: 'demo-all-day', title: 'день без спешки', source: 'demo', completed: false, allDay: true,
      start: allDayDescriptor(dayKey, timeZone), end: allDayDescriptor(addDays(dayKey, 1), timeZone) }
  ];
}

export { DAY_MINUTES };
