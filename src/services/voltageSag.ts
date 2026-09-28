import type { Ride, RidePoint } from '../store/rides';
import { pointSpeed } from './rideMath';
import type { Sample } from './telemetryHistory';

/**
 * Voltage under load, from scooter-reported battery voltage AND current only.
 * Every battery's voltage drops while it delivers current; this module just
 * describes what was observed. It makes no statement about battery condition.
 */

export interface VIPoint {
  t: number;
  v: number; // volts
  i: number; // amps, positive = discharging
  speed: number | null; // km/h, when known
}

export const RESTING_MAX_A = 0.5;
export const RESTING_MAX_KMH = 1;
export const DEFAULT_WINDOW_MS = 30000;
/** Loaded samples: at least this current, and at least LOAD_FRACTION of the peak current observed. */
export const LOAD_MIN_A = 3;
export const LOAD_FRACTION = 0.6;

export const isResting = (p: VIPoint) => Math.abs(p.i) < RESTING_MAX_A && (p.speed == null || p.speed < RESTING_MAX_KMH);

/** Join live voltage/current (and speed) series on identical timestamps (they come from the same snapshot). */
export function joinSeries(voltage: Sample[], current: Sample[], speed: Sample[] = []): VIPoint[] {
  const cur = new Map<number, number>();
  for (const s of current) cur.set(s.t, s.v);
  const spd = new Map<number, number>();
  for (const s of speed) spd.set(s.t, s.v);
  const out: VIPoint[] = [];
  for (const s of voltage) {
    const i = cur.get(s.t);
    if (i == null) continue;
    out.push({ t: s.t, v: s.v, i, speed: spd.get(s.t) ?? null });
  }
  return out;
}

export function pointsFromRide(points: RidePoint[]): VIPoint[] {
  const out: VIPoint[] = [];
  for (const p of points) {
    if (p.voltage == null || p.current == null || !Number.isFinite(p.voltage) || !Number.isFinite(p.current)) continue;
    out.push({ t: p.t, v: p.voltage, i: p.current, speed: pointSpeed(p) });
  }
  return out;
}

export interface SagResult {
  samples: number;
  /** Most recent resting voltage (|I| < 0.5 A, stationary). */
  restingV: number | null;
  restingAt: number | null;
  /** Voltage at the highest observed current. */
  loadedV: number | null;
  loadedA: number | null;
  loadedAt: number | null;
  peakA: number | null;
  /** Largest resting-minus-loaded voltage within the window. */
  maxDropV: number | null;
  maxDropAt: number | null;
  maxDropA: number | null;
  maxDropRestingV: number | null;
  maxDropLoadedV: number | null;
}

export function analyzeSag(pts: VIPoint[], windowMs = DEFAULT_WINDOW_MS): SagResult {
  const res: SagResult = {
    samples: pts.length, restingV: null, restingAt: null, loadedV: null, loadedA: null, loadedAt: null, peakA: null,
    maxDropV: null, maxDropAt: null, maxDropA: null, maxDropRestingV: null, maxDropLoadedV: null,
  };
  if (!pts.length) return res;
  const sorted = pts.every((p, k) => k === 0 || pts[k - 1].t <= p.t) ? pts : [...pts].sort((a, b) => a.t - b.t);
  const resting = sorted.filter(isResting);
  if (resting.length) {
    const last = resting[resting.length - 1];
    res.restingV = last.v;
    res.restingAt = last.t;
  }
  let peak: VIPoint | null = null;
  for (const p of sorted) if (!peak || p.i > peak.i) peak = p;
  if (peak && peak.i >= LOAD_MIN_A) {
    res.peakA = peak.i;
    res.loadedV = peak.v;
    res.loadedA = peak.i;
    res.loadedAt = peak.t;
  } else if (peak) {
    res.peakA = peak.i;
  }
  if (!resting.length || !peak || peak.i < LOAD_MIN_A) return res;
  const threshold = Math.max(LOAD_MIN_A, LOAD_FRACTION * peak.i);
  const rt = resting.map((r) => r.t);
  for (const p of sorted) {
    if (p.i < threshold) continue;
    // nearest resting sample in time (binary search)
    let lo = 0;
    let hi = rt.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rt[mid] < p.t) lo = mid + 1;
      else hi = mid;
    }
    const cands = [resting[lo - 1], resting[lo]].filter((r): r is VIPoint => !!r && Math.abs(r.t - p.t) <= windowMs);
    for (const r of cands) {
      const drop = r.v - p.v;
      if (drop > 0 && (res.maxDropV == null || drop > res.maxDropV)) {
        res.maxDropV = drop;
        res.maxDropAt = p.t;
        res.maxDropA = p.i;
        res.maxDropRestingV = r.v;
        res.maxDropLoadedV = p.v;
      }
    }
  }
  return res;
}

/** Evenly thinned copy for plotting; keeps the raw data untouched. */
export function thin<T>(arr: T[], max = 400): T[] {
  if (arr.length <= max) return arr;
  const step = arr.length / max;
  const out: T[] = [];
  for (let k = 0; k < max; k++) out.push(arr[Math.floor(k * step)]);
  return out;
}

export interface RideSag {
  ride: Ride;
  result: SagResult;
}

/** Per-ride summary for rides that recorded both voltage and current, newest first. */
export function rideSagHistory(rides: Ride[], windowMs = DEFAULT_WINDOW_MS): RideSag[] {
  const out: RideSag[] = [];
  for (const ride of rides) {
    const pts = pointsFromRide(ride.points);
    if (pts.length < 2) continue;
    out.push({ ride, result: analyzeSag(pts, windowMs) });
  }
  return out.sort((a, b) => b.ride.start - a.ride.start);
}
