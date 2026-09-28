import type { MaintenanceItem } from '../store/maintenance';
import { maintenanceStatus } from '../store/maintenance';
import type { Ride } from '../store/rides';

/** All statistics here are computed only from rides the user recorded. */

export type Period = 'today' | 'week' | 'month' | 'year' | 'all';

export function periodStart(p: Period, now = new Date()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (p === 'today') return d.getTime();
  if (p === 'week') {
    const day = (d.getDay() + 6) % 7; // Monday start
    d.setDate(d.getDate() - day);
    return d.getTime();
  }
  if (p === 'month') return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  if (p === 'year') return new Date(d.getFullYear(), 0, 1).getTime();
  return 0;
}

export interface Aggregate {
  rides: number;
  distanceKm: number;
  timeSec: number;
  energyWh: number | null; // null when no ride had energy data
  energyRides: number;
  maxSpeedKmh: number | null;
  avgDistanceKm: number | null;
  longest: Ride | null;
  mostEfficient: Ride | null; // lowest Wh/km among rides with energy data
  avgWhPerKm: number | null;
  avgDurationSec: number | null;
  batteryUsedPct: number | null;
}

export const rideWhPerKm = (r: Ride) => r.whPerKm ?? (r.energyWh != null && r.distanceKm > 0.05 ? r.energyWh / r.distanceKm : null);

export function aggregate(rides: Ride[]): Aggregate {
  const n = rides.length;
  const distanceKm = rides.reduce((a, r) => a + r.distanceKm, 0);
  const timeSec = rides.reduce((a, r) => a + r.durationSec, 0);
  const withEnergy = rides.filter((r) => r.energyWh != null);
  const eff = rides.map((r) => ({ r, w: rideWhPerKm(r) })).filter((x) => x.w != null && x.r.distanceKm >= 0.5) as { r: Ride; w: number }[];
  const speeds = rides.map((r) => r.maxSpeedKmh).filter((v): v is number => v != null);
  const batt = rides.filter((r) => r.batteryStart != null && r.batteryEnd != null);
  const effDist = eff.reduce((a, x) => a + x.r.distanceKm, 0);
  return {
    rides: n,
    distanceKm,
    timeSec,
    energyWh: withEnergy.length ? withEnergy.reduce((a, r) => a + (r.energyWh ?? 0), 0) : null,
    energyRides: withEnergy.length,
    maxSpeedKmh: speeds.length ? Math.max(...speeds) : null,
    avgDistanceKm: n ? distanceKm / n : null,
    longest: rides.reduce<Ride | null>((a, r) => (!a || r.distanceKm > a.distanceKm ? r : a), null),
    mostEfficient: eff.reduce<{ r: Ride; w: number } | null>((a, x) => (!a || x.w < a.w ? x : a), null)?.r ?? null,
    avgWhPerKm: eff.length && effDist > 0 ? eff.reduce((a, x) => a + x.w * x.r.distanceKm, 0) / effDist : null,
    avgDurationSec: n ? timeSec / n : null,
    batteryUsedPct: batt.length ? batt.reduce((a, r) => a + (r.batteryStart! - r.batteryEnd!), 0) : null,
  };
}

export const ridesInPeriod = (rides: Ride[], p: Period) => {
  const from = periodStart(p);
  return rides.filter((r) => r.start >= from);
};

export interface Insight {
  id: string;
  icon: string;
  text: string;
  tone: 'neutral' | 'good' | 'attention';
}

/** Plain statements about the user's own recorded data. No mechanical or health diagnoses. */
export function insights(rides: Ride[], items: MaintenanceItem[], odometerFor: (scooterId: string) => number | null, fmt: { dist: (km: number) => string; speed: (kmh: number) => string }): Insight[] {
  const out: Insight[] = [];
  const sorted = [...rides].sort((a, b) => b.start - a.start);
  const recent = sorted.slice(0, 5);
  const recentAgg = aggregate(recent);
  const allAgg = aggregate(rides);
  if (recentAgg.avgWhPerKm != null) {
    let text = `Your average consumption on your last ${recent.length} rides was ${recentAgg.avgWhPerKm.toFixed(1)} Wh/km.`;
    if (allAgg.avgWhPerKm != null && sorted.length > recent.length) {
      const diff = ((recentAgg.avgWhPerKm - allAgg.avgWhPerKm) / allAgg.avgWhPerKm) * 100;
      if (Math.abs(diff) >= 5) text += ` That is ${Math.abs(diff).toFixed(0)}% ${diff > 0 ? 'higher' : 'lower'} than your all-time average.`;
    }
    out.push({ id: 'whkm', icon: 'flash-outline', text, tone: 'neutral' });
  }
  if (allAgg.longest && allAgg.longest.distanceKm > 0) out.push({ id: 'longest', icon: 'trophy-outline', text: `Your longest recorded ride was ${fmt.dist(allAgg.longest.distanceKm)}.`, tone: 'good' });
  if (allAgg.avgDurationSec != null && rides.length >= 2) out.push({ id: 'dur', icon: 'time-outline', text: `Your average ride duration is ${Math.round(allAgg.avgDurationSec / 60)} minutes.`, tone: 'neutral' });
  const wk = aggregate(ridesInPeriod(rides, 'week'));
  const lastWeekStart = periodStart('week') - 7 * 86400000;
  const lw = aggregate(rides.filter((r) => r.start >= lastWeekStart && r.start < periodStart('week')));
  if (wk.rides > 0 || lw.rides > 0) out.push({ id: 'week', icon: 'calendar-outline', text: `This week you rode ${fmt.dist(wk.distanceKm)} in ${wk.rides} ride${wk.rides === 1 ? '' : 's'} (last week: ${fmt.dist(lw.distanceKm)}).`, tone: 'neutral' });
  const perKm = rides.filter((r) => r.batteryStart != null && r.batteryEnd != null && r.distanceKm >= 1).map((r) => (r.batteryStart! - r.batteryEnd!) / r.distanceKm);
  if (perKm.length >= 3) out.push({ id: 'battkm', icon: 'battery-half-outline', text: `On average you use ${(perKm.reduce((a, b) => a + b, 0) / perKm.length).toFixed(1)}% battery per km.`, tone: 'neutral' });
  for (const i of items) {
    const st = maintenanceStatus(i, odometerFor(i.scooterId));
    if (st.status === 'due-soon') out.push({ id: `m-${i.id}`, icon: 'construct-outline', text: `Your ${i.name.toLowerCase()} maintenance reminder is approaching.`, tone: 'attention' });
    else if (st.status === 'due' && i.history.length) out.push({ id: `m-${i.id}`, icon: 'construct-outline', text: `Your ${i.name.toLowerCase()} maintenance reminder is due.`, tone: 'attention' });
  }
  return out;
}

/** Achievements: distance and consistency only. Nothing rewards speed or risky riding. */
export interface AchievementInputs {
  totalKm: number;
  rides: number;
  longestKm: number;
  maintLogs: number;
  weeksActive: number;
  /** Total moving time in hours (time spent riding, stops excluded). */
  rideHours: number;
  /** Rides of at least 1 km with valid energy data (Wh/km). */
  efficientRides: number;
}

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  icon: string;
  progress: (a: AchievementInputs) => { value: number; target: number };
}

const dist = (km: number, title: string, icon = 'ribbon-outline'): AchievementDef => ({
  id: `dist-${km}`, title, description: `Ride ${km.toLocaleString()} km in total`, icon, progress: (a) => ({ value: a.totalKm, target: km }),
});
const count = (n: number, title: string): AchievementDef => ({
  id: `rides-${n}`, title, description: `Record ${n} rides`, icon: 'repeat-outline', progress: (a) => ({ value: a.rides, target: n }),
});
const hours = (h: number, title: string): AchievementDef => ({
  id: `hours-${h}`, title, description: `Spend ${h} hours riding in total (moving time)`, icon: 'time-outline', progress: (a) => ({ value: a.rideHours, target: h }),
});
const single = (km: number, title: string): AchievementDef => ({
  id: `single-${km}`, title, description: `Ride ${km} km in one ride`, icon: 'trail-sign-outline', progress: (a) => ({ value: a.longestKm, target: km }),
});

export const ACHIEVEMENTS: AchievementDef[] = [
  count(1, 'First ride'),
  dist(10, 'First 10 km'),
  dist(100, 'First 100 km', 'medal-outline'),
  dist(500, '500 km club', 'medal-outline'),
  dist(1000, '1,000 km', 'trophy-outline'),
  dist(5000, '5,000 km', 'trophy-outline'),
  count(10, '10 rides'),
  count(50, '50 rides'),
  count(100, '100 rides'),
  single(10, 'Long ride: 10 km'),
  single(25, 'Long ride: 25 km'),
  single(50, 'Long ride: 50 km'),
  hours(10, '10 hours riding'),
  hours(50, '50 hours riding'),
  { id: 'efficient-1', title: 'Most efficient ride', description: 'Log a ride of 1 km or more with valid Wh/km data', icon: 'leaf-outline', progress: (a) => ({ value: a.efficientRides, target: 1 }) },
  { id: 'maint-1', title: 'Well maintained', description: 'Log your first maintenance', icon: 'construct-outline', progress: (a) => ({ value: a.maintLogs, target: 1 }) },
  { id: 'maint-10', title: 'Service regular', description: 'Log 10 maintenance tasks', icon: 'build-outline', progress: (a) => ({ value: a.maintLogs, target: 10 }) },
  { id: 'weeks-4', title: 'Regular rider', description: 'Ride in 4 different weeks', icon: 'calendar-outline', progress: (a) => ({ value: a.weeksActive, target: 4 }) },
];

export function achievementInputs(rides: Ride[], items: MaintenanceItem[]): AchievementInputs {
  const weeks = new Set(rides.map((r) => periodStart('week', new Date(r.start))));
  return {
    totalKm: rides.reduce((a, r) => a + r.distanceKm, 0),
    rides: rides.length,
    longestKm: rides.reduce((a, r) => Math.max(a, r.distanceKm), 0),
    maintLogs: items.reduce((a, i) => a + i.history.length, 0),
    weeksActive: weeks.size,
    rideHours: rides.reduce((a, r) => a + (r.movingSec > 0 ? r.movingSec : 0), 0) / 3600,
    efficientRides: rides.filter((r) => {
      const w = rideWhPerKm(r);
      return r.distanceKm >= 1 && w != null && Number.isFinite(w) && w > 0;
    }).length,
  };
}
