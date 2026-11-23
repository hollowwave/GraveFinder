import { useEffect, useState, useCallback } from 'react';
import { STATES, graveState } from './lease';
import { api } from './api';
import MapView from './MapView';
import { pointInRing } from './geo';


const GRAVE_LABELS = [['section', 'Section'], ['block', 'Block'], ['row', 'Row'], ['grave_number', 'Grave number']];
const round = (n) => Math.round(n * 1e7) / 1e7;

export default function MapPage({ cemetery, onCemeteryChange }) {
  const [graves, setGraves] = useState([]);
  const [unassigned, setUnassigned] = useState([]);
  const [selId, setSelId] = useState(null);
  const [mode, setMode] = useState('select');
  const [coords, setCoords] = useState({ latitude: '', longitude: '' });
  const [nf, setNf] = useState({ section: 'A', block: '1', row: '1', grave_number: '' });
  const [ef, setEf] = useState({ section: '', block: '', row: '', grave_number: '' });
  const [confirmDel, setConfirmDel] = useState(false);
  const [recordId, setRecordId] = useState('');
  const [msg, setMsg] = useState('');
  const [draft, setDraft] = useState(null);
  const [relayout, setRelayout] = useState(false);
  const [roads, setRoads] = useState({ nodes: [], edges: [] });
  const [pendingNodeId, setPendingNodeId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const ring = cemetery.geojson.features.find((f) => f.properties.kind === 'boundary').geometry.coordinates[0];

  const load = useCallback(() => {
    api('/admin/graves').then(setGraves);
    api('/records?status=unassigned').then(setUnassigned);
    api('/roads').then(setRoads);
  }, []);
  useEffect(load, [load]);

  const grave = graves.find((g) => g.id === selId);
  const flash = (m) => setMsg(m);

  const pick = useCallback((g) => {
    setSelId(g.id);
    setCoords({ latitude: g.latitude, longitude: g.longitude });
    setMode('select');
    setConfirmDel(false);
    setMsg('');
  }, []);

  const placeAt = useCallback(
    (ll) => {
      if (!pointInRing(ll.lat, ll.lng, ring)) {
        setMsg('That spot is outside the cemetery boundary. Click inside the dashed line.');
        return false;
      }
      setMsg('');
      setCoords({ latitude: round(ll.lat), longitude: round(ll.lng) });
      return true;
    },
    [ring]
  );

  const addPoint = useCallback((ll) => setDraft((d) => [...d, { latitude: round(ll.lat), longitude: round(ll.lng) }]), []);
  const movePoint = useCallback((i, ll) => setDraft((d) => d.map((p, k) => (k === i ? { latitude: round(ll.lat), longitude: round(ll.lng) } : p))), []);
  const removePoint = useCallback((i) => setDraft((d) => d.filter((_, k) => k !== i)), []);

  const addRoadNode = (ll) =>
    guard(() => api('/roads/nodes', { method: 'POST', body: { latitude: round(ll.lat), longitude: round(ll.lng) } }), 'Point added');

  const onGraveClick = useCallback(
    (g, ll) => {
      if (mode === 'select' || mode === 'edit') pick(g);
      else if (mode === 'boundary') addPoint(ll);
      else if (mode === 'roads') addRoadNode(ll);
      else placeAt(ll);
    },
    [mode, pick, placeAt, addPoint]
  );

  const onMapClick = useCallback(
    (ll) => {
      if (mode === 'boundary') addPoint(ll);
      else if (mode === 'roads') addRoadNode(ll);
      else if (mode === 'move' || mode === 'add') placeAt(ll);
    },
    [mode, placeAt, addPoint]
  );

  const startBoundary = () => {
    setDraft(ring.slice(0, -1).map(([lng, lat]) => ({ latitude: lat, longitude: lng })));
    setRelayout(false);
    setSelId(null);
    setMode('boundary');
    setMsg('');
  };

  const cancelBoundary = () => {
    setDraft(null);
    setMode('select');
    setMsg('');
  };

  const saveBoundary = async () => {
    try {
      const updated = await api('/cemetery/boundary', {
        method: 'PUT',
        body: { ring: draft.map((p) => [p.longitude, p.latitude]), relayout },
      });
      onCemeteryChange(updated);
      setDraft(null);
      setMode('select');
      flash('Boundary saved');
      load();
    } catch (e) {
      flash(e.message);
    }
  };

  const startRoads = () => {
    setPendingNodeId(null);
    setSelectedEdgeId(null);
    setSelId(null);
    setMode('roads');
    setMsg('');
  };

  const exitRoads = () => {
    setPendingNodeId(null);
    setSelectedEdgeId(null);
    setMode('select');
    setMsg('');
  };

  const onNodeClick = (n) => {
    setSelectedEdgeId(null);
    if (pendingNodeId == null) return setPendingNodeId(n.id);
    if (pendingNodeId === n.id) return setPendingNodeId(null);
    guard(() => api('/roads/edges', { method: 'POST', body: { a: pendingNodeId, b: n.id } }), 'Path connected').then(() => setPendingNodeId(null));
  };

  const moveNode = (id, ll) => {
    if (!pointInRing(ll.lat, ll.lng, ring)) {
      setMsg('That spot is outside the cemetery boundary. Drag it back inside the dashed line.');
      return false;
    }
    setMsg('');
    api('/roads/nodes/' + id, { method: 'PUT', body: { latitude: round(ll.lat), longitude: round(ll.lng) } })
      .then(load)
      .catch((e) => {
        setMsg(e.message);
        load();
      });
    return true;
  };

  const deleteNode = (id) => {
    if (pendingNodeId === id) setPendingNodeId(null);
    guard(() => api('/roads/nodes/' + id, { method: 'DELETE' }), 'Point deleted');
  };

  const onEdgeClick = (id) => {
    setPendingNodeId(null);
    setSelectedEdgeId((cur) => (cur === id ? null : id));
  };

  const deleteEdge = () =>
    guard(() => api('/roads/edges/' + selectedEdgeId, { method: 'DELETE' }).then(() => setSelectedEdgeId(null)), 'Path removed');

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

  const startEdit = () => {
    setEf({ section: grave.section, block: grave.block, row: grave.row, grave_number: grave.grave_number });
    setMode('edit');
    setMsg('');
  };

  const saveDetails = () => guard(() => api('/graves/' + grave.id, { method: 'PUT', body: ef }).then(() => setMode('select')), 'Grave details saved');

  const deleteGrave = () =>
    guard(async () => {
      await api('/graves/' + grave.id, { method: 'DELETE' });
      setSelId(null);
      setConfirmDel(false);
      setCoords({ latitude: '', longitude: '' });
    }, 'Grave deleted');

  const assign = () =>
    guard(() => api(`/records/${recordId}/grave`, { method: 'PUT', body: { grave_id: grave.id } }).then(() => setRecordId('')), 'Grave assigned');

  const unassign = () => guard(() => api(`/records/${grave.record_id}/grave`, { method: 'PUT', body: { grave_id: null } }), 'Grave is now available');

  const pin = (mode === 'move' || mode === 'add') && coords.latitude !== '' ? { latitude: +coords.latitude, longitude: +coords.longitude } : null;
  const counts = graves.reduce((a, g) => { const k = graveState(g); a[k] = (a[k] || 0) + 1; return a; }, {});

  return (
    <>
      <header className="pagehead">
        <h1>Cemetery map</h1>
      </header>
      <div className="mapgrid">
        <div>
          <MapView cemetery={cemetery} graves={graves} selectedId={selId} onSelect={onGraveClick} onMapClick={onMapClick} pin={pin} onPinMove={placeAt}
            locked={false} draft={draft} onDraftMove={movePoint} onDraftRemove={removePoint} />
         <p className="legend muted">
            {Object.entries(STATES).map(([k, s]) => (
              <span key={k} className="legend-item">
                <span className="dot" style={{ background: s.fill, borderColor: s.stroke }} /> {s.label} ({counts[k] || 0})
              </span>
            ))}
            <span className="legend-item"><span className="dot sel" /> Selected</span>
          </p>
        </div>
        <aside className="panel">
          {msg && <p className="notice">{msg}</p>}
          {mode === 'select' && !grave && <p className="muted">Select a grave on the map to see who is buried there, move it, or assign a record.</p>}
          {mode !== 'boundary' && grave && mode !== 'edit' && (
            <section>
              <h2>{grave.grave_number}</h2>
              <p className="muted">Section {grave.section}, block {grave.block}, row {grave.row}</p>
              <p>{grave.status === 'occupied' ? `Occupied by ${grave.occupant}` : 'Available'}</p>
                            {grave.status === 'occupied' && (
                <p className="muted">
                  Lease: {grave.lease_status}{grave.lease_end ? `, ends ${grave.lease_end}` : ''}
                  {grave.assigned_via === 'field' ? ' (assigned by field)' : ''}
                </p>
              )}
              
              {grave.status === 'occupied' ? (
                <button className="secondary" onClick={unassign}>Remove assignment</button>
              )
              
              : (
                <div className="inline">
                  <select value={recordId} onChange={(e) => setRecordId(e.target.value)}>
                    <option value="">Choose a record without a grave</option>
                    {unassigned.map((r) => <option key={r.id} value={r.id}>{r.full_name}</option>)}
                  </select>
                  <button disabled={!recordId} onClick={assign}>Assign</button>
                </div>
              )}
              {mode === 'select' && (
                <div className="inline">
                  <button className="secondary" onClick={startEdit}>Edit details</button>
                  {grave.status === 'available' && !confirmDel && <button className="secondary" onClick={() => setConfirmDel(true)}>Delete grave</button>}
                </div>
              )}
              {mode === 'select' && confirmDel && (
                <>
                  <p className="muted">Delete {grave.grave_number} permanently?</p>
                  <div className="actions">
                    <button className="secondary" onClick={() => setConfirmDel(false)}>Cancel</button>
                    <button onClick={deleteGrave}>Yes, delete</button>
                  </div>
                </>
              )}
            </section>
          )}
          {mode === 'edit' && grave && (
            <section>
              <h2>Edit grave details</h2>
              <div className="row2">
                {GRAVE_LABELS.map(([k, label]) => (
                  <label key={k}>
                    {label}
                    <input value={ef[k]} onChange={(e) => setEf({ ...ef, [k]: e.target.value })} />
                  </label>
                ))}
              </div>
              <div className="actions">
                <button className="secondary" onClick={() => setMode('select')}>Cancel</button>
                <button disabled={GRAVE_LABELS.some(([k]) => !ef[k].trim())} onClick={saveDetails}>Save details</button>
              </div>
            </section>
          )}
          {mode !== 'boundary' && mode !== 'edit' && mode !== 'roads' && (
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
                <p className="muted">Drag the marker or click the new position on the map.</p>
                <div className="actions">
                  <button className="secondary" onClick={() => pick(grave)}>Cancel</button>
                  <button onClick={saveCoords}>Save coordinates</button>
                </div>
              </>
            )}
            {mode === 'add' && (
              <>
                <p className="muted">Click the position on the map (you can drag the marker to adjust), then add the grave.</p>
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
          )}
          {mode === 'select' && (
            <section>
              <h2>Cemetery boundary</h2>
              <p className="muted">Redraw the outline when you have a more accurate map or plan.</p>
              <button className="secondary" onClick={startBoundary}>Edit boundary</button>
            </section>
          )}
          {mode === 'select' && (
            <section>
              <h2>Cemetery paths</h2>
              <p className="muted">Draw the walkable paths between graves, used to route visitors to a grave.</p>
              <button className="secondary" onClick={startRoads}>Edit paths</button>
            </section>
          )}
          {mode === 'roads' && (
            <section>
              <h2>Edit paths</h2>
              <p className="muted">
                Click empty ground to drop a point. Click two points, one after the other, to connect them with a path. Drag a point to move it.
                Right-click a point to delete it (its paths go too). Click a path to select it, then remove it below.
              </p>
              <p>{roads.nodes.length} point{roads.nodes.length === 1 ? '' : 's'}, {roads.edges.length} path{roads.edges.length === 1 ? '' : 's'}</p>
              {pendingNodeId != null && <p className="notice">Point selected — click another point to connect it, or the same point again to cancel.</p>}
              {selectedEdgeId != null && (
                <div className="actions">
                  <button className="secondary" onClick={() => setSelectedEdgeId(null)}>Deselect</button>
                  <button onClick={deleteEdge}>Delete this path</button>
                </div>
              )}
              <div className="actions">
                <button className="secondary" onClick={exitRoads}>Done</button>
              </div>
            </section>
          )}
          {mode === 'boundary' && (
            <section>
              <h2>Edit boundary</h2>
              <p className="muted">Click the map to add corner points in order around the cemetery. Drag a point to move it. Right-click a point to delete it. You can zoom and pan freely while editing.</p>
              <p>{draft.length} point{draft.length === 1 ? '' : 's'}</p>
              <div className="inline">
                <button className="secondary" disabled={!draft.length} onClick={() => setDraft((d) => d.slice(0, -1))}>Undo last point</button>
                <button className="secondary" disabled={!draft.length} onClick={() => setDraft([])}>Start over</button>
              </div>
              <label className="check">
                <input type="checkbox" checked={relayout} onChange={(e) => setRelayout(e.target.checked)} />
                Move the sample graves inside the new boundary
              </label>
              <div className="actions">
                <button className="secondary" onClick={cancelBoundary}>Cancel</button>
                <button disabled={draft.length < 3} onClick={saveBoundary}>Save boundary</button>
              </div>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
