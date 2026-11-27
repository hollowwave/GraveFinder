# Run against a freshly seeded database (npm run seed in server/). Changes data: reseed afterwards.
import json, urllib.request, urllib.error
from playwright.sync_api import sync_playwright
API='http://127.0.0.1:4000/api'; OUT='/tmp/shots/'
res=[]
def check(n,ok,x=''):
    res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+n+(f'  [{x}]' if x and not ok else ''))
def api(p): return json.load(urllib.request.urlopen(API+p))
def raw(method,path,body=None,tok=None):
    r=urllib.request.Request(API+path,json.dumps(body).encode() if body is not None else None,{'Content-Type':'application/json',**({'Authorization':'Bearer '+tok} if tok else {})},method=method)
    try:
        x=urllib.request.urlopen(r); t=x.read(); return x.status,(json.loads(t) if t else None)
    except urllib.error.HTTPError as e: return e.code,json.loads(e.read() or b'{}')
def cx(el): b=el.bounding_box(); return b['x']+b['width']/2, b['y']+b['height']/2

with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1366,'height':900})
    errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto('http://127.0.0.1:5173'); pg.fill('input >> nth=0','admin'); pg.fill('input[type=password]','admin123'); pg.click('text=Log in')
    pg.wait_for_selector('text=Burial records'); pg.click('.rail >> text=Cemetery map'); pg.wait_for_selector('.leaflet-container'); pg.wait_for_timeout(1200)
    box=pg.locator('.mapgrid .leaflet-container').bounding_box()
    pg.click('button:has-text("Edit boundary")'); pg.wait_for_timeout(400)
    V=pg.locator('.vertex')
    check('starts with the 4 existing corners', V.count()==4)
    # select by click + button
    V.nth(0).click(); pg.wait_for_timeout(200)
    check('click selects a point (red)', pg.locator('.vertex.sel').count()==1 and 'point 1 selected' in pg.locator('.panel').inner_text())
    pg.click('button:has-text("Delete selected point")'); pg.wait_for_timeout(300)
    check('Delete-selected button removes it', V.count()==3)
    # keyboard
    V.nth(0).click(); pg.keyboard.press('Delete'); pg.wait_for_timeout(300)
    check('Delete key removes selected point', pg.locator('.vertex').count()==2)
    pg.click('button:has-text("Undo last point")'); pg.wait_for_timeout(200)
    # back to a clean 4-corner rectangle for the insertion test
    pg.click('button:has-text("Cancel")'); pg.wait_for_timeout(300)
    pg.click('button:has-text("Edit boundary")'); pg.wait_for_timeout(400)
    V=pg.locator('.vertex')
    x2,y2=cx(V.nth(2)); x3,y3=cx(V.nth(3))
    top_y=min(y2,y3)
    pg.mouse.click((x2+x3)/2, top_y-25); pg.wait_for_timeout(300)  # just above the top edge (v3->v4)
    check('new corner is inserted into the nearest edge, not the end', V.count()==5)
    xs=[cx(V.nth(i))[0] for i in range(5)]
    check('  ...between points 3 and 4', min(xs[2],xs[4])<xs[3]<max(xs[2],xs[4]) or abs(xs[3]-(xs[2]+xs[4])/2)<5, str([round(x) for x in xs]))
    # right-click still works
    V.nth(3).click(button='right'); pg.wait_for_timeout(300)
    check('right-click still deletes a point', V.count()==4)

    # ---- redraw a boundary around the left half only
    pg.click('button:has-text("Start over")'); pg.wait_for_timeout(200)
    check('start over clears the draft', pg.locator('.vertex').count()==0 and pg.locator('button:has-text("Save boundary")').is_disabled())
    x0,y0,w,h=box['x'],box['y'],box['width'],box['height']
    for (px,py) in [(x0+w*0.30,y0+h*0.25),(x0+w*0.50,y0+h*0.25),(x0+w*0.50,y0+h*0.75),(x0+w*0.30,y0+h*0.75)]:
        pg.mouse.click(px,py); pg.wait_for_timeout(150)
    pg.wait_for_timeout(300)
    txt=pg.locator('.panel').inner_text()
    check('live count of graves outside is shown', 'outside (shown in red)' in txt, txt[:300])
    n_out=int(txt.split('Graves outside the new shape')[1].split()[0]) if False else None
    pg.screenshot(path=OUT+'s3_boundary_draft.png')
    pg.click('button:has-text("Save boundary")'); pg.wait_for_timeout(700)
    check('default mode refuses with clear message', 'would fall outside' in pg.locator('.notice').first.inner_text() and len(api('/graves'))==96)
    pg.locator('label.radio:has-text("Delete the graves that are outside") input').check(); pg.wait_for_timeout(200)
    pg.click('button:has-text("Save boundary")'); pg.wait_for_timeout(300)
    check('delete mode asks for confirmation first', 'Delete' in pg.locator('.panel .warn').last.inner_text() and len(api('/graves'))==96)
    pg.screenshot(path=OUT+'s4_confirm.png')
    before=api('/graves'); recs_before=len(api('/records'))
    pg.click('button:has-text("Yes, delete and save")'); pg.wait_for_timeout(900)
    after=api('/graves'); ring=api('/cemetery')['geojson']['features'][0]['geometry']['coordinates'][0]
    def inside(lat,lng):
        ins=False
        for i in range(len(ring)):
            xi,yi=ring[i]; xj,yj=ring[i-1]
            if (yi>lat)!=(yj>lat) and lng<(xj-xi)*(lat-yi)/(yj-yi)+xi: ins=not ins
        return ins
    check('boundary saved with 4 new corners', len(ring)==5)
    check('some graves deleted, some kept', 0<len(after)<len(before), f'{len(before)}->{len(after)}')
    check('every remaining grave is inside the new boundary', all(inside(g['latitude'],g['longitude']) for g in after))
    check('all burial records kept', len(api('/records'))==recs_before==26)
    check('records of deleted graves are unassigned, not removed', any(r['grave_id'] is None for r in api('/records')))
    check('success message reports deletions', 'were deleted' in pg.locator('.notice').first.inner_text() or 'was deleted' in pg.locator('.notice').first.inner_text(), pg.locator('.notice').first.inner_text())
    pg.screenshot(path=OUT+'s5_after.png')
    check('no JS errors', not errs, str(errs))
    b.close()
print(f'{sum(res)}/{len(res)} passed')
import sys; sys.exit(0 if all(res) else 1)
