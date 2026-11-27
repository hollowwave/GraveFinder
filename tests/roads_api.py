# API: road network editing and walking routes. Run against a freshly seeded database.
import json, sys, urllib.request, urllib.error
API = 'http://127.0.0.1:4000/api'
ok_all = True
def call(method, path, body=None, tok=None):
    r = urllib.request.Request(API + path, json.dumps(body).encode() if body is not None else None,
                               {'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + tok} if tok else {})}, method=method)
    try:
        x = urllib.request.urlopen(r); t = x.read(); return x.status, (json.loads(t) if t else None)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')
def check(name, ok):
    global ok_all; ok_all &= bool(ok); print(('PASS ' if ok else 'FAIL ') + name)

tok = call('POST', '/login', {'username': 'admin', 'password': 'admin123'})[1]['token']
c = call('GET', '/cemetery')[1]; ctr = c['center']; g = call('GET', '/graves')[1]
check('roads list starts empty', call('GET', '/roads')[1] == {'nodes': [], 'edges': []})
check('route with no paths falls back to a straight line', call('GET', '/route?lat=%f&lng=%f&grave_id=%d' % (ctr['latitude'], ctr['longitude'], g[0]['id']))[1]['on_road'] is False)
check('adding a path point needs admin', call('POST', '/roads/nodes', {'latitude': ctr['latitude'], 'longitude': ctr['longitude']})[0] == 401)
check('path point outside the boundary is refused', call('POST', '/roads/nodes', {'latitude': 14.52, 'longitude': 121.05}, tok)[0] == 400)
d = 0.00004
a = call('POST', '/roads/nodes', {'latitude': ctr['latitude'], 'longitude': ctr['longitude']}, tok)[1]
b = call('POST', '/roads/nodes', {'latitude': ctr['latitude'], 'longitude': ctr['longitude'] + d}, tok)[1]
e = call('POST', '/roads/edges', {'a': a['id'], 'b': b['id']}, tok)
check('two points can be connected', e[0] == 201)
check('connecting the same pair twice is refused', call('POST', '/roads/edges', {'a': b['id'], 'b': a['id']}, tok)[0] == 409)
east = max(g, key=lambda x: x['longitude'])  # nearest path point to this grave is the far end (b), not the start (a)
r = call('GET', '/route?lat=%f&lng=%f&grave_id=%d' % (ctr['latitude'], ctr['longitude'], east['id']))[1]
check('route now follows the path network', r['on_road'] is True and len(r['points']) >= 3)
check('route survives deleting every grave but unknown grave is 404', call('GET', '/route?lat=1&lng=1&grave_id=99999')[0] == 404)
call('DELETE', '/roads/nodes/%d' % a['id'], tok=tok)
check('deleting a point removes its paths', call('GET', '/roads')[1]['edges'] == [])
call('DELETE', '/roads/nodes/%d' % b['id'], tok=tok)
print('\nALL PASSED' if ok_all else '\nSOME FAILED'); sys.exit(0 if ok_all else 1)
