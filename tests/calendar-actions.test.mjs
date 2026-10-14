import '../i18n.js';
I18n.setLocale('ru');
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../js/calendar-core.js', import.meta.url), 'utf8');
const core = await import(`data:text/javascript;base64,${Buffer.from(source.replace("import '../i18n.js';\n", '')).toString('base64')}`);
const { parseIcs, projectDay, findAvailableSlots, getEventFormValues, createTimedEvent, updateOccurrence, removeOccurrence } = core;
const DAY = '2026-10-14';
const ZONE = 'Europe/Moscow';
const series = (extra = '') => parseIcs(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:daily
DTSTART:20261014T090000Z
DTEND:20261014T100000Z
SUMMARY:встреча
LOCATION:кабинет
DESCRIPTION:заметка
RRULE:FREQ=DAILY;COUNT=3
${extra}
END:VEVENT
END:VCALENDAR`).events;
const replacement = (selected, values = {}) => createTimedEvent({ id: selected.id, title: 'изменено',
  start: `${DAY}T12:00`, end: `${DAY}T13:00`, source: 'ics', ...values }, ZONE, selected);

test('available slots merge overlapping busy events and include exact duration fits', () => {
  const events = [{ startMinute: 0, endMinute: 540 }, { startMinute: 600, endMinute: 700 },
    { startMinute: 650, endMinute: 1440 }];
  assert.deepEqual(findAvailableSlots(events, 60), [{ startMinute: 540, endMinute: 600, duration: 60, slotEndMinute: 600 }]);
  assert.deepEqual(findAvailableSlots(events, 90), []);
});

test('available slots handle empty and full days and ignore all-day notes', () => {
  assert.deepEqual(findAvailableSlots([], 30), [{ startMinute: 0, endMinute: 1440, duration: 1440, slotEndMinute: 30 }]);
  assert.equal(findAvailableSlots([{ allDay: true, startMinute: 0, endMinute: 1440 }], 60).length, 1);
  assert.deepEqual(findAvailableSlots([{ startMinute: 0, endMinute: 1440 }], 30), []);
  assert.equal(findAvailableSlots([{ startMinute: 0, endMinute: 1410 }], 30)[0].slotEndMinute, 1440);
  for (const duration of [0, -30, NaN, 1441, 1.5]) assert.throws(() => findAvailableSlots([], duration));
});

test('edit form shows original dates and seconds in the display timezone', () => {
  const events = series();
  const selected = projectDay(events, DAY, ZONE).events[0];
  assert.deepEqual(getEventFormValues(selected, ZONE), { startDate: DAY, start: '12:00', endDate: DAY, end: '13:00' });
  const overnight = { start: core.parseDateValue('20261013T230030Z'), end: core.parseDateValue('20261014T010015Z') };
  assert.deepEqual(getEventFormValues(overnight, 'UTC'), { startDate: '2026-10-13', start: '23:00:30', endDate: DAY, end: '01:00:15' });
});

test('new timed events are anchored to the selected timezone and support midnight', () => {
  const event = createTimedEvent({ id: 'night', title: 'ночь', start: `${DAY}T23:30`, end: '2026-10-15T00:00' }, ZONE);
  assert.equal(event.start.timestamp, Date.parse('2026-10-14T20:30:00Z'));
  assert.equal(projectDay([event], DAY, ZONE).events[0].endMinute, 1440);
  assert.equal(projectDay([event], '2026-10-15', ZONE).events.length, 0);
  assert.equal(projectDay([event], DAY, 'UTC').events[0].startMinute, 1230);
});

test('timed event validation rejects reversed, impossible and nonexistent DST dates', () => {
  const input = { id: 'test', title: 'тест', start: `${DAY}T09:00`, end: `${DAY}T10:00` };
  assert.throws(() => createTimedEvent({ ...input, end: `${DAY}T08:00` }, ZONE), /позже/);
  assert.throws(() => createTimedEvent({ ...input, start: '2026-02-30T09:00' }, ZONE), /дат/);
  assert.throws(() => createTimedEvent({ ...input, start: `${DAY}T25:00` }, ZONE), /врем/);
  assert.throws(() => createTimedEvent({ ...input, start: `${DAY}T09:00garbage` }, ZONE), /дат/);
  assert.throws(() => createTimedEvent({ ...input, start: '2026-03-08T02:30', end: '2026-03-08T04:00' }, 'America/New_York'), /переход|существует/);
});

test('text-only editing preserves an ambiguous DST instant and floating input', () => {
  const previous = { start: core.parseDateValue('20261101T063000Z'), end: core.parseDateValue('20261101T073000Z') };
  const edited = createTimedEvent({ id: 'fall', title: 'обновлено', start: '2026-11-01T01:30', end: '2026-11-01T02:30' }, 'America/New_York', previous);
  assert.deepEqual(edited.start, previous.start);
  assert.deepEqual(edited.end, previous.end);
  const withSeconds = createTimedEvent({ id: 'fall', title: 'обновлено', start: '2026-11-01T01:30:00', end: '2026-11-01T02:30:00' }, 'America/New_York', previous);
  assert.deepEqual(withSeconds.start, previous.start, 'zero seconds in a browser input must not resolve the ambiguous instant again');
  const floating = { start: `${DAY}T09:00`, end: `${DAY}T10:00` };
  const changed = createTimedEvent({ id: 'floating', title: 'текст', ...floating }, ZONE, floating);
  assert.equal(changed.start, floating.start);
});

test('projection carries the base id even when the raw id contains @', () => {
  const event = { id: 'manual@work', title: 'тест', start: `${DAY}T09:00`, end: `${DAY}T10:00` };
  assert.equal(projectDay([event], DAY, ZONE).events[0].baseId, 'manual@work');
});

test('editing one recurrence keeps the series, original instants, metadata and occurrence id', () => {
  const events = series(); const before = JSON.stringify(events);
  const selected = projectDay(events, DAY, ZONE).events[0];
  const updated = updateOccurrence(events, selected, replacement(selected, { location: 'новое место', description: 'новая заметка' }));
  assert.equal(JSON.stringify(events), before, 'undo snapshot must not be mutated');
  assert.equal(updated.length, 2);
  assert.deepEqual(updated[0].recurrence, events[0].recurrence);
  assert.deepEqual(updated[0].exdates, [selected.start]);
  const edited = projectDay(updated, DAY, ZONE).events;
  assert.equal(edited.length, 1);
  assert.equal(edited[0].id, selected.id);
  assert.equal(edited[0].title, 'изменено');
  assert.equal(edited[0].location, 'новое место');
  assert.equal(edited[0].startMinute, 720);
  assert.equal(projectDay(updated, '2026-10-15', ZONE).events[0].title, 'встреча');
  assert.equal(projectDay(updated, '2026-10-16', ZONE).events.length, 1);
  assert.equal(projectDay(updated, '2026-10-17', ZONE).events.length, 0);
});

test('moving an occurrence to another day neither duplicates it nor changes neighbours', () => {
  const events = series(); const selected = projectDay(events, DAY, ZONE).events[0];
  const updated = updateOccurrence(events, selected, replacement(selected, { start: '2026-10-15T14:00', end: '2026-10-15T15:00' }));
  assert.equal(projectDay(updated, DAY, ZONE).events.length, 0);
  assert.equal(projectDay(updated, '2026-10-15', ZONE).events.length, 2);
  const restored = JSON.parse(JSON.stringify(updated));
  const moved = projectDay(restored, '2026-10-15', ZONE).events.find(e => e.id === selected.id);
  const twice = updateOccurrence(restored, moved, replacement(moved, { start: '2026-10-15T14:00', end: '2026-10-15T15:00', title: 'ещё раз' }));
  assert.equal(twice.length, 2);
  assert.equal(projectDay(twice, '2026-10-15', ZONE).events.find(e => e.id === selected.id).title, 'ещё раз');
});

test('deletion excludes one occurrence and preserves existing EXDATE and COUNT', () => {
  const events = series('EXDATE:20261015T090000Z'); const before = JSON.stringify(events);
  const selected = projectDay(events, DAY, ZONE).events[0];
  const deleted = removeOccurrence(events, selected);
  assert.equal(JSON.stringify(events), before);
  assert.equal(deleted[0].exdates.length, 2);
  assert.equal(projectDay(deleted, DAY, ZONE).events.length, 0);
  assert.equal(projectDay(deleted, '2026-10-15', ZONE).events.length, 0);
  assert.equal(projectDay(deleted, '2026-10-16', ZONE).events.length, 1);
});

test('all-day recurring deletion only removes the selected day', () => {
  const { events } = parseIcs('BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:note\nSUMMARY:заметка\nDTSTART;VALUE=DATE:20261014\nRRULE:FREQ=DAILY;COUNT=3\nEND:VEVENT\nEND:VCALENDAR');
  const deleted = removeOccurrence(events, projectDay(events, DAY, ZONE).events[0]);
  assert.equal(projectDay(deleted, DAY, ZONE).events.length, 0);
  assert.equal(projectDay(deleted, '2026-10-15', ZONE).events.length, 1);
});

test('non-recurring actions preserve ids containing @ and fail safely on stale selections', () => {
  const events = [{ id: 'manual@work', title: 'тест', start: `${DAY}T09:00`, end: `${DAY}T10:00` }];
  const selected = projectDay(events, DAY, ZONE).events[0];
  const updated = updateOccurrence(events, selected, replacement(selected));
  assert.equal(updated.length, 1);
  assert.equal(updated[0].id, 'manual@work');
  assert.deepEqual(removeOccurrence(updated, projectDay(updated, DAY, ZONE).events[0]), []);
  assert.throws(() => updateOccurrence([], selected, replacement(selected)), /найден/);
  assert.throws(() => removeOccurrence([], selected), /найден/);
  assert.throws(() => removeOccurrence(events, null), /найден/);
});
