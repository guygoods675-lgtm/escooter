import { create } from 'zustand';
import { AccentKey, setThemeAccent } from '../ui/theme';

/**
 * Accent colour state. `version` bumps on any accent change so UI-kit components
 * re-render; `staticVersion` bumps only when the user picks a new accent, and
 * screens remount their content on it so every colour updates.
 */
interface ThemeState {
  current: AccentKey;
  version: number;
  staticVersion: number;
  apply(k: AccentKey, userChange?: boolean): void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  current: 'purple',
  version: 0,
  staticVersion: 0,
  apply(k, userChange = false) {
    if (k === get().current && !userChange) return;
    setThemeAccent(k);
    set((s) => ({ current: k, version: s.version + 1, staticVersion: userChange ? s.staticVersion + 1 : s.staticVersion }));
  },
}));

export const useThemeVersion = () => useThemeStore((s) => s.version);
