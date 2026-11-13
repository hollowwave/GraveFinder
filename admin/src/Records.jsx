import { useEffect, useState, useCallback } from 'react';
import { api, show, gravePath } from './api';
import MapView from './MapView';

const empty = { full_name: '', date_of_birth: '', date_of_death: '', burial_date: '', grave_id: '' };

function RecordForm({ record, cemetery, onClose, onSaved }) {
  const [f, setF] = useState(record ? { ...empty, ...Object.fromEntries(Object.entries(record).map(([k, v]) => [k, v ?? ''])) } : empty);
  const [graves, setGraves] = useState([]);
  const [pickOnMap, setPickOnMap] = useState(false);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api('/graves').then(setGraves);
  }, []);

  const free = graves.filter((g) => g.status === 'available' || g.id === record?.grave_id);
  const chosen = graves.find((g) => g.id === Number(f.grave_id));
  const set = (k) => (e) => {
    setF({ ...f, [k]: e.target.value });
    setErrors((p) => ({ ...p, [k]: undefined }));
  };
  const select = useCallback((g) => setF((p) => ({ ...p, grave_id: g.id })), []);

  const submit = async (e) => {
    e.preventDefault();
    const local = {};
    if (!f.full_name.trim()) local.full_name = 'Full name is required';
    if (!f.date_of_death) local.date_of_death = 'Date of death is required';
    setErrors(local);
    if (Object.keys(local).length) return;
    setSaving(true);
    try {
      const body = { ...f, grave_id: f.grave_id || null };
      await api(record ? `/records/${record.id}` : '/records', { method: record ? 'PUT' : 'POST', body });
      onSaved();
    } catch (err) {
      setErrors(err.errors || { form: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="overlay">
      <form className="dialog" onSubmit={submit} noValidate>
        <h2>{record ? 'Edit burial record' : 'New burial record'}</h2>
        {errors.form && <p className="error">{errors.form}</p>}
        <label>
          Full name
          <input value={f.full_name} onChange={set('full_name')} autoFocus />
          {errors.full_name && <span className="error">{errors.full_name}</span>}
        </label>
        <div className="row3">
          <label>
            Date of birth
            <input type="date" value={f.date_of_birth} onChange={set('date_of_birth')} />
            {errors.date_of_birth && <span className="error">{errors.date_of_birth}</span>}
          </label>
          <label>
            Date of death
            <input type="date" value={f.date_of_death} onChange={set('date_of_death')} />
            {errors.date_of_death && <span className="error">{errors.date_of_death}</span>}
          </label>
          <label>
            Burial date
            <input type="date" value={f.burial_date} onChange={set('burial_date')} />
            {errors.burial_date && <span className="error">{errors.burial_date}</span>}
          </label>
        </div>
        <label>
          Grave
          <select value={f.grave_id} onChange={set('grave_id')}>
            <option value="">Unassigned</option>
            {free.map((g) => (
              <option key={g.id} value={g.id}>
                {g.grave_number} (section {g.section}, block {g.block}, row {g.row})
              </option>
            ))}
          </select>
        </label>
        <div className="inline">
          <button type="button" className="secondary" onClick={() => setPickOnMap(!pickOnMap)}>
            {pickOnMap ? 'Hide map' : 'Pick grave on map'}
          </button>
          <span className="muted">{chosen ? `Selected: ${chosen.grave_number} at ${chosen.latitude.toFixed(6)}, ${chosen.longitude.toFixed(6)}` : 'No grave selected'}</span>
        </div>
        {pickOnMap && (
          <>
            <div className="map small">
              <MapView cemetery={cemetery} graves={free} selectedId={Number(f.grave_id)} onSelect={select} />
            </div>
            <p className="muted">Open circles are available graves. Click one to assign it.</p>
          </>
        )}
        <div className="actions">
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={saving}>{record ? 'Save changes' : 'Create record'}</button>
        </div>
      </form>
    </div>
  );
}

export default function Records({ cemetery }) {
  const [rows, setRows] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState('');
  const [section, setSection] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    const p = new URLSearchParams({ q, section, status });
    api('/records?' + p).then((r) => {
      setRows(r);
      setLoaded(true);
    });
  }, [q, section, status]);

  useEffect(() => {
    const t = setTimeout(load, 150);
    return () => clearTimeout(t);
  }, [load]);

  const remove = async (r) => {
    if (!window.confirm(`Delete the record for ${r.full_name}?${r.grave_number ? ` Grave ${r.grave_number} will become available.` : ''}`)) return;
    await api('/records/' + r.id, { method: 'DELETE' });
    setNotice(`Deleted ${r.full_name}`);
    load();
  };

  const saved = () => {
    setNotice(editing === 'new' ? 'Record created' : 'Changes saved');
    setEditing(null);
    load();
  };

  return (
    <>
      <header className="pagehead">
        <h1>Burial records</h1>
        <button onClick={() => setEditing('new')}>New record</button>
      </header>
      <div className="filters">
        <input placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={section} onChange={(e) => setSection(e.target.value)}>
          <option value="">All sections</option>
          {['A', 'B', 'C', 'D'].map((s) => <option key={s} value={s}>Section {s}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All records</option>
          <option value="assigned">Grave assigned</option>
          <option value="unassigned">No grave</option>
        </select>
        <span className="muted">{rows.length} shown</span>
        {notice && <span className="notice">{notice}</span>}
      </div>
      <table>
        <thead>
          <tr><th>ID</th><th>Name</th><th>Born</th><th>Died</th><th>Buried</th><th>Location</th><th>Coordinates</th><th></th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.id}</td>
              <td>{r.full_name}</td>
              <td className="nw">{show(r.date_of_birth)}</td>
              <td className="nw">{r.date_of_death}</td>
              <td className="nw">{show(r.burial_date)}</td>
              <td>{gravePath(r)}</td>
              <td className="num">{r.latitude ? `${r.latitude.toFixed(6)}, ${r.longitude.toFixed(6)}` : '—'}</td>
              <td className="rowactions">
                <button className="link" onClick={() => setEditing(r)}>Edit</button>
                <button className="link danger" onClick={() => remove(r)}>Delete</button>
              </td>
            </tr>
          ))}
          {loaded && !rows.length && (
            <tr><td colSpan="8" className="empty">No records match. Clear the search or add a new record.</td></tr>
          )}
        </tbody>
      </table>
      {editing && (
        <RecordForm record={editing === 'new' ? null : editing} cemetery={cemetery} onClose={() => setEditing(null)} onSaved={saved} />
      )}
    </>
  );
}
