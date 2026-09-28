import { router } from 'expo-router';
import React from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { discardRide, startRide, stopRide, useActiveRide } from '../../services/RideTracker';
import { pointSpeed, summarizeRide } from '../../services/rideMath';
import { useLive } from '../../store/live';
import { useRides } from '../../store/rides';
import { Badge, GlassCard, Grid, NeonButton, Note, SectionHeader, StatTile } from '../../ui/components/Glass';
import { RideSummary } from '../../ui/components/RideSummary';
import { RouteMap } from '../../ui/components/RouteMap';
import { Screen } from '../../ui/components/Screen';
import { useNow } from '../../ui/hooks';
import { C, S } from '../../ui/theme';
import { fmtDuration, useUnits } from '../../utils/format';

export default function RideScreen() {
  const active = useActiveRide((s) => s.active);
  const points = useActiveRide((s) => s.points);
  const start = useActiveRide((s) => s.start);
  const gpsOk = useActiveRide((s) => s.gpsOk);
  const last = useActiveRide((s) => s.lastSummary);
  const conn = useLive((s) => s.conn);
  const rides = useRides((s) => s.rides);
  const u = useUnits();
  const now = useNow();
  const live = active && start ? summarizeRide(points, start, now) : null;
  const lastP = points[points.length - 1];
  const speed = lastP ? pointSpeed(lastP) : null;

  return (
    <Screen topInset>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: S.md }}>
        <Text style={styles.title}>Ride Tracker</Text>
        {active && <Badge text="REC" color={C.red} icon="radio-button-on" />}
      </View>

      {!active ? (
        <>
          <GlassCard>
            <Text style={styles.sub}>Records GPS route, distance, time, speed, battery, energy, elevation, stops and temperatures.</Text>
            {conn !== 'connected' && <Note color={C.amber}>No scooter connected. The ride will use phone GPS only; scooter values will be "Not available".</Note>}
            <NeonButton title="Start Ride" icon="play" onPress={startRide} style={{ marginTop: S.lg }} />
          </GlassCard>
          <Note>Ride safely and follow local laws. Keep your eyes on the road, not the phone.</Note>
          {last && (
            <>
              <SectionHeader title="Last ride" icon="flag-outline" />
              <RouteMap routes={[{ id: last.id, points: last.points }]} height={260} />
              <View style={{ height: S.md }} />
              <RideSummary ride={last} />
            </>
          )}
          <NeonButton title={`Ride history (${rides.length})`} icon="list" variant="ghost" onPress={() => router.push('/history')} style={{ marginTop: S.lg }} />
        </>
      ) : (
        <>
          <GlassCard accent={C.red}>
            <Text style={styles.timer}>{fmtDuration(live?.durationSec ?? 0)}</Text>
            <Text style={styles.speed}>
              {speed != null ? u.speed(speed).toFixed(1) : '—'} <Text style={styles.unit}>{u.speedLabel}</Text>
            </Text>
            {!gpsOk && <Note color={C.amber}>Location permission unavailable. Route and GPS speed are not recorded.</Note>}
          </GlassCard>
          <Grid cols={2}>
            <StatTile label="Distance" text={live ? u.dist(live.distanceKm).toFixed(2) : null} unit={u.distLabel} />
            <StatTile label="Average" text={live?.avgSpeedKmh != null ? u.speed(live.avgSpeedKmh).toFixed(1) : null} unit={u.speedLabel} />
            <StatTile label="Max" text={live?.maxSpeedKmh != null ? u.speed(live.maxSpeedKmh).toFixed(1) : null} unit={u.speedLabel} />
            <StatTile label="Battery" text={live?.batteryStart != null ? `${live.batteryStart}% → ${live.batteryEnd}%` : null} />
            <StatTile label="Elevation gain" text={live?.elevationGainM != null ? `+${live.elevationGainM.toFixed(0)}` : null} unit="m" />
            <StatTile label="Stops" text={String(live?.stops ?? 0)} />
          </Grid>
          <View style={{ height: S.md }} />
          <RouteMap routes={[{ id: 'live', points }]} height={240} current={lastP?.lat != null ? { lat: lastP.lat, lon: lastP.lon! } : null} />
          <NeonButton
            title="Stop & save ride"
            icon="stop"
            onPress={() => stopRide()}
            style={{ marginTop: S.lg }}
          />
          <NeonButton
            title="Discard"
            variant="danger"
            small
            onPress={() => Alert.alert('Discard ride?', 'The recording will be deleted.', [{ text: 'Keep', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: discardRide }])}
            style={{ marginTop: S.md }}
          />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: C.text, fontSize: 30, fontWeight: '900', letterSpacing: -0.5 },
  sub: { color: C.textDim, fontSize: 14, lineHeight: 20 },
  timer: { color: C.text, fontSize: 48, fontWeight: '900', fontVariant: ['tabular-nums'], letterSpacing: -1 },
  speed: { get color() { return C.purpleLight; }, fontSize: 28, fontWeight: '800' },
  unit: { color: C.textDim, fontSize: 15 },
});
