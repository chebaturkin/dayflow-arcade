**english** · [русский](README.ru.md)

<p><img src="assets/wordmark.svg" alt="dayflow arcade" width="420"></p>

# dayflow arcade

your whole day on one timeline. import a calendar, see free slots and put together a schedule you can read at a glance.

**[open the calendar ↗](https://chebaturkin.github.io/dayflow-arcade/?lang=en)** · [run locally](#run-locally) · [checks](#checks) · [русская версия](https://chebaturkin.github.io/dayflow-arcade/?lang=ru)

![dayflow arcade with a timeline, free slots and event list](docs/screenshots/en/desktop.png)

## using the calendar

choose a day and import an `.ics` file from your calendar. events appear on the timeline and in the list below. select one to see its details, edit its time or mark it as done. “load example” gives you a sample day.

- move between days with arrows, choose a date or return to today.
- fit the whole day or its events into view, or jump to the current time.
- create an event from a free slot with a 30, 60 or 90 minute duration.
- add, edit and delete events, and undo the last action.
- choose a time zone and calm or arcade mode.
- download the schedule and event list as svg or png.

editing or deleting a recurring event affects only the selected occurrence. its neighbors stay in the calendar. the form uses the selected time zone and supports ending on the next date.

choose a duration under “free slots” and select a suitable interval. its start and end appear in the form; add a title and save. you can also select a slot on the timeline. an end at 24:00 becomes 00:00 on the next date.

all day notes have their own row and do not occupy hours in the metrics. overlapping events have separate lanes. busy time uses merged intervals, so overlaps do not count the same hours twice.

the **ru / en** control changes the interface, demo labels, dates and export captions without reloading. direct `?lang=ru` and `?lang=en` links take priority over the saved choice, the first supported browser preference and english. your calendar text and unfinished form remain yours.

## two modes

calm mode keeps the emphasis on the schedule. arcade adds a dotted texture, crisp cards and a completion mark that flies toward the done counter when both are visible. both modes have short transitions and button feedback. your system's reduced motion preference disables animations.

<details>
<summary>arcade mode, mobile screen and event form</summary>

![the timeline in arcade mode](docs/screenshots/en/arcade.png)

<p><img src="docs/screenshots/en/mobile.png" alt="calendar on a phone" width="300"></p>

![the add event form](docs/screenshots/en/event-dialog.png)

</details>

## data stays with you

the calendar is parsed in your browser. events, completion marks, mode and time zone are saved in `localStorage`; the language choice has a separate key. calendar files and data are never uploaded. there are no accounts, external api calls or server database.

an import replaces the event source; you can undo the last action. data belongs to this browser: clearing site data removes the saved calendar. there is no sync with the original calendar. after loading, the app makes no network requests, but opening or reloading the published page needs a connection: there is no service worker yet.

## run locally

no build or dependency installation is needed for the app:

```bash
python3 -m http.server 4173
```

open the [local calendar in english](http://127.0.0.1:4173/?lang=en). `file://` cannot run the app because browsers block modules loaded directly from a local file.

## calendar support

imports support utc, `TZID`, floating times, all day events, `DURATION`, `EXDATE` and `DAILY` / `WEEKLY` recurrence. unsupported rules appear in a message. an invalid file does not erase saved events. file size limit: 2 mb.

changes to individual occurrences are stored locally; reimporting replaces them with file data. editing an entire series and importing `RECURRENCE-ID` exceptions are not supported yet. all day notes can be completed or deleted, but their date editor is not implemented.

## checks

core tests need node.js:

```bash
node --test tests/*.test.*
node --check js/app.js
node --check js/calendar-core.js
node --check js/motion.js
```

browser tests need playwright and chromium for python and node.js. install the optional tools in the repository root:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install playwright
.venv/bin/python -m playwright install chromium
npm install --no-save --package-lock=false playwright
npx playwright install chromium
```

keep the local server running, then run:

```bash
DAYFLOW_BASE_URL=http://127.0.0.1:4173 .venv/bin/python tests/browser_smoke.py
DAYFLOW_BASE_URL=http://127.0.0.1:4173 .venv/bin/python tests/calendar_usability.py
DAYFLOW_BASE_URL=http://127.0.0.1:4173 .venv/bin/python tests/browser_motion.py
DAYFLOW_BASE_URL=http://127.0.0.1:4173 node tests/i18n-browser.cjs
```

checks cover imports, creation and editing, completion, undo, day navigation, legacy data, two tabs, exports, free slots, recurrence, time zones, motion and both languages. readme screenshots come from the running application with demo data. update both language sets with:

```bash
DAYFLOW_BASE_URL=http://127.0.0.1:4173 .venv/bin/python tests/capture_screenshots.py
```

## publication

[github pages](https://chebaturkin.github.io/dayflow-arcade/?lang=en) updates after changes reach `main`. the workflow is [`.github/workflows/pages.yml`](.github/workflows/pages.yml). for your own repository, select **github actions** in **settings → pages**.

## project structure

- `index.html`: interface and accessible controls.
- `styles.css`: styling, responsive layout and motion.
- `i18n.js`: local interface messages and language selection.
- `js/app.js`: state, event list, imports and exports.
- `js/motion.js`: selection, completion and event movement animations.
- `js/calendar-core.js`: calendar parsing, recurrence, overlaps and free slots.
- `assets/logo.svg`: the day loop and current time mark.
- `assets/fonts/`: local fonts and licenses.

## fonts and references

the app uses local pt sans and ibm plex mono. attribution and the font license link are in [`assets/fonts/README.md`](assets/fonts/README.md).

these references informed free-slot selection and editing individual occurrences. their code and assets are not included:

- [fullcalendar range selection](https://github.com/fullcalendar/fullcalendar/blob/5160c2c953c349996b0e34a09faa77b759995a2b/packages/preact/src/interaction-plugin/interactions/DateSelecting.ts): validate a chosen range before creating an event; [mit, standard edition](https://github.com/fullcalendar/fullcalendar/blob/5160c2c953c349996b0e34a09faa77b759995a2b/LICENSE.md).
- [toast ui calendar event form](https://github.com/nhn/tui.calendar/blob/b53e765e8d896ab7c63d9b9b9515904119a72f46/apps/calendar/src/hooks/calendar/useEventFormPopup.tsx): carry selected times into the form; [mit](https://github.com/nhn/tui.calendar/blob/b53e765e8d896ab7c63d9b9b9515904119a72f46/LICENSE).
- [cal.diy slot calculation](https://github.com/calcom/cal.diy/blob/54343aa685ae8f33159d2f485ec4a57bad5c574a/packages/features/schedules/lib/slots.ts): fit the selected duration into available time; [mit for the referenced revision](https://github.com/calcom/cal.diy/blob/54343aa685ae8f33159d2f485ec4a57bad5c574a/LICENSE).
- [ical.js occurrence details](https://github.com/kewisch/ical.js/blob/33ba266282fac7c721d792e04124513df73fe140/lib/ical/event.js): keep a series separate from its exceptions; [mpl-2.0](https://github.com/kewisch/ical.js/blob/33ba266282fac7c721d792e04124513df73fe140/LICENSE).
