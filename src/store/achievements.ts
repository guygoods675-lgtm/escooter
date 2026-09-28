import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { jsonStorage } from './storage';

interface AchState {
  unlocked: Record<string, number>; // id -> unlock time
  unlock(ids: string[]): void;
  reset(): void;
}

export const useAchievements = create<AchState>()(
  persist(
    (set) => ({
      unlocked: {},
      unlock: (ids) => set((s) => ({ unlocked: { ...s.unlocked, ...Object.fromEntries(ids.map((i) => [i, Date.now()])) } })),
      reset: () => set({ unlocked: {} }),
    }),
    { name: 'sh.achievements', storage: jsonStorage },
  ),
);
