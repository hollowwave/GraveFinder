import { useEffect, useState, useCallback, useMemo } from 'react';
import { STATES, graveState } from './lease';
import { api } from './api';
import MapView from './MapView';
import { pointInRing } from './geo';


const GRAVE_LABELS = [['section', 'Section'], ['block', 'Block'], ['row', 'Row'], ['grave_number', 'Grave number']];
const round = (n) => Math.round(n * 1e7) / 1e7;

// Distance from point p to segment a-b, in a lng/lat plane scaled so both axes are roughly equal in metres.
const segDist = (p, a, b) => {
  const k = Math.cos((p.latitude * Math.PI) / 180);
  const px = p.longitude * k, py = p.latitude;
  const ax = a.longitude * k, ay = a.latitude;
  const bx = b.longitude * k, by = b.latitude;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

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
  const [outsideMode, setOutsideMode] = useState('block'); // what to do with graves outside the new boundary: block | relayout | delete
  const [confirmBoundaryDelete, setConfirmBoundaryDelete] = useState(false);
  const [vertex, setVertex] = useState(null);
  const [picked, setPicked] = useState([]);
  const [confirmMulti, setConfirmMulti] = useState(false);
  const [roads, setRoads] = useState({ nodes: [], edges: [] });
  const [pendingNodeId, setPendingNodeId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const ring = cemetery.geojson.features.find((f) => f.properties.kind === 'boundary').geometry.coordinates[0];

  const load = useCallback(() => {
    api('/admin/graves').then(setGraves);
    api('/records?status=unassigned').then(setUnassigned);
    api('/roads').then(setRoads).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const grave = graves.find((g) => g.id === selId);
  const flash = (m) => setMsg(m);
  const pickedSet = useMemo(() => new Set(picked), [picked]);
  const pickedOccupied = graves.filter((g) => pickedSet.has(g.id) && g.status === 'occupied').length;
  const sectionNames = useMemo(() => [...new Set(graves.map((g) => g.section))].sort(), [graves]);
  // Graves that the boundary being drawn would leave outside (shown in red on the map).
  const outsideIds = useMemo(() => {
    if (mode !== 'boundary' || !draft || draft.length < 3 || outsideMode === 'relayout') return undefined;
    const r = draft.map((p) => [p.longitude, p.latitude]);
    return new Set(graves.filter((g) => !pointInRing(g.latitude, g.longitude, r)).map((g) => g.id));
  }, [mode, draft, graves, outsideMode]);
  const outsideOccupied = outsideIds ? graves.filter((g) => outsideIds.has(g.id) && g.status === 'occupied').length : 0;

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

  // With 3+ points the shape is already closed, so a new corner goes into the nearest edge instead of the end.
  const addPoint = useCallback((ll) => {
    const pt = { latitude: round(ll.lat), longitude: round(ll.lng) };
    setVertex(null);
    setDraft((d) => {
      if (d.length < 3) return [...d, pt];
      let best = d.length - 1;
      let bestD = Infinity;
      d.forEach((a, i) => {
        const dist = segDist(pt, a, d[(i + 1) % d.length]);
        if (dist < bestD) {
          bestD = dist;
          best = i;
        }
      });
      return [...d.slice(0, best + 1), pt, ...d.slice(best + 1)];
    });
  }, []);
  const movePoint = useCallback((i, ll) => setDraft((d) => d.map((p, k) => (k === i ? { latitude: round(ll.lat), longitude: round(ll.lng) } : p))), []);
  const removePoint = useCallback((i) => {
    setDraft((d) => d.filter((_, k) => k !== i));
    setVertex(null);
  }, []);
  const togglePick = useCallback((id) => {
    setConfirmMulti(false);
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }, []);

  // Delete / Backspace removes the selected boundary point.
  useEffect(() => {
    if (mode !== 'boundary' || vertex == null) return undefined;
    const onKey = (e) => {
      if (!['Delete', 'Backspace'].includes(e.key) || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      e.preventDefault();
      removePoint(vertex);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, vertex, removePoint]);

  const addRoadNode = (ll) =>
    guard(() => api('/roads/nodes', { method: 'POST', body: { latitude: round(ll.lat), longitude: round(ll.lng) } }), 'Point added');

  const onGraveClick = useCallback(
    (g, ll) => {
      if (mode === 'select' || mode === 'edit') pick(g);
      else if (mode === 'multi') togglePick(g.id);
      else if (mode === 'boundary') addPoint(ll);
      else if (mode === 'roads') addRoadNode(ll);
      else placeAt(ll);
    },
    [mode, pick, placeAt, addPoint, togglePick]
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
    setOutsideMode('block');
    setConfirmBoundaryDelete(false);
    setVertex(null);
    setSelId(null);
    setMode('boundary');
    setMsg('');
  };

  const cancelBoundary = () => {
    setDraft(null);
    setVertex(null);
    setConfirmBoundaryDelete(false);
    setMode('select');
    setMsg('');
  };

  const saveBoundary = async () => {
    try {
      const updated = await api('/cemetery/boundary', {
        method: 'PUT',
        body: { ring: draft.map((p) => [p.longitude, p.latitude]), relayout: outsideMode === 'relayout', outside: outsideMode === 'delete' ? 'delete' : undefined },
      });
      const removed = outsideMode === 'delete' ? outsideIds.size : 0;
      onCemeteryChange(updated);
      setDraft(null);
      setVertex(null);
      setConfirmBoundaryDelete(false);
      setMode('select');
      flash(removed ? `Boundary saved. ${removed} grave${removed === 1 ? '' : 's'} outside it ${removed === 1 ? 'was' : 'were'} deleted.` : 'Boundary saved');
      load();
    } catch (e) {
      setConfirmBoundaryDelete(false);
      flash(e.message);
    }
  };

  const trySaveBoundary = () => {
    if (outsideMode === 'delete' && outsideIds && outsideIds.size > 0 && !confirmBoundaryDelete) return setConfirmBoundaryDelete(true);
    saveBoundary();
  };

  const startMulti = () => {
    setPicked([]);
    setConfirmMulti(false);
    setSelId(null);
    setMode('multi');
    setMsg('');
  };

  const exitMulti = () => {
    setPicked([]);
    setConfirmMulti(false);
    setMode('select');
    setMsg('');
  };

  const deletePicked = async () => {
    try {
      const r = await api('/graves/bulk-delete', { method: 'POST', body: { ids: picked, unassign: true } });
      flash(
        `Deleted ${r.deleted} grave${r.deleted === 1 ? '' : 's'}.` +
          (r.unassigned ? ` ${r.unassigned} burial record${r.unassigned === 1 ? ' was' : 's were'} kept and now ${r.unassigned === 1 ? 'has' : 'have'} no grave.` : '')
      );
      setPicked([]);
      setConfirmMulti(false);
      setMode('select');
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
      await api('/graves/' + grave.id + (grave.status === 'occupied' ? '?unassign=true' : ''), { method: 'DELETE' });
      setSelId(null);
      setConfirmDel(false);
      setCoords({ latitude: '', longitude: '' });
    }, grave.status === 'occupied' ? `Grave deleted. ${grave.occupant}'s burial record was kept and now has no grave.` : 'Grave deleted');

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
            locked={mode !== 'boundary'} draft={draft} onDraftMove={movePoint} onDraftRemove={removePoint} selectedVertex={vertex} onDraftSelect={setVertex}
            pickedIds={mode === 'multi' ? pickedSet : undefined} outsideIds={outsideIds}
            roads={roads} roadMode={mode === 'roads'} pendingNodeId={pendingNodeId} selectedEdgeId={selectedEdgeId}
            onNodeClick={onNodeClick} onNodeDrag={moveNode} onNodeContext={deleteNode} onEdgeClick={onEdgeClick} />
          <p className="legend muted">
            {Object.entries(STATES).map(([k, s]) => (
              <span key={k} className="legend-item">
                <span className="dot" style={{ background: s.fill, borderColor: s.stroke }} /> {s.label} ({counts[k] || 0})
              </span>
            ))}
            <span className="legend-item"><span className="dot sel" /> Selected</span>
            <span className="legend-item"><span className="dot road" /> Path ({roads.edges.length})</span>
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
                  {!confirmDel && <button className="secondary" onClick={() => setConfirmDel(true)}>Delete grave</button>}
                </div>
              )}
              {mode === 'select' && confirmDel && (
                <>
                  <p className="muted">
                    Delete {grave.grave_number} permanently?
                    {grave.status === 'occupied' && ` ${grave.occupant}'s burial record is kept, but it will have no grave until you assign a new one.`}
                  </p>
                  <div className="actions">
                    <button className="secondary" onClick={() => setConfirmDel(false)}>Cancel</button>
                    <button className="destructive" onClick={deleteGrave}>Yes, delete</button>
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
          {mode !== 'boundary' && mode !== 'edit' && mode !== 'roads' && mode !== 'multi' && (
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
              <h2>Delete several graves</h2>
              <p className="muted">Pick many graves on the map, a whole section, or every grave, and remove them in one step.</p>
              <button className="secondary" onClick={startMulti}>Select graves to delete</button>
            </section>
          )}
          {mode === 'multi' && (
            <section>
              <h2>Select graves to delete</h2>
              <p className="muted">Click graves on the map to select or unselect them.</p>
              <p><strong>{picked.length}</strong> selected</p>
              <div className="inline">
                <button className="secondary" onClick={() => { setConfirmMulti(false); setPicked(graves.filter((g) => g.status === 'available').map((g) => g.id)); }}>All available ({counts.available || 0})</button>
                <button className="secondary" onClick={() => { setConfirmMulti(false); setPicked(graves.map((g) => g.id)); }}>Every grave ({graves.length})</button>
                <button className="secondary" disabled={!picked.length} onClick={() => { setConfirmMulti(false); setPicked([]); }}>Clear</button>
              </div>
              <div className="inline">
                <select
                  value=""
                  onChange={(e) => {
                    const sec = e.target.value;
                    setConfirmMulti(false);
                    setPicked((p) => [...new Set([...p, ...graves.filter((g) => g.section === sec).map((g) => g.id)])]);
                  }}
                >
                  <option value="">Add a whole section…</option>
                  {sectionNames.map((n) => <option key={n} value={n}>Section {n}</option>)}
                </select>
              </div>
              {pickedOccupied > 0 && (
                <p className="warn">
                  {pickedOccupied} of these {pickedOccupied === 1 ? 'has a burial record' : 'have burial records'}. The records are kept, but they will have no grave until you assign a new one.
                </p>
              )}
              {confirmMulti ? (
                <>
                  <p className="muted">Delete {picked.length} grave{picked.length === 1 ? '' : 's'} permanently?</p>
                  <div className="actions">
                    <button className="secondary" onClick={() => setConfirmMulti(false)}>Cancel</button>
                    <button className="destructive" onClick={deletePicked}>Yes, delete</button>
                  </div>
                </>
              ) : (
                <div className="actions">
                  <button className="secondary" onClick={exitMulti}>Done</button>
                  <button className="destructive" disabled={!picked.length} onClick={() => setConfirmMulti(true)}>Delete selected ({picked.length})</button>
                </div>
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
              <p className="muted">
                Click the map to add a corner (it goes into the nearest edge). Drag a point to move it. Click a point to select it, then delete it with the button, the Delete key, or a right-click.
                You can zoom and pan freely while editing.
              </p>
              <p>{draft.length} point{draft.length === 1 ? '' : 's'}{vertex != null && ` · point ${vertex + 1} selected`}</p>
              <div className="inline">
                <button className="secondary" disabled={vertex == null} onClick={() => removePoint(vertex)}>Delete selected point</button>
                <button className="secondary" disabled={!draft.length} onClick={() => { setVertex(null); setDraft((d) => d.slice(0, -1)); }}>Undo last point</button>
                <button className="secondary" disabled={!draft.length} onClick={() => { setVertex(null); setDraft([]); }}>Start over</button>
              </div>
              <h2>Graves outside the new shape</h2>
              {outsideIds && (
                <p className={outsideIds.size ? 'warn' : 'muted'}>
                  {outsideIds.size ? `${outsideIds.size} grave${outsideIds.size === 1 ? ' is' : 's are'} outside (shown in red).` : 'Every grave is inside.'}
                  {outsideOccupied > 0 && ` ${outsideOccupied} ${outsideOccupied === 1 ? 'has a burial record' : 'have burial records'}.`}
                </p>
              )}
              {[
                ['block', 'Do not save until they are inside', 'Adjust the shape or move the graves yourself.'],
                ['relayout', 'Move the sample graves inside', 'Re-centres the sample grid in the new shape. Graves you added yourself stay where they are.'],
                ['delete', 'Delete the graves that are outside', 'Burial records are kept, without a grave.'],
              ].map(([k, label, hint]) => (
                <label key={k} className="radio">
                  <input type="radio" name="outsideMode" checked={outsideMode === k} onChange={() => { setOutsideMode(k); setConfirmBoundaryDelete(false); }} />
                  <span>{label}<br /><span className="muted">{hint}</span></span>
                </label>
              ))}
              {confirmBoundaryDelete ? (
                <>
                  <p className="warn">Delete {outsideIds.size} grave{outsideIds.size === 1 ? '' : 's'} and save the boundary?</p>
                  <div className="actions">
                    <button className="secondary" onClick={() => setConfirmBoundaryDelete(false)}>Back</button>
                    <button className="destructive" onClick={saveBoundary}>Yes, delete and save</button>
                  </div>
                </>
              ) : (
                <div className="actions">
                  <button className="secondary" onClick={cancelBoundary}>Cancel</button>
                  <button disabled={draft.length < 3} onClick={trySaveBoundary}>Save boundary</button>
                </div>
              )}
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
