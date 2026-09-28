import { Platform } from 'react-native';
import { requestWidgetUpdate } from 'react-native-android-widget';
import React from 'react';
import { summarizeRide } from '../services/rideMath';
import { useActiveRide } from '../services/RideTracker';
import { useGarage } from '../store/garage';
import { useLive } from '../store/live';
import { useSettings } from '../store/settings';
import { ScooterWidget } from './ScooterWidget';
import { WidgetData, saveWidgetData } from './widgetData';

let last = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

function collect(): WidgetData {
  const live = useLive.getState();
  const g = useGarage.getState();
  const profile = g.scooters.find((s) => s.id === (live.scooterId ?? g.activeId));
  const ride = useActiveRide.getState();
  const sum = ride.active && ride.start ? summarizeRide(ride.points, ride.start, Date.now()) : null;
  const st = useSettings.getState();
  return {
    name: profile?.nickname ?? live.deviceName ?? 'Scooter Hub',
    battery: live.snapshot?.batteryPercent?.value ?? null,
    connected: live.conn === 'connected',
    speedKmh: live.snapshot?.speedKmh?.value ?? null,
    rideDistanceKm: sum ? sum.distanceKm : null,
    rideTimeSec: sum ? sum.durationSec : null,
    speedUnit: st.speedUnit,
    distanceUnit: st.distanceUnit,
    updatedAt: Date.now(),
  };
}

/** Refreshes the Android widget at most every 15 s (Android also rate-limits widget updates). */
export function updateWidgets() {
  if (Platform.OS !== 'android') return;
  const run = async () => {
    last = Date.now();
    timer = null;
    const data = collect();
    try {
      await saveWidgetData(data);
      await requestWidgetUpdate({ widgetName: 'ScooterStatus', renderWidget: () => React.createElement(ScooterWidget, { data }) });
    } catch {
      /* widget module unavailable in this build */
    }
  };
  const wait = 15000 - (Date.now() - last);
  if (wait <= 0) run();
  else if (!timer) timer = setTimeout(run, wait);
}
