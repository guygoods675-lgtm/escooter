import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { jsonStorage, uid } from './storage';

export interface MaintenanceEvent {
  id: string;
  date: number;
  odometerKm: number | null;
  notes: string;
}

export interface MaintenanceItem {
  id: string;
  scooterId: string;
  name: string;
  icon: string;
  intervalDays: number | null; // user-chosen reminder interval
  intervalKm: number | null;
  custom: boolean;
  history: MaintenanceEvent[];
  notes: string;
  /** Explicit next date chosen by the user (custom reminder). Overrides the day interval when set. */
  nextDate?: number | null;
}

/** `aliases` are earlier names of the same default item, so renamed defaults are not added twice. */
export const DEFAULT_ITEMS: { name: string; icon: string; aliases?: string[] }[] = [
  { name: 'Tires', icon: 'disc-outline' },
  { name: 'Tire pressure', icon: 'speedometer-outline' },
  { name: 'Brakes', icon: 'hand-left-outline' },
  { name: 'Brake pads', icon: 'remove-circle-outline' },
  { name: 'Bearings', icon: 'aperture-outline' },
  { name: 'Suspension', icon: 'git-commit-outline' },
  { name: 'Screws', icon: 'construct-outline', aliases: ['Screws / bolts'] },
  { name: 'Lights', icon: 'bulb-outline' },
  { name: 'Charging port', icon: 'flash-outline' },
  { name: 'Battery', icon: 'battery-half-outline' },
  { name: 'Cleaning', icon: 'water-outline', aliases: ['General cleaning'] },
  { name: 'General service', icon: 'build-outline' },
  { name: 'Firmware updates', icon: 'hardware-chip-outline' },
];

/** True when `itemName` is the default item `defName` (or one of its earlier names). */
export function isDefaultItem(itemName: string, defName: string) {
  const d = DEFAULT_ITEMS.find((x) => x.name === defName);
  const names = [defName, ...(d?.aliases ?? [])].map((n) => n.toLowerCase());
  return names.includes(itemName.toLowerCase());
}

interface MaintState {
  items: MaintenanceItem[];
  ensureDefaults(scooterId: string): void;
  addItem(scooterId: string, name: string, intervalDays: number | null, intervalKm: number | null): void;
  updateItem(id: string, patch: Partial<MaintenanceItem>): void;
  removeItem(id: string): void;
  logEvent(id: string, ev: Omit<MaintenanceEvent, 'id'>): void;
  removeForScooter(scooterId: string): void;
}

export const useMaintenance = create<MaintState>()(
  persist(
    (set, get) => ({
      items: [],
      /** Adds any missing default items for the scooter. Existing items (and their history) are never touched. */
      ensureDefaults(scooterId) {
        const mine = get().items.filter((i) => i.scooterId === scooterId);
        const missing = DEFAULT_ITEMS.filter((d) => !mine.some((i) => isDefaultItem(i.name, d.name)));
        if (!missing.length) return;
        const items: MaintenanceItem[] = missing.map((d) => ({ id: uid(), scooterId, name: d.name, icon: d.icon, intervalDays: null, intervalKm: null, custom: false, history: [], notes: '', nextDate: null }));
        set((s) => ({ items: [...s.items, ...items] }));
      },
      addItem: (scooterId, name, intervalDays, intervalKm) =>
        set((s) => ({ items: [...s.items, { id: uid(), scooterId, name, icon: 'build-outline', intervalDays, intervalKm, custom: true, history: [], notes: '' }] })),
      updateItem: (id, patch) => set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) })),
      removeItem: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
      // Logging a completion on/after an explicit next date satisfies that date, so it is cleared.
      logEvent: (id, ev) =>
        set((s) => ({
          items: s.items.map((i) =>
            i.id === id
              ? { ...i, history: [{ ...ev, id: uid() }, ...i.history].sort((a, b) => b.date - a.date), nextDate: i.nextDate != null && i.nextDate <= ev.date + 86400000 ? null : i.nextDate ?? null }
              : i,
          ),
        })),
      removeForScooter: (scooterId) => set((s) => ({ items: s.items.filter((i) => i.scooterId !== scooterId) })),
    }),
    { name: 'sh.maintenance', storage: jsonStorage },
  ),
);

export type MaintStatus = 'completed' | 'due-soon' | 'due' | 'not-scheduled' | 'never' | 'scheduled';

/**
 * Status is based only on dates/intervals the user set; the app invents no service intervals.
 * An explicit next date (item.nextDate) wins over the day interval.
 */
export function maintenanceStatus(item: MaintenanceItem, odometerKm: number | null, now = Date.now()): { status: MaintStatus; nextDate: number | null; nextKm: number | null } {
  const last = item.history[0];
  const explicit = item.nextDate ?? null;
  const soonWindowMs = (item.intervalDays ? Math.max(item.intervalDays * 0.15, 3) : 7) * 86400000;
  if (!last) {
    if (explicit == null) return { status: item.intervalDays || item.intervalKm ? 'due' : 'never', nextDate: null, nextKm: null };
    return { status: now >= explicit ? 'due' : explicit - now < soonWindowMs ? 'due-soon' : 'scheduled', nextDate: explicit, nextKm: null };
  }
  const nextDate = explicit ?? (item.intervalDays ? last.date + item.intervalDays * 86400000 : null);
  const nextKm = item.intervalKm && last.odometerKm != null ? last.odometerKm + item.intervalKm : null;
  if (!nextDate && !nextKm) return { status: 'not-scheduled', nextDate, nextKm };
  const overDate = nextDate != null && now >= nextDate;
  const overKm = nextKm != null && odometerKm != null && odometerKm >= nextKm;
  if (overDate || overKm) return { status: 'due', nextDate, nextKm };
  const soonDate = nextDate != null && nextDate - now < soonWindowMs;
  const soonKm = nextKm != null && odometerKm != null && item.intervalKm != null && nextKm - odometerKm < item.intervalKm * 0.15;
  return { status: soonDate || soonKm ? 'due-soon' : 'completed', nextDate, nextKm };
}
