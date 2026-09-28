import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ErrorSeverity } from '../protocols/types';
import { jsonStorage } from './storage';

export interface ErrorRecord {
  key: string; // scooterId:kind:code
  scooterId: string | null;
  code: number;
  kind: 'error' | 'warning';
  title: string;
  severity: ErrorSeverity;
  causes: string[];
  source: string;
  firstSeen: number;
  lastSeen: number;
  occurrences: number;
  active: boolean;
}

interface ErrorState {
  records: ErrorRecord[];
  observe(scooterId: string | null, active: Omit<ErrorRecord, 'key' | 'scooterId' | 'firstSeen' | 'lastSeen' | 'occurrences' | 'active'>[]): ErrorRecord[];
  markAllInactive(scooterId: string | null): void;
  clearHistory(): void;
}

export const useErrors = create<ErrorState>()(
  persist(
    (set, get) => ({
      records: [],
      observe(scooterId, active) {
        const now = Date.now();
        const keys = new Set(active.map((a) => `${scooterId}:${a.kind}:${a.code}`));
        const newlyActive: ErrorRecord[] = [];
        const records = get().records.map((r) => {
          if (r.scooterId !== scooterId) return r;
          if (keys.has(r.key)) {
            if (!r.active) newlyActive.push(r);
            return { ...r, active: true, lastSeen: now, occurrences: r.active ? r.occurrences : r.occurrences + 1 };
          }
          return r.active ? { ...r, active: false } : r;
        });
        for (const a of active) {
          const key = `${scooterId}:${a.kind}:${a.code}`;
          if (!records.some((r) => r.key === key)) {
            const rec = { ...a, key, scooterId, firstSeen: now, lastSeen: now, occurrences: 1, active: true };
            records.push(rec);
            newlyActive.push(rec);
          }
        }
        set({ records });
        return newlyActive;
      },
      markAllInactive: (scooterId) => set((s) => ({ records: s.records.map((r) => (r.scooterId === scooterId ? { ...r, active: false } : r)) })),
      clearHistory: () => set((s) => ({ records: s.records.filter((r) => r.active) })),
    }),
    { name: 'sh.errors', storage: jsonStorage },
  ),
);
