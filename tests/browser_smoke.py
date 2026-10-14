from pathlib import Path
import os
import tempfile
import struct
import xml.etree.ElementTree as ET
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
BASE_URL = os.environ.get('DAYFLOW_BASE_URL', 'http://127.0.0.1:4173')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True)
    page = context.new_page()
    page.set_default_timeout(60000)
    console_errors = []
    page.on("pageerror", lambda error: console_errors.append(str(error)))
    page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
    page.goto(f"{BASE_URL}/index.html")
    page.wait_for_load_state("networkidle")

    expect(page.locator("#timezone-picker")).to_have_value("local")
    expect(page.get_by_role("heading", level=1)).to_have_text("dayflow arcade")
    expect(page.locator("#details-panel")).to_be_visible()
    expect(page.locator("#details-empty")).to_be_visible()
    expect(page.locator("#details-empty")).to_contain_text("выберите событие")
    expect(page.locator("#metric-events")).to_have_text("00")

    # The import surface is usable without a pointer.
    dropzone = page.locator("#drop-zone")
    expect(dropzone).to_have_attribute("role", "button")
    expect(dropzone).to_have_attribute("tabindex", "0")
    dropzone.focus()
    assert page.evaluate("document.activeElement.id") == "drop-zone"
    page.keyboard.press("Enter")
    page.keyboard.press("Escape")

    page.get_by_role("button", name="загрузить пример").click()
    expect(page.locator("#metric-events")).not_to_have_text("00")
    expect(page.locator(".agenda-select")).to_have_count(5)
    expect(page.locator("#metric-busy")).not_to_contain_text("24")
    original_day = page.locator("#day-picker").input_value()
    page.get_by_role("button", name="следующий день").click()
    expect(page.locator("#metric-events")).to_have_text("00")
    page.get_by_role("button", name="предыдущий день").click()
    expect(page.locator("#day-picker")).to_have_value(original_day)
    expect(page.locator(".agenda-select")).to_have_count(5)
    page.locator('#fit-day').click()
    expect(page.locator('#fit-day')).to_have_attribute('aria-pressed', 'true')
    assert page.locator('#route-viewport').evaluate('el => el.scrollWidth == el.clientWidth')
    page.locator('#focus-events').click()
    expect(page.locator('#focus-events')).to_have_attribute('aria-pressed', 'true')
    station = page.locator(".station").first
    expect(station).to_be_visible()
    station.click()
    expect(page.locator("#event-details")).to_be_visible()
    expect(page.locator("#detail-title")).not_to_have_text("без названия")

    page.get_by_role("button", name="отметить выполненным", exact=True).click()
    expect(page.get_by_role("button", name="вернуть в день", exact=True)).to_be_visible()

    # Edit the selected event and confirm the title is persisted.
    page.get_by_role("button", name="изменить выбранное событие").click()
    expect(page.locator("#manual-dialog")).to_be_visible()
    title = page.locator('input[name="title"]')
    original_title = title.input_value()
    title.fill(original_title + " · обновлено")
    page.locator('input[name="start"]').fill("09:15")
    page.locator('input[name="end"]').fill("10:15")
    page.get_by_role("button", name="сохранить изменения").click()
    expect(page.locator("#detail-title")).to_contain_text("обновлено")

    # Create a second event.
    page.get_by_role("button", name="добавить событие", exact=True).click()
    page.locator('input[name="title"]').fill("Ручная проверка")
    page.locator('input[name="start"]').fill("15:00")
    page.locator('input[name="end"]').fill("15:30")
    page.get_by_role("button", name="добавить в день").click()
    expect(page.locator("#detail-title")).to_have_text("Ручная проверка")

    # The global event source survives navigation between dates.
    page.get_by_role("button", name="следующий день").click()
    expect(page.locator("#metric-events")).to_have_text("00")
    page.get_by_role("button", name="предыдущий день").click()
    expect(page.locator(".agenda-name").filter(has_text="Ручная проверка")).to_have_count(1)

    # Undo is available for the last mutation.
    page.get_by_role("button", name="отменить").click()
    expect(page.locator("#detail-title")).not_to_have_text("Ручная проверка")

    # Case-insensitive ICS import and invalid import preservation.
    ics_path = Path(tempfile.gettempdir()) / "dayflow-lower.ics"
    day_compact = page.locator("#day-picker").input_value().replace("-", "")
    ics_path.write_text(f"begin:vcalendar\nversion:2.0\nbegin:vevent\nuid:lower-case\ndtstart:{day_compact}T180000\ndtend:{day_compact}T183000\nsummary:Нижний регистр\nend:vevent\nend:vcalendar\n", encoding="utf-8")
    page.locator("#ics-file").set_input_files(str(ics_path))
    expect(page.locator("#metric-events")).to_have_text("01")
    page.locator("#ics-file").set_input_files(files={"name": "bad.ics", "mimeType": "text/calendar", "buffer": b"BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:bad\nEND:VEVENT\nEND:VCALENDAR"})
    expect(page.locator("#metric-events")).to_have_text("01")

    # Multiple all-day events occupy separate visual rows.
    all_day_path = Path(tempfile.gettempdir()) / "dayflow-all-day.ics"
    all_day_path.write_text(f"BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:all-day-a\nDTSTART;VALUE=DATE:{day_compact}\nSUMMARY:Весь день A\nEND:VEVENT\nBEGIN:VEVENT\nUID:all-day-b\nDTSTART;VALUE=DATE:{day_compact}\nSUMMARY:Весь день B\nEND:VEVENT\nEND:VCALENDAR\n", encoding="utf-8")
    page.locator("#ics-file").set_input_files(str(all_day_path))
    expect(page.locator(".all-day-block")).to_have_count(2)
    positions = page.locator(".all-day-block").evaluate_all("els => els.map(el => [Math.round(el.getBoundingClientRect().left), Math.round(el.getBoundingClientRect().top)])")
    assert len(set(map(tuple, positions))) == 2, positions

    # SVG and PNG downloads.
    with page.expect_download() as download_info:
        page.locator("#export-svg").click()
    download = download_info.value
    assert download.suggested_filename.startswith('dayflow-arcade-')
    assert download.suggested_filename.endswith(".svg")
    svg_path = Path(tempfile.gettempdir()) / 'dayflow-smoke-export.svg'
    download.save_as(str(svg_path))
    svg = ET.fromstring(svg_path.read_text())
    assert svg.attrib['width'] == '1600'
    assert 'dayflow arcade' in ''.join(svg.itertext())
    assert 'Весь день A' in ''.join(svg.itertext())
    with page.expect_download() as download_info:
        page.locator("#export-png").click()
    download = download_info.value
    assert download.suggested_filename.endswith(".png")
    png_path = Path(tempfile.gettempdir()) / 'dayflow-smoke-export.png'
    download.save_as(str(png_path))
    png = png_path.read_bytes()
    assert png[:8] == b'\x89PNG\r\n\x1a\n'
    png_width, png_height = struct.unpack('>II', png[16:24])
    assert png_width >= 1600 and png_height >= 900

    # Timezone setting persists through reload.
    page.locator("#timezone-picker").select_option("UTC")
    page.reload()
    page.wait_for_load_state("networkidle")
    expect(page.locator("#metric-events")).not_to_have_text("00")
    expect(page.locator("#timezone-picker")).to_have_value("UTC")

    # A broken global settings record must not erase a valid saved day.
    page.evaluate("localStorage.setItem('dayflow:settings', '{broken')")
    page.reload()
    page.wait_for_load_state("networkidle")
    expect(page.locator("#metric-events")).not_to_have_text("00")

    # Oversized local files are rejected before their contents are parsed.
    huge_ics = Path(tempfile.gettempdir()) / "dayflow-huge.ics"
    huge_ics.write_bytes(b"BEGIN:VCALENDAR\n" + b"X" * (2 * 1024 * 1024) + b"\nEND:VCALENDAR\n")
    page.locator("#ics-file").set_input_files(str(huge_ics))
    expect(page.locator("#message-stack")).to_contain_text("2 МБ")

    # Keyboard and mobile timeline affordance.
    page.locator("#route-viewport").focus()
    assert page.locator("#route-viewport").get_attribute("role") == "region"
    mobile_context = browser.new_context(viewport={"width": 320, "height": 900})
    mobile = mobile_context.new_page()
    mobile.goto(f"{BASE_URL}/index.html")
    mobile.wait_for_load_state("networkidle")
    expect(mobile.locator("#route-viewport")).to_be_visible()
    assert mobile.locator("#route-viewport").evaluate("el => el.scrollWidth >= el.clientWidth")
    assert mobile.evaluate('document.documentElement.scrollWidth == innerWidth')
    mobile.locator('#open-manual').click()
    expect(mobile.locator('#manual-dialog')).to_be_visible()
    mobile.locator('#cancel-manual').click()
    mobile.emulate_media(reduced_motion='reduce')
    assert mobile.locator('.route-panel').evaluate("el => parseFloat(getComputedStyle(el).animationDuration) <= 0.01")
    mobile.close()
    mobile_context.close()

    # Upgrade calendars saved before there was a shared editable source.
    migration_context = browser.new_context()
    migration = migration_context.new_page()
    migration.goto(BASE_URL)
    migration.wait_for_load_state('networkidle')
    migration.evaluate("""() => {
      const entry = (id, date) => ({id, title:id, source:'manual', start:date+'T12:00', end:date+'T13:00'});
      localStorage.setItem('dayflow:2026-10-14', JSON.stringify({rawEvents:[entry('legacy-a','2026-10-14')],completed:{},timeZone:'UTC',mode:'calm'}));
      localStorage.setItem('dayflow:2026-10-15', JSON.stringify({rawEvents:[entry('legacy-b','2026-10-15'),{...entry('imported-b','2026-10-15'),source:'ics',title:'изменённая импортированная запись'}],completed:{},timeZone:'UTC',mode:'calm'}));
      localStorage.setItem('dayflow:source', JSON.stringify([{...entry('imported-b','2026-10-15'),source:'ics',title:'исходная импортированная запись'}]));
      localStorage.setItem('dayflow:settings', JSON.stringify({timeZone:'UTC',mode:'calm'}));
    }""")
    migration.reload()
    migration.wait_for_load_state('networkidle')
    migration.locator('#day-picker').fill('2026-10-14')
    migration.locator('#day-picker').dispatch_event('change')
    expect(migration.locator('.agenda-name')).to_have_text('legacy-a')
    migration.locator('[data-mode-choice="arcade"]').click()
    migration.locator('#next-day').click()
    expect(migration.locator('.agenda-name').filter(has_text='legacy-b')).to_have_count(1)
    expect(migration.locator('.agenda-name').filter(has_text='изменённая импортированная запись')).to_have_count(1)
    migration_context.close()

    # Adding and deleting on different dates must not restore old snapshots.
    nav_context = browser.new_context(viewport={"width": 1440, "height": 1000})
    nav = nav_context.new_page()
    nav.goto(BASE_URL)
    nav.wait_for_load_state('networkidle')
    for title_text in ['сегодняшняя запись', 'завтрашняя запись']:
        nav.locator('#open-manual').click()
        nav.locator('input[name="title"]').fill(title_text)
        nav.locator('input[name="start"]').fill('12:00')
        nav.locator('input[name="end"]').fill('13:00')
        nav.get_by_role('button', name='добавить в день', exact=True).click()
        if title_text == 'сегодняшняя запись':
            nav.locator('[data-mode-choice="arcade"]').click()
            nav.locator('#next-day').click()
            nav.locator('[data-mode-choice="calm"]').click()
    nav.locator('#previous-day').click()
    expect(nav.locator('body')).to_have_attribute('data-mode', 'calm')
    expect(nav.locator('.agenda-name')).to_have_text('сегодняшняя запись')
    nav.locator('.agenda-select').click()
    nav.once('dialog', lambda dialog: dialog.accept())
    nav.locator('#delete-event').click()
    expect(nav.locator('#metric-events')).to_have_text('00')
    nav.locator('#next-day').click()
    expect(nav.locator('.agenda-name')).to_have_text('завтрашняя запись')
    nav.locator('.agenda-select').focus()
    nav.keyboard.press('Enter')
    expect(nav.locator('#detail-title')).to_have_text('завтрашняя запись')
    nav.locator('.agenda-check').click()
    expect(nav.locator('.agenda-check')).to_have_attribute('aria-pressed', 'true')
    assert nav.evaluate("document.activeElement.className") == 'agenda-check'
    nav.locator('#previous-day').click()
    expect(nav.locator('#metric-events')).to_have_text('00')
    assert nav.evaluate('document.documentElement.scrollWidth == innerWidth')
    nav_context.close()

    # A display setting in another tab must not overwrite new events.
    tabs_context = browser.new_context(viewport={"width": 1440, "height": 1000})
    tabs_context.set_default_timeout(60000)
    first = tabs_context.new_page()
    first.goto(BASE_URL)
    first.wait_for_load_state('networkidle')
    first.locator('#load-demo').click()
    second = tabs_context.new_page()
    second.goto(BASE_URL)
    second.wait_for_load_state('networkidle')
    second.locator('#next-day').click()
    first.bring_to_front()
    first.locator('#open-manual').click()
    first.locator('input[name="title"]').fill('событие из другой вкладки')
    first.locator('input[name="start"]').fill('12:00')
    first.locator('input[name="end"]').fill('13:00')
    first.get_by_role('button', name='добавить в день', exact=True).click()
    expect(second.locator('#undo-action')).to_have_count(0)
    second.bring_to_front()
    second.locator('[data-mode-choice="arcade"]').click()
    expect(first.locator('#undo-action')).to_have_count(0)
    first.bring_to_front()
    first.reload()
    first.wait_for_load_state('networkidle')
    expect(first.locator('.agenda-name').filter(has_text='событие из другой вкладки')).to_have_count(1)
    tabs_context.close()

    page.screenshot(path="/tmp/dayflow-smoke.png", full_page=True)
    assert not console_errors, console_errors
    browser.close()
    print("browser smoke: PASS")
