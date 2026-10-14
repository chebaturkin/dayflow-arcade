"""Capture both shipped languages with a fixed demo date."""
from datetime import datetime, timezone
from pathlib import Path
import os
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
BASE=os.environ.get('DAYFLOW_BASE_URL','http://127.0.0.1:4173')
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    for lang in ('ru','en'):
        output=ROOT/'docs'/'screenshots'/('en' if lang=='en' else '')
        output.mkdir(parents=True,exist_ok=True)
        context=browser.new_context(viewport={'width':1440,'height':1000},locale='ru-RU' if lang=='ru' else 'en-US',timezone_id='Europe/Moscow')
        page=context.new_page()
        page.clock.install(time=datetime(2026,10,14,7,15,tzinfo=timezone.utc))
        page.emulate_media(reduced_motion='reduce')
        page.goto(BASE+'/?lang='+lang)
        page.wait_for_load_state('networkidle')
        page.evaluate('document.fonts.ready')
        page.locator('#load-demo').click()
        page.locator('.agenda-select').nth(2).click()
        page.locator('#toast').evaluate("el=>el.classList.remove('is-visible')")
        page.evaluate('scrollTo(0,0)')
        page.screenshot(path=str(output/'desktop.png'),full_page=True)
        page.locator('[data-mode-choice="arcade"]').click()
        page.locator('#toast').evaluate("el=>el.classList.remove('is-visible')")
        page.locator('.route-panel').screenshot(path=str(output/'arcade.png'))
        page.locator('[data-mode-choice="calm"]').click()
        page.set_viewport_size({'width':390,'height':844})
        page.locator('#focus-events').click()
        page.locator('#toast').evaluate("el=>el.classList.remove('is-visible')")
        page.evaluate('scrollTo(0,0)')
        page.screenshot(path=str(output/'mobile.png'),full_page=True)
        page.set_viewport_size({'width':1440,'height':1000})
        page.locator('#open-manual').click()
        page.locator('input[name="title"]').fill('работа над проектом' if lang=='ru' else 'project work')
        page.locator('input[name="start"]').fill('11:00')
        page.locator('input[name="end"]').fill('12:30')
        page.locator('#manual-title').click()
        page.locator('#manual-dialog').screenshot(path=str(output/'event-dialog.png'))
        context.close()
    browser.close()
print('captured ru/en desktop, arcade, mobile and event dialog')
