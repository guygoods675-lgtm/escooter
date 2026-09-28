import type { ImageSourcePropType } from 'react-native';
import type { BgTheme } from '../store/settings';
import type { AccentKey } from '../ui/theme';

export interface ThemePreset {
  id: BgTheme;
  name: string;
  description: string;
  image: ImageSourcePropType | null;
  thumb: ImageSourcePropType | null;
  accent: AccentKey; // suggested accent when the theme is applied
  tint: string; // top overlay tint
  base: string; // fallback background colour
  stars: boolean; // animated twinkle layer
  hidden?: boolean; // Easter egg: shown only once unlocked
}

export const THEMES: ThemePreset[] = [
  { id: 'sunset', name: 'Sunset Ride', description: 'The original Scooter Hub photo', image: require('../../assets/background.jpg'), thumb: require('../../assets/themes/sunset-thumb.jpg'), accent: 'purple', tint: 'rgba(124,58,237,0.18)', base: '#05030B', stars: false },
  { id: 'space', name: 'Deep Space', description: 'Starfield with a faint galaxy band', image: require('../../assets/themes/space.jpg'), thumb: require('../../assets/themes/space-thumb.jpg'), accent: 'blue', tint: 'rgba(37,99,235,0.14)', base: '#02030A', stars: true },
  { id: 'nebula', name: 'Nebula', description: 'Purple and pink cosmic clouds', image: require('../../assets/themes/nebula.jpg'), thumb: require('../../assets/themes/nebula-thumb.jpg'), accent: 'pink', tint: 'rgba(219,39,119,0.14)', base: '#06020E', stars: true },
  { id: 'aurora', name: 'Aurora', description: 'Northern-lights curtains', image: require('../../assets/themes/aurora.jpg'), thumb: require('../../assets/themes/aurora-thumb.jpg'), accent: 'green', tint: 'rgba(16,185,129,0.12)', base: '#02060C', stars: true },
  { id: 'carbon', name: 'Carbon', description: 'Motorsport carbon weave', image: require('../../assets/themes/carbon.jpg'), thumb: require('../../assets/themes/carbon-thumb.jpg'), accent: 'red', tint: 'rgba(220,38,38,0.10)', base: '#0A0A0E', stars: false },
  { id: 'synthwave', name: 'Synthwave', description: 'Retro neon sun and grid', image: require('../../assets/themes/synthwave.jpg'), thumb: require('../../assets/themes/synthwave-thumb.jpg'), accent: 'orange', tint: 'rgba(236,72,153,0.12)', base: '#0A0418', stars: false },
  { id: 'ocean', name: 'Deep Ocean', description: 'Light rays and bubbles', image: require('../../assets/themes/ocean.jpg'), thumb: require('../../assets/themes/ocean-thumb.jpg'), accent: 'cyan', tint: 'rgba(8,145,178,0.14)', base: '#020A14', stars: false },
  { id: 'midnight', name: 'Midnight', description: 'Clean dark gradient, no image', image: null, thumb: null, accent: 'purple', tint: 'rgba(124,58,237,0.16)', base: '#03050A', stars: false },
  { id: 'terminal', name: 'Terminal', description: 'Secret: green-on-black hacker look', image: null, thumb: null, accent: 'green', tint: 'rgba(34,197,94,0.10)', base: '#000000', stars: false, hidden: true },
  { id: 'custom', name: 'Your photo', description: 'Pick any picture from your gallery', image: null, thumb: null, accent: 'purple', tint: 'rgba(124,58,237,0.14)', base: '#05030B', stars: false },
];

export const themeById = (id: BgTheme) => THEMES.find((t) => t.id === id) ?? THEMES[0];
