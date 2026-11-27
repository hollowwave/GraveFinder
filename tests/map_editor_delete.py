# Run against a freshly seeded database (npm run seed in server/). Changes data: reseed afterwards.
import json, urllib.request, urllib.error
from playwright.sync_api import sync_playwright
API='http://127.0.0.1:4000/api'
res=[]
def check(n,ok,x=''):
    res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ')+n+(f'  [{x}]' if x and not ok else ''))
def api(p): return json.load(urllib.request.urlopen(API+p))
def raw(method,path,body=None,tok=None):
    r=urllib.request.Request(API+path,json.dumps(body).encode() if body is not None else None,{'Content-Type':'application/json',**({'Authorization':'Bearer '+tok} if tok else {})},method=method)
    try:
        x=urllib.request.urlopen(r); t=x.read(); return x.status,(json.loads(t) if t else None)
    except urllib.error.HTTPError as e: return e.code,json.loads(e.read() or b'{}')
tok=json.load(urllib.request.urlopen(urllib.request.Request(API+'/login',json.dumps({'username':'admin','password':'admin123'}).encode(),{'Content-Type':'application/json'})))['token']

# ---- API level
g=api('/graves'); occ=[x for x in g if x['status']=='occupied'][0]
check('API: plain delete of occupied grave still refused (409)', raw('DELETE','/graves/%d'%occ['id'],tok=tok)[0]==409)
check('API: unauthenticated delete refused', raw('DELETE','/graves/%d?unassign=true'%occ['id'])[0]==401)
check('API: bulk delete refuses occupied without unassign, deletes nothing', raw('POST','/graves/bulk-delete',{'ids':[occ['id']]},tok)[0]==409 and len(api('/graves'))==96)
check('API: bulk delete rejects bad body', raw('POST','/graves/bulk-delete',{'ids':'x'},tok)[0]==400)
st,body=raw('DELETE','/graves/%d?unassign=true'%occ['id'],tok=tok)
rec=api('/records/%d'%occ['record_id'])
check('API: unassign-delete removes grave, keeps record without grave', st==204 and len(api('/graves'))==95 and rec['grave_id'] is None and rec['full_name'])
check('API: status counts consistent after delete', api('/stats')['occupiedGraves']==25)

# ---- UI
with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1366,'height':900})
    errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)))
    pg.goto('http://127.0.0.1:5173'); pg.fill('input >> nth=0','admin'); pg.fill('input[type=password]','admin123'); pg.click('text=Log in')
    pg.wait_for_selector('text=Burial records'); pg.click('.rail >> text=Cemetery map'); pg.wait_for_selector('.leaflet-container'); pg.wait_for_timeout(1200)
    n0=len(api('/graves'))
    # single delete of an OCCUPIED grave
    pg.locator('.mapgrid path.leaflet-interactive[fill="#2f5d50"]').first.dispatch_event('click'); pg.wait_for_timeout(300)
    check('UI: Delete button now shown for occupied grave', pg.locator('button:has-text("Delete grave")').count()==1)
    pg.click('button:has-text("Delete grave")')
    check('UI: confirm explains the record is kept', 'burial record is kept' in pg.locator('.panel').inner_text())
    pg.click('button:has-text("Yes, delete")'); pg.wait_for_timeout(700)
    check('UI: occupied grave deleted', len(api('/graves'))==n0-1, str(len(api('/graves'))))
    check('UI: success message names kept record', 'kept' in pg.locator('.notice').first.inner_text())
    pg.screenshot(path='/tmp/shots/s1_single.png')

    # multi-select: whole section B + two clicks
    pg.click('button:has-text("Select graves to delete")'); pg.wait_for_timeout(300)
    pg.select_option('.panel select','B'); pg.wait_for_timeout(300)
    nB=len([x for x in api('/graves') if x['section']=='B'])
    check('UI: whole-section pick selects every B grave', pg.locator('.panel strong').first.inner_text()==str(nB), pg.locator('.panel strong').first.inner_text())
    check('UI: warns about burial records', 'burial record' in pg.locator('.panel .warn').inner_text())
    pg.screenshot(path='/tmp/shots/s2_multi.png')
    pg.click('button:has-text("Delete selected")'); pg.click('button:has-text("Yes, delete")'); pg.wait_for_timeout(800)
    left=api('/graves')
    check('UI: section B deleted in one step', not [x for x in left if x['section']=='B'] and len(left)==n0-1-nB, str(len(left)))
    check('UI: records of B kept, now unassigned', all(r['grave_id'] is None for r in api('/records?q=Corazon')) and len(api('/records'))==26)
    # every grave
    pg.click('button:has-text("Select graves to delete")'); pg.click('button:has-text("Every grave")'); pg.click('button:has-text("Delete selected")'); pg.click('button:has-text("Yes, delete")'); pg.wait_for_timeout(800)
    check('UI: "Every grave" empties the map', api('/graves')==[], str(len(api('/graves'))))
    check('UI: map page still renders with zero graves', pg.locator('.leaflet-container').count()==1 and not errs, str(errs))
    b.close()
print(f'{sum(res)}/{len(res)} passed')
import sys; sys.exit(0 if all(res) else 1)
