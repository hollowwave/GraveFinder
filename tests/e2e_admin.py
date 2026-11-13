import json, sys, urllib.request
from playwright.sync_api import sync_playwright

BASE = 'http://127.0.0.1:5173'
API = 'http://127.0.0.1:4000/api'
results = []

def check(name, ok, extra=''):
    results.append((name, ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{extra}]' if extra and not ok else ''))

def api(path):
    return json.load(urllib.request.urlopen(API + path))

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1366, 'height': 820})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'tile.openstreetmap' not in m.text and 'ERR_' not in m.text and 'Failed to load resource' not in m.text else None)

    page.goto(BASE)
    page.fill('input >> nth=0', 'admin')
    page.fill('input[type=password]', 'wrong')
    page.click('text=Log in')
    page.wait_for_selector('.error')
    check('login rejects bad password', page.locator('.error').count() == 1)
    page.screenshot(path='/tmp/shots/01_login.png')
    page.fill('input[type=password]', 'admin123')
    page.click('text=Log in')
    page.wait_for_selector('text=Burial records')
    check('login succeeds and overview shows stats', page.locator('dl.facts dd').first.inner_text() == '26')
    page.screenshot(path='/tmp/shots/02_overview.png')

    page.click('.rail >> text=Burial records')
    page.wait_for_selector('tbody tr:has-text("Castillo")')
    check('records table lists 26', page.locator('tbody tr').count() == 26)
    page.fill('input[placeholder="Search by name"]', 'castillo')
    page.wait_for_timeout(500)
    check('search filters by partial name', page.locator('tbody tr').count() == 1)
    page.fill('input[placeholder="Search by name"]', '')
    page.select_option('select >> nth=0', 'B')
    page.wait_for_timeout(500)
    check('section filter works', page.locator('tbody tr').count() == 7, str(page.locator('tbody tr').count()))
    page.select_option('select >> nth=0', '')
    page.wait_for_timeout(400)

    page.click('text=New record')
    page.click('text=Create record')
    check('form validation blocks empty submit', page.locator('.dialog .error').count() == 2)
    page.fill('.dialog input >> nth=0', 'Demo Visitor Target')
    page.locator('.dialog input[type=date]').nth(0).fill('1950-05-05')
    page.locator('.dialog input[type=date]').nth(1).fill('2026-11-01')
    page.locator('.dialog input[type=date]').nth(2).fill('2026-11-04')
    page.click('text=Pick grave on map')
    page.wait_for_selector('.dialog .leaflet-container')
    page.wait_for_timeout(800)
    n_free = page.locator('.dialog path.leaflet-interactive').count()
    check('map shows only available graves', n_free == 70, str(n_free))
    page.screenshot(path='/tmp/shots/03_form_map.png')
    page.locator('.dialog path.leaflet-interactive').nth(40).dispatch_event('click')
    page.wait_for_timeout(300)
    sel_text = page.locator('.dialog .muted').first.inner_text()
    check('clicking a grave on the map assigns it', 'Selected:' in sel_text, sel_text)
    chosen_number = sel_text.split('Selected: ')[1].split(' at ')[0]
    page.click('text=Create record')
    page.wait_for_selector('text=Record created')
    rec = api('/records?q=demo%20visitor')
    check('record saved in shared database', len(rec) == 1 and rec[0]['grave_number'] == chosen_number)
    graves = api('/graves')
    g = [x for x in graves if x['grave_number'] == chosen_number][0]
    check('assigned grave marked occupied', g['status'] == 'occupied' and g['occupant'] == 'Demo Visitor Target')
    page.screenshot(path='/tmp/shots/04_after_create.png')

    page.fill('input[placeholder="Search by name"]', 'demo visitor')
    page.wait_for_timeout(500)
    page.click('tbody >> text=Edit')
    page.fill('.dialog input >> nth=0', 'Demo Visitor Edited')
    page.click('text=Save changes')
    page.wait_for_selector('text=Changes saved')
    check('edit persists', len(api('/records?q=edited')) == 1)

    page.fill('input[placeholder="Search by name"]', 'edited')
    page.wait_for_timeout(500)
    dialogs = []
    page.once('dialog', lambda d: (dialogs.append(d.message), d.dismiss()))
    page.click('tbody >> text=Delete')
    check('delete asks for confirmation', len(dialogs) == 1)
    check('cancelled delete keeps record', len(api('/records?q=edited')) == 1)
    page.once('dialog', lambda d: d.accept())
    page.click('tbody >> text=Delete')
    page.wait_for_selector('text=Deleted Demo Visitor Edited')
    g = [x for x in api('/graves') if x['grave_number'] == chosen_number][0]
    check('delete removes record and frees grave', not api('/records?q=edited') and g['status'] == 'available')

    page.click('.rail >> text=Cemetery map')
    page.wait_for_selector('.leaflet-container')
    page.wait_for_timeout(800)
    page.screenshot(path='/tmp/shots/05_map.png')
    total = page.locator('.mapgrid path.leaflet-interactive').count()
    check('map page draws all 96 graves plus 5 polygons', total >= 96, str(total))
    page.locator('.mapgrid path.leaflet-interactive[fill="#8c3b34"]').first.dispatch_event('click')
    page.wait_for_timeout(300)
    check('selecting occupied grave shows occupant', 'Occupied by' in page.locator('.panel').inner_text())
    page.click('text=Remove assignment')
    page.wait_for_selector('text=Grave is now available')
    check('unassign frees grave', len(api('/graves?status=available')) == 71)
    page.wait_for_timeout(400)
    sel = page.locator('.panel select')
    sel.select_option(index=1)
    page.click('button:has-text("Assign")')
    page.wait_for_selector('text=Grave assigned')
    check('assign from map page', len(api('/graves?status=available')) == 70)

    page.click('text=Move this grave')
    box = page.locator('.mapgrid .leaflet-container').bounding_box()
    page.mouse.click(box['x'] + 120, box['y'] + 120)
    lat_before = page.locator('.panel input >> nth=0').input_value()
    page.click('text=Save coordinates')
    page.wait_for_selector('text=Coordinates saved')
    check('move grave saves coordinates', lat_before != '')

    page.click('button:has-text("Add a grave")')
    page.mouse.click(box['x'] + 5, box['y'] + 5)
    page.wait_for_selector('text=outside the cemetery boundary')
    check('admin map refuses a click outside the boundary', page.locator('.panel label:has-text("Latitude") input').input_value() == '')
    page.mouse.click(box['x'] + 200, box['y'] + 200)
    page.locator('.panel label:has-text("Grave number") input').fill('Z9-R1-01')
    page.click('button:has-text("Add grave")')
    page.wait_for_selector('text=Grave added')
    check('add grave persists', len(api('/graves')) == 97)

    check('place search and back button are gone', page.locator('text=Find place').count() == 0 and page.locator('text=Back to cemetery').count() == 0)
    measure = '''() => {
      const c = document.querySelector('.mapgrid .leaflet-container').getBoundingClientRect();
      const b = document.querySelector('.mapgrid path[stroke-dasharray]').getBoundingClientRect();
      const overlaps = b.right > c.left && b.left < c.right && b.bottom > c.top && b.top < c.bottom;
      const g = [...document.querySelectorAll('.mapgrid path.leaflet-interactive')].filter(p => p.getBoundingClientRect().width < 30).slice(0, 2).map(p => p.getBoundingClientRect());
      const spacing = Math.abs((g[1].left + g[1].width / 2) - (g[0].left + g[0].width / 2));
      return { width: spacing, overlaps };
    }'''
    before = page.evaluate(measure)
    page.mouse.move(box['x'] + 300, box['y'] + 300)
    page.mouse.down(); page.mouse.move(box['x'] + 2000, box['y'] + 1500, steps=10); page.mouse.up()
    for _ in range(6):
        page.mouse.wheel(0, 600)
        page.wait_for_timeout(150)
    page.wait_for_timeout(600)
    after = page.evaluate(measure)
    check('map cannot be dragged away from the cemetery', after['overlaps'], str(after))
    check('map cannot be zoomed out past the cemetery view', after['width'] >= before['width'] * 0.98, f"{before['width']} -> {after['width']}")
    page.screenshot(path='/tmp/shots/07_locked.png')

    page.set_viewport_size({'width': 390, 'height': 800})
    page.screenshot(path='/tmp/shots/06_narrow.png')
    check('no JS errors during run', not errors, '; '.join(errors)[:300])
    browser.close()

failed = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(failed)}/{len(results)} passed')
sys.exit(1 if failed else 0)
