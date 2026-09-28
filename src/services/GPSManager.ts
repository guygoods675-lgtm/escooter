import * as Location from 'expo-location';
import { useSettings } from '../store/settings';
import { setBackgroundSink, startBackgroundLocation, stopBackgroundLocation } from './backgroundLocation';

export interface GpsFix {
  t: number;
  lat: number;
  lon: number;
  alt: number | null;
  accuracy: number | null;
  speedKmh: number | null; // from the OS; null when the platform reports none
}

type Listener = (f: GpsFix) => void;
const listeners = new Set<Listener>();
let sub: Location.LocationSubscription | null = null;
let lastFix: GpsFix | null = null;

export type GpsProblem = 'disabled-in-app' | 'permission-denied' | 'services-off' | null;
let lastProblem: GpsProblem = null;
export const getGpsProblem = () => lastProblem;

export async function ensureLocationPermission(): Promise<boolean> {
  lastProblem = null;
  if (!useSettings.getState().locationEnabled) {
    lastProblem = 'disabled-in-app';
    return false;
  }
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    lastProblem = 'permission-denied';
    return false;
  }
  if (!(await Location.hasServicesEnabledAsync().catch(() => true))) {
    lastProblem = 'services-off';
    return false;
  }
  return true;
}

let bgActive = false;
const deliver = (f: GpsFix) => {
  lastFix = f;
  listeners.forEach((l) => l(f));
};

/**
 * @param background also keep tracking with the screen off (foreground service on
 * Android). Falls back to foreground-only if the user refuses "Allow all the time".
 */
export async function startGps(background = false): Promise<boolean> {
  if (sub || bgActive) return true;
  if (!(await ensureLocationPermission())) return false;
  const high = useSettings.getState().gpsAccuracy === 'high';
  if (background) {
    setBackgroundSink(deliver);
    bgActive = await startBackgroundLocation(high);
    if (bgActive) return true;
    setBackgroundSink(null);
  }
  sub = await Location.watchPositionAsync(
    { accuracy: high ? Location.Accuracy.BestForNavigation : Location.Accuracy.Balanced, timeInterval: 1000, distanceInterval: 0 },
    (loc) => {
      const f: GpsFix = {
        t: loc.timestamp,
        lat: loc.coords.latitude,
        lon: loc.coords.longitude,
        alt: loc.coords.altitude ?? null,
        accuracy: loc.coords.accuracy ?? null,
        speedKmh: loc.coords.speed != null && loc.coords.speed >= 0 ? loc.coords.speed * 3.6 : null,
      };
      deliver(f);
    },
  );
  return true;
}

export function stopGps() {
  sub?.remove();
  sub = null;
  if (bgActive) {
    bgActive = false;
    setBackgroundSink(null);
    stopBackgroundLocation();
  }
}

export const isBackgroundTracking = () => bgActive;

export const getLastFix = () => lastFix;

export function onGps(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export async function currentPosition(): Promise<GpsFix | null> {
  if (!(await ensureLocationPermission())) return null;
  try {
    const loc = await Location.getCurrentPositionAsync({});
    return { t: loc.timestamp, lat: loc.coords.latitude, lon: loc.coords.longitude, alt: loc.coords.altitude ?? null, accuracy: loc.coords.accuracy ?? null, speedKmh: null };
  } catch {
    return null;
  }
}

/** Haversine distance in km. */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
