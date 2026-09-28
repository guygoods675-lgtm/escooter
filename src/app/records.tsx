import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { Text } from 'react-native';
import { RecordKey, computeRecords } from '../services/records';
import { useRides } from '../store/rides';
import { DataTag, DataSource } from '../ui/components/DataTag';
import { EmptyState, GlassCard, IconName, ListRow, Note, SectionHeader } from '../ui/components/Glass';
import { FadeIn } from '../ui/components/Motion';
import { Screen } from '../ui/components/Screen';
import { C, S } from '../ui/theme';
import { NA, fmtDate, fmtDuration, useUnits } from '../utils/format';

type U = ReturnType<typeof useUnits>;

const ROWS: { key: RecordKey; title: string; icon: IconName; format: (v: number, u: U) => string; kind: 'measured' | 'calculated'; source: DataSource }[] = [
  { key: 'longestDuration', title: 'Longest ride (duration)', icon: 'time-outline', format: (v) => fmtDuration(v), kind: 'measured', source: 'Ride history' },
  { key: 'longestDistance', title: 'Longest distance', icon: 'map-outline', format: (v, u) => `${u.dist(v).toFixed(2)} ${u.distLabel}`, kind: 'measured', source: 'Ride history' },
  { key: 'longestMoving', title: 'Longest riding (moving) time', icon: 'hourglass-outline', format: (v) => fmtDuration(v), kind: 'calculated', source: 'Ride history' },
  { key: 'mostEnergy', title: 'Most energy in one ride', icon: 'flash-outline', format: (v) => `${v.toFixed(1)} Wh`, kind: 'calculated', source: 'Ride history' },
  { key: 'lowestWhPerKm', title: 'Lowest consumption (Wh/km, rides ≥ 1 km)', icon: 'leaf-outline', format: (v, u) => (u.distanceUnit === 'mi' ? `${(v * 1.609344).toFixed(1)} Wh/mi` : `${v.toFixed(1)} Wh/km`), kind: 'calculated', source: 'Ride history' },
  { key: 'highestElevationGain', title: 'Highest elevation gain', icon: 'trending-up-outline', format: (v) => `${v.toFixed(0)} m`, kind: 'measured', source: 'Phone GPS' },
  { key: 'highestSpeed', title: 'Highest recorded speed', icon: 'speedometer-outline', format: (v, u) => `${u.speed(v).toFixed(1)} ${u.speedLabel}`, kind: 'measured', source: 'Ride history' },
  { key: 'highestAvgSpeed', title: 'Highest average speed', icon: 'analytics-outline', format: (v, u) => `${u.speed(v).toFixed(1)} ${u.speedLabel}`, kind: 'calculated', source: 'Ride history' },
];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function RecordsScreen() {
  const rides = useRides((s) => s.rides);
  const u = useUnits();
  const rec = useMemo(() => computeRecords(rides), [rides]);

  if (!rides.length) {
    return (
      <Screen contentStyle={{ paddingTop: 110 }}>
        <EmptyState icon="podium-outline" title="No rides recorded yet" body="Personal records are worked out from the rides you record. Each one links to the ride it comes from." />
      </Screen>
    );
  }

  const open = (id: string) => router.push(`/ride/${id}`);
  const month = rec.mostDistanceMonth;

  return (
    <Screen contentStyle={{ paddingTop: 110 }}>
      <Text style={{ color: C.textDim, fontSize: 13, lineHeight: 19, marginBottom: S.sm }}>
        From your {rides.length} recorded ride{rides.length === 1 ? '' : 's'}. Tap a record to open its ride.
      </Text>
      <GlassCard>
        {ROWS.map((row, i) => {
          const r = rec[row.key];
          return (
            <FadeIn key={row.key} index={i}>
              <ListRow
                icon={row.icon}
                title={row.title}
                subtitle={r ? `${row.format(r.value, u)} · Ride #${r.ride.number} · ${fmtDate(r.ride.start)}` : `${NA} (no ride recorded this value)`}
                onPress={r ? () => open(r.ride.id) : undefined}
                right={r ? <DataTag kind={row.kind} source={row.source} compact /> : undefined}
              />
            </FadeIn>
          );
        })}
      </GlassCard>

      <SectionHeader title="Most distance in one month" icon="calendar-outline" />
      {month ? (
        <GlassCard>
          <Text style={{ color: C.text, fontSize: 20, fontWeight: '800' }}>
            {MONTHS[month.month]} {month.year}
          </Text>
          <Text style={{ color: C.textDim, fontSize: 13, marginTop: 2 }}>
            {u.dist(month.distanceKm).toFixed(1)} {u.distLabel} in {month.rides.length} ride{month.rides.length === 1 ? '' : 's'}
          </Text>
          <DataTag kind="calculated" source="Ride history" />
          {month.rides.map((r) => (
            <ListRow
              key={r.id}
              icon="bicycle-outline"
              title={`Ride #${r.number} · ${fmtDate(r.start)}`}
              subtitle={`${u.dist(r.distanceKm).toFixed(2)} ${u.distLabel} · ${fmtDuration(r.durationSec)}`}
              onPress={() => open(r.id)}
            />
          ))}
        </GlassCard>
      ) : (
        <Note>{NA}: no ride recorded any distance yet.</Note>
      )}
      <Note>
        Speeds come from the scooter (or phone GPS when the scooter doesn't report speed) and are shown as a record of your data only. Consumption needs rides where the scooter reported both voltage and current.
      </Note>
    </Screen>
  );
}
