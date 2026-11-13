import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const COLORS = { occupied: '#8c3b34', available: '#ffffff', selected: '#e0a100' };

export default function MapView({ cemetery, graves, selectedId, onSelect, onMapClick, pin }) {
  const el = useRef();
  const map = useRef();
  const layer = useRef();
  const clickRef = useRef();
  clickRef.current = onMapClick;

  useEffect(() => {
    const m = L.map(el.current, { maxZoom: 22, zoomSnap: 0.25 });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 22,
      maxNativeZoom: 19,
      attribution: '© OpenStreetMap contributors',
    }).addTo(m);
    const b = cemetery.bounds;
    const area = L.latLngBounds([b.minLat, b.minLng], [b.maxLat, b.maxLng]);
    m.fitBounds(area);
    m.setMinZoom(m.getZoom());
    m.setMaxBounds(area.pad(0.25));
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
    m.on('click', (e) => clickRef.current && clickRef.current(e.latlng));
    map.current = m;
    return () => m.remove();
  }, [cemetery]);

  useEffect(() => {
    layer.current.clearLayers();
    graves.forEach((g) => {
      const sel = g.id === selectedId;
      const m = L.circleMarker([g.latitude, g.longitude], {
        radius: sel ? 9 : 6,
        weight: sel ? 3 : 2,
        color: sel ? '#6b4b00' : g.status === 'occupied' ? '#8c3b34' : '#2f5d50',
        fillColor: sel ? COLORS.selected : COLORS[g.status],
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
      L.circleMarker([pin.latitude, pin.longitude], { radius: 8, weight: 3, color: '#1c2623', fillColor: '#ffffff', fillOpacity: 0.6 }).addTo(layer.current);
    }
  }, [graves, selectedId, pin, onSelect]);

  return <div ref={el} className="map" />;
}

