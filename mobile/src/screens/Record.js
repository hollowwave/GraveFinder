import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { get } from '../api';
import { addRecent } from '../recent';
import { colors } from '../theme';

const fmt = (d) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Not recorded');

export default function Record({ navigation, route }) {
  const [r, setR] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    get('/records/' + route.params.id)
      .then((rec) => {
        setR(rec);
        addRecent(rec);
      })
      .catch(() => setError(true));
  }, [route.params.id]);

  if (error) return <Text style={s.note}>This record could not be loaded.</Text>;
  if (!r) return null;

  const rows = [
    ['Date of birth', fmt(r.date_of_birth)],
    ['Date of death', fmt(r.date_of_death)],
    ['Burial date', fmt(r.burial_date)],
    ['Section', r.section || 'Not assigned'],
    ['Block', r.block || 'Not assigned'],
    ['Row', r.row || 'Not assigned'],
    ['Grave number', r.grave_number || 'Not assigned'],
  ];

  return (
    <ScrollView contentContainerStyle={s.screen}>
      <Text style={s.name}>{r.full_name}</Text>
      {rows.map(([k, v]) => (
        <View key={k} style={s.row}>
          <Text style={s.key}>{k}</Text>
          <Text style={s.value}>{v}</Text>
        </View>
      ))}
      {r.grave_id ? (
        <Pressable style={s.button} onPress={() => navigation.navigate('Map', { graveId: r.grave_id })}>
          <Text style={s.buttonText}>Locate grave on map</Text>
        </Pressable>
      ) : (
        <Text style={s.note}>This person has not been assigned a grave location yet. Please ask the cemetery office.</Text>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { padding: 20 },
  name: { fontSize: 26, fontWeight: '700', color: colors.ink, marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 12 },
  key: { color: colors.muted, fontSize: 15 },
  value: { color: colors.ink, fontSize: 16, fontWeight: '500', flexShrink: 1, textAlign: 'right' },
  button: { backgroundColor: colors.moss, borderRadius: 6, height: 54, justifyContent: 'center', alignItems: 'center', marginTop: 24 },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  note: { color: colors.muted, marginTop: 20, fontSize: 15, lineHeight: 21, paddingHorizontal: 20 },
});
