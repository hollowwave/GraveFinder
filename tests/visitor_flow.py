import json, sys, urllib.request, urllib.parse

API = 'http://127.0.0.1:4000/api'
ok_all = True

def get(path):
    return json.load(urllib.request.urlopen(API + path))

def post(path, body, token=None):
    req = urllib.request.Request(API + path, json.dumps(body).encode(), {'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + token} if token else {})})
    return json.load(urllib.request.urlopen(req))

def check(name, ok):
    global ok_all
    ok_all &= ok
    print(('PASS ' if ok else 'FAIL ') + name)

q = lambda s: get('/records?q=' + urllib.parse.quote(s))
check('search by first name', any(r['full_name'].startswith('Eleanor') for r in q('eleanor')))
check('search by last name', len(q('villareal')) == 1)
check('search by partial name', len(q('vill')) >= 2)
check('search by full name', len(q('Ramon Dela Cruz')) == 1)
check('search with no match is empty', q('zzzzqq') == [])

c = get('/cemetery')
b = c['bounds']
graves = get('/graves')
inside = all(b['minLat'] <= g['latitude'] <= b['maxLat'] and b['minLng'] <= g['longitude'] <= b['maxLng'] for g in graves)
check('all graves lie inside the cemetery boundary', inside)
check('every record has a grave with coordinates', all(r['grave_id'] and r['latitude'] for r in q('')))
check('no two records share a grave', len({r['grave_id'] for r in q('')}) == len(q('')))

tok = post('/login', {'username': 'admin', 'password': 'admin123'})['token']
free = [g for g in graves if g['status'] == 'available'][3]
new = post('/records', {'full_name': 'Visitor Flow Person', 'date_of_death': '2026-11-02', 'grave_id': free['id']}, tok)
found = q('flow person')
check('new record is found by the visitor search', len(found) == 1)
detail = get('/records/%d' % found[0]['id'])
check('record detail matches the assigned grave', detail['grave_id'] == free['id'] and detail['latitude'] == free['latitude'])
check('map data shows that grave occupied by the person', [g for g in get('/graves') if g['id'] == free['id']][0]['occupant'] == 'Visitor Flow Person')
req = urllib.request.Request(API + '/records/%d' % new['id'], method='DELETE', headers={'Authorization': 'Bearer ' + tok})
urllib.request.urlopen(req)
print('\nALL PASSED' if ok_all else '\nSOME FAILED')
sys.exit(0 if ok_all else 1)
