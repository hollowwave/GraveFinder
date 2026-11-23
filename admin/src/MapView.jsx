import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { STATES, graveState } from './lease';


export default function MapView({ cemetery, graves, selectedId, onSelect, onMapClick, pin, onPinMove, locked = true, draft, onDraftMove, onDraftRemove }) {
  const el = useRef();
  const map = useRef();
  const layer = useRef();
  const draftLayer = useRef();
  const lock = useRef({});
  const clickRef = useRef();
  clickRef.current = onMapClick;
  const pinMoveRef = useRef();
  pinMoveRef.current = onPinMove;

  useEffect(() => {
    const m = L.map(el.current, { maxZoom: 22, zoomSnap: 0.25 });
    L.tileLayer('/api/tiles/{z}/{x}/{y}.png', {
      maxZoom: 22,
      maxNativeZoom: 19,
      attribution: '© OpenStreetMap contributors',
    }).addTo(m);
    const b = cemetery.bounds;
    const area = L.latLngBounds([b.minLat, b.minLng], [b.maxLat, b.maxLng]);
    m.fitBounds(area);
    lock.current = { zoom: m.getZoom(), bounds: area.pad(0.25) };
    m.options.maxBoundsViscosity = 1;
    L.geoJSON(cemetery.geojson, {
      style: (f) =>
        f.properties.kind === 'boundary'
          ? { color: '#2f5d50', weight: 2, fill: false, dashArray: '6 4', interactive: false }
          : { color: '#2f5d50', weight: 1, fillColor: '#2f5d50', fillOpacity: 0.07, interactive: false },
      onEachFeature: (f, l) => {
        if (f.properties.kind !== 'section') return;
        const bb = l.getBounds();
        L.circleMarker([bb.getNorth(), bb.getCenter().lng], { radius: 0, opacity: 0, fill: false, interactive: false })
          .bindTooltip('Section ' + f.properties.section, { permanent: true, direction: 'top', offset: [0, 2], className: 'sec-label' })
          .addTo(m);
      },
    }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    draftLayer.current = L.layerGroup().addTo(m);
    m.on('click', (e) => clickRef.current && clickRef.current(e.latlng));
    map.current = m;
    return () => m.remove();
  }, [cemetery]);

  useEffect(() => {
    layer.current.clearLayers();
    graves.forEach((g) => {
       const sel = g.id === selectedId;
      const st = STATES[graveState(g)];
      const m = L.circleMarker([g.latitude, g.longitude], {
        radius: sel ? 9 : 6,
        weight: sel ? 3 : 2,
        color: sel ? '#6b4b00' : st.stroke,
        fillColor: sel ? '#e0a100' : st.fill,
        fillOpacity: 1,
      });
      m.bindTooltip(g.grave_number, { permanent: sel, direction: 'top', offset: [0, -6] });
      m.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        onSelect && onSelect(g, e.latlng);
      });
      m.addTo(layer.current);
    });
    if (pin) {
      const mk = L.marker([pin.latitude, pin.longitude], { draggable: true, icon: L.divIcon({ className: 'vertex', iconSize: [16, 16] }) });
      mk.on('dragend', (e) => {
        const ok = pinMoveRef.current && pinMoveRef.current(e.target.getLatLng());
        if (!ok) e.target.setLatLng([pin.latitude, pin.longitude]);
      });
      mk.addTo(layer.current);
    }
  }, [graves, selectedId, pin, onSelect, cemetery]);

  useEffect(() => {
    const m = map.current;
    if (locked) {
      m.setMinZoom(lock.current.zoom);
      m.setMaxBounds(lock.current.bounds);
    } else {
      m.setMinZoom(0);
      m.setMaxBounds(null);
    }
  }, [locked, cemetery]);

  useEffect(() => {
    const g = draftLayer.current;
    g.clearLayers();
    if (!draft || !draft.length) return;
    const pts = draft.map((p) => [p.latitude, p.longitude]);
    const style = { color: '#b07d00', weight: 2, dashArray: '5 4', fillColor: '#e0a100', fillOpacity: 0.15, interactive: false };
    (pts.length >= 3 ? L.polygon(pts, style) : L.polyline(pts, style)).addTo(g);
    pts.forEach((pt, i) => {
      const mk = L.marker(pt, { draggable: true, icon: L.divIcon({ className: 'vertex', iconSize: [16, 16] }) });
      mk.bindTooltip(String(i + 1), { permanent: true, direction: 'top', offset: [0, -8], className: 'vertex-label' });
      mk.on('dragend', (e) => onDraftMove && onDraftMove(i, e.target.getLatLng()));
      mk.on('contextmenu', () => onDraftRemove && onDraftRemove(i));
      mk.addTo(g);
    });
  }, [draft, cemetery, onDraftMove, onDraftRemove]);

  return <div ref={el} className="map" />;
}
