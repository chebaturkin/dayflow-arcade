# «линия дня» — редактура и интерфейсный overhaul implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** привести весь пользовательский слой «линии дня» к ясному стилю Тимофея, закрыть найденные accessibility/robustness расхождения и подготовить готовую публикацию на GitHub Pages.

**Architecture:** календарная математика остаётся чистым модулем `js/calendar-core.js`; состояние, действия и экспорт остаются в `js/app.js`. HTML/CSS получает единую семантику и регистр, а GitHub Pages публикует статические файлы через Actions artifact.

**Tech Stack:** vanilla ES modules, HTML/CSS, localStorage, Node built-in test runner, Playwright smoke, GitHub Actions Pages.

---

### Task 1: Добавить контракт текста и baseline

**Files:**
- Create: `tests/copy-contract.test.mjs`
- Modify: `tests/browser_smoke.py`

- [x] **Step 1: Написать failing tests для контрактов копирайтинга.** Проверить, что HTML содержит lowercase-варианты заголовков и кнопок, dropzone имеет `tabindex="0"` и `role="button"`, а README не содержит личный абсолютный путь.
- [x] **Step 2: Запустить `node --test tests/copy-contract.test.mjs` и зафиксировать ожидаемые падения на текущих капс-фразах/отсутствующей роли.**
- [x] **Step 3: Расширить browser smoke проверками: клавиатурное открытие dropzone, тексты пустого состояния, отмена полного невалидного импорта и сохранение старого дня.**
- [x] **Step 4: Запустить существующие `node --test tests/calendar-core.test.mjs` и smoke, чтобы отделить baseline от новых падений.**

### Task 2: Пересобрать опубликованный текстовый слой и доступность

**Files:**
- Modify: `index.html`
- Modify: `styles.css`

- [x] **Step 1: Переписать title, description, skip link, заголовки секций, labels, legend, dialog copy и placeholders со строчными началами; сохранить `ICS`, `UTC`, `PNG`, `SVG` и имена собственных продуктов.**
- [x] **Step 2: Обновить `drop-zone` до `role="button" tabindex="0"`, добавить ясное `aria-label` и связать подсказку с input.**
- [x] **Step 3: Убрать капс из видимых статусных подписей и привести focus/hover/pressed/complete состояния к одной иерархии.**
- [x] **Step 4: Добавить/уточнить responsive стили для 320px, видимый горизонтальный scroll affordance, фокус dropzone и контраст сообщений.**
- [x] **Step 5: Запустить `node --test tests/copy-contract.test.mjs` и убедиться, что новый контракт проходит.**

### Task 3: Привести динамические сообщения, детали и импорт к голосу и безопасным границам

**Files:**
- Modify: `js/app.js`
- Modify: `js/calendar-core.js`

- [x] **Step 1: Переписать `sourceLabel`, `announce`, toast/error/undo тексты, empty state, детали и экспортные сообщения; названия кнопок должны описывать фактическое действие.**
- [x] **Step 2: Добавить валидацию выбранного файла до `file.text()`: принять только `File`, ограничить размер 2 MiB, проверить ICS-содержимое после чтения и сохранить понятную ошибку.**
- [x] **Step 3: Разделить восстановление localStorage на независимые слои: повреждённый settings/completion не должен стирать валидные события; completion принимает только boolean-значения.**
- [x] **Step 4: Исправить клавиатурную обработку dropzone, восстановление focus после диалога и доступные labels для all-day/event buttons.**
- [x] **Step 5: Обновить демо-события и сообщения календарного ядра так, чтобы пользовательские строки были lowercase, не меняя расчёты времени и recurrence.**
- [x] **Step 6: Запустить `node --check js/app.js`, `node --check js/calendar-core.js`, затем `node --test tests/calendar-core.test.mjs tests/copy-contract.test.mjs`.**

### Task 4: Переписать README и добавить публикацию на GitHub Pages

**Files:**
- Modify: `README.md`
- Create: `.github/workflows/pages.yml`
- Create: `404.html`
- Modify: `AGENT_PROMPT.md`

- [x] **Step 1: Переписать README короткими абзацами: что это, как начать, как импортировать ICS, приватность, ограничения, локальная проверка и GitHub Pages без абсолютных путей.**
- [x] **Step 2: Сохранить рабочий пример ICS, пояснить `TZID`, floating, all-day и `RRULE` только в объёме реально поддерживаемого кода.**
- [x] **Step 3: Создать workflow с `actions/configure-pages`, `actions/upload-pages-artifact` и `actions/deploy-pages`, permissions `pages: write`/`id-token: write`, запуском на `main` и manual dispatch.**
- [x] **Step 4: Создать lowercase-friendly `404.html`, который возвращает пользователя на `index.html` и сохраняет базовые метаданные.**
- [x] **Step 5: Обновить `AGENT_PROMPT.md`, чтобы он описывал фактический стиль, приватность и отсутствие внешних API.**

### Task 5: Визуальная и функциональная проверка

**Files:**
- Modify: `tests/browser_smoke.py` only if a regression assertion is needed.
- Inspect: `index.html`, `styles.css`, `js/app.js`, `README.md`, `.github/workflows/pages.yml`.

- [x] **Step 1: Запустить `node --test tests/calendar-core.test.mjs tests/copy-contract.test.mjs`.**
- [x] **Step 2: Запустить `node --check js/app.js && node --check js/calendar-core.js`.**
- [x] **Step 3: Запустить браузерный smoke-проход через `with_server.py` и проверить пустой день, импорт, undo, keyboard flow, мобильную ширину и downloads.**
- [x] **Step 4: Открыть локальный сайт в Chromium на desktop и 320px, проверить screenshot, keyboard focus, dialog, empty state, import error и downloads.**
- [x] **Step 5: Проверить `git diff --check`, YAML workflow и `rg` по всем опубликованным строкам на случайные служебные заглавные/личные пути.**
- [x] **Step 6: Закоммитить готовые изменения с сообщением `feat: align dayflow with chebaturkin voice`.**
