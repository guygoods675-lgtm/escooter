import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { C } from '../ui/theme';

/**
 * Background ride tracking (Android foreground service / iOS background location).
 * Only used while a ride is recording AND the user turned on background tracking.
 * Android shows a persistent "Recording ride" notification while it runs, which is
 * also what keeps the app (and its Bluetooth connection) alive with the screen off.
 */
export const BG_LOCATION_TASK = 'scooterhub-ride-location';

export interface BgFix {
  t: number;
  lat: number;
  lon: number;
  alt: number | null;
  accuracy: number | null;
  speedKmh: number | null;
}

let sink: ((f: BgFix) => void) | null = null;
export const setBackgroundSink = (fn: ((f: BgFix) => void) | null) => {
  sink = fn;
};

// Must be defined at module load (imported from index.ts) so the OS can deliver updates.
if (!TaskManager.isTaskDefined(BG_LOCATION_TASK)) {
  TaskManager.defineTask<{ locations: Location.LocationObject[] }>(BG_LOCATION_TASK, async ({ data, error }) => {
    if (error || !data?.locations) return;
    for (const loc of data.locations) {
      sink?.({
        t: loc.timestamp,
        lat: loc.coords.latitude,
        lon: loc.coords.longitude,
        alt: loc.coords.altitude ?? null,
        accuracy: loc.coords.accuracy ?? null,
        speedKmh: loc.coords.speed != null && loc.coords.speed >= 0 ? loc.coords.speed * 3.6 : null,
      });
    }
  });
}

/** Returns false (and the caller falls back to foreground-only GPS) if permission is refused. */
export async function startBackgroundLocation(high: boolean): Promise<boolean> {
  try {
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (bg.status !== 'granted') return false;
    if (await Location.hasStartedLocationUpdatesAsync(BG_LOCATION_TASK)) return true;
    await Location.startLocationUpdatesAsync(BG_LOCATION_TASK, {
      accuracy: high ? Location.Accuracy.BestForNavigation : Location.Accuracy.Balanced,
      timeInterval: 1000,
      distanceInterval: 0,
      pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.OtherNavigation,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Scooter Hub is recording your ride',
        notificationBody: 'Route and scooter data keep recording while the screen is off.',
        notificationColor: C.purple,
        killServiceOnDestroy: true,
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function stopBackgroundLocation() {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(BG_LOCATION_TASK)) await Location.stopLocationUpdatesAsync(BG_LOCATION_TASK);
  } catch {
    // Already stopped.
  }
}
