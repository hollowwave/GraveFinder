import { useCallback, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { getRecent } from '../recent';
import { colors } from '../theme';

export default function Home({ navigation }) {
  const [q, setQ] = useState('');
  const [recent, setRecent] = useState([]);

  useFocusEffect(
    useCallback(() => {
      getRecent().then(setRecent);
    }, [])
  );

  const search = () => navigation.navigate('Search', { q });

  return (
    <SafeAreaView style={s.screen}>
      <Text style={s.title}>GraveFinder</Text>
      <Text style={s.sub}>Hardin ng Alaala Memorial Park</Text>
      <TextInput
        style={s.input}
        placeholder="Search by first or last name"
        placeholderTextColor={colors.muted}
        value={q}
        onChangeText={setQ}
        onSubmitEditing={search}
        returnKeyType="search"
        autoCorrect={false}
      />
      <Pressable style={s.primary} onPress={search}>
        <Text style={s.primaryText}>Search burials</Text>
      </Pressable>
      <Pressable style={s.secondary} onPress={() => navigation.navigate('Map')}>
        <Text style={s.secondaryText}>Open cemetery map</Text>
      </Pressable>
      {recent.length > 0 && (
        <View style={s.recent}>
          <Text style={s.heading}>Recently viewed</Text>
          {recent.map((r) => (
            <Pressable key={r.id} style={s.row} onPress={() => navigation.navigate('Record', { id: r.id })}>
              <Text style={s.name}>{r.full_name}</Text>
              <Text style={s.meta}>{r.grave_number ? `Section ${r.section}, grave ${r.grave_number}` : 'No grave assigned'}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 20, paddingTop: 36 },
  title: { fontSize: 30, fontWeight: '700', color: colors.moss },
  sub: { color: colors.muted, marginBottom: 28, marginTop: 2 },
  input: {
    backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.line, borderRadius: 6,
    paddingHorizontal: 14, height: 56, fontSize: 18, color: colors.ink,
  },
  primary: { backgroundColor: colors.moss, borderRadius: 6, height: 52, justifyContent: 'center', alignItems: 'center', marginTop: 12 },
  primaryText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  secondary: { borderWidth: 1, borderColor: colors.moss, borderRadius: 6, height: 52, justifyContent: 'center', alignItems: 'center', marginTop: 10 },
  secondaryText: { color: colors.moss, fontSize: 17, fontWeight: '600' },
  recent: { marginTop: 32 },
  heading: { fontSize: 16, fontWeight: '700', color: colors.ink, marginBottom: 6 },
  row: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.line, minHeight: 56 },
  name: { fontSize: 17, color: colors.ink },
  meta: { fontSize: 14, color: colors.muted, marginTop: 2 },
});
