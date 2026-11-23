import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'gf_onboarded';

export async function hasSeenOnboarding() {
  try {
    return (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    return true; // if storage is broken, don't nag — fail quiet, not loud
  }
}

export async function markOnboardingSeen() {
  try {
    await AsyncStorage.setItem(KEY, '1');
  } catch {}
}
