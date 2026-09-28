import type { Ride, RidePoint } from '../store/rides';

/** Pure ride statistics, shared by the tracker and unit tests. Heuristics are Scooter Hub's own. */

const MOVING_KMH = 2; // below this we treat the scooter as stopped
const STOP_MIN_MS = 5000; // a stop must last at least 5 s to count
const MAX_GPS_ACCURACY_M = 30;
const ELEVATION_HYSTERESIS_M = 3; // GPS altitude noise filter

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const pointSpeed = (p: RidePoint) => p.speedKmh ?? p.gpsSpeedKmh;
/** Battery-side power from scooter-reported voltage x current, null when either is missing. */
export const pointPower = (p: RidePoint) => (p.voltage != null && p.current != null ? p.voltage * p.current : null);

export function summarizeRide(points: RidePoint[], start: number, end: number): Omit<Ride, 'id' | 'number' | 'scooterId' | 'points'> {
  // GPS distance
  let gpsKm = 0;
  let prev: RidePoint | null = null;
  for (const p of points) {
    if (p.lat == null || p.lon == null || (p.accuracy != null && p.accuracy > MAX_GPS_ACCURACY_M)) continue;
    if (prev && prev.lat != null && prev.lon != null) {
      const d = haversineKm({ lat: prev.lat, lon: prev.lon }, { lat: p.lat, lon: p.lon });
      const dtH = (p.t - prev.t) / 3600000;
      if (dtH > 0 && d / dtH < 120) gpsKm += d; // drop impossible GPS jumps
    }
    prev = p;
  }
  const odo = points.filter((p) => p.odoKm != null);
  const odoKm = odo.length >= 2 ? Math.max(0, odo[odo.length - 1].odoKm! - odo[0].odoKm!) : null;
  const hasGps = points.some((p) => p.lat != null);
  const distanceKm = odoKm != null && odoKm > 0 ? odoKm : gpsKm;
  const distanceSource: Ride['distanceSource'] = odoKm != null && odoKm > 0 ? 'scooter' : hasGps ? 'gps' : 'none';

  let maxSpeed: number | null = null;
  let movingMs = 0;
  let stops = 0;
  let stoppedSince: number | null = null;
  let wasMoving = false;
  let energyWh = 0;
  let energyValid = false;
  let maxTemp: number | null = null;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const v = pointSpeed(p);
    if (v != null) maxSpeed = maxSpeed == null ? v : Math.max(maxSpeed, v);
    if (p.tempC != null) maxTemp = maxTemp == null ? p.tempC : Math.max(maxTemp, p.tempC);
    const next = points[i + 1];
    if (next) {
      const dt = next.t - p.t;
      if (v != null && v >= MOVING_KMH && dt < 10000) movingMs += dt;
      if (p.voltage != null && p.current != null && next.voltage != null && next.current != null && dt < 10000) {
        const w = (p.voltage * p.current + next.voltage * next.current) / 2;
        if (w > 0) energyWh += (w * dt) / 3600000;
        energyValid = true;
      }
    }
    if (v != null) {
      if (v >= MOVING_KMH) {
        if (stoppedSince != null && wasMoving && p.t - stoppedSince >= STOP_MIN_MS) stops++;
        stoppedSince = null;
        wasMoving = true;
      } else if (stoppedSince == null) {
        stoppedSince = p.t;
      }
    }
  }

  let gain = 0;
  let loss = 0;
  let ref: number | null = null;
  let hasAlt = false;
  for (const p of points) {
    if (p.alt == null) continue;
    hasAlt = true;
    if (ref == null) ref = p.alt;
    const d = p.alt - ref;
    if (d >= ELEVATION_HYSTERESIS_M) {
      gain += d;
      ref = p.alt;
    } else if (d <= -ELEVATION_HYSTERESIS_M) {
      loss -= d;
      ref = p.alt;
    }
  }

  const batt = points.filter((p) => p.battery != null);
  const movingSec = Math.round(movingMs / 1000);
  const powers = points.map(pointPower).filter((w): w is number => w != null);
  const avgPowerW = powers.length ? powers.reduce((a, b) => a + b, 0) / powers.length : null;
  const peakPowerW = powers.length ? Math.max(...powers) : null;
  return {
    start,
    end,
    distanceKm,
    distanceSource,
    durationSec: Math.round((end - start) / 1000),
    movingSec,
    avgSpeedKmh: movingSec > 0 && distanceKm > 0 ? distanceKm / (movingSec / 3600) : null,
    maxSpeedKmh: maxSpeed,
    batteryStart: batt[0]?.battery ?? null,
    batteryEnd: batt[batt.length - 1]?.battery ?? null,
    energyWh: energyValid ? energyWh : null,
    elevationGainM: hasAlt ? gain : null,
    elevationLossM: hasAlt ? loss : null,
    stops,
    maxTempC: maxTemp,
    avgPowerW,
    peakPowerW,
    whPerKm: energyValid && distanceKm > 0.05 ? energyWh / distanceKm : null,
  };
}

export interface AccelRun { target: number; seconds: number; at: number }

/**
 * Best standing-start times to each target speed. A run starts at the last
 * sample below 1 km/h and ends at the first sample at/above the target.
 * Resolution is limited by the sample rate (~1 Hz scooter polling / GPS).
 */
export function accelerationRuns(samples: { t: number; v: number }[], targets = [10, 20, 25]): Record<number, AccelRun | null> {
  const best: Record<number, AccelRun | null> = {};
  targets.forEach((t) => (best[t] = null));
  let startT: number | null = null;
  const reached = new Set<number>();
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    if (s.v < 1) {
      startT = s.t;
      reached.clear();
      continue;
    }
    if (startT == null) continue;
    for (const target of targets) {
      if (!reached.has(target) && s.v >= target) {
        reached.add(target);
        const secs = (s.t - startT) / 1000;
        if (secs > 0 && (best[target] == null || secs < best[target]!.seconds)) best[target] = { target, seconds: secs, at: s.t };
      }
    }
  }
  return best;
}
