import { create } from 'zustand';
import { useGarage } from '../store/garage';
import { useLive } from '../store/live';
import { useSettings } from '../store/settings';
import { Ride, RidePoint, useRides } from '../store/rides';
import { uid } from '../store/storage';
import { GpsFix, getGpsProblem, getLastFix, onGps, startGps, stopGps } from './GPSManager';
import { feedback } from './Feedback';
import { summarizeRide } from './rideMath';
import { recordGpsSpeed } from './telemetryHistory';

interface ActiveRideState {
  active: boolean;
  start: number | null;
  points: RidePoint[];
  gpsOk: boolean;
  lastSummary: Ride | null;
  set(p: Partial<ActiveRideState>): void;
}

export const useActiveRide = create<ActiveRideState>((set) => ({
  active: false,
  start: null,
  points: [],
  gpsOk: false,
  lastSummary: null,
  set: (p) => set(p),
}));

let gpsUnsub: (() => void) | null = null;
let sampleTimer: ReturnType<typeof setInterval> | null = null;
let lastGps: GpsFix | null = null;

function makePoint(fix: GpsFix | null): RidePoint {
  const s = useLive.getState().snapshot;
  const fresh = fix && Date.now() - fix.t < 3000 ? fix : null;
  return {
    t: Date.now(),
    lat: fresh?.lat ?? null,
    lon: fresh?.lon ?? null,
    alt: fresh?.alt ?? null,
    accuracy: fresh?.accuracy ?? null,
    gpsSpeedKmh: fresh?.speedKmh ?? null,
    speedKmh: useLive.getState().conn === 'connected' ? s?.speedKmh?.value ?? null : null,
    battery: s?.batteryPercent?.value ?? null,
    tempC: s?.controllerTempC?.value ?? s?.batteryTempC?.value ?? null,
    voltage: s?.batteryVoltage?.value ?? null,
    current: s?.batteryCurrent?.value ?? null,
    odoKm: s?.odometerKm?.value ?? null,
    motorTempC: s?.motorTempC?.value ?? null,
    controllerTempC: s?.controllerTempC?.value ?? null,
    batteryTempC: s?.batteryTempC?.value ?? null,
    powerW: s?.powerW?.source === 'calculated' ? null : s?.powerW?.value ?? null,
    rpm: s?.motorRpm?.value ?? null,
  };
}

export async function startRide() {
  if (useActiveRide.getState().active) return;
  const gpsOk = await startGps(useSettings.getState().backgroundTracking);
  lastGps = getLastFix();
  if (!gpsOk) {
    const why = getGpsProblem();
    const body =
      why === 'services-off'
        ? 'Location services are off on this phone. The ride records scooter data without a route or GPS speed.'
        : why === 'permission-denied'
          ? 'Location permission was denied. The ride records scooter data without a route. You can allow location in Android settings.'
          : 'Location is turned off in Scooter Hub settings. The ride records scooter data without a route.';
    useLive.getState().pushAlert({ level: 'info', title: 'Recording without GPS', body });
  }
  gpsUnsub = onGps((f) => {
    lastGps = f;
    recordGpsSpeed(f.t, f.speedKmh);
    // With the screen off JS timers can be throttled; location updates from the
    // foreground service still arrive, so they also drive sampling (max ~1 Hz).
    const st = useActiveRide.getState();
    const last = st.points[st.points.length - 1];
    if (st.active && (!last || Date.now() - last.t >= 1500)) useActiveRide.setState({ points: [...st.points, makePoint(f)] });
  });
  useActiveRide.setState({ active: true, start: Date.now(), points: [makePoint(lastGps)], gpsOk, lastSummary: null });
  feedback('rideStart');
  sampleTimer = setInterval(() => {
    const st = useActiveRide.getState();
    if (!st.active) return;
    useActiveRide.setState({ points: [...st.points, makePoint(lastGps)] });
  }, 1000);
}

export function stopRide(): Ride | null {
  const st = useActiveRide.getState();
  if (!st.active || st.start == null) return null;
  if (sampleTimer) clearInterval(sampleTimer);
  sampleTimer = null;
  gpsUnsub?.();
  gpsUnsub = null;
  stopGps();
  const end = Date.now();
  const points = [...st.points, makePoint(lastGps)];
  const ride: Ride = {
    id: uid(),
    number: useRides.getState().nextNumber(),
    scooterId: useLive.getState().scooterId ?? useGarage.getState().activeId,
    points,
    ...summarizeRide(points, st.start, end),
  };
  useRides.getState().add(ride);
  useActiveRide.setState({ active: false, start: null, points: [], lastSummary: ride });
  feedback('rideEnd');
  return ride;
}

export function discardRide() {
  if (sampleTimer) clearInterval(sampleTimer);
  sampleTimer = null;
  gpsUnsub?.();
  gpsUnsub = null;
  stopGps();
  useActiveRide.setState({ active: false, start: null, points: [] });
}
