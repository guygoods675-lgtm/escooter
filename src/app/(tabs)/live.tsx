import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useActiveRide } from '../../services/RideTracker';
import { SeriesKey, getSeries, useHistoryVersion } from '../../services/telemetryHistory';
import { useLive } from '../../store/live';
import { EmptyState, GlassCard, NeonButton, Note, Segmented } from '../../ui/components/Glass';
import { LineChart } from '../../ui/components/LineChart';
import { Screen } from '../../ui/components/Screen';
import { C, F, S } from '../../ui/theme';
import { NA, useUnits } from '../../utils/format';
import { router } from 'expo-router';

type Win = '30s' | '5m' | '30m' | 'ride';
const WINDOWS: { label: string; value: Win }[] = [
  { label: '30 s', value: '30s' },
  { label: '5 min', value: '5m' },
  { label: '30 min', value: '30m' },
  { label: 'Ride', value: 'ride' },
];
const MS: Record<Exclude<Win, 'ride'>, number> = { '30s': 30000, '5m': 300000, '30m': 1800000 };

export default function LiveScreen() {
  useHistoryVersion(); // re-render when new samples arrive (throttled)
  const [win, setWin] = useState<Win>('30s');
  const conn = useLive((s) => s.conn);
  const rideStart = useActiveRide((s) => s.start);
  const u = useUnits();
  const now = Date.now();
  const from = win === 'ride' ? rideStart ?? undefined : now - MS[win];

  const charts: { key: SeriesKey; title: string; unit: string; color: string; digits?: number; convert?: (v: number) => number }[] = [
    { key: 'speed', title: 'Speed', unit: u.speedLabel, color: C.purple, convert: u.speed },
    { key: 'gpsSpeed', title: 'GPS speed (phone)', unit: u.speedLabel, color: C.cyan, convert: u.speed },
    { key: 'battery', title: 'Battery', unit: '%', color: C.green, digits: 0 },
    { key: 'voltage', title: 'Battery voltage', unit: 'V', color: C.cyan, digits: 2 },
    { key: 'current', title: 'Battery current', unit: 'A', color: C.amber, digits: 2 },
    { key: 'power', title: 'Power', unit: 'W', color: C.purpleLight, digits: 0 },
    { key: 'motorTemp', title: 'Motor temperature', unit: u.tempLabel, color: C.sunset, convert: u.temp },
    { key: 'controllerTemp', title: 'Controller temperature', unit: u.tempLabel, color: C.sunset, convert: u.temp },
    { key: 'batteryTemp', title: 'Battery temperature', unit: u.tempLabel, color: C.amber, convert: u.temp },
    { key: 'rpm', title: 'Motor RPM', unit: '', color: C.purple, digits: 0 },
    { key: 'accel', title: 'Acceleration (from speed)', unit: ' m/s²', color: C.red, digits: 2 },
  ];

  return (
    <Screen topInset>
      <Text style={styles.title}>Live Data</Text>
      <Segmented options={WINDOWS} value={win} onChange={setWin} style={{ marginBottom: S.md }} />
      {win === 'ride' && !rideStart && <Note>No ride in progress. Showing everything recorded since connecting.</Note>}
      {conn !== 'connected' && (
        <EmptyState icon="pulse" title="No scooter connected" body="Graphs fill with real samples once a scooter is connected. GPS speed appears while a ride is recording.">
          <NeonButton title="Connect Scooter" icon="bluetooth" onPress={() => router.push('/bluetooth')} />
        </EmptyState>
      )}
      {charts.map((c) => {
        const data = getSeries(c.key, from);
        const last = data[data.length - 1];
        return (
          <GlassCard key={c.key}>
            <View style={styles.head}>
              <Text style={F.label}>{c.title}</Text>
              <Text style={[styles.val, { color: c.color }]}>
                {last ? `${(c.convert ? c.convert(last.v) : last.v).toFixed(c.digits ?? 1)}${c.unit.startsWith(' ') || !c.unit ? c.unit : ' ' + c.unit}` : NA}
              </Text>
            </View>
            <LineChart data={data} color={c.color} unit={c.unit.startsWith(' ') ? c.unit : c.unit ? ` ${c.unit}` : ''} digits={c.digits ?? 1} fromT={from} toT={now} convert={c.convert} emptyText={conn === 'connected' ? 'Not available from this scooter' : 'No samples'} height={110} />
          </GlassCard>
        );
      })}
      <Note>Acceleration is derived from consecutive speed samples (about 1–2 per second), so short bursts are smoothed.</Note>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: C.text, fontSize: 30, fontWeight: '900', marginBottom: S.md, letterSpacing: -0.5 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: S.sm },
  val: { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
