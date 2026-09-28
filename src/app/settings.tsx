import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { router } from 'expo-router';
import React from 'react';
import { Alert, StyleSheet, Switch, Text, View } from 'react-native';
import { scheduleMaintenanceReminders } from '../services/Notifier';
import { useAchievements } from '../store/achievements';
import { useErrors } from '../store/errors';
import { useGarage } from '../store/garage';
import { useMaintenance } from '../store/maintenance';
import { useRides } from '../store/rides';
import { Settings, useSettings } from '../store/settings';
import { Divider, GlassCard, ListRow, NeonButton, Note, SectionHeader, Segmented } from '../ui/components/Glass';
import { Screen } from '../ui/components/Screen';
import { C, S } from '../ui/theme';
import { shareText } from '../utils/export';

type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

function Toggle({ k, title, sub, disabled }: { k: BoolKey; title: string; sub?: string; disabled?: boolean }) {
  const v = useSettings((s) => s[k]);
  const set = useSettings((s) => s.set);
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, disabled && { color: C.textFaint }]}>{title}</Text>
        {!!sub && <Text style={styles.sub}>{sub}</Text>}
      </View>
      <Switch value={v} disabled={disabled} onValueChange={(x) => set(k, x)} trackColor={{ true: C.violet, false: 'rgba(255,255,255,0.15)' }} thumbColor="#fff" />
    </View>
  );
}

function Choice<K extends keyof Settings>({ k, title, options }: { k: K; title: string; options: { label: string; value: Settings[K] & (string | number) }[] }) {
  const v = useSettings((s) => s[k]) as Settings[K] & (string | number);
  const set = useSettings((s) => s.set);
  return (
    <View style={{ paddingVertical: S.sm }}>
      <Text style={[styles.title, { marginBottom: 8 }]}>{title}</Text>
      <Segmented options={options} value={v} onChange={(x) => set(k, x)} />
    </View>
  );
}

export default function SettingsScreen() {
  const soundsOn = useSettings((s) => s.sounds);
  const clearRides = useRides((s) => s.clear);
  const removeAll = useGarage((s) => s.removeAll);
  const clearErrors = useErrors((s) => s.clearHistory);
  const confirm = (title: string, body: string, fn: () => void) => Alert.alert(title, body, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: fn }]);

  const exportAll = () =>
    shareText(
      `scooterhub-export-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          scooters: useGarage.getState().scooters,
          rides: useRides.getState().rides,
          errors: useErrors.getState().records,
          maintenance: useMaintenance.getState().items,
          achievements: useAchievements.getState().unlocked,
        },
        null,
        2,
      ),
    ).catch((e) => Alert.alert('Export failed', String(e)));

  // Import merges a Scooter Hub export into the current data; nothing existing is overwritten.
  const importAll = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', '*/*'], copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const data = JSON.parse(await new File(res.assets[0].uri).text());
      if (!data || typeof data !== 'object' || !Array.isArray(data.rides) || !Array.isArray(data.scooters)) throw new Error('This is not a Scooter Hub export file.');
      const g = useGarage.getState();
      const haveS = new Set(g.scooters.map((x) => x.id));
      const newScooters = data.scooters.filter((x: { id?: string }) => x?.id && !haveS.has(x.id));
      useGarage.setState({ scooters: [...g.scooters, ...newScooters] });
      const addedRides = useRides.getState().importMany(data.rides);
      if (Array.isArray(data.errors)) {
        const have = new Set(useErrors.getState().records.map((r) => r.key));
        useErrors.setState((st) => ({ records: [...st.records, ...data.errors.filter((r: { key?: string }) => r?.key && !have.has(r.key)).map((r: object) => ({ ...r, active: false }))] }));
      }
      if (Array.isArray(data.maintenance)) {
        const have = new Set(useMaintenance.getState().items.map((i) => i.id));
        useMaintenance.setState((st) => ({ items: [...st.items, ...data.maintenance.filter((i: { id?: string }) => i?.id && !have.has(i.id))] }));
        scheduleMaintenanceReminders().catch(() => undefined);
      }
      if (data.achievements && typeof data.achievements === 'object') useAchievements.setState((st) => ({ unlocked: { ...data.achievements, ...st.unlocked } }));
      Alert.alert('Import complete', `Added ${newScooters.length} scooter${newScooters.length === 1 ? '' : 's'} and ${addedRides} ride${addedRides === 1 ? '' : 's'}.`);
    } catch (e) {
      Alert.alert('Import failed', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Screen contentStyle={{ paddingTop: 110 }}>
      <SectionHeader title="Appearance" icon="color-palette-outline" />
      <GlassCard style={{ paddingVertical: S.xs }}>
        <ListRow icon="images-outline" title="Themes & backgrounds" subtitle="Space themes, accent colours, your own photo" onPress={() => router.push('/themes')} />
        <Divider />
        <ListRow icon="grid-outline" title="Dashboard layout" subtitle="Compact, large speed, battery, diagnostic, ride, custom" onPress={() => router.push('/dashboard-layout')} />
        <Divider />
        <ListRow icon="key-outline" title="Xiaomi scooter key" subtitle="Needed for the Xiaomi 4 Pro 2nd Gen (encrypted Bluetooth)" onPress={() => router.push('/xiaomi-key')} />
        <Divider />
        <Toggle k="dynamicAccent" title="Dynamic accent" sub="Accent follows charging, warning and critical states the scooter reports" />
        <Toggle k="reduceMotion" title="Reduce motion" sub="Turn off number and card animations" />
        <Toggle k="oledMode" title="OLED / low-power mode" sub="Black background, no photo or effects, bigger numbers, slower graph refresh" />
        <Toggle k="show3d" title="3D scooter" sub="Show the interactive 3D scooter on the dashboard and profile" />
        <Toggle k="easterEggs" title="Easter eggs" sub="Small hidden animations. They never change any data." />
      </GlassCard>

      <SectionHeader title="Feedback" icon="pulse-outline" />
      <GlassCard>
        <Toggle k="haptics" title="Haptic feedback" sub="Connect, disconnect, rides, achievements, warnings and buttons. Never on every telemetry update." />
        <Toggle k="sounds" title="Interface sounds" sub="Short sounds for connect, disconnect, ride start/finish, achievements and warnings. Silent mode is respected." />
        <Toggle k="tapSounds" title="Button sounds" sub="Also click on button presses" disabled={!soundsOn} />
        <Toggle k="cockpitKeepAwake" title="Keep screen on in Cockpit mode" sub="Only while Cockpit mode is open" />
      </GlassCard>

      <SectionHeader title="General" icon="globe-outline" />
      <GlassCard>
        <Choice k="language" title="Language" options={[{ label: 'English', value: 'en' }]} />
        <Choice k="speedUnit" title="Speed" options={[{ label: 'km/h', value: 'kmh' }, { label: 'mph', value: 'mph' }]} />
        <Choice k="distanceUnit" title="Distance" options={[{ label: 'Kilometres', value: 'km' }, { label: 'Miles', value: 'mi' }]} />
        <Choice k="tempUnit" title="Temperature" options={[{ label: '°C', value: 'c' }, { label: '°F', value: 'f' }]} />
      </GlassCard>

      <SectionHeader title="Bluetooth" icon="bluetooth-outline" />
      <GlassCard>
        <Toggle k="autoConnect" title="Auto-connect" sub="Connect to the last scooter when the app opens" />
        <Divider />
        <Choice k="connectionTimeoutSec" title="Connection timeout" options={[{ label: '5 s', value: 5 }, { label: '10 s', value: 10 }, { label: '20 s', value: 20 }, { label: '30 s', value: 30 }]} />
        <Choice k="reconnect" title="When connection drops" options={[{ label: 'Reconnect automatically', value: 'auto' }, { label: 'Stay disconnected', value: 'manual' }]} />
      </GlassCard>

      <SectionHeader title="Ride tracking" icon="navigate-outline" />
      <GlassCard>
        <Choice k="gpsAccuracy" title="GPS accuracy" options={[{ label: 'High', value: 'high' }, { label: 'Battery saver', value: 'balanced' }]} />
        <Toggle k="backgroundTracking" title="Background tracking" sub="Keep recording rides with the screen off. Android shows a 'Recording ride' notification and asks for 'Allow all the time' location. Applies from the next ride." />
        <Divider />
        <Toggle k="autoRideDetection" title="Automatic ride detection" sub="Start recording after ~5 s of scooter-reported movement above 5 km/h" />
      </GlassCard>

      <SectionHeader title="Alerts" icon="notifications-outline" />
      <GlassCard>
        <Toggle k="notifyLowBattery" title="Low battery" />
        <Choice k="lowBatteryPercent" title="Low battery threshold" options={[{ label: '10%', value: 10 }, { label: '15%', value: 15 }, { label: '20%', value: 20 }, { label: '30%', value: 30 }]} />
        <Toggle k="notifyHighTemp" title="High temperature" sub="From overheat codes the scooter reports" />
        <Toggle k="notifyErrors" title="Scooter errors" />
        <Toggle k="notifyMaintenance" title="Maintenance reminders" />
        <Toggle k="notifyDisconnect" title="Disconnection" />
        <Toggle k="notifyChargingComplete" title="Charging complete" sub="When the BMS reports 100%, or stops charging at 98% or more" />
        <Toggle k="notifyAbnormal" title="Abnormal telemetry" sub="Warning codes the scooter reports" />
        <Divider />
        <Toggle k="systemNotifications" title="Phone notifications" sub="Also show alerts in the notification shade, not only inside the app" />
        <Note>Each alert can be switched off on its own. Nothing here uses thresholds the scooter does not report, except the low-battery level you choose.</Note>
      </GlassCard>

      <SectionHeader title="Privacy" icon="lock-closed-outline" />
      <GlassCard>
        <Toggle k="localOnly" title="Local-only mode" sub="All data stays on this phone. This version has no cloud sync." disabled />
        <Divider />
        <Toggle k="locationEnabled" title="Use location" sub="Needed for routes, GPS speed and elevation" />
        <Divider />
        <Toggle k="hideSerials" title="Hide serial numbers" sub="Mask serials on screen" />
        <View style={{ gap: S.sm, marginTop: S.md }}>
          <NeonButton small variant="ghost" title="Export data (JSON)" icon="download-outline" onPress={exportAll} />
          <NeonButton small variant="ghost" title="Import data (JSON)" icon="cloud-upload-outline" onPress={importAll} />
          <NeonButton small variant="danger" title="Delete location history" onPress={() => confirm('Delete location history?', 'GPS positions and elevation are removed from every ride. Distances and telemetry are kept.', useRides.getState().stripLocation)} />
          <NeonButton small variant="danger" title="Delete ride history" onPress={() => confirm('Delete all rides?', 'Routes and ride statistics will be removed.', clearRides)} />
          <NeonButton small variant="danger" title="Delete error history" onPress={() => confirm('Delete error history?', 'Active errors are kept.', clearErrors)} />
          <NeonButton small variant="danger" title="Delete scooter profiles" onPress={() => confirm('Delete all scooter profiles?', 'Saved scooters and their maintenance logs will be removed.', () => { removeAll(); useMaintenance.setState({ items: [] }); })} />
        </View>
      </GlassCard>

      <SectionHeader title="Developer" icon="code-slash-outline" />
      <GlassCard>
        <Toggle k="developerMode" title="Developer mode" sub="BLE Lab: inspector, raw packets, packet rate and log export" />
      </GlassCard>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: S.sm, gap: S.md },
  title: { color: C.text, fontSize: 15, fontWeight: '600' },
  sub: { color: C.textDim, fontSize: 12.5, marginTop: 2 },
});
