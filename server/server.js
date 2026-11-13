const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const db = require('./db');

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

const RECORD_SELECT = `
  SELECT r.id, r.full_name, r.date_of_birth, r.date_of_death, r.burial_date, r.grave_id, r.created_at,
         g.section, g.block, g.row, g.grave_number, g.latitude, g.longitude
  FROM burial_records r LEFT JOIN graves g ON g.id = r.grave_id`;

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

const getBounds = () => {
  const stored = db.prepare('SELECT bounds FROM cemeteries LIMIT 1').get();
  if (stored && stored.bounds) return JSON.parse(stored.bounds);
  const a = db.prepare('SELECT MIN(latitude) minLat, MAX(latitude) maxLat, MIN(longitude) minLng, MAX(longitude) maxLng FROM graves').get();
  const pad = 0.00006;
  return { minLat: a.minLat - pad, maxLat: a.maxLat + pad, minLng: a.minLng - pad, maxLng: a.maxLng + pad };
};

const checkLocation = (lat, lng) => {
  const b = getBounds();
  if (lat < b.minLat || lat > b.maxLat || lng < b.minLng || lng > b.maxLng)
    return 'That location is outside the cemetery boundary';
  return null;
};

app.get('/api/cemetery', (req, res) => {
  const cemetery = db.prepare('SELECT id, name, description FROM cemeteries LIMIT 1').get();
  const rows = db.prepare(`
    SELECT section, MIN(latitude) minLat, MAX(latitude) maxLat, MIN(longitude) minLng, MAX(longitude) maxLng
    FROM graves GROUP BY section ORDER BY section`).all();
  const pad = 0.00002;
  const ring = (a, b, c, d) => [[[a, b], [c, b], [c, d], [a, d], [a, b]]];
  const sections = rows.map((s) => ({
    type: 'Feature',
    properties: { kind: 'section', section: s.section },
    geometry: { type: 'Polygon', coordinates: ring(s.minLng - pad, s.minLat - pad, s.maxLng + pad, s.maxLat + pad) },
  }));
  const bounds = getBounds();
  const boundary = {
    type: 'Feature',
    properties: { kind: 'boundary', name: cemetery.name },
    geometry: { type: 'Polygon', coordinates: ring(bounds.minLng, bounds.minLat, bounds.maxLng, bounds.maxLat) },
  };
  res.json({
    ...cemetery,
    center: { latitude: (bounds.minLat + bounds.maxLat) / 2, longitude: (bounds.minLng + bounds.maxLng) / 2 },
    bounds,
    geojson: { type: 'FeatureCollection', features: [boundary, ...sections] },
  });
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
    res.status(201).json(db.prepare('SELECT * FROM graves WHERE id=?').get(info.lastInsertRowid));
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Grave number already exists' });
    throw e;
  }
});

app.put('/api/graves/:id', requireAdmin, (req, res) => {
  const grave = db.prepare('SELECT * FROM graves WHERE id=?').get(req.params.id);
  if (!grave) return res.status(404).json({ error: 'Grave not found' });
  const { latitude, longitude } = req.body || {};
  if (isNaN(latitude) || isNaN(longitude) || latitude === '' || longitude === '' || latitude == null || longitude == null)
    return res.status(400).json({ error: 'latitude and longitude are required' });
  const outside = checkLocation(Number(latitude), Number(longitude));
  if (outside) return res.status(400).json({ error: outside });
  db.prepare('UPDATE graves SET latitude=?, longitude=? WHERE id=?').run(Number(latitude), Number(longitude), grave.id);
  res.json(db.prepare('SELECT * FROM graves WHERE id=?').get(grave.id));
});

app.get('/api/records', (req, res) => {
  const { q, section, status } = req.query;
  const where = [];
  const params = [];
  String(q || '').trim().split(/\s+/).filter(Boolean).forEach((t) => {
    where.push('r.full_name LIKE ? COLLATE NOCASE');
    params.push(`%${t}%`);
  });
  if (section) { where.push('g.section = ?'); params.push(section); }
  if (status === 'unassigned') where.push('r.grave_id IS NULL');
  if (status === 'assigned') where.push('r.grave_id IS NOT NULL');
  const sql = `${RECORD_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.full_name COLLATE NOCASE`;
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/records/:id', (req, res) => {
  const record = db.prepare(`${RECORD_SELECT} WHERE r.id=?`).get(req.params.id);
  if (!record) return res.status(404).json({ error: 'Record not found' });
  res.json(record);
});

app.post('/api/records', requireAdmin, (req, res) => {
  const errors = validateRecord(req.body || {});
  if (Object.keys(errors).length) return res.status(400).json({ errors });
  const data = clean(req.body);
  const conflict = checkGrave(data.grave_id, null);
  if (conflict) return res.status(conflict.status).json({ error: conflict.error });
  const id = db.transaction(() => {
    const info = db.prepare(
      'INSERT INTO burial_records (full_name, date_of_birth, date_of_death, burial_date, grave_id) VALUES (?,?,?,?,?)'
    ).run(data.full_name, data.date_of_birth, data.date_of_death, data.burial_date, data.grave_id);
    syncStatus.run();
    return info.lastInsertRowid;
  })();
  res.status(201).json(db.prepare(`${RECORD_SELECT} WHERE r.id=?`).get(id));
});

app.put('/api/records/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT id FROM burial_records WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Record not found' });
  const errors = validateRecord(req.body || {});
  if (Object.keys(errors).length) return res.status(400).json({ errors });
  const data = clean(req.body);
  const conflict = checkGrave(data.grave_id, existing.id);
  if (conflict) return res.status(conflict.status).json({ error: conflict.error });
  db.transaction(() => {
    db.prepare(
      'UPDATE burial_records SET full_name=?, date_of_birth=?, date_of_death=?, burial_date=?, grave_id=? WHERE id=?'
    ).run(data.full_name, data.date_of_birth, data.date_of_death, data.burial_date, data.grave_id, existing.id);
    syncStatus.run();
  })();
  res.json(db.prepare(`${RECORD_SELECT} WHERE r.id=?`).get(existing.id));
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

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, '0.0.0.0', () => console.log(`GraveFinder API on :${PORT}`));
