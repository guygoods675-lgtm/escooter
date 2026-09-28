import { useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AnalysisUnits, batteryUsed, compareRides, rideEnergyWh, rideWhPerKm, tempOf, tempSensors, TEMP_LABEL } from '../services/rideAnalysis';
import { Ride, useRides } from '../store/rides';
import { DataTag } from '../ui/components/DataTag';
import { EmptyState, GlassCard, ListRow, NeonButton, Note, SectionHeader } from '../ui/components/Glass';
import { Screen } from '../ui/components/Screen';
import { C, F, R, S } from '../ui/theme';
import { NA, fmtDateTime, fmtDuration, useUnits } from '../utils/format';

type Slot = 'a' | 'b';
const PAGE = 20;

export default function CompareRides() {
  const params = useLocalSearchParams<{ a?: string; b?: string }>();
  const rides = useRides((s) => s.rides);
  const [ids, setIds] = useState<{ a: string | null; b: string | null }>({ a: params.a ?? null, b: params.b ?? null });
  const [picking, setPicking] = useState<Slot | null>(!params.a ? 'a' : !params.b ? 'b' : null);
  const [limit, setLimit] = useState(PAGE);
  const u = useUnits();

  const a = rides.find((r) => r.id === ids.a) ?? null;
  const b = rides.find((r) => r.id === ids.b) ?? null;

  const units: AnalysisUnits = useMemo(
    () => ({
      speed: (v) => `${u.speed(v).toFixed(1)} ${u.speedLabel}`,
      dist: (v) => `${u.dist(v).toFixed(2)} ${u.distLabel}`,
      temp: (c) => `${u.temp(c).toFixed(0)}${u.tempLabel}`,
      distanceUnit: u.distanceUnit === 'mi' ? 'mi' : 'km',
    }),
    [u.speedUnit, u.distanceUnit, u.tempUnit],
  );
  const sentences = useMemo(() => (a && b ? compareRides(a, b, units, { a: `Ride #${a.number}`, b: `Ride #${b.number}` }) : []), [a, b, units]);

  if (rides.length < 2) {
    return (
      <Screen contentStyle={{ paddingTop: 110 }}>
        <EmptyState icon="git-compare-outline" title="Not enough rides" body="Record at least two rides to compare them." />
      </Screen>
    );
  }

  const choose = (slot: Slot, id: string) => {
    setIds((s) => ({ ...s, [slot]: id }));
    setPicking(slot === 'a' && !ids.b ? 'b' : null);
    setLimit(PAGE);
  };

  return (
    <Screen contentStyle={{ paddingTop: 110 }}>
      <View style={{ flexDirection: 'row', gap: S.sm }}>
        <SlotCard label="Ride A" ride={a} active={picking === 'a'} onPress={() => setPicking(picking === 'a' ? null : 'a')} />
        <SlotCard label="Ride B" ride={b} active={picking === 'b'} onPress={() => setPicking(picking === 'b' ? null : 'b')} />
      </View>

      {picking && (
        <>
          <SectionHeader title={`Pick ${picking === 'a' ? 'ride A' : 'ride B'}`} icon="list-outline" />
          <GlassCard>
            {rides.slice(0, limit).map((r) => {
              const other = picking === 'a' ? ids.b : ids.a;
              return (
                <ListRow
                  key={r.id}
                  icon={r.id === ids[picking] ? 'checkmark-circle' : 'bicycle-outline'}
                  title={`Ride #${r.number} · ${u.dist(r.distanceKm).toFixed(2)} ${u.distLabel}`}
                  subtitle={`${fmtDateTime(r.start)} · ${fmtDuration(r.durationSec)}${r.id === other ? ' · already selected' : ''}`}
                  onPress={r.id === other ? undefined : () => choose(picking, r.id)}
                />
              );
            })}
            {rides.length > limit && <NeonButton title="Show more rides" variant="ghost" small onPress={() => setLimit((l) => l + PAGE)} />}
          </GlassCard>
        </>
      )}

      {a && b && (
        <>
          <SectionHeader title="Side by side" icon="stats-chart-outline" />
          <StatsTable a={a} b={b} />
          <SectionHeader title="Comparison" icon="bulb-outline" />
          <GlassCard>
            {sentences.length ? (
              sentences.map((it) => (
                <View key={it.id} style={{ paddingVertical: 6 }}>
                  <Text style={styles.sentence}>{it.text}</Text>
                  <DataTag kind={it.kind} source={it.source} />
                </View>
              ))
            ) : (
              <Text style={{ color: C.textFaint }}>These two rides don't share enough recorded values to compare.</Text>
            )}
            <Note>Only values recorded in both rides are compared. Differences can come from route, weather, load, riding mode and many other factors.</Note>
          </GlassCard>
        </>
      )}
    </Screen>
  );
}

function SlotCard({ label, ride, active, onPress }: { label: string; ride: Ride | null; active: boolean; onPress: () => void }) {
  const u = useUnits();
  return (
    <Pressable onPress={onPress} style={[styles.slot, active && styles.slotActive]} accessibilityRole="button" accessibilityLabel={`${label}: ${ride ? `ride ${ride.number}` : 'not selected'}. Tap to change.`}>
      <Text style={F.label}>{label}</Text>
      {ride ? (
        <>
          <Text style={styles.slotTitle}>Ride #{ride.number}</Text>
          <Text style={styles.slotSub}>{fmtDateTime(ride.start)}</Text>
          <Text style={styles.slotSub}>{u.dist(ride.distanceKm).toFixed(2)} {u.distLabel}</Text>
        </>
      ) : (
        <Text style={[styles.slotSub, { marginTop: 6 }]}>Tap to choose</Text>
      )}
    </Pressable>
  );
}

function peakTemp(r: Ride, s: ReturnType<typeof tempSensors>[number]) {
  let m: number | null = null;
  for (const p of r.points) {
    const v = tempOf(p, s);
    if (v != null && (m == null || v > m)) m = v;
  }
  return m;
}

function StatsTable({ a, b }: { a: Ride; b: Ride }) {
  const u = useUnits();
  const perKm = (v: number) => (u.distanceUnit === 'mi' ? v * 1.609344 : v);
  const rows = useMemo(() => {
    const f = (v: number | null | undefined, fm: (x: number) => string) => (v == null || !Number.isFinite(v) ? NA : fm(v));
    const bpk = (r: Ride) => {
      const used = batteryUsed(r);
      return used != null && r.distanceKm > 0.3 ? used / r.distanceKm : null;
    };
    const out: { label: string; a: string; b: string }[] = [
      { label: 'Date', a: fmtDateTime(a.start), b: fmtDateTime(b.start) },
      { label: `Distance (${u.distLabel})`, a: a.distanceSource === 'none' ? NA : u.dist(a.distanceKm).toFixed(2), b: b.distanceSource === 'none' ? NA : u.dist(b.distanceKm).toFixed(2) },
      { label: 'Time', a: fmtDuration(a.durationSec), b: fmtDuration(b.durationSec) },
      { label: 'Moving time', a: fmtDuration(a.movingSec), b: fmtDuration(b.movingSec) },
      { label: `Avg speed (${u.speedLabel})`, a: f(a.avgSpeedKmh, (v) => u.speed(v).toFixed(1)), b: f(b.avgSpeedKmh, (v) => u.speed(v).toFixed(1)) },
      { label: `Max speed (${u.speedLabel})`, a: f(a.maxSpeedKmh, (v) => u.speed(v).toFixed(1)), b: f(b.maxSpeedKmh, (v) => u.speed(v).toFixed(1)) },
      { label: 'Battery used', a: f(batteryUsed(a), (v) => `${v}%`), b: f(batteryUsed(b), (v) => `${v}%`) },
      { label: `Battery per ${u.distLabel}`, a: f(bpk(a), (v) => `${perKm(v).toFixed(1)}%`), b: f(bpk(b), (v) => `${perKm(v).toFixed(1)}%`) },
      { label: 'Energy (Wh, V × I)', a: f(rideEnergyWh(a), (v) => v.toFixed(1)), b: f(rideEnergyWh(b), (v) => v.toFixed(1)) },
      { label: `Wh/${u.distLabel}`, a: f(rideWhPerKm(a), (v) => perKm(v).toFixed(1)), b: f(rideWhPerKm(b), (v) => perKm(v).toFixed(1)) },
      { label: 'Elevation gain (GPS)', a: f(a.elevationGainM, (v) => `${v.toFixed(0)} m`), b: f(b.elevationGainM, (v) => `${v.toFixed(0)} m`) },
    ];
    const sensors = Array.from(new Set([...tempSensors(a.points), ...tempSensors(b.points)]));
    for (const s of sensors) {
      const label = s === 'legacy' ? 'Peak temp (sensor not identified)' : `Peak ${TEMP_LABEL[s].replace(' temperature', ' temp').toLowerCase()}`;
      out.push({ label, a: f(peakTemp(a, s), (v) => `${u.temp(v).toFixed(0)}${u.tempLabel}`), b: f(peakTemp(b, s), (v) => `${u.temp(v).toFixed(0)}${u.tempLabel}`) });
    }
    return out;
  }, [a, b, u.speedUnit, u.distanceUnit, u.tempUnit]);
  return (
    <GlassCard>
      <View style={styles.row}>
        <Text style={[styles.cLabel, F.label]} />
        <Text style={[styles.cVal, F.label]}>#{a.number}</Text>
        <Text style={[styles.cVal, F.label]}>#{b.number}</Text>
      </View>
      {rows.map((r) => (
        <View key={r.label} style={styles.row}>
          <Text style={styles.cLabel}>{r.label}</Text>
          <Text style={[styles.cVal, r.a === NA && styles.na]}>{r.a}</Text>
          <Text style={[styles.cVal, r.b === NA && styles.na]}>{r.b}</Text>
        </View>
      ))}
      <Note>Energy and Wh/{u.distLabel} are calculated from scooter voltage × current; elevation from phone GPS altitude. {NA} means the ride didn't record that value.</Note>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  slot: { flex: 1, backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, get borderColor() { return C.border; }, padding: S.md, minHeight: 92 },
  slotActive: { get borderColor() { return C.purple; } },
  slotTitle: { color: C.text, fontSize: 17, fontWeight: '800', marginTop: 4 },
  slotSub: { color: C.textDim, fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.06)' },
  cLabel: { flex: 1.4, color: C.textDim, fontSize: 13 },
  cVal: { flex: 1, color: C.text, fontSize: 13.5, fontWeight: '700', textAlign: 'right', fontVariant: ['tabular-nums'] },
  na: { color: C.textFaint, fontWeight: '500', fontSize: 12 },
  sentence: { color: C.text, fontSize: 14, lineHeight: 20 },
});
