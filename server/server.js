const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const db = require('./db');
const { generateLayout } = require('./layout');

const app = express();
app.use(cors());
app.use(express.json());

const tokens = new Set();
const hash = (p) => crypto.createHash('sha256').update(String(p)).digest('hex');

const requireAdmin = (req, res, next) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!tokens.has(token)) return res.status(401).json({ error: 'Unauthorized' });
  next();
};

// Public select: used by the visitor mobile app. Never include lease or lessee data here.
const RECORD_SELECT = `
  SELECT r.id, r.full_name, r.date_of_birth, r.date_of_death, r.burial_date, r.grave_id, r.created_at,
         g.section, g.block, g.row, g.grave_number, g.latitude, g.longitude
  FROM burial_records r LEFT JOIN graves g ON g.id = r.grave_id`;

const LEASE_FLAG_SQL = `CASE
  WHEN l.lease_end IS NOT NULL AND l.lease_end < date('now', 'localtime') THEN 'expired'
  WHEN l.lease_end IS NOT NULL AND l.lease_end <= date('now', 'localtime', '+90 days') THEN 'due_soon'
END`;

// Admin select: includes lease and lessee data. Only use behind requireAdmin.
const ADMIN_SELECT = `
  SELECT r.id, r.full_name, r.date_of_birth, r.date_of_death, r.burial_date, r.grave_id, r.created_at,
         g.section, g.block, g.row, g.grave_number, g.latitude, g.longitude,
         l.lessee_name, l.order_of_payment_no, l.official_receipt_no, l.amount, l.paid_date, l.lease_start, l.lease_end,
         COALESCE(l.status, 'unpaid') AS lease_status, COALESCE(l.assigned_via, 'office') AS assigned_via,
         ${LEASE_FLAG_SQL} AS lease_flag
  FROM burial_records r
  LEFT JOIN graves g ON g.id = r.grave_id
  LEFT JOIN leases l ON l.record_id = r.id`;

const isDate = (v) => v === null || v === undefined || v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v));

const validateRecord = (b) => {
  const errors = {};
  if (!b.full_name || !String(b.full_name).trim()) errors.full_name = 'Full name is required';
  if (!b.date_of_death) errors.date_of_death = 'Date of death is required';
  ['date_of_birth', 'date_of_death', 'burial_date'].forEach((f) => {
    if (!isDate(b[f])) errors[f] = 'Use YYYY-MM-DD';
  });
  if (!errors.date_of_birth && !errors.date_of_death && b.date_of_birth && b.date_of_death && b.date_of_birth > b.date_of_death)
    errors.date_of_birth = 'Birth date must be before date of death';
  if (!errors.burial_date && !errors.date_of_death && b.burial_date && b.date_of_death && b.burial_date < b.date_of_death)
    errors.burial_date = 'Burial date cannot be before date of death';
  return errors;
};

const clean = (b) => ({
  full_name: String(b.full_name).trim(),
  date_of_birth: b.date_of_birth || null,
  date_of_death: b.date_of_death,
  burial_date: b.burial_date || null,
  grave_id: b.grave_id ? Number(b.grave_id) : null,
});

const LEASE_KEYS = ['lessee_name', 'order_of_payment_no', 'official_receipt_no', 'amount', 'paid_date', 'lease_start', 'lease_end', 'lease_status', 'assigned_via'];

const validateLease = (b) => {
  const e = {};
  const st = b.lease_status || 'unpaid';
  if (st !== 'provisional' && !String(b.lessee_name || '').trim()) e.lessee_name = 'Lessee name is required';
  if (!['provisional', 'unpaid', 'paid'].includes(st)) e.lease_status = 'Choose provisional, unpaid, or paid';
  ['paid_date', 'lease_start', 'lease_end'].forEach((f) => {
    if (!isDate(b[f])) e[f] = 'Use YYYY-MM-DD';
  });
  const hasAmount = b.amount !== undefined && b.amount !== null && b.amount !== '';
  if (hasAmount && !(Number(b.amount) >= 0)) e.amount = 'Amount must be a number';
  if (!e.lease_start && !e.lease_end && b.lease_start && b.lease_end && b.lease_end <= b.lease_start)
    e.lease_end = 'Lease end must be after lease start';
  if (st === 'paid') {
    if (!String(b.official_receipt_no || '').trim()) e.official_receipt_no = 'Official Receipt number is required when paid';
    if (!hasAmount) e.amount = e.amount || 'Amount is required when paid';
    if (!b.paid_date) e.paid_date = e.paid_date || 'Paid date is required when paid';
  }
  return e;
};

const txt = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());

const cleanLease = (b) => ({
  lessee_name: txt(b.lessee_name),
  order_of_payment_no: txt(b.order_of_payment_no),
  official_receipt_no: txt(b.official_receipt_no),
  amount: txt(b.amount) === null ? null : Number(b.amount),
  paid_date: b.paid_date || null,
  lease_start: b.lease_start || null,
  lease_end: b.lease_end || null,
  status: b.lease_status || 'unpaid',
  assigned_via: b.assigned_via === 'field' ? 'field' : 'office',
});

const saveLease = db.prepare(`
  INSERT INTO leases (record_id, lessee_name, order_of_payment_no, official_receipt_no, amount, paid_date, lease_start, lease_end, status, assigned_via, updated_at)
  VALUES (@record_id, @lessee_name, @order_of_payment_no, @official_receipt_no, @amount, @paid_date, @lease_start, @lease_end, @status, @assigned_via, datetime('now'))
  ON CONFLICT(record_id) DO UPDATE SET
    lessee_name = excluded.lessee_name,
    order_of_payment_no = excluded.order_of_payment_no, official_receipt_no = excluded.official_receipt_no,
    amount = excluded.amount, paid_date = excluded.paid_date, lease_start = excluded.lease_start,
    lease_end = excluded.lease_end, status = excluded.status, assigned_via = excluded.assigned_via,
    updated_at = datetime('now')`);

const receiptDup = (e) => /UNIQUE/.test(String(e.message)) && /official_receipt_no|idx_leases_receipt/.test(String(e.message));
const dupResponse = (res) => res.status(409).json({ errors: { official_receipt_no: 'This Official Receipt number is already used by another record' } });

const checkGrave = (graveId, recordId) => {
  if (!graveId) return null;
  const grave = db.prepare('SELECT id FROM graves WHERE id=?').get(graveId);
  if (!grave) return { status: 404, error: 'Grave not found' };
  const taken = db.prepare('SELECT id FROM burial_records WHERE grave_id=? AND id IS NOT ?').get(graveId, recordId ?? null);
  if (taken) return { status: 409, error: 'Grave is already assigned to another record' };
  return null;
};

const syncStatus = db.prepare(`
  UPDATE graves SET status = CASE WHEN EXISTS (SELECT 1 FROM burial_records WHERE grave_id = graves.id) THEN 'occupied' ELSE 'available' END`);

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare('SELECT * FROM admin_users WHERE username=?').get(username);
  if (!user || user.password_hash !== hash(password)) return res.status(401).json({ error: 'Invalid username or password' });
  const token = crypto.randomBytes(24).toString('hex');
  tokens.add(token);
  res.json({ token, username: user.username });
});

const rectRing = (b) => [
  [b.minLng, b.minLat],
  [b.maxLng, b.minLat],
  [b.maxLng, b.maxLat],
  [b.minLng, b.maxLat],
  [b.minLng, b.minLat],
];

const ringBounds = (ring) => {
  const lats = ring.map((p) => p[1]);
  const lngs = ring.map((p) => p[0]);
  return { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLng: Math.min(...lngs), maxLng: Math.max(...lngs) };
};

const inRing = (lat, lng, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

const centroid = (ring) => {
  const [ox, oy] = ring[0];
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const x0 = ring[i][0] - ox;
    const y0 = ring[i][1] - oy;
    const x1 = ring[i + 1][0] - ox;
    const y1 = ring[i + 1][1] - oy;
    const f = x0 * y1 - x1 * y0;
    a += f;
    cx += (x0 + x1) * f;
    cy += (y0 + y1) * f;
  }
  a /= 2;
  return { longitude: ox + cx / (6 * a), latitude: oy + cy / (6 * a) };
};

const orient = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
const crosses = (a, b, c, d) => orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0;

const parseRing = (input) => {
  if (!Array.isArray(input)) return { error: 'The boundary must be a list of points' };
  let pts = input.map((p) => [Number(p && p[0]), Number(p && p[1])]);
  if (pts.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[1]) > 90 || Math.abs(p[0]) > 180))
    return { error: 'Every point needs a valid latitude and longitude' };
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  if (pts.length > 1 && same(pts[0], pts[pts.length - 1])) pts.pop();
  pts = pts.filter((p, i) => i === 0 || !same(p, pts[i - 1]));
  if (pts.length < 3) return { error: 'A boundary needs at least 3 different points' };
  const b = ringBounds(pts);
  if (b.maxLat - b.minLat > 0.02 || b.maxLng - b.minLng > 0.02) return { error: 'That boundary is too large for one cemetery' };
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (crosses(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return { error: 'The boundary lines cross each other. Move or delete a point.' };
    }
  }
  const closed = [...pts, pts[0]];
  const c = centroid(closed);
  if (!Number.isFinite(c.latitude)) return { error: 'The points do not enclose an area' };
  return { ring: closed };
};

const getBoundary = () => {
  const row = db.prepare('SELECT bounds, boundary FROM cemeteries LIMIT 1').get();
  if (row && row.boundary) return JSON.parse(row.boundary);
  if (row && row.bounds) return rectRing(JSON.parse(row.bounds));
  const a = db.prepare('SELECT MIN(latitude) minLat, MAX(latitude) maxLat, MIN(longitude) minLng, MAX(longitude) maxLng FROM graves').get();
  const pad = 0.00006;
  return rectRing({ minLat: a.minLat - pad, maxLat: a.maxLat + pad, minLng: a.minLng - pad, maxLng: a.maxLng + pad });
};

const checkLocation = (lat, lng) => (inRing(lat, lng, getBoundary()) ? null : 'That location is outside the cemetery boundary');

const GRID_NUMBER = /^[A-D][12]-R[1-3]-0[1-4]$/;

const relayoutInside = (ring, graves) => {
  const c = centroid(ring);
  for (let f = 1; f > 0.05; f *= 0.9) {
    const layout = generateLayout(c, f);
    if (layout.every((p) => inRing(p.latitude, p.longitude, ring))) {
      const byNumber = new Map(layout.map((p) => [p.number, p]));
      return {
        updates: graves.filter((g) => GRID_NUMBER.test(g.grave_number) && byNumber.has(g.grave_number)).map((g) => ({ id: g.id, ...byNumber.get(g.grave_number) })),
      };
    }
  }
  return { error: 'The new boundary is too small or too narrow to fit the sample graves inside it.' };
};

const buildCemeteryPayload = () => {
  const cemetery = db.prepare('SELECT id, name, description FROM cemeteries LIMIT 1').get();
  const rows = db.prepare(`
    SELECT section, MIN(latitude) minLat, MAX(latitude) maxLat, MIN(longitude) minLng, MAX(longitude) maxLng
    FROM graves GROUP BY section ORDER BY section`).all();
  const pts = db.prepare('SELECT latitude, longitude FROM graves ORDER BY latitude').all();
  let nearest = Infinity;
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length && pts[j].latitude - pts[i].latitude < nearest; j++)
      nearest = Math.min(nearest, Math.hypot(pts[i].latitude - pts[j].latitude, pts[i].longitude - pts[j].longitude));
  const pad = Math.min(0.00002, nearest * 0.67);
  const sections = rows.map((s) => ({
    type: 'Feature',
    properties: { kind: 'section', section: s.section },
    geometry: { type: 'Polygon', coordinates: [rectRing({ minLat: s.minLat - pad, maxLat: s.maxLat + pad, minLng: s.minLng - pad, maxLng: s.maxLng + pad })] },
  }));
  const ring = getBoundary();
  const bounds = ringBounds(ring);
  const boundary = { type: 'Feature', properties: { kind: 'boundary', name: cemetery.name }, geometry: { type: 'Polygon', coordinates: [ring] } };
  return {
    ...cemetery,
    center: { latitude: (bounds.minLat + bounds.maxLat) / 2, longitude: (bounds.minLng + bounds.maxLng) / 2 },
    bounds,
    geojson: { type: 'FeatureCollection', features: [boundary, ...sections] },
  };
};

let cemeteryCache = null;
const cemeteryPayload = () => cemeteryCache || (cemeteryCache = buildCemeteryPayload());
const invalidateCemetery = () => {
  cemeteryCache = null;
};

app.get('/api/cemetery', (req, res) => res.json(cemeteryPayload()));

app.put('/api/cemetery/boundary', requireAdmin, (req, res) => {
  const parsed = parseRing(req.body && req.body.ring);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const ring = parsed.ring;
  const graves = db.prepare('SELECT id, grave_number, latitude, longitude FROM graves').all();
  let updates = [];
  if (req.body.relayout) {
    const r = relayoutInside(ring, graves);
    if (r.error) return res.status(400).json({ error: r.error });
    updates = r.updates;
  }
  const moved = new Map(updates.map((u) => [u.id, u]));
  const outside = graves.filter((g) => {
    const p = moved.get(g.id) || { latitude: g.latitude, longitude: g.longitude };
    return !inRing(p.latitude, p.longitude, ring);
  });
  if (outside.length)
    return res.status(409).json({
      error: `${outside.length} grave${outside.length === 1 ? '' : 's'} would fall outside the new boundary (for example ${outside[0].grave_number}). Tick "Move the sample graves inside" or adjust the shape.`,
      outside: outside.length,
    });
  db.transaction(() => {
    const upd = db.prepare('UPDATE graves SET latitude=?, longitude=? WHERE id=?');
    updates.forEach((u) => upd.run(u.latitude, u.longitude, u.id));
    db.prepare('UPDATE cemeteries SET boundary=?, bounds=? WHERE id=(SELECT id FROM cemeteries LIMIT 1)').run(JSON.stringify(ring), JSON.stringify(ringBounds(ring)));
  })();
  invalidateCemetery();
  res.json(cemeteryPayload());
});

app.get('/api/stats', (req, res) => {
  const q = (sql) => db.prepare(sql).get();
  res.json({
    totalRecords: q('SELECT COUNT(*) c FROM burial_records').c,
    occupiedGraves: q("SELECT COUNT(*) c FROM graves WHERE status='occupied'").c,
    availableGraves: q("SELECT COUNT(*) c FROM graves WHERE status='available'").c,
    totalSections: q('SELECT COUNT(DISTINCT section) c FROM graves').c,
    recentRecords: db.prepare(`${RECORD_SELECT} ORDER BY r.created_at DESC, r.id DESC LIMIT 5`).all(),
  });
});

app.get('/api/graves', (req, res) => {
  const { status, section } = req.query;
  const where = [];
  const params = [];
  if (status) { where.push('g.status=?'); params.push(status); }
  if (section) { where.push('g.section=?'); params.push(section); }
  const sql = `
    SELECT g.*, r.id AS record_id, r.full_name AS occupant
    FROM graves g LEFT JOIN burial_records r ON r.grave_id = g.id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY g.section, g.block, g.row, g.grave_number`;
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/graves', requireAdmin, (req, res) => {
  const { section, block, row, grave_number, latitude, longitude } = req.body || {};
  if (!section || !block || !row || !grave_number || isNaN(latitude) || isNaN(longitude) || latitude === '' || longitude === '')
    return res.status(400).json({ error: 'section, block, row, grave_number, latitude and longitude are required' });
  const outside = checkLocation(Number(latitude), Number(longitude));
  if (outside) return res.status(400).json({ error: outside });
  try {
    const info = db.prepare(
      "INSERT INTO graves (cemetery_id, section, block, row, grave_number, latitude, longitude, status) VALUES (1,?,?,?,?,?,?, 'available')"
    ).run(section, String(block), String(row), grave_number, Number(latitude), Number(longitude));
    invalidateCemetery();
    res.status(201).json(db.prepare('SELECT * FROM graves WHERE id=?').get(info.lastInsertRowid));
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Grave number already exists' });
    throw e;
  }
});

const GRAVE_FIELDS = ['section', 'block', 'row', 'grave_number'];

app.put('/api/graves/:id', requireAdmin, (req, res) => {
  const grave = db.prepare('SELECT * FROM graves WHERE id=?').get(req.params.id);
  if (!grave) return res.status(404).json({ error: 'Grave not found' });
  const body = req.body || {};
  const hasPosition = body.latitude !== undefined || body.longitude !== undefined;
  const hasDetails = GRAVE_FIELDS.some((k) => body[k] !== undefined);
  if (!hasPosition && !hasDetails) return res.status(400).json({ error: 'Nothing to update' });
  let { latitude, longitude } = grave;
  if (hasPosition) {
    if (isNaN(body.latitude) || isNaN(body.longitude) || body.latitude === '' || body.longitude === '' || body.latitude == null || body.longitude == null)
      return res.status(400).json({ error: 'latitude and longitude are required' });
    latitude = Number(body.latitude);
    longitude = Number(body.longitude);
    const outside = checkLocation(latitude, longitude);
    if (outside) return res.status(400).json({ error: outside });
  }
  const next = {};
  for (const k of GRAVE_FIELDS) {
    next[k] = body[k] !== undefined ? String(body[k]).trim() : grave[k];
    if (!next[k]) return res.status(400).json({ error: `${k.replace('_', ' ')} is required` });
  }
  try {
    db.prepare('UPDATE graves SET section=?, block=?, row=?, grave_number=?, latitude=?, longitude=? WHERE id=?').run(
      next.section, next.block, next.row, next.grave_number, latitude, longitude, grave.id
    );
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Grave number already exists' });
    throw e;
  }
  invalidateCemetery();
  res.json(db.prepare('SELECT * FROM graves WHERE id=?').get(grave.id));
});

app.delete('/api/graves/:id', requireAdmin, (req, res) => {
  const grave = db.prepare('SELECT id FROM graves WHERE id=?').get(req.params.id);
  if (!grave) return res.status(404).json({ error: 'Grave not found' });
  const taken = db.prepare('SELECT id FROM burial_records WHERE grave_id=?').get(grave.id);
  if (taken) return res.status(409).json({ error: 'This grave has a burial record. Remove the assignment first.' });
  db.prepare('DELETE FROM graves WHERE id=?').run(grave.id);
  invalidateCemetery();
  res.status(204).end();
});

const recordWhere = (query, withLease) => {
  const { q, section, status, lease } = query;
  const where = [];
  const params = [];
  String(q || '').trim().split(/\s+/).filter(Boolean).forEach((t) => {
    where.push('r.full_name LIKE ? COLLATE NOCASE');
    params.push(`%${t}%`);
  });
  if (section) { where.push('g.section = ?'); params.push(section); }
  if (status === 'unassigned') where.push('r.grave_id IS NULL');
  if (status === 'assigned') where.push('r.grave_id IS NOT NULL');
  if (withLease && ['paid', 'unpaid', 'provisional'].includes(lease)) {
    where.push("COALESCE(l.status, 'unpaid') = ?");
    params.push(lease);
  }
  return { clause: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
};

app.get('/api/records', (req, res) => {
  const { clause, params } = recordWhere(req.query, false);
  res.json(db.prepare(`${RECORD_SELECT} ${clause} ORDER BY r.full_name COLLATE NOCASE`).all(...params));
});

app.get('/api/admin/records', requireAdmin, (req, res) => {
  const { clause, params } = recordWhere(req.query, true);
  res.json(db.prepare(`${ADMIN_SELECT} ${clause} ORDER BY r.full_name COLLATE NOCASE`).all(...params));
});

app.get('/api/admin/graves', requireAdmin, (req, res) => {
  res.json(db.prepare(`
    SELECT g.*, r.id AS record_id, r.full_name AS occupant, l.lessee_name,
           COALESCE(l.status, 'unpaid') AS lease_status, l.assigned_via, l.official_receipt_no, l.lease_end,
           ${LEASE_FLAG_SQL} AS lease_flag
    FROM graves g
    LEFT JOIN burial_records r ON r.grave_id = g.id
    LEFT JOIN leases l ON l.record_id = r.id
    ORDER BY g.section, g.block, g.row, g.grave_number`).all());
});

app.get('/api/records/:id', (req, res) => {
  const record = db.prepare(`${RECORD_SELECT} WHERE r.id=?`).get(req.params.id);
  if (!record) return res.status(404).json({ error: 'Record not found' });
  res.json(record);
});

app.post('/api/records', requireAdmin, (req, res) => {
  const body = req.body || {};
  const errors = { ...validateRecord(body), ...validateLease(body) };
  if (Object.keys(errors).length) return res.status(400).json({ errors });
  const data = clean(body);
  const conflict = checkGrave(data.grave_id, null);
  if (conflict) return res.status(conflict.status).json({ error: conflict.error });
  try {
    const id = db.transaction(() => {
      const info = db.prepare(
        'INSERT INTO burial_records (full_name, date_of_birth, date_of_death, burial_date, grave_id) VALUES (?,?,?,?,?)'
      ).run(data.full_name, data.date_of_birth, data.date_of_death, data.burial_date, data.grave_id);
      saveLease.run({ record_id: info.lastInsertRowid, ...cleanLease(body) });
      syncStatus.run();
      return info.lastInsertRowid;
    })();
    res.status(201).json(db.prepare(`${ADMIN_SELECT} WHERE r.id=?`).get(id));
  } catch (e) {
    if (receiptDup(e)) return dupResponse(res);
    throw e;
  }
});

app.put('/api/records/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT id FROM burial_records WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Record not found' });
  const body = req.body || {};
  const withLease = LEASE_KEYS.some((k) => body[k] !== undefined);
  const errors = { ...validateRecord(body), ...(withLease ? validateLease(body) : {}) };
  if (Object.keys(errors).length) return res.status(400).json({ errors });
  const data = clean(body);
  const conflict = checkGrave(data.grave_id, existing.id);
  if (conflict) return res.status(conflict.status).json({ error: conflict.error });
  try {
    db.transaction(() => {
      db.prepare(
        'UPDATE burial_records SET full_name=?, date_of_birth=?, date_of_death=?, burial_date=?, grave_id=? WHERE id=?'
      ).run(data.full_name, data.date_of_birth, data.date_of_death, data.burial_date, data.grave_id, existing.id);
      if (withLease) saveLease.run({ record_id: existing.id, ...cleanLease(body) });
      syncStatus.run();
    })();
  } catch (e) {
    if (receiptDup(e)) return dupResponse(res);
    throw e;
  }
  res.json(db.prepare(`${ADMIN_SELECT} WHERE r.id=?`).get(existing.id));
});

app.put('/api/records/:id/grave', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT id FROM burial_records WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Record not found' });
  const graveId = req.body && req.body.grave_id ? Number(req.body.grave_id) : null;
  const conflict = checkGrave(graveId, existing.id);
  if (conflict) return res.status(conflict.status).json({ error: conflict.error });
  db.transaction(() => {
    db.prepare('UPDATE burial_records SET grave_id=? WHERE id=?').run(graveId, existing.id);
    syncStatus.run();
  })();
  res.json(db.prepare(`${RECORD_SELECT} WHERE r.id=?`).get(existing.id));
});

app.delete('/api/records/:id', requireAdmin, (req, res) => {
  const info = db.transaction(() => {
    const r = db.prepare('DELETE FROM burial_records WHERE id=?').run(req.params.id);
    syncStatus.run();
    return r;
  })();
  if (!info.changes) return res.status(404).json({ error: 'Record not found' });
  res.status(204).end();
});

const attention = (r) => (r.lease_status !== 'paid' ? r.lease_status : r.lease_flag);
const RANK = { provisional: 0, unpaid: 1, expired: 2, due_soon: 3 };

app.get('/api/reconciliation', requireAdmin, (req, res) => {
  const all = db.prepare(`${ADMIN_SELECT} ORDER BY r.burial_date, r.id`).all();
  const rows = all.filter(attention).sort((a, b) => RANK[attention(a)] - RANK[attention(b)]);
  const count = (k) => rows.filter((r) => attention(r) === k).length;
  res.json({
    summary: {
      total: all.length,
      occupiedUnpaid: all.filter((r) => r.grave_id && r.lease_status !== 'paid').length,
      provisional: count('provisional'),
      unpaid: count('unpaid'),
      expired: count('expired'),
      dueSoon: count('due_soon'),
    },
    rows,
  });
});

app.put('/api/records/:id/lease', requireAdmin, (req, res) => {
  const cur = db.prepare(`${ADMIN_SELECT} WHERE r.id=?`).get(req.params.id);
  if (!cur) return res.status(404).json({ error: 'Record not found' });
  const merged = { ...cur, ...(req.body || {}) };
  const errors = validateLease(merged);
  if (Object.keys(errors).length) return res.status(400).json({ errors });
  try {
    saveLease.run({ record_id: cur.id, ...cleanLease(merged) });
  } catch (e) {
    if (receiptDup(e)) return dupResponse(res);
    throw e;
  }
  res.json(db.prepare(`${ADMIN_SELECT} WHERE r.id=?`).get(cur.id));
});

const fs = require('fs');
const path = require('path');

const TILE_DIR = path.join(__dirname, 'tile-cache');
const TILE_UA = process.env.TILE_USER_AGENT || 'GraveFinder-CvSU-INSY55/1.0 (contact: clarkkent123@gmail.com)';
const TILE_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

let tileActive = 0;
const tileQueue = [];
const tileSlot = () => new Promise((resolve) => (tileActive < 2 ? (tileActive++, resolve()) : tileQueue.push(resolve)));
const tileRelease = () => {
  const next = tileQueue.shift();
  if (next) next();
  else tileActive--;
};

const tileInflight = new Map();

async function fetchTile(z, x, y, file) {
  await tileSlot();
  try {
    let upstream;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        upstream = await fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, {
          headers: { 'User-Agent': TILE_UA },
          signal: AbortSignal.timeout(8000),
        });
        if (upstream.ok || upstream.status === 403 || upstream.status === 429) break;
      } catch (e) {
        console.warn(`[tiles] attempt ${attempt} failed for ${z}/${x}/${y}: ${e.message}`);
        if (attempt === 2) throw e;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!upstream.ok) {
      console.warn(`[tiles] OSM refused ${z}/${x}/${y}: HTTP ${upstream.status} (User-Agent: ${TILE_UA})`);
      throw new Error(`OSM HTTP ${upstream.status}`);
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, buf);
    await fs.promises.rename(tmp, file);
    return buf;
  } finally {
    tileRelease();
  }
}

app.get('/api/tiles/:z/:x/:y.png', async (req, res) => {
  const z = Number(req.params.z);
  const x = Number(req.params.x);
  const y = Number(req.params.y);
  const max = 2 ** z;
  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 19 || x < 0 || y < 0 || x >= max || y >= max) return res.status(400).end();
  const file = path.join(TILE_DIR, String(z), String(x), `${y}.png`);
  const sendCached = () =>
    res.sendFile(file, { maxAge: '7d' }, (err) => {
      if (err && !res.headersSent) res.status(502).end();
    });

  let stat = null;
  try {
    stat = await fs.promises.stat(file);
  } catch {}
  if (stat && Date.now() - stat.mtimeMs < TILE_MAX_AGE_MS) return sendCached();

  let pending = tileInflight.get(file);
  if (!pending) {
    pending = fetchTile(z, x, y, file).finally(() => tileInflight.delete(file));
    tileInflight.set(file, pending);
  }
  try {
    const buf = await pending;
    res.set('Cache-Control', 'public, max-age=604800').type('png').send(buf);
  } catch (e) {
    if (!/^OSM HTTP/.test(e.message)) console.warn(`[tiles] fetch failed for ${z}/${x}/${y}: ${e.message}`);
    if (stat) return sendCached();
    res.status(502).end();
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, '0.0.0.0', () => console.log(`GraveFinder API on :${PORT}`));