import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useErrors } from '../store/errors';
import { useGarage } from '../store/garage';
import { useMaintenance } from '../store/maintenance';
import { useRides } from '../store/rides';
import { Badge, Divider, EmptyState, GlassCard, KeyValue, ListRow, Segmented } from '../ui/components/Glass';
import { LineChart } from '../ui/components/LineChart';
import { Screen } from '../ui/components/Screen';
import { C, F, S, severityColor } from '../ui/theme';
import { fmtDate, fmtDateTime, fmtDuration, useUnits } from '../utils/format';

type Tab = 'rides' | 'errors' | 'battery' | 'maintenance';
type Sort = 'date' | 'distance' | 'speed' | 'battery';

export default function HistoryScreen() {
  const [tab, setTab] = useState<Tab>('rides');
  return (
    <Screen contentStyle={{ paddingTop: 110 }}>
      <Segmented
        options={[{ label: 'Rides', value: 'rides' }, { label: 'Errors', value: 'errors' }, { label: 'Battery', value: 'battery' }, { label: 'Service', value: 'maintenance' }]}
        value={tab}
        onChange={setTab}
        style={{ marginBottom: S.md }}
      />
      {tab === 'rides' && <Rides />}
      {tab === 'errors' && <Errors />}
      {tab === 'battery' && <Battery />}
      {tab === 'maintenance' && <Service />}
    </Screen>
  );
}

function ScooterFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const scooters = useGarage((s) => s.scooters);
  if (scooters.length < 2) return null;
  return <Segmented options={[{ label: 'All', value: 'all' }, ...scooters.slice(0, 3).map((s) => ({ label: s.nickname.slice(0, 10), value: s.id }))]} value={value} onChange={onChange} style={{ marginBottom: S.md }} />;
}

function Rides() {
  const rides = useRides((s) => s.rides);
  const u = useUnits();
  const [sort, setSort] = useState<Sort>('date');
  const [scooter, setScooter] = useState('all');
  const [minKm, setMinKm] = useState('');
  const list = useMemo(() => {
    const min = parseFloat(minKm) || 0;
    const f = rides.filter((r) => (scooter === 'all' || r.scooterId === scooter) && u.dist(r.distanceKm) >= min);
    const key = (r: (typeof rides)[number]) =>
      sort === 'date' ? r.start : sort === 'distance' ? r.distanceKm : sort === 'speed' ? r.maxSpeedKmh ?? -1 : r.batteryStart != null && r.batteryEnd != null ? r.batteryStart - r.batteryEnd : -1;
    return [...f].sort((a, b) => key(b) - key(a));
  }, [rides, sort, scooter, minKm, u]);
  return (
    <>
      <ScooterFilter value={scooter} onChange={setScooter} />
      <Segmented options={[{ label: 'Newest', value: 'date' }, { label: 'Distance', value: 'distance' }, { label: 'Max speed', value: 'speed' }, { label: 'Battery', value: 'battery' }]} value={sort} onChange={setSort} style={{ marginBottom: S.sm }} />
      <TextInput
        placeholder={`Min distance (${u.distLabel})`}
        placeholderTextColor={C.textFaint}
        keyboardType="decimal-pad"
        value={minKm}
        onChangeText={setMinKm}
        style={{ color: C.text, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 12, height: 42, marginBottom: S.md }}
      />
      {list.length === 0 ? (
        <EmptyState icon="navigate-outline" title="No rides" body="Start a ride from the Ride tab." />
      ) : (
        list.map((r) => (
          <GlassCard key={r.id} padded={false} style={{ paddingHorizontal: S.lg }}>
            <ListRow
              icon="navigate"
              title={`#${r.number} · ${u.dist(r.distanceKm).toFixed(2)} ${u.distLabel} · ${fmtDuration(r.durationSec)}`}
              subtitle={`${fmtDateTime(r.start)} · avg ${r.avgSpeedKmh != null ? u.speed(r.avgSpeedKmh).toFixed(1) : '–'} · max ${r.maxSpeedKmh != null ? u.speed(r.maxSpeedKmh).toFixed(1) : '–'} ${u.speedLabel} · battery ${r.batteryStart != null && r.batteryEnd != null ? `${r.batteryStart - r.batteryEnd}%` : '–'}`}
              onPress={() => router.push({ pathname: '/ride/[id]', params: { id: r.id } })}
            />
          </GlassCard>
        ))
      )}
    </>
  );
}

function Errors() {
  const records = useErrors((s) => s.records);
  const [sev, setSev] = useState<'ALL' | 'CRITICAL' | 'WARNING' | 'INFO'>('ALL');
  const list = records.filter((r) => sev === 'ALL' || r.severity === sev).sort((a, b) => b.lastSeen - a.lastSeen);
  return (
    <>
      <Segmented options={[{ label: 'All', value: 'ALL' }, { label: 'Critical', value: 'CRITICAL' }, { label: 'Warning', value: 'WARNING' }, { label: 'Info', value: 'INFO' }]} value={sev} onChange={setSev} style={{ marginBottom: S.md }} />
      {list.length === 0 ? (
        <EmptyState icon="checkmark-done-outline" title="No errors recorded" />
      ) : (
        <GlassCard style={{ paddingVertical: S.xs }}>
          {list.map((r, i) => (
            <View key={r.key}>
              {i > 0 && <Divider />}
              <ListRow
                icon="alert-circle"
                color={severityColor(r.severity)}
                title={`${r.kind === 'error' ? 'E' : 'W'}${r.code} · ${r.title}`}
                subtitle={`First ${fmtDateTime(r.firstSeen)} · last ${fmtDateTime(r.lastSeen)} · ×${r.occurrences}`}
                right={r.active ? <Badge text="ACTIVE" color={C.red} /> : undefined}
              />
            </View>
          ))}
        </GlassCard>
      )}
    </>
  );
}

function Battery() {
  const rides = useRides((s) => s.rides);
  const withBatt = rides.filter((r) => r.batteryStart != null && r.batteryEnd != null).sort((a, b) => a.start - b.start);
  const perKm = withBatt.filter((r) => r.distanceKm > 0.5).map((r) => ({ t: r.start, v: (r.batteryStart! - r.batteryEnd!) / r.distanceKm }));
  const whKm = rides.filter((r) => r.energyWh != null && r.distanceKm > 0.5).sort((a, b) => a.start - b.start).map((r) => ({ t: r.start, v: r.energyWh! / r.distanceKm }));
  const total = withBatt.reduce((a, r) => a + (r.batteryStart! - r.batteryEnd!), 0);
  const u = useUnits();
  return (
    <>
      <GlassCard>
        <KeyValue label="Rides with battery data" value={String(withBatt.length)} />
        <KeyValue label="Total battery used" value={`${total}%`} />
        <KeyValue label="Average per ride" value={withBatt.length ? `${(total / withBatt.length).toFixed(1)}%` : 'Not available'} />
      </GlassCard>
      <GlassCard>
        <Text style={F.label}>Battery % per {u.distLabel}</Text>
        <View style={{ height: 8 }} />
        <LineChart data={perKm.map((p) => ({ t: p.t, v: u.distanceUnit === 'mi' ? p.v * 1.609344 : p.v }))} color={C.green} unit="%" emptyText="Needs rides with battery and distance" />
      </GlassCard>
      <GlassCard>
        <Text style={F.label}>Energy Wh per {u.distLabel}</Text>
        <View style={{ height: 8 }} />
        <LineChart data={whKm.map((p) => ({ t: p.t, v: u.distanceUnit === 'mi' ? p.v * 1.609344 : p.v }))} color={C.cyan} unit=" Wh" emptyText="Needs scooter voltage and current" />
      </GlassCard>
    </>
  );
}

function Service() {
  const items = useMaintenance((s) => s.items);
  const scooters = useGarage((s) => s.scooters);
  const events = items.flatMap((i) => i.history.map((h) => ({ ...h, item: i.name, scooter: scooters.find((s) => s.id === i.scooterId)?.nickname ?? '' }))).sort((a, b) => b.date - a.date);
  if (!events.length) return <EmptyState icon="construct-outline" title="No service logged" body="Log work from the Maintenance screen." />;
  return (
    <GlassCard style={{ paddingVertical: S.xs }}>
      {events.map((e, i) => (
        <View key={e.id}>
          {i > 0 && <Divider />}
          <ListRow icon="checkmark-circle" color={C.green} title={`${e.item} · ${e.scooter}`} subtitle={`${fmtDate(e.date)}${e.odometerKm != null ? ` · ${e.odometerKm.toFixed(0)} km` : ''}${e.notes ? ` · ${e.notes}` : ''}`} />
        </View>
      ))}
    </GlassCard>
  );
}
