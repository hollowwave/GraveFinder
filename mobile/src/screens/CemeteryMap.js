import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, Platform, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { UrlTile, Polygon, Polyline, Circle, Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { API, get } from '../api';
import { distance, direction } from '../geo';
import { colors } from '../theme';
import Onboarding from '../Onboarding';

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
  const [walkingRoute, setWalkingRoute] = useState(null);
  const insets = useSafeAreaInsets();

  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searchState, setSearchState] = useState('idle');
  const [searchNote, setSearchNote] = useState('');
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResults([]);
      setSearchState('idle');
      return;
    }
    setSearchState('loading');
    const t = setTimeout(() => {
      get('/records?q=' + encodeURIComponent(term))
        .then((r) => {
          setResults(r);
          setSearchState('done');
        })
        .catch(() => setSearchState('error'));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const toggleSearch = () => {
    setSearchOpen((o) => !o);
    setQ('');
    setResults([]);
    setSearchNote('');
  };

  const pickResult = (r) => {
    if (r.grave_id) {
      setSelectedId(r.grave_id);
      setSearchOpen(false);
      setQ('');
      setResults([]);
      setSearchNote('');
    } else {
      setSearchNote(`${r.full_name} has not been assigned a grave location yet.`);
    }
  };

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

  // Drop the old line immediately on a new grave pick, so it never points
  // confidently at the wrong grave while the new route is still loading.
  useEffect(() => setWalkingRoute(null), [selectedId]);

  // Ask the server for a walking route over the road network. Debounced so a
  // moving GPS fix (updates every ~2m) doesn't fire a request on every tick.
  useEffect(() => {
    if (!selected || !cemetery) return;
    const boundaryRing = cemetery.geojson.features.find((f) => f.properties.kind === 'boundary').geometry.coordinates[0];
    const south = boundaryRing.reduce((a, c) => (c[1] < a[1] ? c : a));
    const gateFallback = { latitude: south[1], longitude: south[0] };
    const inRange = gps && distance(gps, cemetery.center) < GPS_RANGE_METERS;
    const pos = inRange && useGps ? gps : gateFallback;
    const t = setTimeout(() => {
      get(`/route?lat=${pos.latitude}&lng=${pos.longitude}&grave_id=${selected.id}`)
        .then(setWalkingRoute)
        .catch(() => setWalkingRoute(null));
    }, 300);
    return () => clearTimeout(t);
  }, [selected, cemetery, gps, useGps]);

  const sections = useMemo(() => (cemetery ? cemetery.geojson.features.filter((f) => f.properties.kind === 'section') : []), [cemetery]);
  const boundary = cemetery?.geojson.features.find((f) => f.properties.kind === 'boundary');

  if (error) return <Text style={s.note}>The cemetery map could not be loaded. Check that the server is running.</Text>;
  if (!cemetery) return <ActivityIndicator style={{ marginTop: 40 }} color={colors.moss} />;

  const b = cemetery.bounds;
  const south = boundary.geometry.coordinates[0].reduce((a, c) => (c[1] < a[1] ? c : a));
  const entrance = { latitude: south[1], longitude: south[0] };
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
    const d = walkingRoute ? walkingRoute.distance_m : Math.round(distance(position, selected));
    if (d < 3) guidance = 'You are at this grave.';
    else if (walkingRoute?.on_road) guidance = `Follow the path — about ${d} m to the grave.`;
    else guidance = `The grave is about ${d} m ${direction(position, selected)} of you.`;
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
        <UrlTile urlTemplate={`${API}/tiles/{z}/{x}/{y}.png`} maximumZ={19} shouldReplaceMapContent />
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
        {selected && walkingRoute?.on_road && (
          <Polyline coordinates={walkingRoute.points} strokeColor={colors.amberDark} strokeWidth={4} />
        )}
        {selected && !walkingRoute?.on_road && (
          <Polyline coordinates={[position, { latitude: selected.latitude, longitude: selected.longitude }]} strokeColor={colors.amberDark} strokeWidth={2} lineDashPattern={[6, 6]} />
        )}
        {simulated && (
          <Marker coordinate={entrance} title="Simulated position" description="Demo entrance, not your GPS location" pinColor="blue" />
        )}
      </MapView>

      <Text style={s.attribution}>© OpenStreetMap contributors</Text>

      <View style={[s.topRow, { top: insets.top + 8 }]} pointerEvents="box-none">
        <View style={s.searchWrap}>
          {searchOpen ? (
            <View style={s.searchBox}>
              <TextInput
                style={s.searchInput}
                value={q}
                onChangeText={(v) => {
                  setQ(v);
                  setSearchNote('');
                }}
                placeholder="Search by name"
                placeholderTextColor={colors.muted}
                autoFocus
                autoCorrect={false}
                returnKeyType="search"
              />
              <Pressable style={s.searchClose} onPress={toggleSearch} hitSlop={10}>
                <Text style={s.searchCloseText}>✕</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable style={s.roundButton} onPress={toggleSearch} hitSlop={10}>
              <Text style={s.roundButtonText}>🔍</Text>
            </Pressable>
          )}
          {searchOpen && !!q.trim() && (
            <ScrollView style={s.resultsBox} keyboardShouldPersistTaps="handled">
              {searchState === 'loading' && <Text style={s.resultsNote}>Searching…</Text>}
              {searchState === 'done' && results.length === 0 && <Text style={s.resultsNote}>No match for “{q.trim()}”.</Text>}
              {results.slice(0, 8).map((r) => (
                <Pressable key={r.id} style={s.resultRow} onPress={() => pickResult(r)}>
                  <Text style={s.resultName}>{r.full_name}</Text>
                  <Text style={s.resultMeta}>{r.grave_id ? `Section ${r.section}, grave ${r.grave_number}` : 'No grave assigned yet'}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
          {!!searchNote && <Text style={s.searchNote}>{searchNote}</Text>}
        </View>
        <Pressable style={s.roundButton} onPress={() => setShowHelp(true)} hitSlop={10}>
          <Text style={s.roundButtonText}>?</Text>
        </Pressable>
      </View>

      <Onboarding visible={showHelp} onClose={() => setShowHelp(false)} />

      <View style={s.sheet}>
        {gps && !gpsInRange && (
          <View style={s.banner}>
            <Text style={s.bannerText}>You're outside the cemetery's GPS range — showing a route from the main gate instead.</Text>
          </View>
        )}
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
  topRow: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  searchWrap: { flex: 1, marginRight: 10 },
  roundButton: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line,
    alignItems: 'center', justifyContent: 'center',
    elevation: 3, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
  },
  roundButtonText: { fontSize: 18, color: colors.ink },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', maxWidth: '100%',
    backgroundColor: colors.panel, borderRadius: 24, borderWidth: 1, borderColor: colors.line, height: 48, paddingLeft: 16, paddingRight: 6,
    elevation: 3, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
  },
  searchInput: { flex: 1, fontSize: 16, color: colors.ink, minWidth: 160 },
  searchClose: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  searchCloseText: { fontSize: 16, color: colors.muted, fontWeight: '700' },
  resultsBox: { backgroundColor: colors.panel, borderRadius: 10, borderWidth: 1, borderColor: colors.line, marginTop: 6, maxHeight: 260 },
  resultsNote: { padding: 14, color: colors.muted, fontSize: 14 },
  resultRow: { paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line },
  resultName: { fontSize: 16, color: colors.ink, fontWeight: '600' },
  resultMeta: { fontSize: 13, color: colors.muted, marginTop: 2 },
  searchNote: { marginTop: 6, color: colors.oxblood, fontSize: 13, backgroundColor: colors.panel, padding: 8, borderRadius: 6 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.panel, padding: 16, paddingBottom: 28, borderTopWidth: 1, borderTopColor: colors.line },
  grave: { fontSize: 20, fontWeight: '700', color: colors.ink },
  meta: { fontSize: 15, color: colors.muted, marginTop: 2, lineHeight: 21 },
  guidance: { fontSize: 16, color: colors.ink, fontWeight: '600', marginTop: 8 },
  source: { fontSize: 13, color: colors.muted, marginTop: 10 },
  banner: { backgroundColor: '#fbf0d9', borderWidth: 1, borderColor: colors.amber, borderRadius: 6, padding: 10, marginBottom: 10 },
  bannerText: { color: colors.amberDark, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  link: { fontSize: 14, color: colors.moss, fontWeight: '600', marginTop: 6, paddingVertical: 6 },
});
