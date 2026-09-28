import { LinearGradient } from 'expo-linear-gradient';
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { LatLng, Polyline } from 'react-native-maps';
import { HEAT_BATTERY_WINDOW_KM, HeatMetric, buildHeatSegments } from '../services/rideAnalysis';
import { useRides } from '../store/rides';
import { DataTag } from '../ui/components/DataTag';
import { EmptyState, GlassCard, NeonButton, Note, Segmented } from '../ui/components/Glass';
import { DARK_MAP_STYLE, RAMP, rampColor } from '../ui/components/RouteMap';
import { Screen } from '../ui/components/Screen';
import { C, F, R, S } from '../ui/theme';
import { useUnits } from '../utils/format';

const STEPS = 12;
const METRICS: { label: string; value: HeatMetric }[] = [
  { label: 'Speed', value: 'speed' },
  { label: 'Battery', value: 'battery' },
  { label: 'Elevation', value: 'elevation' },
  { label: 'Temp', value: 'temperature' },
  { label: 'Power', value: 'power' },
];

interface Run { key: string; coords: LatLng[]; color: string }

export default function RouteHeatmap() {
  const [shown, setShown] = useState(false);
  const rideCount = useRides((s) => s.rides.length);
  if (!rideCount) {
    return (
      <Screen contentStyle={{ paddingTop: 110 }}>
        <EmptyState icon="map-outline" title="No rides yet" body="Recorded rides with GPS appear here as a personal heatmap." />
      </Screen>
    );
  }
  if (!shown) {
    return (
      <Screen contentStyle={{ paddingTop: 110 }}>
        <EmptyState icon="flame-outline" title="Your personal route heatmap" body="Draws every route you've recorded on one map, coloured by speed, battery use, elevation, temperature or power.">
          <Note icon="lock-closed-outline">
            Your route data stays on this phone. Nothing is uploaded or shared unless you export it yourself.
          </Note>
          <NeonButton title="Show my routes" icon="eye-outline" style={{ marginTop: S.lg }} onPress={() => setShown(true)} />
        </EmptyState>
      </Screen>
    );
  }
  return <Heatmap onHide={() => setShown(false)} />;
}

function Heatmap({ onHide }: { onHide: () => void }) {
  const rides = useRides((s) => s.rides);
  const u = useUnits();
  const [metric, setMetric] = useState<HeatMetric>('speed');

  const heat = useMemo(() => buildHeatSegments(rides, metric, 3000), [rides, metric]);

  // Merge consecutive segments of the same ride and quantised colour into one polyline.
  const runs = useMemo(() => {
    const out: Run[] = [];
    let cur: Run | null = null;
    let curRide = '';
    let curStep = -1;
    let last: { lat: number; lon: number } | null = null;
    const span = heat.hi - heat.lo;
    heat.segments.forEach((sg, i) => {
      const f = span < 1e-9 ? 0.5 : (sg.v - heat.lo) / span;
      const step = Math.round(Math.max(0, Math.min(1, f)) * STEPS);
      const contiguous = cur && curRide === sg.rideId && curStep === step && last && last.lat === sg.a.lat && last.lon === sg.a.lon;
      if (contiguous) cur!.coords.push({ latitude: sg.b.lat, longitude: sg.b.lon });
      else {
        cur = { key: `${sg.rideId}-${i}`, coords: [{ latitude: sg.a.lat, longitude: sg.a.lon }, { latitude: sg.b.lat, longitude: sg.b.lon }], color: rampColor(step / STEPS) };
        out.push(cur);
      }
      curRide = sg.rideId;
      curStep = step;
      last = sg.b;
    });
    return out;
  }, [heat]);

  // Bounds from every ride's GPS points (so the map frames all routes even when a metric has no data).
  const region = useMemo(() => {
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const r of rides)
      for (const p of r.points) {
        if (p.lat == null || p.lon == null) continue;
        minLat = Math.min(minLat, p.lat);
        maxLat = Math.max(maxLat, p.lat);
        minLon = Math.min(minLon, p.lon);
        maxLon = Math.max(maxLon, p.lon);
      }
    if (!Number.isFinite(minLat)) return null;
    return { latitude: (minLat + maxLat) / 2, longitude: (minLon + maxLon) / 2, latitudeDelta: Math.max(0.01, (maxLat - minLat) * 1.3), longitudeDelta: Math.max(0.01, (maxLon - minLon) * 1.3) };
  }, [rides]);

  const perDist = (v: number) => (u.distanceUnit === 'mi' ? v * 1.609344 : v);
  const fmtV = (v: number) => {
    switch (metric) {
      case 'speed':
        return `${u.speed(v).toFixed(1)} ${u.speedLabel}`;
      case 'battery':
        return `${perDist(v).toFixed(1)} %/${u.distLabel}`;
      case 'elevation':
        return `${v.toFixed(0)} m`;
      case 'temperature':
        return `${u.temp(v).toFixed(0)}${u.tempLabel}`;
      case 'power':
        return `${v.toFixed(0)} W`;
    }
  };
  const legendTitle = {
    speed: 'Speed (scooter, else GPS)',
    battery: `Battery use (%/${u.distLabel})`,
    elevation: 'Elevation (GPS)',
    temperature: 'Highest scooter temperature',
    power: 'Power (scooter or V × I)',
  }[metric];
  const tag = {
    speed: <DataTag kind="measured" source="Scooter BLE" />,
    battery: <DataTag kind="calculated" source="Calculated" />,
    elevation: <DataTag kind="measured" source="Phone GPS" />,
    temperature: <DataTag kind="measured" source="Scooter BLE" />,
    power: <DataTag kind="measured" source="Scooter BLE" />,
  }[metric];
  const explain = {
    speed: 'Scooter-reported speed where recorded, otherwise phone GPS speed.',
    battery: `Battery % change divided by GPS distance over stretches of at least ${HEAT_BATTERY_WINDOW_KM} km (the battery reports in 1 % steps). Negative values mean the reported percentage rose.`,
    elevation: 'Phone GPS altitude, unfiltered.',
    temperature: 'The highest temperature any scooter sensor reported at that point.',
    power: 'Scooter-reported power where available, otherwise calculated from voltage × current.',
  }[metric];

  if (!region) {
    return (
      <Screen contentStyle={{ paddingTop: 110 }}>
        <EmptyState icon="navigate-outline" title="No GPS routes" body="None of your recorded rides has GPS positions." />
      </Screen>
    );
  }

  return (
    <Screen contentStyle={{ paddingTop: 110 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: S.sm }}>
        <Segmented options={METRICS} value={metric} onChange={setMetric} style={{ minWidth: 360 }} />
      </ScrollView>
      <View style={styles.mapBox}>
        <MapView style={StyleSheet.absoluteFill} initialRegion={region} customMapStyle={DARK_MAP_STYLE} userInterfaceStyle="dark" toolbarEnabled={false}>
          {runs.map((r) => (
            <Polyline key={r.key} coordinates={r.coords} strokeColor={r.color} strokeWidth={4} />
          ))}
        </MapView>
        {heat.segments.length > 0 && (
          <View style={styles.legend} pointerEvents="none">
            <Text style={styles.legendTitle}>{legendTitle}</Text>
            <LinearGradient colors={RAMP as unknown as [string, string, ...string[]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.legendBar} />
            <View style={styles.legendRow}>
              <Text style={styles.legendText}>{fmtV(heat.lo)}</Text>
              <Text style={styles.legendText}>{fmtV(heat.hi)}</Text>
            </View>
          </View>
        )}
        {heat.segments.length === 0 && (
          <View style={styles.noData} pointerEvents="none">
            <Text style={{ color: C.text, fontWeight: '700' }}>Not recorded</Text>
            <Text style={{ color: C.textDim, fontSize: 12 }}>None of your GPS routes has {legendTitle.toLowerCase()} data.</Text>
          </View>
        )}
      </View>
      <GlassCard style={{ marginTop: S.md }}>
        <Text style={F.label}>{legendTitle}</Text>
        {tag}
        <Note>{explain}</Note>
        <Note>
          {heat.ridesUsed} ride{heat.ridesUsed === 1 ? '' : 's'} with GPS
          {heat.ridesWithoutGps ? `, ${heat.ridesWithoutGps} without GPS not shown` : ''}. Colours show position between the lowest and highest value in your own data, not good or bad.
          {heat.stride > 1 ? ` To keep the map fast, every ${heat.stride}th GPS point is used.` : ''} Parts without data for this value are left out.
        </Note>
        <Note icon="lock-closed-outline">Your route data stays on this phone and is never shared unless you export it.</Note>
      </GlassCard>
      <NeonButton title="Hide my routes" icon="eye-off-outline" variant="ghost" small onPress={onHide} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  mapBox: { height: 420, borderRadius: R.lg, overflow: 'hidden', borderWidth: 1, get borderColor() { return C.border; } },
  legend: { position: 'absolute', top: S.sm, right: S.sm, width: 170, backgroundColor: 'rgba(10,6,22,0.9)', borderRadius: R.sm, borderWidth: 1, get borderColor() { return C.border; }, padding: S.sm },
  legendTitle: { color: C.textDim, fontSize: 10.5, fontWeight: '700', marginBottom: 4 },
  legendBar: { height: 6, borderRadius: 3 },
  legendRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 3 },
  legendText: { color: C.text, fontSize: 10.5, fontVariant: ['tabular-nums'] },
  noData: { position: 'absolute', left: S.md, right: S.md, bottom: S.md, backgroundColor: 'rgba(10,6,22,0.9)', borderRadius: R.sm, padding: S.sm },
});
