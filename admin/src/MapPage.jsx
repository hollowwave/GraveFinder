import { useEffect, useState, useCallback } from 'react';
import { api } from './api';
import MapView from './MapView';

const round = (n) => Math.round(n * 1e7) / 1e7;

export default function MapPage({ cemetery }) {
  const [graves, setGraves] = useState([]);
  const [unassigned, setUnassigned] = useState([]);
  const [selId, setSelId] = useState(null);
  const [mode, setMode] = useState('select');
  const [coords, setCoords] = useState({ latitude: '', longitude: '' });
  const [nf, setNf] = useState({ section: 'A', block: '1', row: '1', grave_number: '' });
  const [recordId, setRecordId] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(() => {
    api('/graves').then(setGraves);
    api('/records?status=unassigned').then(setUnassigned);
  }, []);
  useEffect(load, [load]);

  const grave = graves.find((g) => g.id === selId);
  const flash = (m) => setMsg(m);

  const pick = useCallback((g) => {
    setSelId(g.id);
    setCoords({ latitude: g.latitude, longitude: g.longitude });
    setMode('select');
    setMsg('');
  }, []);

  const placeAt = useCallback(
    (ll) => {
      const b = cemetery.bounds;
      if (ll.lat < b.minLat || ll.lat > b.maxLat || ll.lng < b.minLng || ll.lng > b.maxLng) {
        setMsg('That spot is outside the cemetery boundary. Click inside the dashed line.');
        return;
      }
      setMsg('');
      setCoords({ latitude: round(ll.lat), longitude: round(ll.lng) });
    },
    [cemetery]
  );

  const onGraveClick = useCallback(
    (g, ll) => {
      if (mode === 'select') pick(g);
      else placeAt(ll);
    },
    [mode, pick, placeAt]
  );

  const onMapClick = useCallback(
    (ll) => {
      if (mode !== 'select') placeAt(ll);
    },
    [mode, placeAt]
  );

  const guard = async (fn, ok) => {
    try {
      await fn();
      flash(ok);
      load();
    } catch (e) {
      flash(e.message);
    }
  };

  const saveCoords = () =>
    guard(() => api('/graves/' + grave.id, { method: 'PUT', body: coords }).then(() => setMode('select')), 'Coordinates saved');

  const addGrave = () =>
    guard(async () => {
      const g = await api('/graves', { method: 'POST', body: { ...nf, ...coords } });
      setSelId(g.id);
      setMode('select');
    }, 'Grave added');

  const assign = () =>
    guard(() => api(`/records/${recordId}/grave`, { method: 'PUT', body: { grave_id: grave.id } }).then(() => setRecordId('')), 'Grave assigned');

  const unassign = () => guard(() => api(`/records/${grave.record_id}/grave`, { method: 'PUT', body: { grave_id: null } }), 'Grave is now available');

  const pin = mode !== 'select' && coords.latitude !== '' ? { latitude: +coords.latitude, longitude: +coords.longitude } : null;
  const occupied = graves.filter((g) => g.status === 'occupied').length;

  return (
    <>
      <header className="pagehead">
        <h1>Cemetery map</h1>
      </header>
      <div className="mapgrid">
        <div>
          <MapView cemetery={cemetery} graves={graves} selectedId={selId} onSelect={onGraveClick} onMapClick={onMapClick} pin={pin} />
          <p className="legend muted">
            <span className="dot occ" /> Occupied ({occupied})
            <span className="dot avail" /> Available ({graves.length - occupied})
            <span className="dot sel" /> Selected
          </p>
        </div>
        <aside className="panel">
          {msg && <p className="notice">{msg}</p>}
          {mode === 'select' && !grave && <p className="muted">Select a grave on the map to see who is buried there, move it, or assign a record.</p>}
          {grave && (
            <section>
              <h2>{grave.grave_number}</h2>
              <p className="muted">Section {grave.section}, block {grave.block}, row {grave.row}</p>
              <p>{grave.status === 'occupied' ? `Occupied by ${grave.occupant}` : 'Available'}</p>
              {grave.status === 'occupied' ? (
                <button className="secondary" onClick={unassign}>Remove assignment</button>
              ) : (
                <div className="inline">
                  <select value={recordId} onChange={(e) => setRecordId(e.target.value)}>
                    <option value="">Choose a record without a grave</option>
                    {unassigned.map((r) => <option key={r.id} value={r.id}>{r.full_name}</option>)}
                  </select>
                  <button disabled={!recordId} onClick={assign}>Assign</button>
                </div>
              )}
            </section>
          )}
          <section>
            <h2>{mode === 'add' ? 'Add a grave' : 'Coordinates'}</h2>
            {mode === 'add' && (
              <div className="row2">
                {['section', 'block', 'row', 'grave_number'].map((k) => (
                  <label key={k}>
                    {k === 'grave_number' ? 'Grave number' : k[0].toUpperCase() + k.slice(1)}
                    <input value={nf[k]} onChange={(e) => setNf({ ...nf, [k]: e.target.value })} />
                  </label>
                ))}
              </div>
            )}
            <div className="row2">
              <label>
                Latitude
                <input value={coords.latitude} disabled={mode === 'select'} onChange={(e) => setCoords({ ...coords, latitude: e.target.value })} />
              </label>
              <label>
                Longitude
                <input value={coords.longitude} disabled={mode === 'select'} onChange={(e) => setCoords({ ...coords, longitude: e.target.value })} />
              </label>
            </div>
            {mode === 'select' && grave && <button className="secondary" onClick={() => setMode('move')}>Move this grave</button>}
            {mode === 'move' && (
              <>
                <p className="muted">Click the new position on the map.</p>
                <div className="actions">
                  <button className="secondary" onClick={() => pick(grave)}>Cancel</button>
                  <button onClick={saveCoords}>Save coordinates</button>
                </div>
              </>
            )}
            {mode === 'add' && (
              <>
                <p className="muted">Click the position on the map, then add the grave.</p>
                <div className="actions">
                  <button className="secondary" onClick={() => setMode('select')}>Cancel</button>
                  <button disabled={!nf.grave_number || coords.latitude === ''} onClick={addGrave}>Add grave</button>
                </div>
              </>
            )}
            {mode === 'select' && (
              <button className="secondary" onClick={() => { setCoords({ latitude: '', longitude: '' }); setMode('add'); setMsg(''); }}>
                Add a grave
              </button>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}

