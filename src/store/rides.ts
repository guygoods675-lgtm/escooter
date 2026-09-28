import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { jsonStorage } from './storage';

export interface RidePoint {
  t: number;
  lat: number | null;
  lon: number | null;
  alt: number | null;
  accuracy: number | null;
  gpsSpeedKmh: number | null;
  speedKmh: number | null; // scooter speed if available
  battery: number | null;
  tempC: number | null;
  voltage: number | null;
  current: number | null;
  odoKm: number | null;
  // Added in 3.0; older rides don't have these (treat undefined as not recorded).
  motorTempC?: number | null;
  controllerTempC?: number | null;
  batteryTempC?: number | null;
  powerW?: number | null; // as reported by the scooter (Ninebot); null otherwise
  rpm?: number | null;
  accelMs2?: number | null; // phone accelerometer, longitudinal, m/s² (see accelSource)
}

export interface Ride {
  id: string;
  number: number;
  scooterId: string | null;
  start: number;
  end: number;
  distanceKm: number; // GPS distance, or scooter trip delta when no GPS
  distanceSource: 'gps' | 'scooter' | 'none';
  durationSec: number;
  movingSec: number;
  avgSpeedKmh: number | null;
  maxSpeedKmh: number | null;
  batteryStart: number | null;
  batteryEnd: number | null;
  energyWh: number | null; // integrated V*I when the scooter reports both
  elevationGainM: number | null;
  elevationLossM: number | null;
  stops: number;
  maxTempC: number | null;
  avgPowerW?: number | null; // from scooter voltage x current samples
  peakPowerW?: number | null;
  whPerKm?: number | null;
  points: RidePoint[];
}

interface RidesState {
  rides: Ride[];
  add(r: Ride): void;
  remove(id: string): void;
  clear(): void;
  nextNumber(): number;
  importMany(rides: Ride[]): number;
  stripLocation(): void;
}

export const useRides = create<RidesState>()(
  persist(
    (set, get) => ({
      rides: [],
      add: (r) => set((s) => ({ rides: [r, ...s.rides] })),
      remove: (id) => set((s) => ({ rides: s.rides.filter((r) => r.id !== id) })),
      clear: () => set({ rides: [] }),
      importMany(rides) {
        const have = new Set(get().rides.map((r) => r.id));
        const add = rides.filter((r) => r && typeof r.id === 'string' && !have.has(r.id) && Array.isArray(r.points));
        set((s) => ({ rides: [...s.rides, ...add].sort((a, b) => b.start - a.start) }));
        return add.length;
      },
      stripLocation: () => set((s) => ({ rides: s.rides.map((r) => ({ ...r, points: r.points.map((p) => ({ ...p, lat: null, lon: null, alt: null, accuracy: null })) })) })),
      nextNumber: () => get().rides.reduce((m, r) => Math.max(m, r.number), 0) + 1,
    }),
    { name: 'sh.rides', storage: jsonStorage },
  ),
);
