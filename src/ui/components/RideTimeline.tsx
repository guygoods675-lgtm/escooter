import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityActionEvent, Animated, LayoutChangeEvent, PanResponder, StyleSheet, Text, View } from 'react-native';
import { TEMP_LABEL, TempSensor, distanceTrack, nearestIndex, positionAt, powerOf, speedOf, tempOf, tempSensors } from '../../services/rideAnalysis';
import type { Ride, RidePoint } from '../../store/rides';
import { fmtDuration, fmtTime, useUnits } from '../../utils/format';
import { C, R, S, rgba } from '../theme';
import { Confidence, DataSource, DataTag } from './DataTag';

export const NOT_RECORDED = 'Not recorded';
/** A recorded point further than this from the cursor is not shown (the cursor sits in a recording gap). */
export const CURSOR_TOLERANCE_MS = 3000;

// ---------------------------------------------------------------------------
// Slider (PanResponder + Animated; no slider package is installed)
// ---------------------------------------------------------------------------

const THUMB = 24;
const SEEK_THROTTLE_MS = 33;

export function TimelineSlider({
  duration,
  value,
  onSeek,
  onScrubChange,
  label = 'Ride timeline',
}: {
  duration: number;
  value: number;
  onSeek: (ms: number) => void;
  onScrubChange?: (scrubbing: boolean) => void;
  label?: string;
}) {
  const [width, setWidth] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  const st = useRef({ width: 0, duration, startX: 0, dragging: false, lastEmit: 0, pending: null as number | null });
  st.current.width = width;
  st.current.duration = duration;
  const cb = useRef({ onSeek, onScrubChange });
  cb.current = { onSeek, onScrubChange };

  // Follow the controlled value when the user isn't dragging.
  useEffect(() => {
    if (st.current.dragging || width <= 0) return;
    x.setValue(duration > 0 ? Math.max(0, Math.min(1, value / duration)) * width : 0);
  }, [value, duration, width, x]);

  const pan = useMemo(() => {
    const toMs = (px: number) => {
      const s = st.current;
      if (s.width <= 0) return 0;
      return (Math.max(0, Math.min(s.width, px)) / s.width) * s.duration;
    };
    const emit = (px: number, force: boolean) => {
      const clamped = Math.max(0, Math.min(st.current.width, px));
      x.setValue(clamped); // thumb follows the finger immediately
      const now = Date.now();
      if (force || now - st.current.lastEmit >= SEEK_THROTTLE_MS) {
        st.current.lastEmit = now;
        cb.current.onSeek(toMs(clamped));
      }
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (e) => {
        st.current.dragging = true;
        st.current.startX = e.nativeEvent.locationX - THUMB / 2;
        cb.current.onScrubChange?.(true);
        emit(st.current.startX, true);
      },
      onPanResponderMove: (_e, g) => emit(st.current.startX + g.dx, false),
      onPanResponderRelease: (_e, g) => {
        emit(st.current.startX + g.dx, true);
        st.current.dragging = false;
        cb.current.onScrubChange?.(false);
      },
      onPanResponderTerminate: (_e, g) => {
        emit(st.current.startX + g.dx, true);
        st.current.dragging = false;
        cb.current.onScrubChange?.(false);
      },
    });
  }, [x]);

  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.max(0, e.nativeEvent.layout.width - THUMB));
  const step = duration / 20;
  const onA11y = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'increment') onSeek(Math.min(duration, value + step));
    if (e.nativeEvent.actionName === 'decrement') onSeek(Math.max(0, value - step));
  };
  const fill = Animated.add(x, THUMB / 2);

  return (
    <View
      style={styles.track}
      onLayout={onLayout}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: `${fmtDuration(value / 1000)} of ${fmtDuration(duration / 1000)}` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={onA11y}
      {...pan.panHandlers}
    >
      <View pointerEvents="none" style={styles.rail} />
      <Animated.View pointerEvents="none" style={[styles.railFill, { width: fill }]} />
      <Animated.View pointerEvents="none" style={[styles.thumb, { transform: [{ translateX: x }] }]} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Cursor data
// ---------------------------------------------------------------------------

export interface RideTimelineData {
  t0: number;
  duration: number;
  sensors: TempSensor[];
  dist: ReturnType<typeof distanceTrack>;
  points: RidePoint[];
}

export function useRideTimelineData(ride: Ride): RideTimelineData {
  return useMemo(() => {
    const pts = ride.points;
    const t0 = pts.length ? Math.min(ride.start, pts[0].t) : ride.start;
    const tEnd = pts.length ? Math.max(ride.end, pts[pts.length - 1].t) : ride.end;
    return { t0, duration: Math.max(0, tEnd - t0), sensors: tempSensors(pts), dist: distanceTrack(pts), points: pts };
  }, [ride]);
}

export interface CursorInfo {
  /** Offset from the ride start in ms. */
  offsetMs: number;
  /** Absolute time. */
  t: number;
  /** Nearest recorded point, or -1 when the cursor is in a recording gap. */
  index: number;
  /** Marker position (interpolated only between adjacent GPS fixes), null when no GPS here. */
  position: { lat: number; lon: number } | null;
}

export function cursorAt(d: RideTimelineData, offsetMs: number): CursorInfo {
  const t = d.t0 + offsetMs;
  const i = nearestIndex(d.points, t);
  const index = i >= 0 && Math.abs(d.points[i].t - t) <= CURSOR_TOLERANCE_MS ? i : -1;
  return { offsetMs, t, index, position: positionAt(d.points, t) };
}

// ---------------------------------------------------------------------------
// Readouts
// ---------------------------------------------------------------------------

interface Cell { label: string; value: string | null; kind?: Confidence; source?: DataSource; note?: string }

function Readout({ c }: { c: Cell }) {
  return (
    <View style={styles.cell}>
      <Text style={styles.cellLabel} numberOfLines={1}>{c.label}</Text>
      <Text style={[styles.cellValue, c.value == null && styles.cellNA]} numberOfLines={1} adjustsFontSizeToFit>
        {c.value ?? NOT_RECORDED}
      </Text>
      {c.value != null && c.kind ? <DataTag kind={c.kind} source={c.source} compact /> : null}
      {c.value != null && c.note ? <Text style={styles.cellNote} numberOfLines={1}>{c.note}</Text> : null}
    </View>
  );
}

/** Values recorded at the cursor. Never interpolated: a missing value says 'Not recorded'. */
export function RideReadouts({ data, cursor }: { data: RideTimelineData; cursor: CursorInfo }) {
  const u = useUnits();
  const p = cursor.index >= 0 ? data.points[cursor.index] : null;
  const sp = p ? speedOf(p) : null;
  const pw = p ? powerOf(p) : null;
  const km = cursor.index >= 0 ? data.dist.km[cursor.index] : null;
  const cells: Cell[] = [
    { label: 'Time into ride', value: fmtDuration(cursor.offsetMs / 1000), note: fmtTime(cursor.t) },
    {
      label: sp?.source === 'gps' ? 'Speed (GPS)' : 'Speed',
      value: sp ? `${u.speed(sp.v).toFixed(1)} ${u.speedLabel}` : null,
      kind: 'measured',
      source: sp?.source === 'gps' ? 'Phone GPS' : 'Scooter BLE',
    },
    { label: 'Battery', value: p?.battery != null ? `${p.battery.toFixed(0)}%` : null, kind: 'measured', source: 'Scooter BLE' },
    {
      label: pw?.source === 'calculated' ? 'Power (V × I)' : 'Power',
      value: pw ? `${pw.w.toFixed(0)} W` : null,
      kind: pw?.source === 'calculated' ? 'calculated' : 'measured',
      source: pw?.source === 'calculated' ? 'Calculated' : 'Scooter BLE',
    },
    ...(data.sensors.length
      ? data.sensors.map<Cell>((s) => {
          const v = p ? tempOf(p, s) : null;
          return {
            label: s === 'legacy' ? 'Temperature' : TEMP_LABEL[s].replace(' temperature', ' temp'),
            value: v != null ? `${u.temp(v).toFixed(0)}${u.tempLabel}` : null,
            kind: 'measured',
            source: 'Scooter BLE',
            note: s === 'legacy' ? 'sensor not identified' : undefined,
          };
        })
      : [{ label: 'Temperature', value: null }]),
    { label: 'Elevation (GPS)', value: p?.alt != null ? `${p.alt.toFixed(0)} m` : null, kind: 'measured', source: 'Phone GPS' },
    {
      label: 'Distance so far',
      value: km != null ? `${u.dist(km).toFixed(2)} ${u.distLabel}` : null,
      kind: data.dist.source === 'scooter' ? 'measured' : 'calculated',
      source: data.dist.source === 'scooter' ? 'Scooter BLE' : 'Phone GPS',
    },
  ];
  return (
    <View>
      <View style={styles.grid}>
        {cells.map((c) => (
          <View key={c.label} style={styles.gridItem}>
            <Readout c={c} />
          </View>
        ))}
      </View>
      {!p && <Text style={styles.gap}>No sample was recorded at this moment (recording gap). Values are not interpolated.</Text>}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Timeline = slider + readouts
// ---------------------------------------------------------------------------

export function RideTimeline({
  ride,
  time,
  onChange,
  onScrubChange,
}: {
  ride: Ride;
  /** Controlled cursor (ms from ride start). Omit for an uncontrolled timeline. */
  time?: number;
  onChange?: (c: CursorInfo) => void;
  onScrubChange?: (scrubbing: boolean) => void;
}) {
  const data = useRideTimelineData(ride);
  const [own, setOwn] = useState(0);
  const offset = Math.max(0, Math.min(data.duration, time ?? own));
  const cursor = useMemo(() => cursorAt(data, offset), [data, offset]);
  const onSeek = (ms: number) => {
    if (time === undefined) setOwn(ms);
    onChange?.(cursorAt(data, ms));
  };
  if (!data.points.length || data.duration <= 0) {
    return <Text style={styles.gap}>This ride has no recorded samples to scrub through.</Text>;
  }
  return (
    <View>
      <View style={styles.times}>
        <Text style={styles.timeText}>{fmtDuration(offset / 1000)}</Text>
        <Text style={styles.timeText}>{fmtDuration(data.duration / 1000)}</Text>
      </View>
      <TimelineSlider duration={data.duration} value={offset} onSeek={onSeek} onScrubChange={onScrubChange} />
      <View style={{ height: S.sm }} />
      <RideReadouts data={data} cursor={cursor} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 40, justifyContent: 'center' },
  rail: { position: 'absolute', left: THUMB / 2, right: THUMB / 2, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.1)' },
  railFill: { position: 'absolute', left: 0, height: 6, borderRadius: 3, get backgroundColor() { return C.purple; } },
  thumb: {
    position: 'absolute',
    left: 0,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: '#fff',
    borderWidth: 3,
    get borderColor() { return C.purple; },
  },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  timeText: { color: C.textDim, fontSize: 12, fontVariant: ['tabular-nums'] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -S.xs },
  gridItem: { width: '50%', padding: S.xs },
  cell: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: R.sm, borderWidth: 1, get borderColor() { return rgba(C.purple, 0.14); }, padding: S.sm, minHeight: 62 },
  cellLabel: { color: C.textDim, fontSize: 11, fontWeight: '600' },
  cellValue: { color: C.text, fontSize: 17, fontWeight: '800', marginTop: 3, fontVariant: ['tabular-nums'] },
  cellNA: { color: C.textFaint, fontSize: 13, fontWeight: '500' },
  cellNote: { color: C.textFaint, fontSize: 10.5, marginTop: 1 },
  gap: { color: C.amber, fontSize: 12, marginTop: S.xs },
});
