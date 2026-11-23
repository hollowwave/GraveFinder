import { Modal, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { colors } from './theme';

const STEPS = [
  { title: 'Find a name', body: 'Type the name of a loved one in the search box, then tap "Search burials" to see their record.' },
  { title: 'See it on the map', body: 'From a record, tap "Locate grave on map" to see exactly where the grave is.' },
  { title: 'Walk there', body: 'On the map, follow the highlighted path. The message at the bottom tells you how far to walk.' },
  { title: 'Search from the map', body: 'Already on the map? Tap the magnifying glass at the top to look up another name without going back.' },
];

export default function Onboarding({ visible, onClose }) {
  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.card}>
          <Text style={s.title}>Welcome to GraveFinder</Text>
          <Text style={s.sub}>A quick guide to finding a grave.</Text>
          <ScrollView style={s.steps} showsVerticalScrollIndicator={false}>
            {STEPS.map((step, i) => (
              <View key={step.title} style={s.step}>
                <View style={s.badge}>
                  <Text style={s.badgeText}>{i + 1}</Text>
                </View>
                <View style={s.stepText}>
                  <Text style={s.stepTitle}>{step.title}</Text>
                  <Text style={s.stepBody}>{step.body}</Text>
                </View>
              </View>
            ))}
          </ScrollView>
          <Pressable style={s.button} onPress={onClose}>
            <Text style={s.buttonText}>Got it, let's start</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(28,38,35,0.6)', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: colors.panel, borderRadius: 12, padding: 22, maxHeight: '80%' },
  title: { fontSize: 22, fontWeight: '700', color: colors.moss },
  sub: { color: colors.muted, marginTop: 4, marginBottom: 18, fontSize: 15 },
  steps: { marginBottom: 10 },
  step: { flexDirection: 'row', gap: 12, marginBottom: 18, alignItems: 'flex-start' },
  badge: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.moss, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontWeight: '700' },
  stepText: { flex: 1 },
  stepTitle: { fontSize: 17, fontWeight: '700', color: colors.ink },
  stepBody: { fontSize: 15, color: colors.muted, marginTop: 2, lineHeight: 21 },
  button: { backgroundColor: colors.moss, borderRadius: 6, height: 52, justifyContent: 'center', alignItems: 'center', marginTop: 4 },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
