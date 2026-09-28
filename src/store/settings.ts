import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AccentKey } from '../ui/theme';
import { jsonStorage } from './storage';

export type BgTheme = 'sunset' | 'space' | 'nebula' | 'aurora' | 'carbon' | 'synthwave' | 'ocean' | 'midnight' | 'terminal' | 'custom';
export type DashLayout = 'default' | 'compact' | 'large-speed' | 'battery' | 'diagnostic' | 'ride' | 'minimal' | 'performance' | 'cockpit' | 'custom';

export interface Settings {
  language: 'en';
  speedUnit: 'kmh' | 'mph';
  tempUnit: 'c' | 'f';
  distanceUnit: 'km' | 'mi';
  autoConnect: boolean;
  connectionTimeoutSec: number;
  reconnect: 'auto' | 'manual';
  gpsAccuracy: 'high' | 'balanced';
  backgroundTracking: boolean;
  autoRideDetection: boolean;
  notifyLowBattery: boolean;
  lowBatteryPercent: number;
  notifyHighTemp: boolean; // only fires on scooter-reported overheat codes
  notifyErrors: boolean;
  notifyMaintenance: boolean;
  notifyDisconnect: boolean;
  localOnly: boolean;
  locationEnabled: boolean;
  developerMode: boolean;
  devWritesEnabled: boolean;
  hideSerials: boolean;
  accent: AccentKey;
  dynamicAccent: boolean;
  dashLayout: DashLayout;
  dashCards: string[]; // card ids for the custom layout, in order
  notifyChargingComplete: boolean;
  notifyAbnormal: boolean;
  systemNotifications: boolean; // also post OS notifications, not only in-app banners
  reduceMotion: boolean;
  bgTheme: BgTheme;
  customBgUri: string | null;
  bgDim: number; // 0.4-0.95 overlay strength
  twinkle: boolean;
  haptics: boolean;
  sounds: boolean; // off by default
  tapSounds: boolean; // button sounds, off by default even when sounds are on
  oledMode: boolean; // black background, minimal effects, larger numbers
  cockpitKeepAwake: boolean; // keep screen on only while Cockpit Mode is open
  showAllFields: boolean; // also show fields the connected scooter can never report
  show3d: boolean; // 3D scooter card on dashboard/profile
  easterEggs: boolean;
  firstConnectCelebrated: boolean;
  secretThemeUnlocked: boolean;
}

const defaults: Settings = {
  language: 'en',
  speedUnit: 'kmh',
  tempUnit: 'c',
  distanceUnit: 'km',
  autoConnect: true,
  connectionTimeoutSec: 10,
  reconnect: 'auto',
  gpsAccuracy: 'high',
  backgroundTracking: false,
  autoRideDetection: false,
  notifyLowBattery: true,
  lowBatteryPercent: 15,
  notifyHighTemp: true,
  notifyErrors: true,
  notifyMaintenance: true,
  notifyDisconnect: true,
  localOnly: true,
  locationEnabled: true,
  developerMode: false,
  devWritesEnabled: false,
  hideSerials: false,
  accent: 'purple',
  dynamicAccent: false,
  dashLayout: 'default',
  dashCards: ['header', 'speed', 'miniGauges', 'battery', 'energy', 'power', 'distance', 'status'],
  notifyChargingComplete: true,
  notifyAbnormal: true,
  systemNotifications: true,
  reduceMotion: false,
  bgTheme: 'space',
  customBgUri: null,
  bgDim: 0.82,
  twinkle: true,
  haptics: true,
  sounds: false,
  tapSounds: false,
  oledMode: false,
  cockpitKeepAwake: false,
  showAllFields: false,
  show3d: true,
  easterEggs: true,
  firstConnectCelebrated: false,
  secretThemeUnlocked: false,
};

interface SettingsState extends Settings {
  set<K extends keyof Settings>(key: K, value: Settings[K]): void;
  reset(): void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaults,
      set: (key, value) => set({ [key]: value } as Partial<Settings>),
      reset: () => set(defaults),
    }),
    {
      name: 'sh.settings',
      storage: jsonStorage,
      version: 1,
      // v1: Deep Space replaced the Sunset Ride photo as the standard look (john's request).
      migrate: (state, version) => {
        const s = state as Partial<Settings>;
        if (version < 1 && s.bgTheme === 'sunset') s.bgTheme = 'space';
        return s as SettingsState;
      },
    },
  ),
);
