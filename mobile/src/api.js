import Constants from 'expo-constants';
import { Platform } from 'react-native';

const devHost = Constants.expoConfig?.hostUri?.split(':')[0];
const fallback = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';

export const API = process.env.EXPO_PUBLIC_API_URL || `http://${devHost || fallback}:4000/api`;

export async function get(path) {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error('Request failed');
  return res.json();
}
