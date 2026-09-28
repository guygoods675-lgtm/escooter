import { Platform } from 'react-native';

// Default palette taken from the Scooter Hub logo: violet-to-purple neon on black.
// The accent keys (violet, purple, purpleLight, border, borderStrong) are getters so
// the user-selected accent applies everywhere without touching each screen.
export type AccentKey = 'purple' | 'blue' | 'cyan' | 'green' | 'red' | 'orange' | 'pink';
export const ACCENTS: Record<AccentKey, { name: string; deep: string; main: string; light: string }> = {
  purple: { name: 'Purple', deep: '#7C3AED', main: '#A855F7', light: '#C084FC' },
  blue: { name: 'Blue', deep: '#2563EB', main: '#3B82F6', light: '#93C5FD' },
  cyan: { name: 'Cyan', deep: '#0891B2', main: '#22D3EE', light: '#A5F3FC' },
  green: { name: 'Green', deep: '#059669', main: '#10B981', light: '#6EE7B7' },
  red: { name: 'Red', deep: '#DC2626', main: '#EF4444', light: '#FCA5A5' },
  orange: { name: 'Orange', deep: '#EA580C', main: '#F97316', light: '#FDBA74' },
  pink: { name: 'Pink', deep: '#DB2777', main: '#EC4899', light: '#F9A8D4' },
};

export const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

let accent = ACCENTS.purple;
export const setThemeAccent = (k: AccentKey) => {
  accent = ACCENTS[k] ?? ACCENTS.purple;
};

export const C = {
  get violet() {
    return accent.deep;
  },
  get purple() {
    return accent.main;
  },
  get purpleLight() {
    return accent.light;
  },
  get border() {
    return rgba(accent.main, 0.22);
  },
  get borderStrong() {
    return rgba(accent.main, 0.5);
  },
  bg: '#05030B',
  bgOverlayTop: 'rgba(5,3,11,0.55)',
  bgOverlayBottom: 'rgba(5,3,11,0.94)',
  card: 'rgba(16,11,30,0.72)',
  cardStrong: 'rgba(20,14,38,0.9)',
  text: '#F4F1FF',
  textDim: '#A69FC0',
  textFaint: '#6E6789',
  cyan: '#22D3EE',
  green: '#34D399',
  amber: '#FBBF24',
  red: '#F87171',
  sunset: '#FB923C',
};

export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const R = { sm: 10, md: 16, lg: 22, pill: 999 };

export const F = {
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  display: { fontWeight: '800' as const, letterSpacing: -1 },
  label: { fontSize: 11, fontWeight: '700' as const, letterSpacing: 1.4, textTransform: 'uppercase' as const, color: '#A69FC0' },
};

export const glow = (color: string = accent.main, radius = 16) => ({
  shadowColor: color,
  shadowOpacity: 0.55,
  shadowRadius: radius,
  shadowOffset: { width: 0, height: 0 },
  elevation: 8,
});

export const severityColor = (s: 'INFO' | 'WARNING' | 'CRITICAL') => (s === 'CRITICAL' ? C.red : s === 'WARNING' ? C.amber : C.cyan);
