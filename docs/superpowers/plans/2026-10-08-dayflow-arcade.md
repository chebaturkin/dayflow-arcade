# «Линия дня» Professional Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Повысить надёжность, доступность и качество UX офлайн-календаря «Линия дня», сохранив его текущую дизайн-систему и статическую архитектуру.

**Architecture:** Чистое календарное ядро остаётся в `js/calendar-core.js`; UI-состояние, persistence, действия, DOM и экспорт остаются в `js/app.js`. HTML/CSS получает семантические регионы, ясные labels, states и responsive behavior. Изменения выполняются последовательно с TDD для ядра и браузерным smoke проходом после интеграции.

**Tech Stack:** Vanilla ES modules, HTML/CSS, localStorage, Intl, SVG/Canvas, Node built-in test runner, Playwright scripts для smoke.

---

### Task 1: Stabilize calendar core and recurrence performance

**Files:**
- Modify: `js/calendar-core.js`
- Test: `tests/calendar-core.test.mjs`

- [x] **Step 1: Add failing tests** for duplicate UID/no-UID IDs, malformed RRULE UNTIL, old DAILY recurrence projection completing under 1s, all-day occupancy in `freeWindows`/metrics, and DST day clipping.
- [x] **Step 2: Run `node --test tests/calendar-core.test.mjs` and record failures.**
- [x] **Step 3: Replace recurrence day-by-day expansion** with arithmetic candidate generation for DAILY/WEEKLY relative to the target display window; cap candidate creation to the target day plus overlap margin and preserve COUNT/UNTIL/EXDATE.
- [x] **Step 4: Validate UNTIL during parse** and return a localized error while keeping the rule visible once when the rest of the event is valid.
- [x] **Step 5: Generate collision-safe stable IDs** by namespacing UID and appending deterministic occurrence indexes for duplicate base IDs.
- [x] **Step 6: Include all-day occupancy in merged busy intervals** while keeping all-day events in their own rendering collection.
- [x] **Step 7: Run the full core suite and confirm zero failures plus the old-recurrence timing check.**

### Task 2: Harden state, import and event actions

**Files:**
- Modify: `js/app.js`
- Modify: `index.html`
- Test: `tests/app-state.test.mjs` (new pure helper coverage if practical)

- [x] **Step 1: Add pure state helpers** for safe restore, timezone/mode persistence, normalized imported event merge and undo stack; exercise them through the browser smoke flow.
- [x] **Step 2: Validate localStorage records** field-by-field, dropping malformed events while keeping valid ones and showing a non-blocking message.
- [x] **Step 3: Persist timezone and global mode**, and preserve completion by stable event/occurrence ID across imports when possible.
- [x] **Step 4: Make import case-insensitive and reset file input**; retain valid old data on all-invalid files and expose Undo for replacement/merge.
- [x] **Step 5: Add manual event edit/delete and Undo** with a single dialog used for create/edit, validation messages tied to fields, and focus restoration.
- [x] **Step 6: Ensure selection/complete/delete updates are announced** and never silently lose the details panel.
- [x] **Step 7: Run syntax checks and core tests before UI work continues.**

### Task 3: Make the timeline and details accessible

**Files:**
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `js/app.js`

- [x] **Step 1: Replace hidden status with a live status region**, fix skip link, add timeline role/label/keyboard scroll hint and accessible text summary.
- [x] **Step 2: Render stations and all-day events as real buttons** with aria-pressed, source/status labels and focus restoration after rerender.
- [x] **Step 3: Keep details empty state visible**, add edit/delete controls, and show original plus clipped time when an event crosses midnight.
- [x] **Step 4: Align copy, tokens and control states**; make Calm/Arcade visibly distinct without decorative text, add error toast styling, forced-colors and focus states.
- [x] **Step 5: Fix date/year, lane wording, all-day lane stacking, short-event overlap handling and mobile scroll affordance.
- [x] **Step 6: Verify 320px, 640px and desktop layout plus keyboard-only flow.**

### Task 4: Rebuild exports from the projection

**Files:**
- Modify: `js/app.js`
- Modify: `styles.css`

- [x] **Step 1: Add export fixtures** for all-day + multi-lane geometry, escaped text and dynamic height to the browser smoke flow.
- [x] **Step 2: Update SVG layout** to reserve all-day band, free band, every timed lane and footer legend; use 24:00 endpoint and escaped labels.
- [x] **Step 3: Harden PNG conversion** against null canvas/context/toBlob and surface actionable error messages.
- [x] **Step 4: Verify SVG/PNG downloads after demo, manual event and completion.**

### Task 5: Browser smoke harness and documentation

**Files:**
- Create: `tests/browser_smoke.py`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-10-08-dayflow-arcade-design.md`
- Modify: `docs/superpowers/plans/2026-10-08-dayflow-arcade.md`

- [x] **Step 1: Add a Playwright smoke script** that starts from a static server URL and checks empty/demo/manual/import/reload/keyboard/mobile/export flows.
- [x] **Step 2: Run the script in headed-free Chromium and save a screenshot artifact for visual review.**
- [x] **Step 3: Update README** with the real feature set, privacy model, local commands and smoke command.
- [x] **Step 4: Run final syntax, core and browser checks; record exact results in the final report.**
