import { useEffect, useState } from 'react';
import { View, Text, TextInput, FlatList, Pressable, StyleSheet } from 'react-native';
import { get } from '../api';
import { years } from '../geo';
import { colors } from '../theme';

export default function Search({ navigation, route }) {
  const [q, setQ] = useState(route.params?.q || '');
  const [rows, setRows] = useState([]);
  const [state, setState] = useState('idle');

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setRows([]);
      setState('idle');
      return;
    }
    setState('loading');
    const t = setTimeout(() => {
      get('/records?q=' + encodeURIComponent(term))
        .then((r) => {
          setRows(r);
          setState('done');
        })
        .catch(() => setState('error'));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const message = {
    idle: 'Type a first name, last name, or full name. Partial names work.',
    error: 'Could not reach the cemetery records. Check that the server is running and your phone is on the same network.',
    done: rows.length ? '' : `No burial record matches “${q.trim()}”. Check the spelling or try fewer letters.`,
    loading: '',
  }[state];

  return (
    <View style={s.screen}>
      <TextInput
        style={s.input}
        value={q}
        onChangeText={setQ}
        placeholder="Name of the deceased"
        placeholderTextColor={colors.muted}
        autoFocus={!route.params?.q}
        autoCorrect={false}
      />
      {!!message && <Text style={s.message}>{message}</Text>}
      <FlatList
        data={rows}
        keyExtractor={(r) => String(r.id)}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item: r }) => (
          <Pressable style={s.row} onPress={() => navigation.navigate('Record', { id: r.id })}>
            <Text style={s.name}>{r.full_name}</Text>
            <Text style={s.meta}>{years(r)}</Text>
            <Text style={s.meta}>{r.grave_number ? `Section ${r.section}, grave ${r.grave_number}` : 'No grave assigned yet'}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 20 },
  input: {
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 6,
    paddingHorizontal: 14, height: 52, fontSize: 18, color: colors.ink,
  },
  message: { color: colors.muted, marginTop: 16, fontSize: 15, lineHeight: 21 },
  row: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line, minHeight: 64 },
  name: { fontSize: 18, color: colors.ink, fontWeight: '600' },
  meta: { fontSize: 14, color: colors.muted, marginTop: 2 },
});
