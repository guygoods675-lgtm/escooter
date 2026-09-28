import { Href, router } from 'expo-router';
import React, { useRef } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSettings } from '../../store/settings';
import { Divider, GlassCard, IconName, ListRow, SectionHeader } from '../../ui/components/Glass';
import { Screen } from '../../ui/components/Screen';
import { C, S } from '../../ui/theme';
import { useLive } from '../../store/live';
import { triggerEgg, unlockSecretTheme } from '../../ui/components/EasterEggs';

const LOGO = require('../../../assets/logo.png');

type Item = { icon: IconName; title: string; subtitle: string; href: Href; color?: string };

const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: 'Scooter',
    items: [
      { icon: 'pulse-outline', title: 'Scooter health', subtitle: 'Normal, warning or critical by system', href: '/health', color: C.green },
      { icon: 'information-circle-outline', title: 'Scooter info', subtitle: 'Every detail the scooter reports', href: '/info', color: C.cyan },
      { icon: 'cube-outline', title: '3D scooter', subtitle: 'Rotate and zoom, synced to live data', href: '/scooter3d', color: C.cyan },
      { icon: 'speedometer-outline', title: 'Cockpit mode', subtitle: 'Full-screen view for a mounted phone', href: '/cockpit', color: C.green },
      { icon: 'battery-charging-outline', title: 'Battery', subtitle: 'BMS, cells, health, charging', href: '/battery', color: C.green },
      { icon: 'cog-outline', title: 'Motor & controller', subtitle: 'Temperatures, current, power', href: '/motor', color: C.sunset },
      { icon: 'bulb-outline', title: 'Lights & modes', subtitle: 'Accessories and riding modes', href: '/controls', color: C.amber },
      { icon: 'rocket-outline', title: 'Performance', subtitle: 'Live graphs, RPM, power, Wh/km, 0–25 km/h', href: '/performance', color: C.cyan },
      { icon: 'navigate-circle-outline', title: 'G-force', subtitle: 'Live acceleration and braking', href: '/gforce', color: C.sunset },
      { icon: 'trending-down-outline', title: 'Voltage sag', subtitle: 'Resting vs loaded battery voltage', href: '/voltage', color: C.amber },
      { icon: 'hardware-chip-outline', title: 'Firmware', subtitle: 'Versions (read-only)', href: '/firmware' },
    ],
  },
  {
    title: 'Garage',
    items: [
      { icon: 'bicycle-outline', title: 'My scooters', subtitle: 'Profiles & statistics', href: '/garage' },
      { icon: 'construct-outline', title: 'Maintenance', subtitle: 'Due soon, due, completed', href: '/maintenance', color: C.amber },
      { icon: 'stats-chart-outline', title: 'Statistics', subtitle: 'Today, week, month, year, all time', href: '/stats', color: C.cyan },
      { icon: 'podium-outline', title: 'Personal records', subtitle: 'Each record links to its ride', href: '/records', color: C.amber },
      { icon: 'sparkles-outline', title: 'Scooter Hub Wrapped', subtitle: 'Your year in rides', href: '/wrapped', color: C.sunset },
      { icon: 'git-compare-outline', title: 'Compare rides', subtitle: 'Side-by-side ride stats', href: '/compare' },
      { icon: 'flame-outline', title: 'Route heatmap', subtitle: 'Your recorded routes by speed, battery…', href: '/heatmap', color: C.red },
      { icon: 'trophy-outline', title: 'Achievements', subtitle: 'Distance and consistency milestones', href: '/achievements', color: C.amber },
      { icon: 'map-outline', title: 'Map', subtitle: 'Current location and routes', href: '/map', color: C.cyan },
      { icon: 'albums-outline', title: 'History', subtitle: 'Rides, errors, battery, service', href: '/history' },
      { icon: 'library-outline', title: 'Scooter database', subtitle: 'Supported models & protocols', href: '/database' },
    ],
  },
  {
    title: 'App',
    items: [
      { icon: 'color-palette-outline', title: 'Themes', subtitle: 'Backgrounds, space themes, accent colours', href: '/themes', color: C.sunset },
      { icon: 'grid-outline', title: 'Dashboard layout', subtitle: 'Compact, large speed, battery, custom', href: '/dashboard-layout' },
      { icon: 'bluetooth-outline', title: 'Bluetooth', subtitle: 'Scan, connect, saved scooters', href: '/bluetooth', color: C.cyan },
      { icon: 'settings-outline', title: 'Settings', subtitle: 'Units, alerts, privacy', href: '/settings' },
    ],
  },
];

export default function MoreScreen() {
  const dev = useSettings((s) => s.developerMode);
  const set = useSettings((s) => s.set);
  const pushAlert = useLive((s) => s.pushAlert);
  const taps = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hidden developer mode: tap the logo 7 times.
  const onLogo = () => {
    taps.current++;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => (taps.current = 0), 1500);
    if (taps.current >= 7) {
      taps.current = 0;
      set('developerMode', !dev);
      if (!dev) triggerEgg('hexrain');
      pushAlert({ level: 'info', title: dev ? 'Developer mode off' : 'Developer mode on', body: dev ? 'Inspector hidden.' : 'BLE Lab is now available in More.' });
    }
  };

  return (
    <Screen topInset>
      <Pressable onPress={onLogo} style={styles.hero}>
        <Image source={LOGO} style={styles.logo} />
        <View>
          <Text style={styles.name}>Scooter Hub</Text>
          <Text style={styles.ver} onLongPress={unlockSecretTheme}>Version 3.0.0</Text>
        </View>
      </Pressable>
      {GROUPS.map((g) => (
        <View key={g.title}>
          <SectionHeader title={g.title} />
          <GlassCard style={{ paddingVertical: S.xs }}>
            {g.items.map((it, i) => (
              <View key={it.title}>
                {i > 0 && <Divider />}
                <ListRow icon={it.icon} title={it.title} subtitle={it.subtitle} color={it.color} onPress={() => router.push(it.href)} />
              </View>
            ))}
          </GlassCard>
        </View>
      ))}
      {dev && (
        <>
          <SectionHeader title="Developer" />
          <GlassCard style={{ paddingVertical: S.xs }} accent={C.cyan}>
            <ListRow icon="flask-outline" title="BLE Lab" subtitle="Inspector, raw packets, packet rate, logs" color={C.cyan} onPress={() => router.push('/developer')} />
          </GlassCard>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: S.md, marginBottom: S.sm },
  logo: { width: 56, height: 56, borderRadius: 14 },
  name: { color: C.text, fontSize: 24, fontWeight: '900' },
  ver: { color: C.textDim, fontSize: 12 },
});
