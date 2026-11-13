import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform, ActivityIndicator } from 'react-native';
import MapView, { UrlTile, Polygon, Polyline, Circle, Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { get } from '../api';
import { distance, direction } from '../geo';
import { colors } from '../theme';

const toCoords = (ring) => ring.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
const NEAR_METERS = 4;
const GPS_RANGE_METERS = 1000;

export default function CemeteryMap({ route }) {
  const mapRef = useRef();
  const [cemetery, setCemetery] = useState(null);
  const [graves, setGraves] = useState([]);
  const [selectedId, setSelectedId] = useState(route.params?.graveId ?? null);
  const [gps, setGps] = useState(null);
  const [useGps, setUseGps] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    Promise.all([get('/cemetery'), get('/graves')])
      .then(([c, g]) => {
        setCemetery(c);
        setGraves(g);
      })
      .catch(() => setError(true));
  }, []);

  useEffect(() => {
    let sub;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      sub = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, distanceInterval: 2 }, (p) =>
        setGps({ latitude: p.coords.latitude, longitude: p.coords.longitude })
      );
    })().catch(() => {});
    return () => sub && sub.remove();
  }, []);

  const selected = graves.find((g) => g.id === selectedId);

  useEffect(() => {
    if (selected && mapRef.current)
      mapRef.current.animateToRegion({ latitude: selected.latitude, longitude: selected.longitude, latitudeDelta: 0.0003, longitudeDelta: 0.0003 }, 400);
  }, [selectedId, cemetery]);

  const sections = useMemo(() => (cemetery ? cemetery.geojson.features.filter((f) => f.properties.kind === 'section') : []), [cemetery]);
  const boundary = cemetery?.geojson.features.find((f) => f.properties.kind === 'boundary');

  if (error) return <Text style={s.note}>The cemetery map could not be loaded. Check that the server is running.</Text>;
  if (!cemetery) return <ActivityIndicator style={{ marginTop: 40 }} color={colors.moss} />;

  const b = cemetery.bounds;
  const entrance = { latitude: b.minLat + 0.00003, longitude: cemetery.center.longitude };
  const home = {
    latitude: cemetery.center.latitude,
    longitude: cemetery.center.longitude,
    latitudeDelta: (b.maxLat - b.minLat) * 1.6,
    longitudeDelta: (b.maxLng - b.minLng) * 1.6,
  };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const keepInside = (r) => {
    const tooWide = r.latitudeDelta > home.latitudeDelta * 1.5;
    const out = r.latitude < b.minLat || r.latitude > b.maxLat || r.longitude < b.minLng || r.longitude > b.maxLng;
    if (tooWide) mapRef.current.animateToRegion(home, 300);
    else if (out)
      mapRef.current.animateToRegion(
        { ...r, latitude: clamp(r.latitude, b.minLat, b.maxLat), longitude: clamp(r.longitude, b.minLng, b.maxLng) },
        300
      );
  };
  const gpsInRange = gps && distance(gps, cemetery.center) < GPS_RANGE_METERS;
  const simulated = !(gpsInRange && useGps);
  const position = simulated ? entrance : gps;

  const onMapPress = (e) => {
    const p = e.nativeEvent.coordinate;
    let best = null;
    let bestD = NEAR_METERS;
    graves.forEach((g) => {
      const d = distance(p, g);
      if (d < bestD) {
        best = g;
        bestD = d;
      }
    });
    if (best) setSelectedId(best.id);
  };

  let guidance = '';
  if (selected) {
    const d = distance(position, selected);
    guidance = d < 3 ? 'You are at this grave.' : `The grave is about ${Math.round(d)} m ${direction(position, selected)} of you.`;
  }

  return (
    <View style={s.screen}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        mapType={Platform.OS === 'android' ? 'none' : 'standard'}
        initialRegion={home}
        onRegionChangeComplete={keepInside}
        maxZoomLevel={21}
        showsUserLocation={!simulated}
        onPress={onMapPress}
        toolbarEnabled={false}
      >
        <UrlTile urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maximumZ={19} shouldReplaceMapContent />
        {boundary && (
          <Polygon coordinates={toCoords(boundary.geometry.coordinates[0])} strokeColor={colors.moss} strokeWidth={2} fillColor="transparent" lineDashPattern={[8, 6]} />
        )}
        {sections.map((f) => {
          const ring = toCoords(f.geometry.coordinates[0]);
          const lats = ring.map((c) => c.latitude);
          const lngs = ring.map((c) => c.longitude);
          return (
            <Fragment key={f.properties.section}>
              <Polygon coordinates={ring} strokeColor={colors.moss} strokeWidth={1} fillColor="rgba(47,93,80,0.08)" />
              <Marker
                coordinate={{ latitude: (Math.min(...lats) + Math.max(...lats)) / 2, longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2 }}
                tracksViewChanges={false}
                anchor={{ x: 0.5, y: 0.5 }}
              >
                <Text style={s.section}>Section {f.properties.section}</Text>
              </Marker>
            </Fragment>
          );
        })}
        {graves.map((g) => {
          const sel = g.id === selectedId;
          return (
            <Circle
              key={g.id}
              center={{ latitude: g.latitude, longitude: g.longitude }}
              radius={sel ? 2.2 : 1.2}
              zIndex={sel ? 3 : 2}
              strokeWidth={sel ? 3 : 1.5}
              strokeColor={sel ? colors.amberDark : g.status === 'occupied' ? colors.oxblood : colors.moss}
              fillColor={sel ? colors.amber : g.status === 'occupied' ? colors.oxblood : '#ffffff'}
            />
          );
        })}
        {selected && (
          <Marker key={'label' + selected.id} coordinate={{ latitude: selected.latitude, longitude: selected.longitude }} anchor={{ x: 0.5, y: 1.6 }} tracksViewChanges={false}>
            <View style={s.label}>
              <Text style={s.labelText}>{selected.grave_number}</Text>
            </View>
          </Marker>
        )}
        {selected && <Polyline coordinates={[position, { latitude: selected.latitude, longitude: selected.longitude }]} strokeColor={colors.amberDark} strokeWidth={2} lineDashPattern={[6, 6]} />}
        {simulated && (
          <Marker coordinate={entrance} title="Simulated position" description="Demo entrance, not your GPS location" pinColor="blue" />
        )}
      </MapView>

      <Text style={s.attribution}>© OpenStreetMap contributors</Text>

      <View style={s.sheet}>
        {selected ? (
          <>
            <Text style={s.grave}>{selected.grave_number}</Text>
            <Text style={s.meta}>Section {selected.section}, block {selected.block}, row {selected.row}</Text>
            <Text style={s.meta}>{selected.status === 'occupied' ? `Buried here: ${selected.occupant}` : 'No burial recorded at this grave'}</Text>
            <Text style={s.guidance}>{guidance}</Text>
          </>
        ) : (
          <Text style={s.meta}>Tap a grave on the map to see its details. Filled red circles are occupied, open circles are available.</Text>
        )}
        <Text style={s.source}>{simulated ? 'Position: simulated at the cemetery entrance (demo)' : 'Position: your GPS location'}</Text>
        {gpsInRange && (
          <Pressable onPress={() => setUseGps(!useGps)}>
            <Text style={s.link}>{useGps ? 'Use simulated position instead' : 'Use my GPS position'}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  note: { padding: 20, color: colors.muted, fontSize: 15, lineHeight: 21 },
  section: { color: colors.moss, fontWeight: '700', fontSize: 13, opacity: 0.8 },
  label: { backgroundColor: colors.ink, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  labelText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  attribution: { position: 'absolute', right: 6, top: 4, fontSize: 10, color: colors.ink, backgroundColor: 'rgba(255,255,255,0.7)', paddingHorizontal: 4 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.panel, padding: 16, paddingBottom: 28, borderTopWidth: 1, borderTopColor: colors.line },
  grave: { fontSize: 20, fontWeight: '700', color: colors.ink },
  meta: { fontSize: 15, color: colors.muted, marginTop: 2, lineHeight: 21 },
  guidance: { fontSize: 16, color: colors.ink, fontWeight: '600', marginTop: 8 },
  source: { fontSize: 13, color: colors.muted, marginTop: 10 },
  link: { fontSize: 14, color: colors.moss, fontWeight: '600', marginTop: 6, paddingVertical: 6 },
});
