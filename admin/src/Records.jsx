import { useEffect, useMemo, useState, useCallback } from 'react';
import { api, show, gravePath } from './api';
import MapView from './MapView';
import { LeaseBadge, plus5 } from './lease';

const empty = {
  full_name: '', date_of_birth: '', date_of_death: '', burial_date: '', grave_id: '',
  lessee_name: '', order_of_payment_no: '', official_receipt_no: '', amount: '', paid_date: '',
  lease_start: '', lease_end: '', lease_status: 'unpaid', assigned_via: 'office',
};

// Lower rank = needs attention sooner.
const rank = (r) =>
  r.lease_status === 'provisional' ? 0
  : r.lease_status === 'unpaid' ? 1
  : r.lease_flag === 'expired' ? 2
  : r.lease_flag === 'due_soon' ? 3
  : 4;

const byName = (a, b) => a.full_name.localeCompare(b.full_name);

const SORTS = {
  name: { label: 'Name (A to Z)', fn: byName },
  attention: { label: 'Lease: provisional, unpaid, then paid', fn: (a, b) => rank(a) - rank(b) || byName(a, b) },
  paidFirst: { label: 'Lease: paid first', fn: (a, b) => rank(b) - rank(a) || byName(a, b) },
  leaseEnd: { label: 'Lease end (soonest first)', fn: (a, b) => (a.lease_end || '9999').localeCompare(b.lease_end || '9999') || byName(a, b) },
  buried: { label: 'Burial date (newest first)', fn: (a, b) => (b.burial_date || '').localeCompare(a.burial_date || '') || byName(a, b) },
};

function RecordForm({ record, cemetery, onClose, onSaved }) {
  const [f, setF] = useState(record ? { ...empty, ...Object.fromEntries(Object.entries(record).map(([k, v]) => [k, v ?? ''])) } : empty);
  const [graves, setGraves] = useState([]);
  const [pickOnMap, setPickOnMap] = useState(false);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api('/admin/graves').then(setGraves);
  }, []);

  const free = graves.filter((g) => g.status === 'available' || g.id === record?.grave_id);
  const chosen = graves.find((g) => g.id === Number(f.grave_id));
  const set = (k) => (e) => {
    setF({ ...f, [k]: e.target.value });
    setErrors((p) => ({ ...p, [k]: undefined }));
  };
  const err = (k) => errors[k] && <span className="error">{errors[k]}</span>;
  const onStart = (e) => {
    const v = e.target.value;
    setF((p) => ({ ...p, lease_start: v, lease_end: p.lease_end || (v ? plus5(v) : '') }));
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
    } catch (ex) {
      setErrors(ex.errors || { form: ex.message });
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
          {err('full_name')}
        </label>
        <div className="row3">
          <label>
            Date of birth
            <input type="date" value={f.date_of_birth} onChange={set('date_of_birth')} />
            {err('date_of_birth')}
          </label>
          <label>
            Date of death
            <input type="date" value={f.date_of_death} onChange={set('date_of_death')} />
            {err('date_of_death')}
          </label>
          <label>
            Burial date
            <input type="date" value={f.burial_date} onChange={set('burial_date')} />
            {err('burial_date')}
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
        <fieldset className="lease">
          <legend>Lease and payment</legend>
          <div className="row3">
            <label>
              Lessee name (signs the lease)
              <input value={f.lessee_name} onChange={set('lessee_name')} />
              {err('lessee_name')}
            </label>
          </div>
          <div className="row3">
            <label>
              Status
              <select value={f.lease_status} onChange={set('lease_status')}>
                <option value="provisional">Provisional</option>
                <option value="unpaid">Unpaid</option>
                <option value="paid">Paid</option>
              </select>
              {err('lease_status')}
            </label>
            <label>Order of Payment no.<input value={f.order_of_payment_no} onChange={set('order_of_payment_no')} />{err('order_of_payment_no')}</label>
            <label>Official Receipt no.<input value={f.official_receipt_no} onChange={set('official_receipt_no')} />{err('official_receipt_no')}</label>
          </div>
          <div className="row3">
            <label>Amount<input type="number" min="0" step="0.01" value={f.amount} onChange={set('amount')} />{err('amount')}</label>
            <label>Paid date<input type="date" value={f.paid_date} onChange={set('paid_date')} />{err('paid_date')}</label>
            <label>Lease start<input type="date" value={f.lease_start} onChange={onStart} />{err('lease_start')}</label>
          </div>
          <div className="row3">
            <label>Lease end<input type="date" value={f.lease_end} onChange={set('lease_end')} />{err('lease_end')}</label>
            <label>
              Assigned by
              <select value={f.assigned_via} onChange={set('assigned_via')}>
                <option value="office">Office</option>
                <option value="field">Field worker</option>
              </select>
            </label>
          </div>
        </fieldset>
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
  const [lease, setLease] = useState('');
  const [sort, setSort] = useState('name');
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    const p = new URLSearchParams({ q, section, status, lease });
    api('/admin/records?' + p).then((r) => {
      setRows(r);
      setLoaded(true);
    });
  }, [q, section, status, lease]);

  useEffect(() => {
    const t = setTimeout(load, 150);
    return () => clearTimeout(t);
  }, [load]);

  const sorted = useMemo(() => [...rows].sort(SORTS[sort].fn), [rows, sort]);

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

  // Clicking the Lease header flips between "needs attention first" and "paid first".
  const toggleLeaseSort = () => setSort(sort === 'attention' ? 'paidFirst' : 'attention');
  const arrow = sort === 'attention' ? ' \u25B2' : sort === 'paidFirst' ? ' \u25BC' : '';

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
        <select value={lease} onChange={(e) => setLease(e.target.value)}>
          <option value="">All lease statuses</option>
          <option value="paid">Paid</option>
          <option value="unpaid">Unpaid</option>
          <option value="provisional">Provisional</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort records">
          {Object.entries(SORTS).map(([k, s]) => <option key={k} value={k}>Sort: {s.label}</option>)}
        </select>
        <span className="muted">{rows.length} shown</span>
        {notice && <span className="notice">{notice}</span>}
      </div>
      <table>
        <thead>
          <tr>
            <th>ID</th><th>Name</th><th>Born</th><th>Died</th><th>Buried</th><th>Lessee</th>
            <th><button className="link" onClick={toggleLeaseSort}>Lease{arrow}</button></th>
            <th>Location</th><th>Coordinates</th><th></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id}>
              <td>{r.id}</td>
              <td>{r.full_name}</td>
              <td className="nw">{show(r.date_of_birth)}</td>
              <td className="nw">{r.date_of_death}</td>
              <td className="nw">{show(r.burial_date)}</td>
              <td>{show(r.lessee_name)}</td>
              <td><LeaseBadge r={r} /></td>
              <td>{gravePath(r)}</td>
              <td className="num">{r.latitude ? `${r.latitude.toFixed(6)}, ${r.longitude.toFixed(6)}` : '—'}</td>
              <td className="rowactions">
                <button className="link" onClick={() => setEditing(r)}>Edit</button>
                <button className="link danger" onClick={() => remove(r)}>Delete</button>
              </td>
            </tr>
          ))}
          {loaded && !rows.length && (
            <tr><td colSpan="10" className="empty">No records match. Clear the search or add a new record.</td></tr>
          )}
        </tbody>
      </table>
      {editing && (
        <RecordForm record={editing === 'new' ? null : editing} cemetery={cemetery} onClose={() => setEditing(null)} onSaved={saved} />
      )}
    </>
  );
}