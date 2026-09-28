import type { Reading } from '../protocols/types';
import { useSettings } from '../store/settings';

export const NA = 'Not available';

export function useUnits() {
  const speedUnit = useSettings((s) => s.speedUnit);
  const tempUnit = useSettings((s) => s.tempUnit);
  const distanceUnit = useSettings((s) => s.distanceUnit);
  return {
    speedUnit,
    tempUnit,
    distanceUnit,
    speed: (kmh: number) => (speedUnit === 'mph' ? kmh / 1.609344 : kmh),
    speedLabel: speedUnit === 'mph' ? 'mph' : 'km/h',
    dist: (km: number) => (distanceUnit === 'mi' ? km / 1.609344 : km),
    distLabel: distanceUnit === 'mi' ? 'mi' : 'km',
    temp: (c: number) => (tempUnit === 'f' ? (c * 9) / 5 + 32 : c),
    tempLabel: tempUnit === 'f' ? '°F' : '°C',
  };
}

export const fmt = (v: number | null | undefined, digits = 1) => (v == null || !Number.isFinite(v) ? NA : v.toFixed(digits));

export function fmtReading(r: Reading, digits = 1, convert?: (v: number) => number): string {
  if (!r) return NA;
  const v = convert ? convert(r.value) : r.value;
  return v.toFixed(digits);
}

export function fmtDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return NA;
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
}

export const fmtDate = (t: number | null | undefined) => (t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : NA);
export const fmtDateTime = (t: number | null | undefined) =>
  t ? new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : NA;
export const fmtTime = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const onOff = (r: Reading<boolean>) => (r ? (r.value ? 'On' : 'Off') : NA);

export function rssiQuality(rssi: number | null): { label: string; bars: number } {
  if (rssi == null) return { label: NA, bars: 0 };
  if (rssi >= -60) return { label: 'Excellent', bars: 4 };
  if (rssi >= -70) return { label: 'Good', bars: 3 };
  if (rssi >= -80) return { label: 'Fair', bars: 2 };
  return { label: 'Weak', bars: 1 };
}

export const maskSerial = (s: string) => (s.length <= 4 ? '••••' : `${'•'.repeat(Math.max(0, s.length - 4))}${s.slice(-4)}`);
