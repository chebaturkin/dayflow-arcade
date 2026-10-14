const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const base = process.env.DAYFLOW_BASE_URL || 'http://127.0.0.1:4432';
const url = path => new URL(path, base + '/').href;
const text = page => page.locator('body').innerText();
(async () => {
 const browser = await chromium.launch();
 try {
  for (const language of ['en-US', 'ru-RU']) {
   const context = await browser.newContext({ locale: language, viewport: { width: 390, height: 900 }, reducedMotion: 'reduce', acceptDownloads: true, timezoneId: 'Europe/Moscow' });
   const page = await context.newPage(); const errors = [];
   page.on('pageerror', error => errors.push(error.message));
   await page.goto(url('?keep=yes#draft'));
   await page.waitForFunction(() => document.documentElement.lang === navigator.language.slice(0, 2));
   const initial = language.slice(0, 2), target = initial === 'en' ? 'ru' : 'en';
   
   await page.locator('#load-demo').click();
   await page.locator('header [data-locale="en"]').click();assert.ok((await page.locator('.agenda-list').innerText()).includes('project work'));
   await page.locator('header [data-locale="ru"]').click();assert.ok((await page.locator('.agenda-list').innerText()).includes('работа над проектом'));
   await page.locator('header [data-locale="en"]').click();assert.ok((await page.locator('.agenda-list').innerText()).includes('project work'));
   await page.locator('header [data-locale="' + initial + '"]').click();
   await page.locator('#open-manual').click();
   await page.locator('[name="title"]').fill('my pending title / мой текст');
   await page.locator('textarea[name="description"]').fill('my pending note');
   await page.locator('[name="start"]').fill('11:00'); await page.locator('[name="end"]').fill('12:00');

   const before = await page.evaluate(() => ({ hash: location.hash, data: Object.fromEntries(Object.entries(localStorage).filter(([key]) => !key.endsWith(':locale'))) }));
   await page.locator('#manual-dialog [data-locale="' + target + '"]').focus();
   await page.keyboard.press('Enter');
   assert.equal(await page.locator('html').getAttribute('lang'), target);
   assert.equal(await page.locator('#manual-dialog [data-locale="' + target + '"]').getAttribute('aria-pressed'), 'true');
   const after = await page.evaluate(() => ({ hash: location.hash, data: Object.fromEntries(Object.entries(localStorage).filter(([key]) => !key.endsWith(':locale'))) }));
   assert.equal(after.hash, before.hash); assert.ok(page.url().includes('keep=yes')); assert.deepEqual(after.data, before.data);
   
   assert.equal(await page.locator('[name="title"]').inputValue(), 'my pending title / мой текст');
   assert.equal(await page.locator('textarea[name="description"]').inputValue(), 'my pending note');
   assert.equal(await page.locator('[name="start"]').inputValue(), '11:00');
   assert.equal(await page.locator('[name="end"]').inputValue(), '12:00');

   await page.locator('#manual-dialog [data-locale="en"]').click();
   
   await page.locator('#manual-form [type="submit"]').click();
   assert.equal(await page.locator('#detail-title').textContent(), 'my pending title / мой текст');
   await page.locator('header [data-locale="ru"]').click();
   assert.equal(await page.locator('#detail-title').textContent(), 'my pending title / мой текст');
   await page.locator('header [data-locale="en"]').click();
   assert.ok((await page.locator('.agenda-list').innerText()).includes('project work'));
   const downloading = page.waitForEvent('download');await page.locator('#export-svg').click();const download = await downloading;
   const svg = await fs.readFile(await download.path(), 'utf8'); assert.ok(svg.includes('day events'));assert.ok(svg.includes('my pending title / мой текст'));assert.ok(!svg.includes('события дня'));
   const beforeError=await page.locator('#agenda-count').textContent();
   await page.locator('#ics-file').setInputFiles({name:'bad.ics',mimeType:'text/calendar',buffer:Buffer.from('bad calendar')});
   await page.waitForFunction(()=>document.querySelector('#message-stack').textContent.includes('does not look like ics'));
   assert.equal(await page.locator('#agenda-count').textContent(),beforeError);
   await page.locator('#ics-file').setInputFiles({name:'valid.ics',mimeType:'text/calendar',buffer:Buffer.from('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:import-1\r\nDTSTART:20261014T090000\r\nDTEND:20261014T100000\r\nSUMMARY:Keep My Case\r\nEND:VEVENT\r\nEND:VCALENDAR')});
   await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('events added: 1'));
   assert.ok((await page.evaluate(()=>localStorage.getItem('dayflow:source'))).includes('Keep My Case'));

   for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const width of [320, 390, 768, 1440]) {
     await page.setViewportSize({ width, height: 1000 });
     assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}/${scheme}`);
    }
   }
   await page.reload();
   assert.equal(await page.locator('html').getAttribute('lang'), 'en');
   await page.goto(url('?lang=ru&keep=yes'));
   assert.equal(await page.locator('html').getAttribute('lang'), 'ru', 'query overrides saved English');
   assert.deepEqual(errors, []);
   await context.close();
  }
  const blocked = await browser.newContext({ locale: 'en-US', viewport: { width: 390, height: 900 } });
  await blocked.addInitScript(() => {
   Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked storage'); } });
   history.replaceState = () => { throw new Error('blocked history'); };
  });
  const restricted = await blocked.newPage(); await restricted.goto(url(''));
  await restricted.locator('header [data-locale="ru"]').click();
  assert.equal(await restricted.locator('html').getAttribute('lang'), 'ru');
  await restricted.locator('header [data-locale="en"]').click();
  assert.equal(await restricted.locator('html').getAttribute('lang'), 'en');
  
  await restricted.locator('#load-demo').click();assert.equal(await restricted.locator('.agenda-select').count(),5);

  await blocked.close();
  
  const late = await browser.newPage({locale:'en-US',timezoneId:'Europe/Moscow',viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  await late.clock.install({time:new Date('2026-10-14T20:59:00Z')}); await late.goto(url('?lang=en')); await late.locator('#load-demo').click();await late.locator('#fit-day').click();
  assert.ok(await late.locator('#route-viewport').evaluate(n=>n.scrollWidth===n.clientWidth),'the late-night now caption must stay inside the fitted timeline');
  await late.close();

  const blank = await browser.newPage({locale:'en-US'});await blank.goto(url('?lang=en'));await blank.locator('#open-manual').click();await blank.locator('#manual-form [type="submit"]').click();assert.equal(await blank.locator('#manual-form-error').textContent(),'enter an event title.');await blank.close();
  const pending = await browser.newPage({locale:'en-US'});await pending.goto(url('?lang=en'));
  await pending.evaluate(() => { const original = File.prototype.text; File.prototype.text = function() { return new Promise(resolve => { window.finishPendingImport = () => original.call(this).then(resolve); }); }; });
  await pending.locator('#ics-file').setInputFiles({name:'pending.ics',mimeType:'text/calendar',buffer:Buffer.from('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:pending\r\nDTSTART:20261014T090000\r\nDTEND:20261014T100000\r\nSUMMARY:Keep Pending Case\r\nEND:VEVENT\r\nEND:VCALENDAR')});
  await pending.waitForFunction(() => document.querySelector('#drop-zone').getAttribute('aria-busy') === 'true');
  await pending.locator('header [data-locale="ru"]').click();
  assert.equal(await pending.locator('#drop-zone strong').textContent(),'читаю календарь…');
  assert.equal(await pending.locator('#drop-zone').getAttribute('aria-busy'),'true');
  await pending.locator('header [data-locale="en"]').click();
  assert.equal(await pending.locator('#drop-zone strong').textContent(),'reading the calendar…');
  await pending.evaluate(() => window.finishPendingImport());
  await pending.waitForFunction(() => document.querySelector('#toast').textContent.includes('events added: 1'));
  assert.ok((await pending.evaluate(() => localStorage.getItem('dayflow:source'))).includes('Keep Pending Case'));
  await pending.close();
  console.log('dayflow-arcade bilingual browser checks passed: browser defaults, in-place state, keyboard, imports/errors/exports, persistence, blocked storage/history and 320/390/768/1440 light/dark.');
 } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
