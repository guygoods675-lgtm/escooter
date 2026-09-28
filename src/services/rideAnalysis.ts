import type { Ride, RidePoint } from '../store/rides';

/**
 * Data-based ride analysis. Every sentence is derived only from values that were
 * actually recorded during the ride. No mechanical or battery-condition claims.
 * Pure module (no React / RN imports) so it can be unit tested.
 */

export type AnalysisSource = 'Scooter BLE' | 'Phone GPS' | 'Calculated' | 'Ride history';
export type AnalysisKind = 'measured' | 'calculated';

export interface AnalysisItem {
  id: string;
  text: string;
  source: AnalysisSource;
  kind: AnalysisKind;
}

export interface AnalysisUnits {
  speed(kmh: number): string;
  dist(km: number): string;
  temp(c: number): string;
  /** 'km' or 'mi' (per-distance values are converted). */
  distanceUnit: 'km' | 'mi';
}

export const METRIC_UNITS: AnalysisUnits = {
  speed: (v) => `${v.toFixed(1)} km/h`,
  dist: (v) => `${v.toFixed(2)} km`,
  temp: (c) => `${c.toFixed(0)} °C`,
  distanceUnit: 'km',
};

const KM_PER_MI = 1.609344;
/** Consecutive V×I samples further apart than this are not integrated (recording gap). */
const MAX_ENERGY_DT_MS = 10000;
const MAX_GPS_ACCURACY_M = 30;

// ---------------------------------------------------------------------------
// Point helpers (shared by the timeline, replay, temperature history, heatmap)
// ---------------------------------------------------------------------------

export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const hasGps = (p: RidePoint): p is RidePoint & { lat: number; lon: number } => p.lat != null && p.lon != null;

/** Speed at a point: scooter-reported first, else phone GPS. */
export function speedOf(p: RidePoint): { v: number; source: 'scooter' | 'gps' } | null {
  if (p.speedKmh != null) return { v: p.speedKmh, source: 'scooter' };
  if (p.gpsSpeedKmh != null) return { v: p.gpsSpeedKmh, source: 'gps' };
  return null;
}

/** Power at a point: scooter-reported first, else calculated voltage × current. */
export function powerOf(p: RidePoint): { w: number; source: 'scooter' | 'calculated' } | null {
  if (p.powerW != null) return { w: p.powerW, source: 'scooter' };
  if (p.voltage != null && p.current != null) return { w: p.voltage * p.current, source: 'calculated' };
  return null;
}

export type TempSensor = 'motor' | 'controller' | 'battery' | 'legacy';
export const TEMP_LABEL: Record<TempSensor, string> = {
  motor: 'Motor temperature',
  controller: 'Controller temperature',
  battery: 'Battery temperature',
  legacy: 'Temperature (sensor not identified, older ride)',
};
export function tempOf(p: RidePoint, s: TempSensor): number | null {
  const v = s === 'motor' ? p.motorTempC : s === 'controller' ? p.controllerTempC : s === 'battery' ? p.batteryTempC : p.tempC;
  return v ?? null;
}

/**
 * Temperature sensors recorded in this ride. Rides from 3.0 on carry per-sensor
 * fields; older rides only have the unidentified `tempC`.
 */
export function tempSensors(points: RidePoint[]): TempSensor[] {
  const out: TempSensor[] = [];
  (['motor', 'controller', 'battery'] as TempSensor[]).forEach((s) => {
    if (points.some((p) => tempOf(p, s) != null)) out.push(s);
  });
  if (!out.length && points.some((p) => p.tempC != null)) out.push('legacy');
  return out;
}

export interface DistanceTrack {
  /** Distance from the start at each point; null where this point has no reading. */
  km: (number | null)[];
  source: 'scooter' | 'gps' | 'none';
}

/** Distance so far at each point: scooter odometer delta when recorded, else cumulative GPS distance. */
export function distanceTrack(points: RidePoint[]): DistanceTrack {
  const odo = points.filter((p) => p.odoKm != null);
  if (odo.length >= 2 && odo[odo.length - 1].odoKm! - odo[0].odoKm! > 0) {
    const base = odo[0].odoKm!;
    return { km: points.map((p) => (p.odoKm != null ? Math.max(0, p.odoKm - base) : null)), source: 'scooter' };
  }
  if (!points.some(hasGps)) return { km: points.map(() => null), source: 'none' };
  let total = 0;
  let prev: RidePoint | null = null;
  const km = points.map((p) => {
    if (!hasGps(p)) return null;
    if (p.accuracy != null && p.accuracy > MAX_GPS_ACCURACY_M) return prev ? total : 0;
    if (prev && hasGps(prev)) {
      const d = haversineKm(prev, p);
      const dtH = (p.t - prev.t) / 3600000;
      if (dtH > 0 && d / dtH < 120) total += d; // drop impossible GPS jumps
    }
    prev = p;
    return total;
  });
  return { km, source: 'gps' };
}

/** Index of the recorded point closest in time to `t` (points sorted by t). -1 when empty. */
export function nearestIndex(points: RidePoint[], t: number): number {
  if (!points.length) return -1;
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(points[lo - 1].t - t) <= Math.abs(points[lo].t - t)) return lo - 1;
  return lo;
}

/**
 * Map position at time `t`. Interpolates only between two adjacent recorded GPS
 * fixes at most `maxGapMs` apart; otherwise snaps to a fix within `snapMs`, else null.
 */
export function positionAt(points: RidePoint[], t: number, maxGapMs = 5000, snapMs = 3000): { lat: number; lon: number } | null {
  const i = nearestIndex(points, t);
  if (i < 0) return null;
  let a = -1;
  for (let k = points[i].t <= t ? i : i - 1; k >= 0; k--) {
    if (hasGps(points[k])) {
      a = k;
      break;
    }
    if (t - points[k].t > maxGapMs) break;
  }
  let b = -1;
  for (let k = points[i].t > t ? i : i + 1; k < points.length; k++) {
    if (hasGps(points[k])) {
      b = k;
      break;
    }
    if (points[k].t - t > maxGapMs) break;
  }
  const pa = a >= 0 ? points[a] : null;
  const pb = b >= 0 ? points[b] : null;
  if (pa && pb && hasGps(pa) && hasGps(pb) && pb.t - pa.t <= maxGapMs && pb.t > pa.t) {
    const f = Math.max(0, Math.min(1, (t - pa.t) / (pb.t - pa.t)));
    return { lat: pa.lat + (pb.lat - pa.lat) * f, lon: pa.lon + (pb.lon - pa.lon) * f };
  }
  const near = [pa, pb].filter((p): p is RidePoint => p != null && Math.abs(p.t - t) <= snapMs).sort((x, y) => Math.abs(x.t - t) - Math.abs(y.t - t))[0];
  return near && hasGps(near) ? { lat: near.lat, lon: near.lon } : null;
}

// ---------------------------------------------------------------------------
// Energy
// ---------------------------------------------------------------------------

export interface EnergyInterval { t0: number; t1: number; wh: number; km0: number | null; km1: number | null }

/** Energy between consecutive V×I samples (trapezoid, positive power only). */
export function energyIntervals(points: RidePoint[], track: DistanceTrack = distanceTrack(points)): EnergyInterval[] {
  const out: EnergyInterval[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const p = points[i];
    const n = points[i + 1];
    if (p.voltage == null || p.current == null || n.voltage == null || n.current == null) continue;
    const dt = n.t - p.t;
    if (dt <= 0 || dt >= MAX_ENERGY_DT_MS) continue;
    const w = (p.voltage * p.current + n.voltage * n.current) / 2;
    out.push({ t0: p.t, t1: n.t, wh: w > 0 ? (w * dt) / 3600000 : 0, km0: track.km[i], km1: track.km[i + 1] });
  }
  return out;
}

export function rideEnergyWh(ride: Ride): number | null {
  if (ride.energyWh != null) return ride.energyWh;
  const iv = energyIntervals(ride.points);
  return iv.length ? iv.reduce((a, x) => a + x.wh, 0) : null;
}

export function rideWhPerKm(ride: Ride): number | null {
  if (ride.whPerKm != null) return ride.whPerKm;
  const e = rideEnergyWh(ride);
  return e != null && ride.distanceKm > 0.05 ? e / ride.distanceKm : null;
}

export function batteryUsed(ride: Ride): number | null {
  return ride.batteryStart != null && ride.batteryEnd != null ? ride.batteryStart - ride.batteryEnd : null;
}

export type Third = 'start' | 'middle' | 'end';
export interface ThirdsResult { by: 'distance' | 'time'; wh: Record<Third, number>; most: Third; totalWh: number }

/**
 * Splits the ride into thirds (by distance when the distance track covers the
 * energy samples, else by time) and sums V×I energy per third. Null unless every
 * third has at least a few energy samples.
 */
export function energyByThirds(ride: Ride): ThirdsResult | null {
  const pts = ride.points;
  if (pts.length < 6) return null;
  const track = distanceTrack(pts);
  const iv = energyIntervals(pts, track);
  if (iv.length < 6) return null;
  const withKm = iv.filter((x) => x.km0 != null && x.km1 != null);
  const totalKm = Math.max(0, ...track.km.filter((k): k is number => k != null));
  const byDistance = totalKm > 0.3 && withKm.length >= iv.length * 0.9;
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const span = byDistance ? totalKm : t1 - t0;
  if (span <= 0) return null;
  const wh: Record<Third, number> = { start: 0, middle: 0, end: 0 };
  const count: Record<Third, number> = { start: 0, middle: 0, end: 0 };
  for (const x of byDistance ? withKm : iv) {
    const mid = byDistance ? (x.km0! + x.km1!) / 2 : (x.t0 + x.t1) / 2 - t0;
    const f = mid / span;
    const k: Third = f < 1 / 3 ? 'start' : f < 2 / 3 ? 'middle' : 'end';
    wh[k] += x.wh;
    count[k]++;
  }
  if (count.start < 2 || count.middle < 2 || count.end < 2) return null;
  const totalWh = wh.start + wh.middle + wh.end;
  if (totalWh <= 0) return null;
  const most = (['start', 'middle', 'end'] as Third[]).reduce((m, k) => (wh[k] > wh[m] ? k : m), 'start' as Third);
  return { by: byDistance ? 'distance' : 'time', wh, most, totalWh };
}

// ---------------------------------------------------------------------------
// Analysis sentences
// ---------------------------------------------------------------------------

const perDist = (v: number, u: AnalysisUnits) => (u.distanceUnit === 'mi' ? v * KM_PER_MI : v);
const perDistLabel = (u: AnalysisUnits) => (u.distanceUnit === 'mi' ? 'mi' : 'km');

export function analyzeRide(ride: Ride, u: AnalysisUnits = METRIC_UNITS): AnalysisItem[] {
  const items: AnalysisItem[] = [];
  const pts = ride.points;

  const whKm = rideWhPerKm(ride);
  const energy = rideEnergyWh(ride);
  if (whKm != null && energy != null) {
    items.push({
      id: 'wh-per-km',
      text: `Energy use was ${perDist(whKm, u).toFixed(1)} Wh/${perDistLabel(u)} (${energy.toFixed(1)} Wh over ${u.dist(ride.distanceKm)}).`,
      source: 'Calculated',
      kind: 'calculated',
    });
  }

  const thirds = energyByThirds(ride);
  if (thirds) {
    const share = Math.round((thirds.wh[thirds.most] / thirds.totalWh) * 100);
    const name = thirds.most === 'start' ? 'first' : thirds.most === 'middle' ? 'middle' : 'last';
    items.push({
      id: 'energy-thirds',
      text: `The ${name} third of the ride (by ${thirds.by}) used the most energy: ${thirds.wh[thirds.most].toFixed(1)} Wh, ${share}% of the energy measured.`,
      source: 'Calculated',
      kind: 'calculated',
    });
  }

  for (const s of tempSensors(pts)) {
    let max: number | null = null;
    for (const p of pts) {
      const v = tempOf(p, s);
      if (v != null && (max == null || v > max)) max = v;
    }
    if (max == null) continue;
    const label = s === 'legacy' ? 'Peak temperature (sensor not identified)' : `Peak ${TEMP_LABEL[s].toLowerCase()}`;
    items.push({ id: `peak-temp-${s}`, text: `${label}: ${u.temp(max)}.`, source: 'Scooter BLE', kind: 'measured' });
  }

  if (ride.avgSpeedKmh != null) {
    items.push({
      id: 'avg-speed',
      text: `Average moving speed was ${u.speed(ride.avgSpeedKmh)}.`,
      source: 'Calculated',
      kind: 'calculated',
    });
  }

  const used = batteryUsed(ride);
  if (used != null) {
    const perKm = ride.distanceKm > 0.3 ? used / ride.distanceKm : null;
    items.push({
      id: 'battery-used',
      text:
        `Battery went from ${ride.batteryStart}% to ${ride.batteryEnd}% (${used} percentage points)` +
        (perKm != null && used > 0 ? `, about ${perDist(perKm, u).toFixed(1)}% per ${perDistLabel(u)}.` : '.'),
      source: 'Scooter BLE',
      kind: 'measured',
    });
  }

  if (ride.elevationGainM != null) {
    items.push({
      id: 'elevation-gain',
      text: `Elevation gain was ${ride.elevationGainM.toFixed(0)} m (phone GPS altitude, 3 m noise filter).`,
      source: 'Phone GPS',
      kind: 'calculated',
    });
  }
  return items;
}

/** Relative difference (b as reference) below which values are called "about the same". */
const SAME = 0.03;

function compareLine(
  id: string,
  a: number | null,
  b: number | null,
  fmt: (v: number) => string,
  words: { less: string; more: string; same: string },
  labels: { a: string; b: string },
  source: AnalysisSource,
  kind: AnalysisKind,
): AnalysisItem | null {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  const ref = Math.max(Math.abs(a), Math.abs(b));
  const rel = ref === 0 ? 0 : Math.abs(a - b) / ref;
  const vals = `(${fmt(a)} vs ${fmt(b)})`;
  const text = rel < SAME ? `${labels.a} and ${labels.b} ${words.same} ${vals}.` : `${labels.a} ${a < b ? words.less : words.more} ${labels.b} ${vals}.`;
  return { id, text, source, kind };
}

export function compareRides(a: Ride, b: Ride, u: AnalysisUnits = METRIC_UNITS, labels = { a: 'Ride A', b: 'Ride B' }): AnalysisItem[] {
  const out: (AnalysisItem | null)[] = [];
  const whA = rideWhPerKm(a);
  const whB = rideWhPerKm(b);
  out.push(
    compareLine(
      'cmp-wh-per-km',
      whA,
      whB,
      (v) => `${perDist(v, u).toFixed(1)} Wh/${perDistLabel(u)}`,
      { less: `used less energy per ${perDistLabel(u)} than`, more: `used more energy per ${perDistLabel(u)} than`, same: `used about the same energy per ${perDistLabel(u)}` },
      labels,
      'Calculated',
      'calculated',
    ),
  );
  const bpk = (r: Ride) => {
    const used = batteryUsed(r);
    return used != null && r.distanceKm > 0.3 ? used / r.distanceKm : null;
  };
  out.push(
    compareLine(
      'cmp-battery-per-km',
      bpk(a),
      bpk(b),
      (v) => `${perDist(v, u).toFixed(1)}%/${perDistLabel(u)}`,
      { less: `used less battery per ${perDistLabel(u)} than`, more: `used more battery per ${perDistLabel(u)} than`, same: `used about the same battery per ${perDistLabel(u)}` },
      labels,
      'Calculated',
      'calculated',
    ),
  );
  out.push(
    compareLine(
      'cmp-avg-speed',
      a.avgSpeedKmh,
      b.avgSpeedKmh,
      u.speed,
      { less: 'had a lower average moving speed than', more: 'had a higher average moving speed than', same: 'had about the same average moving speed' },
      labels,
      'Calculated',
      'calculated',
    ),
  );
  out.push(
    compareLine(
      'cmp-distance',
      a.distanceKm > 0 ? a.distanceKm : null,
      b.distanceKm > 0 ? b.distanceKm : null,
      u.dist,
      { less: 'was shorter than', more: 'was longer than', same: 'were about the same distance' },
      labels,
      'Ride history',
      'measured',
    ),
  );
  out.push(
    compareLine(
      'cmp-elevation',
      a.elevationGainM,
      b.elevationGainM,
      (v) => `${v.toFixed(0)} m`,
      { less: 'had less elevation gain than', more: 'had more elevation gain than', same: 'had about the same elevation gain' },
      labels,
      'Phone GPS',
      'calculated',
    ),
  );
  const sensorsA = tempSensors(a.points);
  const sensorsB = tempSensors(b.points);
  for (const s of sensorsA.filter((x) => sensorsB.includes(x))) {
    const peak = (r: Ride) => r.points.reduce<number | null>((m, p) => {
      const v = tempOf(p, s);
      return v != null && (m == null || v > m) ? v : m;
    }, null);
    const name = s === 'legacy' ? 'temperature (sensor not identified)' : TEMP_LABEL[s].toLowerCase();
    out.push(
      compareLine(
        `cmp-peak-temp-${s}`,
        peak(a),
        peak(b),
        u.temp,
        { less: `had a lower peak ${name} than`, more: `had a higher peak ${name} than`, same: `had about the same peak ${name}` },
        labels,
        'Scooter BLE',
        'measured',
      ),
    );
  }
  return out.filter((x): x is AnalysisItem => x != null);
}

// ---------------------------------------------------------------------------
// Personal heatmap (all recorded routes)
// ---------------------------------------------------------------------------

export type HeatMetric = 'speed' | 'battery' | 'elevation' | 'temperature' | 'power';

export interface HeatSegment { rideId: string; a: { lat: number; lon: number }; b: { lat: number; lon: number }; v: number }
export interface HeatResult { segments: HeatSegment[]; lo: number; hi: number; ridesUsed: number; ridesWithoutGps: number; stride: number }

/** Battery %/km is measured over stretches of at least this length (battery reports in 1 % steps). */
export const HEAT_BATTERY_WINDOW_KM = 0.5;

/** Highest scooter temperature recorded at a point (any sensor). */
export function maxTempOf(p: RidePoint): number | null {
  let m: number | null = null;
  for (const v of [p.motorTempC, p.controllerTempC, p.batteryTempC, p.tempC]) if (v != null && (m == null || v > m)) m = v;
  return m;
}

function heatPointValue(p: RidePoint, m: HeatMetric): number | null {
  switch (m) {
    case 'speed':
      return speedOf(p)?.v ?? null;
    case 'elevation':
      return p.alt;
    case 'temperature':
      return maxTempOf(p);
    case 'power':
      return powerOf(p)?.w ?? null;
    default:
      return null;
  }
}

/**
 * Coloured-segment data for all rides. Only recorded GPS points are used; points
 * are down-sampled evenly so the total segment count stays under `maxSegments`.
 * Segments across recording gaps or impossible GPS jumps are skipped.
 */
export function buildHeatSegments(rides: Ride[], metric: HeatMetric, maxSegments = 3000): HeatResult {
  const gpsRides = rides.map((r) => ({ r, pts: r.points.filter(hasGps) })).filter((x) => x.pts.length >= 2);
  const total = gpsRides.reduce((a, x) => a + x.pts.length, 0);
  const stride = Math.max(1, Math.ceil(total / maxSegments));
  const segments: HeatSegment[] = [];
  let lo = Infinity;
  let hi = -Infinity;
  for (const { r, pts: all } of gpsRides) {
    const pts = all.filter((_, i) => i % stride === 0 || i === all.length - 1);
    const maxDt = 60000 + stride * 2000;
    const ok: boolean[] = [];
    const cum: number[] = [0];
    for (let i = 1; i < pts.length; i++) {
      const d = haversineKm(pts[i - 1], pts[i]);
      const dtMs = pts[i].t - pts[i - 1].t;
      const valid = dtMs > 0 && dtMs <= maxDt && d / (dtMs / 3600000) < 120;
      ok.push(valid);
      cum.push(cum[i - 1] + (valid ? d : 0));
    }
    const segVal: (number | null)[] = ok.map(() => null);
    if (metric === 'battery') {
      let start = pts.findIndex((p) => p.battery != null);
      if (start >= 0) {
        for (let k = start + 1; k < pts.length; k++) {
          if (pts[k].battery == null) continue;
          const dist = cum[k] - cum[start];
          if (dist < HEAT_BATTERY_WINDOW_KM) continue;
          const rate = (pts[start].battery! - pts[k].battery!) / dist;
          for (let s = start; s < k; s++) segVal[s] = rate;
          start = k;
        }
      }
    } else {
      const vals = pts.map((p) => heatPointValue(p, metric));
      for (let i = 0; i < ok.length; i++) {
        const va = vals[i];
        const vb = vals[i + 1];
        segVal[i] = va != null && vb != null ? (va + vb) / 2 : va ?? vb;
      }
    }
    for (let i = 0; i < ok.length; i++) {
      const v = segVal[i];
      if (!ok[i] || v == null || !Number.isFinite(v)) continue;
      segments.push({ rideId: r.id, a: { lat: pts[i].lat, lon: pts[i].lon }, b: { lat: pts[i + 1].lat, lon: pts[i + 1].lon }, v });
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  return { segments, lo: Number.isFinite(lo) ? lo : 0, hi: Number.isFinite(hi) ? hi : 0, ridesUsed: gpsRides.length, ridesWithoutGps: rides.length - gpsRides.length, stride };
}
