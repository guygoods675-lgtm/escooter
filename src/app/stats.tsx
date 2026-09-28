import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { aggregate, insights, ridesInPeriod, rideWhPerKm, type Period } from '../services/stats';
import { useGarage } from '../store/garage';
import { useLive } from '../store/live';
import { useMaintenance } from '../store/maintenance';
import type { Ride } from '../store/rides';
import { useRides } from '../store/rides';
import { EmptyState, GlassCard, Grid, IconName, KeyValue, ListRow, Note, SectionHeader, Segmented } from '../ui/components/Glass';
import { AnimatedNumber, FadeIn } from '../ui/components/Motion';
import { Screen } from '../ui/components/Screen';
import { C, R, S, rgba } from '../ui/theme';
import { NA, fmtDate, fmtDuration, useUnits } from '../utils/format';

const PERIODS: { label: string; value: Period }[] = [
  { label: 'Today', value: 'today' },
  { label: 'Week', value: 'week' },
  { label: 'Month', value: 'month' },
  { label: 'Year', value: 'year' },
  { label: 'All', value: 'all' },
];

const PERIOD_TITLE: Record<Period, string> = { today: 'Today', week: 'This week', month: 'This month', year: 'This year', all: 'All time' };

/** Figures derived from the recorded rides (speed, energy, power) that go beyond plain sums. */
function extra(rides: Ride[]) {
  const moving = rides.filter((r) => r.movingSec > 0 && r.distanceKm > 0);
  const movingSec = moving.reduce((a, r) => a + r.movingSec, 0);
  const pw = rides.filter((r) => r.avgPowerW != null && r.durationSec > 0);
  const pwSec = pw.reduce((a, r) => a + r.durationSec, 0);
  const peaks = rides.map((r) => r.peakPowerW).filter((v): v is number => v != null);
  return {
    avgSpeedKmh: movingSec > 0 ? moving.reduce((a, r) => a + r.distanceKm, 0) / (movingSec / 3600) : null,
    avgPowerW: pwSec > 0 ? pw.reduce((a, r) => a + r.avgPowerW! * r.durationSec, 0) / pwSec : null,
    peakPowerW: peaks.length ? Math.max(...peaks) : null,
  };
}

function StatCard({ label, value, digits = 0, unit, text, note, icon, index }: { label: string; value?: number | null; digits?: number; unit?: string; text?: string; note?: string; icon: IconName; index: number }) {
  const has = text != null || (value != null && Number.isFinite(value));
  return (
    <FadeIn index={index}>
      <View style={{ backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: R.md, borderWidth: 1, borderColor: rgba(C.purple, 0.14), padding: S.md, minHeight: 86 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name={icon} size={13} color={C.purpleLight} />
          <Text style={{ color: C.textDim, fontSize: 11.5, fontWeight: '600', letterSpacing: 0.3, flexShrink: 1 }} numberOfLines={1}>{label}</Text>
        </View>
        {has ? (
          <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 6 }}>
            {text != null ? (
              <Text style={{ color: C.text, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{text}</Text>
            ) : (
              <AnimatedNumber value={value!} digits={digits} style={{ color: C.text, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] }} />
            )}
            {!!unit && <Text style={{ color: C.textDim, fontSize: 13, fontWeight: '600' }}> {unit}</Text>}
          </View>
        ) : (
          <Text style={{ color: C.textFaint, fontSize: 13, marginTop: 10 }}>{NA}</Text>
        )}
        {!!note && has && <Text style={{ color: C.textFaint, fontSize: 10, marginTop: 2 }}>{note}</Text>}
      </View>
    </FadeIn>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: R.pill, borderWidth: 1, borderColor: active ? C.purple : C.border, backgroundColor: active ? rgba(C.purple, 0.22) : 'transparent' }}
    >
      <Text style={{ color: active ? C.text : C.textDim, fontWeight: '700', fontSize: 12.5 }}>{label}</Text>
    </Pressable>
  );
}

export default function StatsScreen() {
  const allRides = useRides((s) => s.rides);
  const scooters = useGarage((s) => s.scooters);
  const items = useMaintenance((s) => s.items);
  const liveScooterId = useLive((s) => s.scooterId);
  const liveOdo = useLive((s) => s.snapshot?.odometerKm?.value ?? null);
  const u = useUnits();
  const [period, setPeriod] = useState<Period>('week');
  const [scooter, setScooter] = useState<string | null>(null);

  const rides = useMemo(() => (scooter ? allRides.filter((r) => r.scooterId === scooter) : allRides), [allRides, scooter]);
  const periodRides = useMemo(() => ridesInPeriod(rides, period), [rides, period]);
  const p = useMemo(() => aggregate(periodRides), [periodRides]);
  const px = useMemo(() => extra(periodRides), [periodRides]);
  const all = useMemo(() => aggregate(rides), [rides]);
  const list = useMemo(() => {
    const scopedItems = scooter ? items.filter((i) => i.scooterId === scooter) : items;
    const odometerFor = (id: string) => (id === liveScooterId && liveOdo != null ? liveOdo : scooters.find((s) => s.id === id)?.lastOdometerKm ?? null);
    return insights(rides, scopedItems, odometerFor, {
      dist: (km) => `${u.dist(km).toFixed(1)} ${u.distLabel}`,
      speed: (kmh) => `${u.speed(kmh).toFixed(1)} ${u.speedLabel}`,
    });
  }, [rides, items, scooter, scooters, liveScooterId, liveOdo, u]);

  if (!allRides.length) {
    return (
      <Screen contentStyle={{ paddingTop: 110 }}>
        <EmptyState icon="stats-chart-outline" title="No rides recorded yet" body="Statistics are built only from rides you record in Scooter Hub. Start a ride from the Ride tab." />
      </Screen>
    );
  }

  const effWh = all.mostEfficient ? rideWhPerKm(all.mostEfficient) : null;

  return (
    <Screen contentStyle={{ paddingTop: 110 }}>
      {scooters.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: S.sm, paddingBottom: S.md }}>
          <Chip label="All scooters" active={scooter == null} onPress={() => setScooter(null)} />
          {scooters.map((s) => (
            <Chip key={s.id} label={s.nickname} active={scooter === s.id} onPress={() => setScooter(s.id)} />
          ))}
        </ScrollView>
      )}
      <Segmented options={PERIODS} value={period} onChange={setPeriod} />

      <SectionHeader title={PERIOD_TITLE[period]} icon="calendar-outline" />
      {p.rides === 0 ? (
        <GlassCard>
          <Text style={{ color: C.textFaint }}>No rides recorded in this period.</Text>
        </GlassCard>
      ) : (
        <Grid cols={2}>
          <StatCard index={0} icon="navigate-outline" label="Distance" value={u.dist(p.distanceKm)} digits={1} unit={u.distLabel} />
          <StatCard index={1} icon="repeat-outline" label="Rides" value={p.rides} />
          <StatCard index={2} icon="time-outline" label="Ride time" text={fmtDuration(p.timeSec)} />
          <StatCard index={3} icon="flash-outline" label="Energy" value={p.energyWh} digits={0} unit="Wh" note={`calculated · ${p.energyRides} of ${p.rides} rides`} />
          <StatCard index={4} icon="leaf-outline" label="Avg consumption" value={p.avgWhPerKm} digits={1} unit="Wh/km" note="calculated" />
          <StatCard index={5} icon="speedometer-outline" label="Max speed" value={p.maxSpeedKmh != null ? u.speed(p.maxSpeedKmh) : null} digits={1} unit={u.speedLabel} />
          <StatCard index={6} icon="analytics-outline" label="Avg moving speed" value={px.avgSpeedKmh != null ? u.speed(px.avgSpeedKmh) : null} digits={1} unit={u.speedLabel} note="calculated" />
          <StatCard index={7} icon="pulse-outline" label="Avg power" value={px.avgPowerW} digits={0} unit="W" note="calculated" />
          <StatCard index={8} icon="trending-up-outline" label="Peak power" value={px.peakPowerW} digits={0} unit="W" note="calculated" />
          <StatCard index={9} icon="battery-half-outline" label="Battery used" value={p.batteryUsedPct} digits={0} unit="%" note="sum of ride start − end" />
        </Grid>
      )}
      <Note>Energy and power are calculated from the voltage and current the scooter reported during each ride; rides without those readings are left out.</Note>

      <SectionHeader title="All-time records" icon="trophy-outline" />
      <FadeIn index={2}>
        <GlassCard>
          <KeyValue label="Total distance" value={u.dist(all.distanceKm).toFixed(1)} unit={u.distLabel} />
          <KeyValue label="Total rides" value={String(all.rides)} />
          <KeyValue label="Total ride time" value={fmtDuration(all.timeSec)} />
          <KeyValue label="Total energy" value={all.energyWh != null ? all.energyWh.toFixed(0) : NA} unit="Wh" note={all.energyWh != null ? `calculated · ${all.energyRides} rides with data` : undefined} />
          <KeyValue label="Maximum speed" value={all.maxSpeedKmh != null ? u.speed(all.maxSpeedKmh).toFixed(1) : NA} unit={u.speedLabel} />
          <ListRow
            icon="trail-sign-outline"
            title="Longest ride"
            subtitle={all.longest ? `${u.dist(all.longest.distanceKm).toFixed(2)} ${u.distLabel} · ${fmtDate(all.longest.start)} · ride #${all.longest.number}` : NA}
            onPress={all.longest ? () => router.push(`/ride/${all.longest!.id}`) : undefined}
          />
          <ListRow
            icon="leaf-outline"
            color={C.green}
            title="Most efficient ride"
            subtitle={all.mostEfficient && effWh != null ? `${effWh.toFixed(1)} Wh/km (calculated) · ${u.dist(all.mostEfficient.distanceKm).toFixed(2)} ${u.distLabel} · ${fmtDate(all.mostEfficient.start)}` : `${NA} (needs rides of 0.5 km+ with energy data)`}
            onPress={all.mostEfficient ? () => router.push(`/ride/${all.mostEfficient!.id}`) : undefined}
          />
        </GlassCard>
      </FadeIn>

      <SectionHeader title="Insights" icon="bulb-outline" />
      {list.length ? (
        <GlassCard>
          {list.map((i, idx) => (
            <FadeIn key={i.id} index={idx}>
              <View style={{ flexDirection: 'row', gap: S.md, paddingVertical: S.sm, alignItems: 'flex-start' }}>
                <Ionicons name={i.icon as IconName} size={18} color={i.tone === 'attention' ? C.amber : i.tone === 'good' ? C.green : C.purpleLight} style={{ marginTop: 1 }} />
                <Text style={{ color: C.text, fontSize: 14, lineHeight: 20, flex: 1 }}>{i.text}</Text>
              </View>
            </FadeIn>
          ))}
        </GlassCard>
      ) : (
        <GlassCard>
          <Text style={{ color: C.textFaint }}>Record a few more rides to see insights.</Text>
        </GlassCard>
      )}
      <Note>All statistics come from rides recorded on this phone.</Note>
    </Screen>
  );
}
