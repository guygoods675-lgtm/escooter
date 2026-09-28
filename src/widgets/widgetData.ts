import AsyncStorage from '@react-native-async-storage/async-storage';

/** Last known values shown on the Android home-screen widget. Only real readings; null = not available. */
export interface WidgetData {
  name: string;
  battery: number | null;
  connected: boolean;
  speedKmh: number | null;
  rideDistanceKm: number | null;
  rideTimeSec: number | null;
  speedUnit: 'kmh' | 'mph';
  distanceUnit: 'km' | 'mi';
  updatedAt: number;
}

const KEY = 'sh.widget';

export async function saveWidgetData(d: WidgetData) {
  await AsyncStorage.setItem(KEY, JSON.stringify(d));
}

export async function loadWidgetData(): Promise<WidgetData | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as WidgetData) : null;
  } catch {
    return null;
  }
}
