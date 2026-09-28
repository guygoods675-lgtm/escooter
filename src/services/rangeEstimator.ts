import type { Ride } from '../store/rides';
import { rideWhPerKm } from './stats';

/**
 * Personal range estimate learned from the user's own recorded rides for one
 * scooter. This is a prediction (label it "estimated", source "Ride history"),
 * never a scooter measurement. Returns a reason instead of a number when the
 * inputs needed for an honest estimate are missing.
 */

export type RangeMethod = 'wh-per-km' | 'km-per-percent';
export type RangeConfidence = 'preliminary' | 'normal';

export interface RangeEstimate {
  km: number;
  method: RangeMethod;
  basis: { rides: number; kmUsed: number };
  confidence: RangeConfidence;
  explanation: string;
  /** Wh/km (wh-per-km method) or km per battery % (km-per-percent method), recency weighted. */
  rate: number;
  /** Only for the wh-per-km method: where the capacity came from and the remaining energy. */
  energy?: { source: 'bms' | 'spec'; capacityWh: number; remainingWh: number };
}

export interface RangeUnavailable {
  km: null;
  reason: string;
}

export type RangeResult = RangeEstimate | RangeUnavailable;

export interface RangeInputs {
  rides: Ride[];
  /** Only rides of this scooter are used. Pass null to use every ride. */
  scooterId: string | null;
  /** Current battery level reported by the scooter (0–100). */
  batteryPercent: number | null;
  /** BMS "actual capacity" in mAh, when the scooter exposes it. */
  bmsActualCapacityMah?: number | null;
  /** Nominal pack voltage (model database), used to turn mAh into Wh. */
  nominalVoltage?: number | null;
  /** Manufacturer spec capacity in Wh (model database). */
  specCapacityWh?: number | null;
  now?: number;
}

export const MIN_RIDES = 3;
export const MIN_KM = 10;
const MAX_RIDES = 10; // most recent rides considered
const DECAY = 0.8; // weight of each older ride relative to the next newer one
const MIN_RIDE_KM = 0.5;
const MIN_BATTERY_DROP = 2; // % — smaller drops are mostly rounding in the reported level

const valid = (n: number | null | undefined): n is number => n != null && Number.isFinite(n);

/** Remaining battery energy in Wh, from the BMS capacity when available, else the model spec. */
export function remainingEnergy(i: Pick<RangeInputs, 'batteryPercent' | 'bmsActualCapacityMah' | 'nominalVoltage' | 'specCapacityWh'>) {
  if (!valid(i.batteryPercent)) return null;
  const pct = Math.max(0, Math.min(100, i.batteryPercent));
  if (valid(i.bmsActualCapacityMah) && i.bmsActualCapacityMah > 0 && valid(i.nominalVoltage) && i.nominalVoltage > 0) {
    const capacityWh = (i.bmsActualCapacityMah / 1000) * i.nominalVoltage;
    return { source: 'bms' as const, capacityWh, remainingWh: (pct / 100) * capacityWh };
  }
  if (valid(i.specCapacityWh) && i.specCapacityWh > 0) {
    return { source: 'spec' as const, capacityWh: i.specCapacityWh, remainingWh: (pct / 100) * i.specCapacityWh };
  }
  return null;
}

function weighted<T>(items: T[], value: (x: T) => number, weight: (x: T) => number) {
  // items are newest first; newer rides count more
  let num = 0;
  let den = 0;
  items.forEach((x, idx) => {
    const w = DECAY ** idx;
    num += w * value(x);
    den += w * weight(x);
  });
  return den > 0 ? num / den : null;
}

function confidenceFor(rides: number, km: number): { confidence: RangeConfidence; note: string | null } {
  if (rides < MIN_RIDES || km < MIN_KM) {
    return {
      confidence: 'preliminary',
      note: `Preliminary: based on only ${rides} ride${rides === 1 ? '' : 's'} (${km.toFixed(1)} km). The estimate becomes more reliable after at least ${MIN_RIDES} rides and ${MIN_KM} km with this scooter.`,
    };
  }
  return { confidence: 'normal', note: null };
}

export function estimateRange(input: RangeInputs): RangeResult {
  if (!valid(input.batteryPercent)) return { km: null, reason: 'The current battery level is not available from the scooter.' };
  const pct = Math.max(0, Math.min(100, input.batteryPercent));
  const mine = input.rides
    .filter((r) => (input.scooterId == null || r.scooterId === input.scooterId) && r.distanceKm >= MIN_RIDE_KM && (input.now == null || r.start <= input.now))
    .sort((a, b) => b.start - a.start);
  if (!mine.length) return { km: null, reason: 'No recorded rides for this scooter yet. Record a ride to get a personal range estimate.' };

  // 1) Wh/km from recent rides × remaining energy.
  const energyRides = mine.filter((r) => {
    const w = rideWhPerKm(r);
    return w != null && Number.isFinite(w) && w > 0 && r.energyWh != null && r.energyWh > 0;
  }).slice(0, MAX_RIDES);
  const energy = remainingEnergy(input);
  if (energyRides.length && energy) {
    const whPerKm = weighted(energyRides, (r) => r.energyWh!, (r) => r.distanceKm);
    if (whPerKm != null && whPerKm > 0) {
      const kmUsed = energyRides.reduce((a, r) => a + r.distanceKm, 0);
      const c = confidenceFor(energyRides.length, kmUsed);
      const capText = energy.source === 'bms' ? 'the battery capacity reported by the BMS' : "the model's specified battery capacity";
      return {
        km: energy.remainingWh / whPerKm,
        method: 'wh-per-km',
        rate: whPerKm,
        energy,
        basis: { rides: energyRides.length, kmUsed },
        confidence: c.confidence,
        explanation:
          c.note ??
          `Based on your recent riding data: ${whPerKm.toFixed(1)} Wh/km over your last ${energyRides.length} rides (${kmUsed.toFixed(1)} km), newer rides weighted more, and ${pct.toFixed(0)}% of ${capText}.`,
      };
    }
  }

  // 2) km per battery-% from recent rides.
  const pctRides = mine.filter((r) => valid(r.batteryStart) && valid(r.batteryEnd) && r.batteryStart! - r.batteryEnd! >= MIN_BATTERY_DROP).slice(0, MAX_RIDES);
  if (pctRides.length) {
    const kmPerPct = weighted(pctRides, (r) => r.distanceKm, (r) => r.batteryStart! - r.batteryEnd!);
    if (kmPerPct != null && kmPerPct > 0) {
      const kmUsed = pctRides.reduce((a, r) => a + r.distanceKm, 0);
      const c = confidenceFor(pctRides.length, kmUsed);
      return {
        km: pct * kmPerPct,
        method: 'km-per-percent',
        rate: kmPerPct,
        basis: { rides: pctRides.length, kmUsed },
        confidence: c.confidence,
        explanation:
          c.note ??
          `Based on your recent riding data: ${kmPerPct.toFixed(2)} km per battery % over your last ${pctRides.length} rides (${kmUsed.toFixed(1)} km), newer rides weighted more.`,
      };
    }
  }

  if (energyRides.length && !energy) {
    return { km: null, reason: 'Your rides have energy data, but the battery capacity is unknown (not reported by the BMS and no model selected), and no ride recorded a battery-level drop to fall back on.' };
  }
  return { km: null, reason: 'None of your recorded rides for this scooter logged energy use or a battery-level drop of at least 2%, so there is nothing to base an estimate on yet.' };
}
