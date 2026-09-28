import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useRef } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { checkMaintenanceNow, initNotifications, scheduleMaintenanceReminders } from '../services/Notifier';
import { connectScooter, initScooterManager } from '../services/ScooterManager';
import { useErrors } from '../store/errors';
import { useGarage } from '../store/garage';
import { useLive } from '../store/live';
import { useMaintenance } from '../store/maintenance';
import { useSettings } from '../store/settings';
import { useThemeStore } from '../store/theme';
import { AchievementWatcher } from '../ui/components/AchievementWatcher';
import { EasterEggHost } from '../ui/components/EasterEggs';
import { AccentKey, C } from '../ui/theme';

/**
 * Applies the user's accent. With dynamic accent on, the colour follows what the
 * scooter reports: green while the BMS says it is charging, orange for an active
 * warning code, red for an active critical code. No thresholds of our own.
 */
function ThemeController() {
  const accent = useSettings((s) => s.accent);
  const dynamic = useSettings((s) => s.dynamicAccent);
  const charging = useLive((s) => s.battery?.charging?.value === true);
  const scooterId = useLive((s) => s.scooterId);
  const severity = useErrors((s) => {
    let worst = 0;
    for (const r of s.records) {
      if (!r.active || r.scooterId !== scooterId) continue;
      worst = Math.max(worst, r.severity === 'CRITICAL' ? 2 : r.severity === 'WARNING' ? 1 : 0);
    }
    return worst;
  });
  const apply = useThemeStore((s) => s.apply);
  const lastUser = useRef<AccentKey | null>(null);
  useEffect(() => {
    const userChange = lastUser.current !== accent;
    lastUser.current = accent;
    let k: AccentKey = accent;
    if (dynamic) k = severity === 2 ? 'red' : severity === 1 ? 'orange' : charging ? 'green' : accent;
    apply(k, userChange);
  }, [accent, dynamic, charging, severity, apply]);
  return null;
}

function AutoConnect() {
  const adapter = useLive((s) => s.adapter);
  const tried = useRef(false);
  useEffect(() => {
    if (tried.current || adapter !== 'PoweredOn') return;
    const { autoConnect } = useSettings.getState();
    const g = useGarage.getState();
    const last = [...g.scooters].filter((s) => s.bleId && s.autoConnect !== false).sort((a, b) => (b.lastConnected ?? 0) - (a.lastConnected ?? 0))[0];
    tried.current = true;
    if (autoConnect && last?.bleId && useLive.getState().conn === 'idle') connectScooter(last.bleId, last.bleName);
  }, [adapter]);
  return null;
}

export default function RootLayout() {
  useEffect(() => initScooterManager(), []);
  useEffect(() => {
    // Give every saved scooter the full maintenance checklist (adds missing items only).
    const withDefaults = () => useGarage.getState().scooters.forEach((sc) => useMaintenance.getState().ensureDefaults(sc.id));
    if (useGarage.persist.hasHydrated() && useMaintenance.persist.hasHydrated()) withDefaults();
    else setTimeout(withDefaults, 1500);
    initNotifications()
      .then(() => scheduleMaintenanceReminders())
      .catch(() => undefined);
    const t = setTimeout(checkMaintenanceNow, 4000);
    return () => clearTimeout(t);
  }, []);
  const version = useThemeStore((s) => s.version);
  const navTheme = useMemo(
    () => ({ ...DarkTheme, colors: { ...DarkTheme.colors, background: C.bg, card: C.bg, primary: C.purple, text: C.text, border: C.border } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  );
  return (
    <SafeAreaProvider>
      <ThemeProvider value={navTheme}>
        <StatusBar style="light" />
        <ThemeController />
        <AutoConnect />
        <AchievementWatcher />
        <Stack
          screenOptions={{
            headerTransparent: true,
            headerTintColor: C.text,
            headerTitleStyle: { fontWeight: '700' },
            headerBackButtonDisplayMode: 'minimal',
            contentStyle: { backgroundColor: C.bg },
            animation: 'fade_from_bottom',
            // Portrait everywhere except the screens that benefit from landscape.
            orientation: 'portrait_up',
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="bluetooth" options={{ title: 'Bluetooth' }} />
          <Stack.Screen name="identify" options={{ title: 'Select model', presentation: 'modal' }} />
          <Stack.Screen name="xiaomi-key" options={{ title: 'Scooter key' }} />
          <Stack.Screen name="battery" options={{ title: 'Battery' }} />
          <Stack.Screen name="motor" options={{ title: 'Motor & controller' }} />
          <Stack.Screen name="controls" options={{ title: 'Lights & modes' }} />
          <Stack.Screen name="performance" options={{ title: 'Performance' }} />
          <Stack.Screen name="map" options={{ title: 'Map' }} />
          <Stack.Screen name="history" options={{ title: 'History' }} />
          <Stack.Screen name="ride/[id]" options={{ title: 'Ride' }} />
          <Stack.Screen name="garage" options={{ title: 'My scooters' }} />
          <Stack.Screen name="scooter/[id]" options={{ title: 'Scooter profile' }} />
          <Stack.Screen name="maintenance" options={{ title: 'Maintenance' }} />
          <Stack.Screen name="firmware" options={{ title: 'Firmware' }} />
          <Stack.Screen name="database" options={{ title: 'Scooter database' }} />
          <Stack.Screen name="developer" options={{ title: 'BLE LAB' }} />
          <Stack.Screen name="info" options={{ title: 'Scooter info' }} />
          <Stack.Screen name="health" options={{ title: 'Scooter health' }} />
          <Stack.Screen name="stats" options={{ title: 'Statistics' }} />
          <Stack.Screen name="achievements" options={{ title: 'Achievements' }} />
          <Stack.Screen name="themes" options={{ title: 'Themes' }} />
          <Stack.Screen name="dashboard-layout" options={{ title: 'Dashboard layout' }} />
          <Stack.Screen name="scooter3d" options={{ title: '3D scooter', animation: 'fade', orientation: 'all' }} />
          <Stack.Screen name="cockpit" options={{ headerShown: false, animation: 'fade', orientation: 'all' }} />
          <Stack.Screen name="gforce" options={{ title: 'G-force' }} />
          <Stack.Screen name="replay/[id]" options={{ title: 'Ride replay', orientation: 'all' }} />
          <Stack.Screen name="compare" options={{ title: 'Compare rides' }} />
          <Stack.Screen name="heatmap" options={{ title: 'Route heatmap' }} />
          <Stack.Screen name="voltage" options={{ title: 'Voltage sag' }} />
          <Stack.Screen name="records" options={{ title: 'Personal records' }} />
          <Stack.Screen name="wrapped" options={{ headerShown: false, animation: 'fade' }} />
          <Stack.Screen name="settings" options={{ title: 'Settings' }} />
        </Stack>
        <EasterEggHost />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
