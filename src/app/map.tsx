import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { GpsFix, currentPosition } from '../services/GPSManager';
import { useActiveRide } from '../services/RideTracker';
import { useRides } from '../store/rides';
import { GlassCard, KeyValue, Note, Segmented } from '../ui/components/Glass';
import { RouteMap } from '../ui/components/RouteMap';
import { Screen } from '../ui/components/Screen';
import { C, S } from '../ui/theme';
import { fmtDate, useUnits } from '../utils/format';

export default function MapScreen() {
  const rides = useRides((s) => s.rides);
  const active = useActiveRide((s) => s.active);
  const livePts = useActiveRide((s) => s.points);
  const [pos, setPos] = useState<GpsFix | null>(null);
  const [show, setShow] = useState<'current' | 'all'>(active ? 'current' : 'all');
  const [selected, setSelected] = useState<string | null>(null);
  const u = useUnits();
  useEffect(() => {
    currentPosition().then(setPos);
  }, []);
  const withGps = rides.filter((r) => r.points.some((p) => p.lat != null));
  // "Scooter location" = last GPS point recorded while connected to it (the scooters have no GPS of their own).
  const scooterAt = useMemo(() => {
    for (const r of rides) {
      const p = [...r.points].reverse().find((x) => x.lat != null && x.speedKmh != null);
      if (p) return { lat: p.lat!, lon: p.lon! };
    }
    return null;
  }, [rides]);
  const routes = show === 'current' ? [{ id: 'live', points: livePts }] : withGps.slice(0, 30).map((r) => ({ id: r.id, points: r.points, faded: selected != null && selected !== r.id }));
  const sel = rides.find((r) => r.id === selected);

  return (
    <Screen contentStyle={{ paddingTop: 110 }}>
      <Segmented options={[{ label: 'Current ride', value: 'current' }, { label: 'Previous rides', value: 'all' }]} value={show} onChange={setShow} style={{ marginBottom: S.md }} />
      <RouteMap routes={routes} height={420} current={pos ? { lat: pos.lat, lon: pos.lon } : null} scooterAt={scooterAt} onSelectRoute={setSelected} />
      {show === 'current' && !active && <Note>No ride is recording. Start one from the Ride tab.</Note>}
      <Note>Tap a route to see the speed, battery and temperature recorded at that point. The scooter marker is the last place a ride recorded scooter data; the scooters themselves have no GPS.</Note>
      {sel && (
        <Pressable onPress={() => router.push({ pathname: '/ride/[id]', params: { id: sel.id } })}>
          <GlassCard style={{ marginTop: S.md }} accent={C.borderStrong}>
            <Text style={{ color: C.text, fontWeight: '800', fontSize: 16 }}>Ride #{sel.number} · {fmtDate(sel.start)}</Text>
            <KeyValue label="Distance" value={u.dist(sel.distanceKm).toFixed(2)} unit={u.distLabel} />
            <KeyValue label="Max speed" value={sel.maxSpeedKmh != null ? u.speed(sel.maxSpeedKmh).toFixed(1) : 'Not available'} unit={u.speedLabel} />
            <Text style={{ color: C.purpleLight, fontWeight: '700', marginTop: 4 }}>Open ride ›</Text>
          </GlassCard>
        </Pressable>
      )}
      <View style={{ height: S.xl }} />
    </Screen>
  );
}
