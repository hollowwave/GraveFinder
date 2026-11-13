import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'gf_recent';

export async function getRecent() {
  try {
    return JSON.parse((await AsyncStorage.getItem(KEY)) || '[]');
  } catch {
    return [];
  }
}

export async function addRecent(r) {
  const entry = { id: r.id, full_name: r.full_name, section: r.section, grave_number: r.grave_number };
  const list = (await getRecent()).filter((x) => x.id !== r.id);
  await AsyncStorage.setItem(KEY, JSON.stringify([entry, ...list].slice(0, 5)));
}
