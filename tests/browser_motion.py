"""Interaction regressions; use the same local server as browser_smoke.py."""
import os
import re
from pathlib import Path
import struct
import tempfile
import xml.etree.ElementTree as ET
from playwright.sync_api import sync_playwright, expect

BASE_URL = os.environ.get('DAYFLOW_BASE_URL', 'http://127.0.0.1:4173')
OUTPUT = Path(tempfile.gettempdir()) / 'dayflow-motion'
OUTPUT.mkdir(exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(locale='ru-RU', viewport={'width': 1440, 'height': 1100}, accept_downloads=True)
    page = context.new_page()
    page.set_default_timeout(60000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(BASE_URL)
    page.wait_for_load_state('networkidle')
    page.locator('#load-demo').click()
    page.locator('[data-mode-choice="arcade"]').click()
    page.evaluate('''() => {
        window.originalNodes = [...document.querySelectorAll('[data-event-id]')];
        window.animationTargets = [];
        const animate = Element.prototype.animate;
        Element.prototype.animate = function(...args) {
            window.animationTargets.push(this);
            return animate.apply(this, args);
        };
    }''')
    page.locator('.agenda-select').nth(1).click()
    assert page.evaluate('window.originalNodes.every(node => node.isConnected)'), 'selection replaced interactive nodes'
    page.locator('.agenda-check').nth(1).focus()
    page.keyboard.press('Space')
    expect(page.locator('#metric-done')).to_have_text('01')
    assert page.evaluate('window.originalNodes.every(node => node.isConnected)'), 'completion replaced interactive nodes'
    assert page.evaluate('document.activeElement === window.originalNodes.find(n => n.dataset.surface === "check" && n.ariaPressed === "true")')
    # Selecting another event cannot replay the completion of the first event.
    page.evaluate('window.animationTargets = []')
    page.locator('.agenda-select').nth(2).click()
    assert page.evaluate('window.animationTargets.every(n => n.closest(".agenda-row")?.querySelector(".agenda-check")?.ariaPressed !== "true")')
    page.locator('[data-mode-choice="calm"]').click()
    assert page.evaluate('window.originalNodes.every(node => node.isConnected)'), 'mode replaced interactive nodes'
    # Repeated selection preserves text selection and does not restart motion.
    page.evaluate('''() => {
        const range = document.createRange(); range.selectNodeContents(document.querySelector('#detail-title'));
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
        window.animationTargets = [];
        document.querySelector('.agenda-select[aria-pressed="true"]').click();
    }''')
    assert page.evaluate('getSelection().toString() === document.querySelector("#detail-title").textContent')
    assert page.evaluate('window.animationTargets.length === 0')
    # Pointer targets stay fixed throughout a press.
    button = page.locator('#open-manual')
    box = button.bounding_box()
    page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2)
    page.mouse.down()
    pressed = button.bounding_box()
    assert all(abs(box[k] - pressed[k]) < .1 for k in ('x', 'y', 'width', 'height')), (box, pressed)
    page.mouse.up()
    page.locator('#cancel-manual').click()
    # A system preference change cancels in-flight effects, not just future effects.
    page.locator('[data-mode-choice="arcade"]').click()
    page.locator('.agenda-check').nth(2).click()
    page.emulate_media(reduced_motion='reduce')
    page.wait_for_function('document.getAnimations().filter(a => a.playState === "running").length === 0')
    page.evaluate('window.animationTargets = []')
    for _ in range(8):
        page.locator('.agenda-check').nth(2).press('Space')
    expect(page.locator('.agenda-check').nth(2)).to_have_attribute('aria-pressed', 'true')
    assert page.evaluate('window.animationTargets.length === 0')
    expect(page.locator('#toast')).to_contain_text('выполненным')
    page.emulate_media(reduced_motion='no-preference')
    print('motion: stable targets, focus, repeated actions and reduced motion PASS', flush=True)

    # Nested drag targets do not flicker; ordinary text drags are ignored.
    page.evaluate('''() => {
        const drop = document.querySelector('#drop-zone'); const child = drop.querySelector('strong');
        const transfer = new DataTransfer(); transfer.items.add(new File(['test'], 'test.ics'));
        drop.dispatchEvent(new DragEvent('dragenter', {bubbles: true, dataTransfer: transfer}));
        child.dispatchEvent(new DragEvent('dragenter', {bubbles: true, dataTransfer: transfer}));
        drop.dispatchEvent(new DragEvent('dragleave', {bubbles: true, dataTransfer: transfer}));
    }''')
    expect(page.locator('#drop-zone')).to_have_class(re.compile('is-dragging'))
    page.evaluate('document.querySelector("#drop-zone strong").dispatchEvent(new DragEvent("dragleave", {bubbles:true}))')
    assert not page.locator('#drop-zone').evaluate('el => el.classList.contains("is-dragging")')
    page.evaluate('''() => {
        const transfer = new DataTransfer(); transfer.setData('text/plain', 'a selected sentence');
        document.querySelector('#drop-zone').dispatchEvent(new DragEvent('dragenter', {bubbles:true, dataTransfer:transfer}));
    }''')
    assert not page.locator('#drop-zone').evaluate('el => el.classList.contains("is-dragging")')

    # Undo returns keyboard focus to the exact slot surface used to create.
    page.locator('#fit-day').click()
    origin_slot = page.locator('.free-window').first
    slot_start = origin_slot.get_attribute('data-slot-start')
    origin_slot.focus()
    page.keyboard.press('Enter')
    page.locator('[name="title"]').fill('проверка возврата фокуса')
    page.locator('[type="submit"]').click()
    page.locator('#undo-action').click()
    expect(page.locator(f'.free-window[data-slot-start="{slot_start}"]')).to_be_focused()

    # A new record appears at its time; editing links the previous/new positions.
    page.set_viewport_size({'width': 1440, 'height': 1800})
    page.evaluate('window.scrollTo(0, 0)')
    page.locator('#open-manual').click()
    page.locator('[name="title"]').fill('проверка движения')
    page.locator('[name="start"]').fill('11:00')
    page.locator('[name="end"]').fill('12:00')
    page.locator('[type="submit"]').click()
    expect(page.locator('#detail-title')).to_have_text('проверка движения')
    record = page.locator('.station').filter(has_text='проверка движения')
    before = record.bounding_box()
    expect(record).to_have_attribute('aria-pressed', 'true')
    page.locator('#edit-event').click()
    page.locator('[name="start"]').fill('14:00')
    page.locator('[name="end"]').fill('15:00')
    page.evaluate('''() => {
        const animate = Element.prototype.animate;
        Element.prototype.animate = function(...args) {
            const animation = animate.apply(this, args);
            if (this.classList.contains('motion-record')) animation.pause();
            return animation;
        };
    }''')
    page.locator('[type="submit"]').click()
    expect(page.locator('#detail-time')).to_have_text('14:00 - 15:00')
    assert record.bounding_box()['x'] > before['x']
    # Freeze just the decorative copy to verify the link exists, then resume.
    assert page.evaluate('''() => {
        const ghost = document.querySelector('.motion-record');
        if (!ghost) return false;
        ghost.getAnimations().forEach(a => a.pause());
        return ghost.ariaHidden === 'true' && getComputedStyle(ghost).pointerEvents === 'none';
    }'''), 'editing lost the visual connection between timeline positions'
    page.screenshot(path=str(OUTPUT / 'edit-link.png'))
    page.evaluate('document.querySelector(".motion-record").getAnimations().forEach(a => a.play())')
    page.wait_for_function('document.querySelectorAll(".motion-flight").length === 0')
    # Completion has one stamp, and navigating mid-flight removes it immediately.
    page.locator('.agenda-select[aria-pressed="true"]').locator('..').locator('.agenda-check').click()
    assert page.locator('.motion-stamp').count() == 1
    page.locator('#next-day').click()
    assert page.locator('.motion-flight').count() == 0
    # Rapid mode/day changes keep the final state usable and cancel stale effects.
    for _ in range(4):
        page.locator('[data-mode-choice="calm"]').click()
        page.locator('#previous-day').click()
        page.locator('[data-mode-choice="arcade"]').click()
        page.locator('#next-day').click()
    page.locator('#previous-day').click()
    expect(page.locator('.agenda-select')).to_have_count(6)
    page.set_viewport_size({'width': 1440, 'height': 1100})
    print('motion: creation, edit connection and interrupted transitions PASS', flush=True)

    # The newest file wins even if an earlier File.text() resolves later.
    day = page.locator('#day-picker').input_value().replace('-', '')
    def ics(uid, title):
        return f'BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:{uid}\nDTSTART:{day}T120000\nDTEND:{day}T130000\nSUMMARY:{title}\nEND:VEVENT\nEND:VCALENDAR'
    page.evaluate('''() => {
        const read = File.prototype.text;
        File.prototype.text = function() {
            if (this.name === 'slow.ics') return new Promise(resolve => { window.finishSlowFile = () => read.call(this).then(resolve); });
            return read.call(this);
        };
    }''')
    page.locator('#ics-file').set_input_files({'name': 'slow.ics', 'mimeType': 'text/calendar', 'buffer': ics('old', 'старый файл').encode()})
    expect(page.locator('#drop-zone')).to_have_attribute('aria-busy', 'true')
    page.locator('#ics-file').set_input_files({'name': 'fast.ics', 'mimeType': 'text/calendar', 'buffer': ics('new', 'новый файл').encode()})
    expect(page.locator('.agenda-name')).to_have_text('новый файл')
    page.evaluate('window.finishSlowFile()')
    expect(page.locator('.agenda-name')).to_have_text('новый файл')
    expect(page.locator('#drop-zone')).to_have_attribute('aria-busy', 'false')
    print('motion: nested file drag and latest import PASS', flush=True)

    # Export while completion is moving contains the final data, no editor effects.
    page.locator('.agenda-check').click()
    with page.expect_download() as info:
        page.locator('#export-svg').click()
    svg_path = OUTPUT / 'export.svg'
    info.value.save_as(str(svg_path))
    svg_text = svg_path.read_text()
    svg = ET.fromstring(svg_text)
    assert '✓ новый файл' in ''.join(svg.itertext())
    assert '<animate' not in svg_text and 'motion-flight' not in svg_text
    # PNG is a snapshot of the day at click time, even when navigation interrupts.
    export_day = page.locator('#day-picker').input_value()
    page.evaluate('''() => {
        const toBlob = HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.toBlob = function(callback, ...args) {
            toBlob.call(this, blob => { window.finishPng = () => callback(blob); }, ...args);
        };
    }''')
    page.locator('#export-png').click()
    page.wait_for_function('typeof window.finishPng === "function"')
    expect(page.locator('#export-png')).to_have_attribute('aria-busy', 'true')
    page.locator('#next-day').click()
    with page.expect_download() as info:
        page.evaluate('window.finishPng()')
    assert info.value.suggested_filename == f'dayflow-arcade-{export_day}.png'
    png_path = OUTPUT / 'export.png'
    info.value.save_as(str(png_path))
    assert struct.unpack('>II', png_path.read_bytes()[16:24])[0] >= 1600
    expect(page.locator('#export-png')).to_have_attribute('aria-busy', 'false')
    page.locator('#previous-day').click()
    page.reload()
    page.wait_for_load_state('networkidle')
    expect(page.locator('.agenda-check')).to_have_attribute('aria-pressed', 'true')
    # App still works with the network offline after loading.
    context.set_offline(True)
    page.locator('.agenda-select').click()
    page.locator('.agenda-check').click()
    expect(page.locator('#metric-done')).to_have_text('00')
    context.set_offline(False)
    print('motion: final-state exports, persistence and offline use PASS', flush=True)
    page.screenshot(path=str(OUTPUT / 'desktop.png'), full_page=True)

    # Large data and a touch viewport retain every action without hover.
    mobile_context = browser.new_context(locale='ru-RU', viewport={'width': 320, 'height': 900}, has_touch=True, is_mobile=True)
    mobile = mobile_context.new_page()
    mobile.on('pageerror', lambda error: errors.append(str(error)))
    mobile.goto(BASE_URL)
    mobile.wait_for_load_state('networkidle')
    compact_day = mobile.locator('#day-picker').input_value().replace('-', '')
    events = '\n'.join(f'BEGIN:VEVENT\nUID:large-{i}\nDTSTART:{compact_day}T120000\nDTEND:{compact_day}T130000\nSUMMARY:{"длинное название " * 25}{i}\nEND:VEVENT' for i in range(60))
    mobile.locator('#ics-file').set_input_files({'name': 'large.ics', 'mimeType': 'text/calendar', 'buffer': f'BEGIN:VCALENDAR\n{events}\nEND:VCALENDAR'.encode()})
    expect(mobile.locator('.agenda-select')).to_have_count(60)
    last_title = mobile.locator('.agenda-name').nth(59).inner_text()
    mobile.locator('.agenda-select').nth(59).click()
    expect(mobile.locator('#detail-title')).to_have_text(last_title)
    mobile.locator('.agenda-check').nth(59).click()
    expect(mobile.locator('#metric-done')).to_have_text('01')
    assert mobile.evaluate('document.documentElement.scrollWidth === innerWidth')
    assert mobile.evaluate('document.getAnimations().filter(a => a.playState === "running").length <= 8')
    mobile.screenshot(path=str(OUTPUT / 'mobile-large-data.png'))
    mobile_context.close()
    assert not errors, errors
    context.close()
    browser.close()
    print('browser motion: PASS')
