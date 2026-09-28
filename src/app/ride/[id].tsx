import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { AnalysisUnits, analyzeRide } from '../../services/rideAnalysis';
import { Ride, useRides } from '../../store/rides';
import { DataTag } from '../../ui/components/DataTag';
import { EmptyState, GlassCard, NeonButton, Note, SectionHeader } from '../../ui/components/Glass';
import { RideSummary } from '../../ui/components/RideSummary';
import { CursorInfo, RideTimeline } from '../../ui/components/RideTimeline';
import { RouteMap } from '../../ui/components/RouteMap';
import { Screen } from '../../ui/components/Screen';
import { TemperatureHistory } from '../../ui/components/TemperatureHistory';
import { C, S } from '../../ui/theme';
import { useUnits } from '../../utils/format';

/** Map + synchronized timeline. Holds the cursor state locally so dragging doesn't re-render the whole screen. */
function MapWithTimeline({ ride }: { ride: Ride }) {
  const routes = useMemo(() => [{ id: ride.id, points: ride.points }], [ride.id, ride.points]);
  const [cursor, setCursor] = useState<CursorInfo | null>(null);
  const onChange = useCallback((c: CursorInfo) => setCursor(c), []);
  return (
    <>
      <RouteMap routes={routes} height={300} cursor={cursor?.position ?? null} />
      <SectionHeader title="Timeline" icon="time-outline" />
      <GlassCard>
        <RideTimeline ride={ride} onChange={onChange} />
        {cursor && !cursor.position && ride.points.some((p) => p.lat != null) && <Note>No GPS fix at this moment, so the map marker is hidden.</Note>}
      </GlassCard>
    </>
  );
}

function RideAnalysis({ ride }: { ride: Ride }) {
  const u = useUnits();
  const items = useMemo(() => {
    const units: AnalysisUnits = {
      speed: (v) => `${u.speed(v).toFixed(1)} ${u.speedLabel}`,
      dist: (v) => `${u.dist(v).toFixed(2)} ${u.distLabel}`,
      temp: (c) => `${u.temp(c).toFixed(0)}${u.tempLabel}`,
      distanceUnit: u.distanceUnit === 'mi' ? 'mi' : 'km',
    };
    return analyzeRide(ride, units);
  }, [ride, u.speedUnit, u.distanceUnit, u.tempUnit]);
  return (
    <GlassCard>
      {items.length ? (
        items.map((it) => (
          <View key={it.id} style={{ paddingVertical: 6 }}>
            <Text style={{ color: C.text, fontSize: 14, lineHeight: 20 }}>{it.text}</Text>
            <DataTag kind={it.kind} source={it.source} />
          </View>
        ))
      ) : (
        <Text style={{ color: C.textFaint }}>Not enough recorded data for an analysis of this ride.</Text>
      )}
      <Note>Based only on values recorded during this ride. It doesn't judge the scooter's mechanical or battery condition.</Note>
    </GlassCard>
  );
}

export default function RideDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ride = useRides((s) => s.rides.find((r) => r.id === id));
  const remove = useRides((s) => s.remove);
  if (!ride) return <Screen contentStyle={{ paddingTop: 110 }}><EmptyState icon="alert" title="Ride not found" /></Screen>;
  return (
    <Screen contentStyle={{ paddingTop: 110 }}>
      <MapWithTimeline ride={ride} />
      <View style={{ flexDirection: 'row', gap: S.sm, marginBottom: S.md }}>
        <NeonButton title="▶ Replay" small style={{ flex: 1 }} disabled={ride.points.length < 2} onPress={() => router.push({ pathname: '/replay/[id]', params: { id: ride.id } } as never)} />
        <NeonButton title="Compare" icon="git-compare-outline" variant="ghost" small style={{ flex: 1 }} onPress={() => router.push({ pathname: '/compare', params: { a: ride.id } } as never)} />
      </View>
      <RideSummary ride={ride} />
      <SectionHeader title="Temperature history" icon="thermometer-outline" />
      <TemperatureHistory ride={ride} />
      <SectionHeader title="Ride analysis" icon="bulb-outline" />
      <RideAnalysis ride={ride} />
      <NeonButton
        title="Delete ride"
        variant="danger"
        small
        style={{ marginTop: S.lg }}
        onPress={() => Alert.alert('Delete ride?', 'This cannot be undone.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => { remove(ride.id); router.back(); } }])}
      />
    </Screen>
  );
}
