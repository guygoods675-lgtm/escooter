import React, { useMemo, useState } from 'react';
import { GestureResponderEvent, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { TEMP_LABEL, TempSensor, powerOf, speedOf, tempOf, tempSensors } from '../../services/rideAnalysis';
import type { Ride, RidePoint } from '../../store/rides';
import { fmtDuration, fmtTime, useUnits } from '../../utils/format';
import { C, F, R, S } from '../theme';
import { DataTag } from './DataTag';
import { GlassCard, Note } from './Glass';

const MAX_DRAW = 300;
/** Samples further apart than this are not joined by a line. */
const GAP_MS = 10000;

interface Sample { t: number; v: number; i: number }

const SENSOR_COLOR: Record<TempSensor, string> = { motor: '#F472B6', controller: '#FBBF24', battery: '#34D399', legacy: '#FB923C' };

/** Small tappable SVG line chart (LineChart has no touch support). Draws only real samples. */
function TapChart({ data, color, height = 120, selected, onSelect, t0, t1, fmtV }: {
  data: Sample[]; color: string; height?: number; selected: Sample | null; onSelect: (s: Sample | null) => void; t0: number; t1: number; fmtV: (v: number) => string;
}) {
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  const pad = { l: 34, r: 6, t: 6, b: 6 };
  const geo = useMemo(() => {
    if (w <= 0 || data.length < 1) return null;
    let lo = Infinity;
    let hi = -Infinity;
    for (const d of data) {
      lo = Math.min(lo, d.v);
      hi = Math.max(hi, d.v);
    }
    if (hi - lo < 2) {
      lo -= 1;
      hi += 1;
    }
    const span = Math.max(1, t1 - t0);
    const x = (t: number) => pad.l + ((t - t0) / span) * (w - pad.l - pad.r);
    const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (height - pad.t - pad.b);
    // Draw a reduced set (min/max per bucket keeps peaks); taps still resolve to raw samples.
    let draw = data;
    if (data.length > MAX_DRAW) {
      const bucket = Math.ceil(data.length / (MAX_DRAW / 2));
      draw = [];
      for (let k = 0; k < data.length; k += bucket) {
        const sl = data.slice(k, k + bucket);
        let mn = sl[0];
        let mx = sl[0];
        for (const s of sl) {
          if (s.v < mn.v) mn = s;
          if (s.v > mx.v) mx = s;
        }
        if (mn === mx) draw.push(mn);
        else draw.push(...(mn.t < mx.t ? [mn, mx] : [mx, mn]));
      }
    }
    let path = '';
    let prev: Sample | null = null;
    for (const d of draw) {
      const cmd = !prev || d.t - prev.t > GAP_MS * Math.max(1, data.length / MAX_DRAW) ? 'M' : 'L';
      path += `${cmd}${x(d.t).toFixed(1)},${y(d.v).toFixed(1)}`;
      prev = d;
    }
    return { x, y, lo, hi, path, single: data.length === 1 };
  }, [w, data, height, t0, t1, pad.l, pad.r, pad.t, pad.b]);

  const onPress = (e: GestureResponderEvent) => {
    if (!geo || !data.length) return;
    const px = e.nativeEvent.locationX;
    const t = t0 + ((px - pad.l) / Math.max(1, w - pad.l - pad.r)) * (t1 - t0);
    let lo = 0;
    let hi = data.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (data[mid].t < t) lo = mid + 1;
      else hi = mid;
    }
    const best = lo > 0 && Math.abs(data[lo - 1].t - t) < Math.abs(data[lo].t - t) ? data[lo - 1] : data[lo];
    onSelect(best);
  };

  return (
    <Pressable onPress={onPress} onLayout={onLayout} style={{ height }} accessibilityRole="button" accessibilityLabel="Temperature graph, tap a point for details">
      {geo && (
        <Svg width={w} height={height} pointerEvents="none">
          <Line x1={pad.l} x2={w - pad.r} y1={pad.t} y2={pad.t} stroke="rgba(255,255,255,0.06)" />
          <Line x1={pad.l} x2={w - pad.r} y1={height - pad.b} y2={height - pad.b} stroke="rgba(255,255,255,0.06)" />
          {geo.single ? <Circle cx={geo.x(data[0].t)} cy={geo.y(data[0].v)} r={3} fill={color} /> : <Path d={geo.path} stroke={color} strokeWidth={2} fill="none" />}
          {selected && (
            <>
              <Line x1={geo.x(selected.t)} x2={geo.x(selected.t)} y1={pad.t} y2={height - pad.b} stroke="rgba(255,255,255,0.35)" strokeDasharray="3,3" />
              <Circle cx={geo.x(selected.t)} cy={geo.y(selected.v)} r={5} fill={color} stroke="#fff" strokeWidth={2} />
            </>
          )}
        </Svg>
      )}
      {geo && (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Text style={[styles.axis, { top: 0 }]}>{fmtV(geo.hi)}</Text>
          <Text style={[styles.axis, { bottom: 0 }]}>{fmtV(geo.lo)}</Text>
        </View>
      )}
    </Pressable>
  );
}

function SensorGraph({ ride, sensor, t0, t1 }: { ride: Ride; sensor: TempSensor; t0: number; t1: number }) {
  const u = useUnits();
  const [sel, setSel] = useState<Sample | null>(null);
  const data = useMemo(() => {
    const out: Sample[] = [];
    ride.points.forEach((p, i) => {
      const v = tempOf(p, sensor);
      if (v != null && Number.isFinite(v)) out.push({ t: p.t, v: u.temp(v), i });
    });
    return out;
  }, [ride.points, sensor, u.tempUnit]);
  const stats = useMemo(() => {
    if (!data.length) return null;
    let max = -Infinity;
    let sum = 0;
    for (const d of data) {
      max = Math.max(max, d.v);
      sum += d.v;
    }
    return { last: data[data.length - 1].v, max, avg: sum / data.length };
  }, [data]);
  const fmtV = (v: number) => `${v.toFixed(0)}${u.tempLabel}`;
  const color = SENSOR_COLOR[sensor];
  const p: RidePoint | null = sel ? ride.points[sel.i] : null;
  const sp = p ? speedOf(p) : null;
  const pw = p ? powerOf(p) : null;
  return (
    <GlassCard>
      <Text style={F.label}>{TEMP_LABEL[sensor]}</Text>
      {stats ? (
        <>
          <View style={styles.stats}>
            <Stat label="Last" value={fmtV(stats.last)} />
            <Stat label="Max" value={fmtV(stats.max)} />
            <Stat label="Average" value={fmtV(stats.avg)} />
          </View>
          <DataTag kind="measured" source="Scooter BLE" />
          <View style={{ height: S.sm }} />
          <TapChart data={data} color={color} selected={sel} onSelect={setSel} t0={t0} t1={t1} fmtV={fmtV} />
          {sel && p ? (
            <Pressable onPress={() => setSel(null)} style={styles.detail} accessibilityLabel="Close point details">
              <Text style={styles.detailTitle}>
                {fmtDuration((p.t - t0) / 1000)} into ride · {fmtTime(p.t)}
              </Text>
              <Text style={styles.detailLine}>Temperature: {fmtV(sel.v)}</Text>
              <Text style={styles.detailLine}>
                Speed: {sp ? `${u.speed(sp.v).toFixed(1)} ${u.speedLabel}${sp.source === 'gps' ? ' (GPS)' : ''}` : 'Not recorded'}
              </Text>
              <Text style={styles.detailLine}>Power: {pw ? `${pw.w.toFixed(0)} W${pw.source === 'calculated' ? ' (calculated V × I)' : ''}` : 'Not recorded'}</Text>
              <Text style={styles.detailLine}>Battery: {p.battery != null ? `${p.battery.toFixed(0)}%` : 'Not recorded'}</Text>
            </Pressable>
          ) : (
            <Text style={styles.hint}>Tap the graph to see the values recorded at that moment.</Text>
          )}
        </>
      ) : (
        <Text style={styles.hint}>Not recorded in this ride.</Text>
      )}
    </GlassCard>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

/** Per-sensor temperature graphs for a recorded ride. */
export function TemperatureHistory({ ride }: { ride: Ride }) {
  const sensors = useMemo(() => tempSensors(ride.points), [ride.points]);
  const pts = ride.points;
  if (!sensors.length || !pts.length) {
    return (
      <GlassCard>
        <Text style={styles.hint}>No temperature was recorded during this ride. Not every scooter reports temperatures.</Text>
      </GlassCard>
    );
  }
  const t0 = Math.min(ride.start, pts[0].t);
  const t1 = Math.max(ride.end, pts[pts.length - 1].t);
  return (
    <>
      {sensors.map((s) => (
        <SensorGraph key={s} ride={ride} sensor={s} t0={t0} t1={t1} />
      ))}
      {sensors.includes('legacy') && <Note>This ride was recorded before per-sensor temperatures were stored, so the sensor (controller or battery) can't be identified.</Note>}
      <Note>Scooter-reported temperatures at the recorded samples. Lines break where no samples were recorded.</Note>
    </>
  );
}

const styles = StyleSheet.create({
  stats: { flexDirection: 'row', marginTop: S.sm },
  statLabel: { color: C.textDim, fontSize: 11, fontWeight: '600' },
  statValue: { color: C.text, fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },
  axis: { position: 'absolute', left: 0, color: C.textFaint, fontSize: 10, fontVariant: ['tabular-nums'] },
  hint: { color: C.textFaint, fontSize: 12, marginTop: S.sm },
  detail: { marginTop: S.sm, padding: S.sm, borderRadius: R.sm, backgroundColor: 'rgba(10,6,22,0.9)', borderWidth: 1, get borderColor() { return C.borderStrong; } },
  detailTitle: { get color() { return C.purpleLight; }, fontWeight: '800', marginBottom: 2 },
  detailLine: { color: C.text, fontSize: 13, fontVariant: ['tabular-nums'] },
});
