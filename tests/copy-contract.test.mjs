import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../', import.meta.url);
const read = (file) => readFile(new URL(file, root), 'utf8');

test('published interface uses lowercase copy and keeps technical names intact', async () => {
  const html = await read('index.html');
  assert.match(html, /<h1>линия дня<\/h1>/);
  assert.match(html, /<h2 id="controls-title">настройки дня<\/h2>/);
  assert.match(html, /<h2 id="import-title">добавить в день<\/h2>/);
  assert.match(html, /<button[^>]+id="load-demo"[^>]*>загрузить пример<\/button>/);
  assert.match(html, /<button[^>]+id="open-manual"[^>]*>добавить событие<\/button>/);
  assert.match(html, /линия дня/);
  assert.match(html, /\bICS\b/);
  assert.doesNotMatch(html, />СЕГОДНЯ</);
  assert.doesNotMatch(html, />СЕЙЧАС</);
  assert.doesNotMatch(html, />НОВАЯ ЗАПИСЬ</);
});

test('ICS dropzone is keyboard reachable', async () => {
  const html = await read('index.html');
  assert.match(html, /id="drop-zone"[^>]*role="button"/);
  assert.match(html, /id="drop-zone"[^>]*tabindex="0"/);
  assert.match(html, /id="drop-zone"[^>]*aria-describedby="drop-help"/);
});

test('README stays portable and describes local-only data handling', async () => {
  const readme = await read('README.md');
  assert.doesNotMatch(readme, /\/Users\/timofeychebaturkin/);
  assert.match(readme, /данные.*браузер/i);
  assert.match(readme, /github pages/i);
});

test('GitHub Pages publication is wired for the static site', async () => {
  const workflow = await read('.github/workflows/pages.yml');
  const notFound = await read('404.html');
  assert.match(workflow, /actions\/upload-pages-artifact@v3/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(workflow, /enablement:\s*true/);
  assert.match(workflow, /pages:\s*write/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(notFound, /href="index\.html"/);
  assert.match(notFound, /страница не найдена/);
});
