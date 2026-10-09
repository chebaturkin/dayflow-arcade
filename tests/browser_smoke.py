from pathlib import Path
import tempfile
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True)
    page = context.new_page()
    console_errors = []
    page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
    page.goto("http://127.0.0.1:4173/index.html")
    page.wait_for_load_state("networkidle")

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
    station = page.locator(".station").first
    expect(station).to_be_visible()
    station.click()
    expect(page.locator("#event-details")).to_be_visible()
    expect(page.locator("#detail-title")).not_to_have_text("—")

    page.get_by_role("button", name="отметить выполненным").click()
    expect(page.get_by_role("button", name="вернуть в день")).to_be_visible()

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
    page.get_by_role("button", name="добавить событие").click()
    page.locator('input[name="title"]').fill("Ручная проверка")
    page.locator('input[name="start"]').fill("15:00")
    page.locator('input[name="end"]').fill("15:30")
    page.get_by_role("button", name="добавить в день").click()
    expect(page.locator("#detail-title")).to_have_text("Ручная проверка")

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
        page.get_by_role("button", name="SVG").click()
    download = download_info.value
    assert download.suggested_filename.endswith(".svg")
    with page.expect_download() as download_info:
        page.get_by_role("button", name="PNG").click()
    download = download_info.value
    assert download.suggested_filename.endswith(".png")

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
    mobile.goto("http://127.0.0.1:4173/index.html")
    mobile.wait_for_load_state("networkidle")
    expect(mobile.locator("#route-viewport")).to_be_visible()
    assert mobile.locator("#route-viewport").evaluate("el => el.scrollWidth >= el.clientWidth")
    mobile.close()
    mobile_context.close()

    page.screenshot(path="/tmp/dayflow-smoke.png", full_page=True)
    assert not console_errors, console_errors
    browser.close()
    print("browser smoke: PASS")
