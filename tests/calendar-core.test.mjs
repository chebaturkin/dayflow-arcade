import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// A data URL keeps these browser modules independent of package.json.
const source = await readFile(new URL('../js/calendar-core.js', import.meta.url), 'utf8').catch(() => '');
const core = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const { unfoldIcs, parseProperty, parseDateValue, parseDuration, parseIcs,
  expandEventForDay, projectDay, assignLanes, computeFreeWindows, formatMinutes, makeDemoEvents } = core;
const DAY = '2026-10-08';
const ZONE = 'Europe/Moscow';
const ics = (...events) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.join('\r\n')}\r\nEND:VCALENDAR`;
const event = (lines) => `BEGIN:VEVENT\r\n${lines.join('\r\n')}\r\nEND:VEVENT`;
const timed = (extra = [], start = '20261008T090000', end = '20261008T100000') =>
  event(['UID:test-event', `DTSTART:${start}`, `DTEND:${end}`, 'SUMMARY:Утренний поезд', ...extra]);

test('unfolds BOM, CRLF and continuation whitespace', () => {
  assert.equal(unfoldIcs('\uFEFFBEGIN:VCALENDAR\r\nSUMMARY:Длинное\r\n  название\r\n\t станции\r\nEND:VCALENDAR'),
    'BEGIN:VCALENDAR\nSUMMARY:Длинное название станции\nEND:VCALENDAR');
});

test('reads property parameters, quoted colon and escaped text', () => {
  const property = parseProperty('DESCRIPTION;ALTREP="cid:part1.0001@example.org":Первая\\nВторая\\, третья\\; путь\\\\дом');
  assert.equal(property.name, 'DESCRIPTION');
  assert.equal(property.params.ALTREP, 'cid:part1.0001@example.org');
  assert.equal(property.value, 'Первая\nВторая, третья; путь\\дом');
});

test('parses UTC and leaves floating datetime independent of host timezone', () => {
  assert.equal(parseDateValue('20261008T060000Z').timestamp, Date.parse('2026-10-08T06:00:00Z'));
  assert.equal(parseDateValue('20261008T090000').floating, true);
  assert.equal(parseDateValue('20261008', { VALUE: 'DATE' }).allDay, true);
});

test('resolves IANA TZID and rejects impossible dates and unknown zones', () => {
  assert.equal(parseDateValue('20261008T090000', { TZID: ZONE }).timestamp, Date.parse('2026-10-08T06:00:00Z'));
  assert.throws(() => parseDateValue('20260230T090000'), /дат/i);
  assert.throws(() => parseDateValue('20261008T250000'), /врем|дат/i);
  assert.throws(() => parseDateValue('20261008T090000', { TZID: 'Fake/Zone' }), /пояс/i);
});

test('parses duration and rejects invalid or negative duration', () => {
  assert.equal(parseDuration('P1DT2H30M'), 95400);
  assert.equal(parseDuration('PT45M'), 2700);
  assert.equal(parseDuration('P2W'), 1209600);
  assert.throws(() => parseDuration('tomorrow'));
  assert.throws(() => parseDuration('-PT1H'));
  assert.throws(() => parseDuration('P'));
});

test('preserves escaped title and folded description without creating HTML', () => {
  const result = parseIcs(ics(timed(['DESCRIPTION:Первый\\nвторой', 'LOCATION:Зал\\, 2', 'SUMMARY:<img onerror=x>\\; билет'])));
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].title, '<img onerror=x>; билет');
  assert.equal(result.events[0].description, 'Первый\nвторой');
  assert.equal(result.events[0].location, 'Зал, 2');
});

test('projects UTC, floating and timezone events into selected timezone', () => {
  const result = parseIcs(ics(
    timed([], '20261008T060000Z', '20261008T070000Z'),
    event(['UID:zoned', `DTSTART;TZID=${ZONE}:20261008T110000`, `DTEND;TZID=${ZONE}:20261008T120000`]),
    event(['UID:floating', 'DTSTART:20261008T130000', 'DTEND:20261008T133000'])
  ));
  assert.equal(result.errors.length, 0);
  assert.deepEqual(projectDay(result.events, DAY, ZONE).timedEvents.map(e => [e.startMinute, e.endMinute]),
    [[540, 600], [660, 720], [780, 810]]);
  assert.deepEqual(projectDay(result.events.slice(2), DAY, 'UTC').timedEvents.map(e => [e.startMinute, e.endMinute]), [[780, 810]]);
});

test('all-day DTEND is exclusive and missing DTEND means one day', () => {
  const result = parseIcs(ics(
    event(['UID:trip', 'DTSTART;VALUE=DATE:20261007', 'DTEND;VALUE=DATE:20261009', 'SUMMARY:Поездка']),
    event(['UID:one-day', 'DTSTART;VALUE=DATE:20261008'])
  ));
  assert.equal(projectDay(result.events, DAY, ZONE).allDayEvents.length, 2);
  assert.equal(projectDay(result.events, '2026-10-09', ZONE).events.length, 0);
  assert.equal(projectDay(result.events, DAY, ZONE).freeMinutes, 0, 'all-day events occupy the whole day');
});

test('uses DURATION instead of DTEND', () => {
  const result = parseIcs(ics(event(['UID:duration', 'DTSTART:20261008T090000', 'DURATION:PT45M'])));
  assert.deepEqual(projectDay(result.events, DAY, ZONE).events.map(e => [e.startMinute, e.endMinute]), [[540, 585]]);
});

test('clips intervals crossing midnight and keeps original times', () => {
  const result = parseIcs(ics(timed([], '20261007T233000', '20261008T003000'),
    event(['UID:late', 'DTSTART:20261008T233000', 'DTEND:20261009T010000'])));
  const projected = projectDay(result.events, DAY, ZONE).timedEvents;
  assert.deepEqual(projected.map(e => [e.startMinute, e.endMinute]), [[0, 30], [1410, 1440]]);
  assert.equal(projected[0].clippedStart, true);
  assert.equal(projected[1].clippedEnd, true);
  assert.equal(projected[0].originalStart, '2026-10-07T20:30:00.000Z');
});

test('keeps valid events when another block is malformed', () => {
  const result = parseIcs(ics(timed(), event(['DTSTART:bad', 'DTEND:bad']), event(['DTSTART:20261008T100000'])));
  assert.equal(result.events.length, 1);
  assert.equal(result.errors.length, 2);
  assert.match(result.errors.join(' '), /событи/i);
});

test('reports files without calendar events and unterminated blocks', () => {
  assert.equal(parseIcs('not a calendar').events.length, 0);
  assert.ok(parseIcs('not a calendar').errors.length > 0);
  assert.ok(parseIcs('BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20261008T090000').errors.length > 0);
});

test('rejects reversed intervals and mixed all-day endpoints', () => {
  const result = parseIcs(ics(timed([], '20261008T100000', '20261008T090000'),
    event(['DTSTART;VALUE=DATE:20261008', 'DTEND:20261009T090000'])));
  assert.equal(result.events.length, 0);
  assert.equal(result.errors.length, 2);
});

test('DAILY recurrence obeys INTERVAL and COUNT', () => {
  const { events } = parseIcs(ics(timed(['RRULE:FREQ=DAILY;INTERVAL=2;COUNT=3'], '20261004T090000', '20261004T100000')));
  assert.equal(expandEventForDay(events[0], DAY, ZONE).length, 1);
  assert.equal(expandEventForDay(events[0], '2026-10-07', ZONE).length, 0);
  assert.equal(expandEventForDay(events[0], '2026-10-10', ZONE).length, 0);
});

test('DAILY recurrence BYDAY and EXDATE work together', () => {
  const { events } = parseIcs(ics(timed(['RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;COUNT=5', 'EXDATE:20261008T090000'],
    '20261005T090000', '20261005T100000')));
  assert.equal(projectDay(events, DAY, ZONE).events.length, 0);
  assert.equal(projectDay(events, '2026-10-09', ZONE).events.length, 1);
  assert.equal(projectDay(events, '2026-10-12', ZONE).events.length, 0);
});

test('WEEKLY recurrence uses BYDAY, INTERVAL and occurrence COUNT', () => {
  const { events } = parseIcs(ics(timed(['RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;COUNT=4'],
    '20260928T090000', '20260928T100000')));
  assert.equal(projectDay(events, DAY, ZONE).events.length, 0);
  assert.equal(projectDay(events, '2026-10-12', ZONE).events.length, 1);
  assert.equal(projectDay(events, '2026-10-15', ZONE).events.length, 1);
  assert.equal(projectDay(events, '2026-10-26', ZONE).events.length, 0);
});

test('WEEKLY without BYDAY uses start weekday; UNTIL is inclusive', () => {
  const { events } = parseIcs(ics(timed(['RRULE:FREQ=WEEKLY;UNTIL=20261008T060000Z'],
    '20261001T090000', '20261001T100000')));
  assert.equal(projectDay(events, DAY, ZONE).events.length, 1);
  assert.equal(projectDay(events, '2026-10-15', ZONE).events.length, 0);
});

test('supports recurring all-day EXDATE and inclusive date UNTIL', () => {
  const { events } = parseIcs(ics(event(['UID:all-repeat', 'DTSTART;VALUE=DATE:20261005',
    'RRULE:FREQ=DAILY;UNTIL=20261008', 'EXDATE;VALUE=DATE:20261007'])));
  assert.equal(projectDay(events, '2026-10-07', ZONE).events.length, 0);
  assert.equal(projectDay(events, DAY, ZONE).events.length, 1);
  assert.equal(projectDay(events, '2026-10-09', ZONE).events.length, 0);
});

test('recurrences preserve wall-clock time across DST', () => {
  const { events } = parseIcs(ics(event(['UID:dst', 'DTSTART;TZID=America/New_York:20261031T090000',
    'DTEND;TZID=America/New_York:20261031T100000', 'RRULE:FREQ=DAILY;COUNT=3'])));
  const items = projectDay(events, '2026-11-01', 'America/New_York').events;
  assert.equal(items[0].startMinute, 540);
  assert.equal(items[0].originalStart, '2026-11-01T14:00:00.000Z');
});

test('recurrence in source timezone can land on adjacent display date', () => {
  const { events } = parseIcs(ics(event(['UID:shift', 'DTSTART;TZID=America/New_York:20261007T230000',
    'DTEND;TZID=America/New_York:20261007T233000', 'RRULE:FREQ=DAILY;COUNT=2'])));
  const items = projectDay(events, DAY, ZONE).events;
  assert.equal(items.length, 1);
  assert.equal(items[0].startMinute, 360);
});

test('unsupported recurrence stays visible once and reports its limitation', () => {
  const { events, errors } = parseIcs(ics(timed(['RRULE:FREQ=MONTHLY;BYMONTHDAY=8'])));
  assert.equal(events.length, 1);
  assert.ok(errors.some(e => /повтор/i.test(e)));
  assert.equal(projectDay(events, DAY, ZONE).events.length, 1);
  assert.equal(projectDay(events, '2026-11-08', ZONE).events.length, 0);
});

test('malformed recurrence reports errors instead of infinite expansion', () => {
  for (const rule of ['FREQ=DAILY;INTERVAL=0', 'FREQ=WEEKLY;COUNT=-1', 'FREQ=DAILY;BYDAY=XX']) {
    const result = parseIcs(ics(timed([`RRULE:${rule}`])));
    assert.ok(result.errors.length > 0);
    assert.equal(projectDay(result.events, DAY, ZONE).events.length, 1);
  }
});

test('malformed RRULE UNTIL reports an error and keeps the event visible once', () => {
  const result = parseIcs(ics(timed(['RRULE:FREQ=DAILY;UNTIL=not-a-date'])));
  assert.equal(result.events.length, 1);
  assert.ok(result.errors.some(error => /UNTIL|формат/i.test(error)));
  assert.equal(projectDay(result.events, DAY, ZONE).events.length, 1);
});

test('old unbounded DAILY recurrence jumps directly to the requested day', () => {
  const { events } = parseIcs(ics(timed(['RRULE:FREQ=DAILY'], '20100101T090000', '20100101T100000')));
  assert.equal(expandEventForDay(events[0], DAY, ZONE).length, 1);
});

test('assigns lowest free lanes and marks all intersecting events', () => {
  const items = assignLanes([
    { id: 'a', startMinute: 540, endMinute: 600 },
    { id: 'b', startMinute: 570, endMinute: 630 },
    { id: 'c', startMinute: 600, endMinute: 660 },
    { id: 'd', startMinute: 660, endMinute: 700 }
  ]);
  assert.deepEqual(items.map(e => e.lane), [0, 1, 0, 0]);
  assert.deepEqual(items.map(e => e.overlap), [true, true, true, false]);
});

test('adjacent events share a lane and are not overlapping', () => {
  assert.deepEqual(assignLanes([{ startMinute: 0, endMinute: 60 }, { startMinute: 60, endMinute: 120 }])
    .map(e => [e.lane, e.overlap]), [[0, false], [0, false]]);
});

test('computes free windows from merged busy intervals', () => {
  assert.deepEqual(computeFreeWindows([
    { startMinute: 60, endMinute: 120 }, { startMinute: 90, endMinute: 180 }, { startMinute: 180, endMinute: 240 }
  ]), [{ startMinute: 0, endMinute: 60, duration: 60 }, { startMinute: 240, endMinute: 1440, duration: 1200 }]);
  assert.deepEqual(computeFreeWindows([]), [{ startMinute: 0, endMinute: 1440, duration: 1440 }]);
});

test('projects empty days and full busy days without zero windows', () => {
  assert.equal(projectDay([], DAY, ZONE).freeMinutes, 1440);
  assert.deepEqual(computeFreeWindows([{ startMinute: 0, endMinute: 1440 }]), []);
});

test('stable base and occurrence ids survive parsing, title edits and projection', () => {
  const a = parseIcs(ics(timed())).events[0];
  const b = parseIcs(ics(timed(['SUMMARY:Новое имя']))).events[0];
  assert.equal(a.id, b.id);
  assert.equal(projectDay([a], DAY, ZONE).events[0].id, projectDay([b], DAY, ZONE).events[0].id);
  assert.equal(parseIcs(ics(event(['DTSTART:20261008T090000', 'DTEND:20261008T100000']))).events[0].id,
    parseIcs(ics(event(['DTSTART:20261008T090000', 'DTEND:20261008T100000']))).events[0].id);
});

test('UIDs and no-UID events receive collision-safe deterministic ids', () => {
  const duplicateUid = parseIcs(ics(
    timed([], '20261008T090000', '20261008T100000'),
    event(['UID:test-event', 'DTSTART:20261008T110000', 'DTEND:20261008T120000'])
  ));
  assert.equal(duplicateUid.events.length, 2);
  assert.notEqual(duplicateUid.events[0].id, duplicateUid.events[1].id);
  assert.match(duplicateUid.events[0].id, /^evt-[0-9a-f]{8}/);

  const hashCollision = parseIcs(ics(
    event(['UID:in2w9sAU', 'DTSTART:20261008T090000', 'DTEND:20261008T100000']),
    event(['UID:wcY5k3bv', 'DTSTART:20261008T110000', 'DTEND:20261008T120000'])
  ));
  assert.equal(hashCollision.events.length, 2);
  assert.notEqual(hashCollision.events[0].id, hashCollision.events[1].id);
  assert.match(hashCollision.events[1].id, /~2$/);
  assert.deepEqual(hashCollision.events.map(item => item.id), parseIcs(ics(
    event(['UID:in2w9sAU', 'DTSTART:20261008T090000', 'DTEND:20261008T100000']),
    event(['UID:wcY5k3bv', 'DTSTART:20261008T110000', 'DTEND:20261008T120000'])
  )).events.map(item => item.id));

  const noUid = ics(event(['DTSTART:20261008T090000', 'DTEND:20261008T100000']), event(['DTSTART:20261008T090000', 'DTEND:20261008T100000']));
  const first = parseIcs(noUid); const second = parseIcs(noUid);
  assert.notEqual(first.events[0].id, first.events[1].id);
  assert.deepEqual(first.events.map(item => item.id), second.events.map(item => item.id));
  assert.equal(projectDay(first.events, DAY, ZONE).events[0].occurrenceId, '2026-10-08T09:00:00');
});

test('accepts manual local ISO strings and JSON-restored date descriptors', () => {
  const items = projectDay([{ id: 'manual', title: 'Ручное', start: `${DAY}T09:00`, end: `${DAY}T09:45`, source: 'manual' }], DAY, ZONE).events;
  assert.equal(items[0].startMinute, 540);
  const saved = JSON.parse(JSON.stringify(parseIcs(ics(timed())).events));
  assert.equal(projectDay(saved, DAY, ZONE).events[0].duration, 60);
});

test('formatMinutes and demo provide readable valid data', () => {
  assert.equal(formatMinutes(0), '00:00');
  assert.equal(formatMinutes(1440), '24:00');
  assert.equal(formatMinutes(565), '09:25');
  const demo = projectDay(makeDemoEvents(DAY, ZONE), DAY, ZONE);
  assert.ok(demo.timedEvents.length >= 4);
  assert.ok(demo.allDayEvents.length >= 1);
  assert.ok(demo.timedEvents.some(e => e.overlap));
  assert.equal(demo.errors.length, 0);
});

test('projection validates day and timezone before calculating', () => {
  assert.throws(() => projectDay([], '2026-02-30', ZONE), /дат/i);
  assert.throws(() => projectDay([], DAY, 'Fake/Zone'), /пояс/i);
});
