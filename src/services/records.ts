import type { Ride } from '../store/rides';
import { rideWhPerKm } from './stats';

/** Personal records, each pointing at the real ride it came from. Computed only from recorded rides. */

export type RecordKey =
  | 'longestDuration'
  | 'longestDistance'
  | 'highestSpeed'
  | 'highestAvgSpeed'
  | 'lowestWhPerKm'
  | 'highestElevationGain'
  | 'longestMoving'
  | 'mostEnergy';

export interface RideRecord {
  key: RecordKey;
  value: number;
  ride: Ride;
}

export interface MonthRecord {
  year: number;
  month: number; // 0-11, local time
  distanceKm: number;
  rides: Ride[]; // newest first
}

export type Records = Record<RecordKey, RideRecord | null> & { mostDistanceMonth: MonthRecord | null };

export const MIN_EFFICIENCY_KM = 1;
export const MIN_AVG_SPEED_KM = 0.5;

const ok = (n: number | null | undefined): n is number => n != null && Number.isFinite(n);

/** Highest (or lowest) value; on ties the earlier ride keeps the record. */
function best(rides: Ride[], key: RecordKey, value: (r: Ride) => number | null | undefined, lowest = false): RideRecord | null {
  let out: RideRecord | null = null;
  const chrono = [...rides].sort((a, b) => a.start - b.start);
  for (const r of chrono) {
    const v = value(r);
    if (!ok(v)) continue;
    if (!out || (lowest ? v < out.value : v > out.value)) out = { key, value: v, ride: r };
  }
  return out;
}

export function monthTotals(rides: Ride[]): MonthRecord[] {
  const m = new Map<string, MonthRecord>();
  for (const r of rides) {
    const d = new Date(r.start);
    const k = `${d.getFullYear()}-${d.getMonth()}`;
    let e = m.get(k);
    if (!e) {
      e = { year: d.getFullYear(), month: d.getMonth(), distanceKm: 0, rides: [] };
      m.set(k, e);
    }
    e.distanceKm += r.distanceKm > 0 ? r.distanceKm : 0;
    e.rides.push(r);
  }
  const out = [...m.values()];
  out.forEach((e) => e.rides.sort((a, b) => b.start - a.start));
  return out.sort((a, b) => b.year - a.year || b.month - a.month);
}

export function computeRecords(rides: Ride[]): Records {
  const months = monthTotals(rides).filter((m) => m.distanceKm > 0);
  let bestMonth: MonthRecord | null = null;
  // months are newest first; iterate oldest first so the earlier month keeps a tie
  for (const mo of [...months].reverse()) if (!bestMonth || mo.distanceKm > bestMonth.distanceKm) bestMonth = mo;
  return {
    longestDuration: best(rides, 'longestDuration', (r) => (r.durationSec > 0 ? r.durationSec : null)),
    longestDistance: best(rides, 'longestDistance', (r) => (r.distanceKm > 0 ? r.distanceKm : null)),
    highestSpeed: best(rides, 'highestSpeed', (r) => (r.maxSpeedKmh != null && r.maxSpeedKmh > 0 ? r.maxSpeedKmh : null)),
    highestAvgSpeed: best(rides, 'highestAvgSpeed', (r) => (r.distanceKm >= MIN_AVG_SPEED_KM && r.avgSpeedKmh != null && r.avgSpeedKmh > 0 ? r.avgSpeedKmh : null)),
    lowestWhPerKm: best(
      rides,
      'lowestWhPerKm',
      (r) => {
        if (r.distanceKm < MIN_EFFICIENCY_KM || r.energyWh == null || !(r.energyWh > 0)) return null;
        const w = rideWhPerKm(r);
        return w != null && w > 0 ? w : null;
      },
      true,
    ),
    highestElevationGain: best(rides, 'highestElevationGain', (r) => (r.elevationGainM != null && r.elevationGainM > 0 ? r.elevationGainM : null)),
    longestMoving: best(rides, 'longestMoving', (r) => (r.movingSec > 0 ? r.movingSec : null)),
    mostEnergy: best(rides, 'mostEnergy', (r) => (r.energyWh != null && r.energyWh > 0 ? r.energyWh : null)),
    mostDistanceMonth: bestMonth,
  };
}
