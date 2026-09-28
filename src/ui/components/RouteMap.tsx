import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Circle, LatLng, Marker, Polyline } from 'react-native-maps';
import type { RidePoint } from '../../store/rides';
import { NA, fmtTime, useUnits } from '../../utils/format';
import { C, R, S, rgba } from '../theme';
import { pointPower, pointSpeed } from '../../services/rideMath';
import { useSettings } from '../../store/settings';

/** What the route line is coloured by. 'route' keeps the plain single-colour line. */
export type RouteMetric = 'route' | 'speed' | 'battery' | 'elevation' | 'temperature' | 'acceleration';

const METRICS: { value: RouteMetric; label: string }[] = [
  { value: 'route', label: 'Route' },
  { value: 'speed', label: 'Speed' },
  { value: 'battery', label: 'Battery' },
  { value: 'elevation', label: 'Elevation' },
  { value: 'temperature', label: 'Temp' },
  { value: 'acceleration', label: 'Accel' },
];

// Colour ramp relative to the route's own min..max. It encodes position in the range only, not good/bad.
export const RAMP = ['#3B82F6', '#22D3EE', '#34D399', '#FBBF24', '#F472B6'];
const STEPS = 12;

function hexToRgb(h: string) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rampColor(f: number) {
  const x = Math.max(0, Math.min(1, f)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const a = hexToRgb(RAMP[i]);
  const b = hexToRgb(RAMP[i + 1]);
  const k = x - i;
  const c = a.map((v, j) => Math.round(v + (b[j] - v) * k));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/** Acceleration (m/s², calculated) at each point from the speed change since the previous point with a speed. */
function accelerations(pts: RidePoint[]): (number | null)[] {
  const out: (number | null)[] = pts.map(() => null);
  let prev: { t: number; v: number } | null = null;
  pts.forEach((p, i) => {
    const v = pointSpeed(p);
    if (v == null) return;
    if (prev) {
      const dt = (p.t - prev.t) / 1000;
      // same window as the live acceleration series: consecutive samples 0.2 s to 5 s apart
      if (dt > 0.2 && dt < 5) out[i] = (v - prev.v) / 3.6 / dt;
    }
    prev = { t: p.t, v };
  });
  return out;
}

function metricValues(pts: RidePoint[], m: RouteMetric): (number | null)[] {
  switch (m) {
    case 'speed':
      return pts.map(pointSpeed);
    case 'battery':
      return pts.map((p) => p.battery);
    case 'elevation':
      return pts.map((p) => p.alt);
    case 'temperature':
      return pts.map((p) => p.tempC);
    case 'acceleration':
      return accelerations(pts);
    default:
      return pts.map(() => null);
  }
}

interface ColoredSeg { key: string; coords: LatLng[]; color: string }

/** Splits a route into runs of equal quantised colour so the map draws few polylines. */
function colorSegments(routeId: string, pts: RidePoint[], vals: (number | null)[], lo: number, hi: number): ColoredSeg[] {
  const segs: ColoredSeg[] = [];
  let cur: ColoredSeg | null = null;
  let curStep = -1;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const va = vals[i - 1];
    const vb = vals[i];
    if (a.lat == null || a.lon == null || b.lat == null || b.lon == null || (va == null && vb == null)) {
      cur = null;
      curStep = -1;
      continue;
    }
    const v = va != null && vb != null ? (va + vb) / 2 : (va ?? vb)!;
    const f = hi - lo < 1e-9 ? 0.5 : (v - lo) / (hi - lo);
    const step = Math.round(Math.max(0, Math.min(1, f)) * STEPS);
    const ca = { latitude: a.lat, longitude: a.lon };
    const cb = { latitude: b.lat, longitude: b.lon };
    if (cur && step === curStep) {
      cur.coords.push(cb);
    } else {
      cur = { key: `${routeId}-${i}`, coords: [ca, cb], color: rampColor(step / STEPS) };
      curStep = step;
      segs.push(cur);
    }
  }
  return segs;
}

// Dark Google Maps style (Android). iOS uses userInterfaceStyle="dark".
export const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#0f0b1e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8a84a8' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0b0816' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#241b40' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#070512' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
];

export interface MapRoute {
  id: string;
  points: RidePoint[];
  color?: string;
  faded?: boolean;
}

interface Props {
  routes: MapRoute[];
  height?: number;
  current?: { lat: number; lon: number } | null;
  scooterAt?: { lat: number; lon: number } | null;
  interactive?: boolean;
  onSelectRoute?: (id: string) => void;
  /** Initial colour-by metric (default 'route', the plain line). */
  colorBy?: RouteMetric;
  /** Show the Route/Speed/Battery/... selector above the map (default true when any route has GPS points). */
  showMetricPicker?: boolean;
  /** Optional position marker (e.g. ride timeline / replay cursor). Omit to keep the plain map. */
  cursor?: { lat: number; lon: number } | null;
  /** Keep the cursor marker in view by panning the map (throttled). */
  followCursor?: boolean;
}

/** Small scooter dot for the timeline cursor. Stops tracking view changes after first paint (Android perf). */
function CursorMarker({ at }: { at: { lat: number; lon: number } }) {
  const [track, setTrack] = useState(true);
  useEffect(() => {
    const h = setTimeout(() => setTrack(false), 800);
    return () => clearTimeout(h);
  }, []);
  return (
    <Marker coordinate={{ latitude: at.lat, longitude: at.lon }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={track} title="Position on timeline" zIndex={10}>
      <View style={styles.cursorOuter}>
        <View style={styles.cursorInner} />
      </View>
    </Marker>
  );
}

const coords = (pts: RidePoint[]): LatLng[] => pts.filter((p) => p.lat != null && p.lon != null).map((p) => ({ latitude: p.lat!, longitude: p.lon! }));

/** Map with ride routes. Tap near a route to see the telemetry recorded at that point. */
export function RouteMap({ routes, height = 300, current, scooterAt, interactive = true, onSelectRoute, colorBy = 'route', showMetricPicker = true, cursor, followCursor = false }: Props) {
  const u = useUnits();
  const ref = useRef<MapView>(null);
  const [sel, setSel] = useState<RidePoint | null>(null);
  const [selAccel, setSelAccel] = useState<number | null>(null);
  const [metric, setMetric] = useState<RouteMetric>(colorBy);
  const reduceMotion = useSettings((st) => st.reduceMotion);
  const lastFollow = useRef(0);
  useEffect(() => {
    if (!followCursor || !cursor) return;
    const now = Date.now();
    if (now - lastFollow.current < 1500) return;
    lastFollow.current = now;
    ref.current?.animateCamera({ center: { latitude: cursor.lat, longitude: cursor.lon } }, { duration: reduceMotion ? 0 : 600 });
  }, [followCursor, cursor, reduceMotion]);

  // Per-metric values for the highlighted (non-faded) routes, plus which metrics have any data at all.
  const metricData = useMemo(() => {
    const shown = routes.filter((r) => !r.faded);
    const avail: Record<RouteMetric, boolean> = { route: true, speed: false, battery: false, elevation: false, temperature: false, acceleration: false };
    (['speed', 'battery', 'elevation', 'temperature', 'acceleration'] as RouteMetric[]).forEach((m) => {
      avail[m] = shown.some((r) => metricValues(r.points, m).some((v, i) => v != null && r.points[i].lat != null));
    });
    return { shown, avail };
  }, [routes]);
  const activeMetric: RouteMetric = metricData.avail[metric] ? metric : 'route';

  const colored = useMemo(() => {
    if (activeMetric === 'route') return null;
    const per = metricData.shown.map((r) => ({ r, vals: metricValues(r.points, activeMetric) }));
    let lo = Infinity;
    let hi = -Infinity;
    per.forEach(({ r, vals }) =>
      vals.forEach((v, i) => {
        if (v == null || r.points[i].lat == null) return;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }),
    );
    if (!Number.isFinite(lo)) return null;
    return { lo, hi, segs: per.flatMap(({ r, vals }) => colorSegments(r.id, r.points, vals, lo, hi)) };
  }, [activeMetric, metricData]);
  const all = useMemo(() => routes.flatMap((r) => coords(r.points)), [routes]);
  const region = useMemo(() => {
    const src = all.length ? all : current ? [{ latitude: current.lat, longitude: current.lon }] : [];
    if (!src.length) return undefined;
    const lats = src.map((c) => c.latitude);
    const lons = src.map((c) => c.longitude);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLon = Math.min(...lons), maxLon = Math.max(...lons);
    return { latitude: (minLat + maxLat) / 2, longitude: (minLon + maxLon) / 2, latitudeDelta: Math.max(0.005, (maxLat - minLat) * 1.4), longitudeDelta: Math.max(0.005, (maxLon - minLon) * 1.4) };
  }, [all, current]);

  const onPress = (c: LatLng) => {
    let best: { p: RidePoint; d: number; route: string } | null = null;
    for (const r of routes) {
      for (const p of r.points) {
        if (p.lat == null || p.lon == null) continue;
        const d = (p.lat - c.latitude) ** 2 + (p.lon - c.longitude) ** 2;
        if (!best || d < best.d) best = { p, d, route: r.id };
      }
    }
    // ~100 m tolerance in degrees² at mid latitudes
    if (best && best.d < 1e-6) {
      const pts = routes.find((r) => r.id === best!.route)?.points ?? [];
      const idx = pts.indexOf(best.p);
      setSelAccel(idx >= 0 ? accelerations(pts)[idx] : null);
      setSel(best.p);
      onSelectRoute?.(best.route);
    } else setSel(null);
  };

  if (!region) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={{ color: C.textFaint }}>No GPS data</Text>
      </View>
    );
  }

  const speed = sel ? pointSpeed(sel) : null;
  const power = sel ? pointPower(sel) : null;
  const hasCoords = routes.some((r) => coords(r.points).length >= 2);
  const fmtMetric = (v: number) => {
    switch (activeMetric) {
      case 'speed':
        return `${u.speed(v).toFixed(1)} ${u.speedLabel}`;
      case 'battery':
        return `${v.toFixed(0)}%`;
      case 'elevation':
        return `${v.toFixed(0)} m`;
      case 'temperature':
        return `${u.temp(v).toFixed(0)}${u.tempLabel}`;
      case 'acceleration':
        return `${v.toFixed(2)} m/s²`;
      default:
        return '';
    }
  };
  const legendTitle =
    activeMetric === 'elevation' ? 'Elevation (GPS)' : activeMetric === 'acceleration' ? 'Acceleration (calculated)' : METRICS.find((m) => m.value === activeMetric)?.label ?? '';
  return (
    <View>
      {showMetricPicker && hasCoords && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={{ marginBottom: S.sm }}>
          {METRICS.map((m) => {
            const ok = metricData.avail[m.value];
            const on = activeMetric === m.value;
            return (
              <Pressable
                key={m.value}
                disabled={!ok}
                accessibilityRole="button"
                accessibilityState={{ selected: on, disabled: !ok }}
                accessibilityLabel={ok ? `Colour route by ${m.label}` : `${m.label}: ${NA}`}
                onPress={() => {
                  Haptics.selectionAsync().catch(() => undefined);
                  setMetric(m.value);
                }}
                style={[styles.chip, on && styles.chipOn, !ok && { opacity: 0.4 }]}
              >
                <Text style={[styles.chipText, on && { color: '#fff' }]}>{m.label}</Text>
                {!ok && <Text style={styles.chipNa}>NA</Text>}
              </Pressable>
            );
          })}
        </ScrollView>
      )}
      <View style={{ height, borderRadius: R.lg, overflow: 'hidden', borderWidth: 1, borderColor: C.border }}>
        <MapView
          ref={ref}
          style={StyleSheet.absoluteFill}
          initialRegion={region}
          customMapStyle={DARK_MAP_STYLE}
          userInterfaceStyle="dark"
          showsUserLocation={!!current}
          scrollEnabled={interactive}
          zoomEnabled={interactive}
          onPress={(e) => onPress(e.nativeEvent.coordinate)}
        >
          {routes.map((r) => {
            const c = coords(r.points);
            if (c.length < 2) return null;
            const byMetric = colored != null && !r.faded;
            return (
              <React.Fragment key={r.id}>
                {byMetric ? (
                  // thin base line keeps parts without data for this metric visible
                  <Polyline coordinates={c} strokeColor={rgba(C.purple, 0.3)} strokeWidth={3} />
                ) : (
                  <Polyline coordinates={c} strokeColor={r.faded ? rgba(C.purple, 0.35) : r.color ?? C.purple} strokeWidth={r.faded ? 3 : 5} />
                )}
                {!r.faded && <Marker coordinate={c[0]} pinColor="green" title="Start" />}
                {!r.faded && <Marker coordinate={c[c.length - 1]} pinColor="violet" title="End" />}
              </React.Fragment>
            );
          })}
          {colored?.segs.map((sg) => <Polyline key={sg.key} coordinates={sg.coords} strokeColor={sg.color} strokeWidth={6} />)}
          {scooterAt && <Marker coordinate={{ latitude: scooterAt.lat, longitude: scooterAt.lon }} title="Scooter (last known)" pinColor="purple" />}
          {cursor && <CursorMarker at={cursor} />}
          {sel && sel.lat != null && sel.lon != null && <Circle center={{ latitude: sel.lat, longitude: sel.lon }} radius={8} fillColor={C.cyan} strokeColor="#fff" />}
        </MapView>
        {colored && (
          <View style={styles.legend} pointerEvents="none">
            <Text style={styles.legendTitle}>{legendTitle}</Text>
            <LinearGradient colors={RAMP as unknown as [string, string, ...string[]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.legendBar} />
            <View style={styles.legendRow}>
              <Text style={styles.legendText}>{fmtMetric(colored.lo)}</Text>
              <Text style={styles.legendText}>{fmtMetric(colored.hi)}</Text>
            </View>
          </View>
        )}
        {sel && (
          <Pressable style={styles.callout} onPress={() => setSel(null)} accessibilityLabel="Close point details">
            <Text style={styles.cTitle}>At this point · {fmtTime(sel.t)}</Text>
            <Text style={styles.cLine}>Speed: {speed != null ? `${u.speed(speed).toFixed(1)} ${u.speedLabel}` : NA}</Text>
            <Text style={styles.cLine}>Battery: {sel.battery != null ? `${sel.battery}%` : NA}</Text>
            <Text style={styles.cLine}>Power: {power != null ? `${power.toFixed(0)} W (calculated)` : NA}</Text>
            <Text style={styles.cLine}>Temperature: {sel.tempC != null ? `${u.temp(sel.tempC).toFixed(0)}${u.tempLabel}` : NA}</Text>
            <Text style={styles.cLine}>Elevation (GPS): {sel.alt != null ? `${sel.alt.toFixed(0)} m` : NA}</Text>
            <Text style={styles.cLine}>Acceleration: {selAccel != null ? `${selAccel.toFixed(2)} m/s² (calculated)` : NA}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { borderRadius: R.lg, borderWidth: 1, get borderColor() { return C.border; }, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  callout: { position: 'absolute', left: S.md, bottom: S.md, backgroundColor: 'rgba(10,6,22,0.94)', borderRadius: R.md, borderWidth: 1, get borderColor() { return C.borderStrong; }, padding: S.md },
  cTitle: { get color() { return C.purpleLight; }, fontWeight: '800', marginBottom: 4 },
  cLine: { color: C.text, fontSize: 13.5, fontVariant: ['tabular-nums'] },
  chips: { gap: 6, paddingRight: S.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 7, borderRadius: R.pill, borderWidth: 1, backgroundColor: 'rgba(255,255,255,0.05)', get borderColor() { return C.border; } },
  chipOn: { get backgroundColor() { return C.violet; }, get borderColor() { return C.purple; } },
  chipText: { color: C.textDim, fontWeight: '700', fontSize: 12.5 },
  chipNa: { color: C.textFaint, fontSize: 9.5, fontWeight: '700' },
  cursorOuter: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(34,211,238,0.3)', alignItems: 'center', justifyContent: 'center' },
  cursorInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: C.cyan, borderWidth: 2, borderColor: '#fff' },
  legend: { position: 'absolute', top: S.sm, right: S.sm, width: 150, backgroundColor: 'rgba(10,6,22,0.9)', borderRadius: R.sm, borderWidth: 1, get borderColor() { return C.border; }, padding: S.sm },
  legendTitle: { color: C.textDim, fontSize: 10.5, fontWeight: '700', marginBottom: 4 },
  legendBar: { height: 6, borderRadius: 3 },
  legendRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 3 },
  legendText: { color: C.text, fontSize: 10.5, fontVariant: ['tabular-nums'] },
});
