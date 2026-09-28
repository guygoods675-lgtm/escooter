import { useSyncExternalStore } from 'react';
import type { TelemetrySnapshot } from '../protocols/types';
import { useSettings } from '../store/settings';

/**
 * Time series of real samples for the Live Data graphs. Kept outside React
 * state and published at a throttled version number so graphs redraw smoothly
 * without re-rendering the whole tree on each sample.
 */
export type SeriesKey =
  | 'speed' | 'battery' | 'voltage' | 'current' | 'power' | 'motorTemp' | 'controllerTemp'
  | 'batteryTemp' | 'rpm' | 'accel' | 'gpsSpeed';

export interface Sample { t: number; v: number }

const MAX_SAMPLES = 20000; // ~5.5 h at 1 Hz per series
const series: Record<SeriesKey, Sample[]> = {
  speed: [], battery: [], voltage: [], current: [], power: [], motorTemp: [], controllerTemp: [],
  batteryTemp: [], rpm: [], accel: [], gpsSpeed: [],
};
let version = 0;
const listeners = new Set<() => void>();
let lastSpeed: Sample | null = null;

function push(key: SeriesKey, t: number, v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return;
  const arr = series[key];
  arr.push({ t, v });
  if (arr.length > MAX_SAMPLES) arr.splice(0, arr.length - MAX_SAMPLES);
}

export function recordSnapshot(s: TelemetrySnapshot) {
  const t = s.timestamp;
  push('speed', t, s.speedKmh?.value);
  push('battery', t, s.batteryPercent?.value);
  push('voltage', t, s.batteryVoltage?.value);
  push('current', t, s.batteryCurrent?.value);
  push('power', t, s.powerW?.value);
  push('motorTemp', t, s.motorTempC?.value);
  push('controllerTemp', t, s.controllerTempC?.value);
  push('batteryTemp', t, s.batteryTempC?.value);
  push('rpm', t, s.motorRpm?.value);
  if (s.speedKmh) {
    const cur = { t, v: s.speedKmh.value };
    if (lastSpeed && t - lastSpeed.t > 200 && t - lastSpeed.t < 5000) {
      // acceleration in m/s², derived from consecutive scooter speed samples
      push('accel', t, ((cur.v - lastSpeed.v) / 3.6) / ((t - lastSpeed.t) / 1000));
    }
    lastSpeed = cur;
  }
  bump();
}

export function recordGpsSpeed(t: number, kmh: number | null) {
  push('gpsSpeed', t, kmh);
  bump();
}

let bumpTimer: ReturnType<typeof setTimeout> | null = null;
function bump() {
  if (bumpTimer) return;
  bumpTimer = setTimeout(() => {
    bumpTimer = null;
    version++;
    listeners.forEach((l) => l());
    // Graphs redraw at most 5×/s, or 1×/s in OLED low-power mode. Raw samples are kept either way.
  }, useSettings.getState().oledMode ? 1000 : 200);
}

export function getSeries(key: SeriesKey, sinceMs?: number): Sample[] {
  const arr = series[key];
  if (!sinceMs) return arr;
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].t < sinceMs) lo = mid + 1;
    else hi = mid;
  }
  return arr.slice(lo);
}

export function clearHistory() {
  (Object.keys(series) as SeriesKey[]).forEach((k) => (series[k] = []));
  lastSpeed = null;
  bump();
}

export function useHistoryVersion() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
  );
}
