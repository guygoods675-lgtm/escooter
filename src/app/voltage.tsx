import { router } from 'expo-router';
import React, { memo, useMemo, useState } from 'react';
import { LayoutChangeEvent, Text, View } from 'react-native';
import Svg, { Circle, Line, Text as SvgText } from 'react-native-svg';
import { getSeries, useHistoryVersion } from '../services/telemetryHistory';
import { DEFAULT_WINDOW_MS, RESTING_MAX_A, VIPoint, analyzeSag, joinSeries, pointsFromRide, rideSagHistory, thin } from '../services/voltageSag';
import { useLive } from '../store/live';
import { useRides } from '../store/rides';
import { DataTag } from '../ui/components/DataTag';
import { EmptyState, GlassCard, Grid, ListRow, Note, SectionHeader, Segmented, StatTile } from '../ui/components/Glass';
import { Screen } from '../ui/components/Screen';
import { C, F, S } from '../ui/theme';
import { NA, fmtDateTime } from '../utils/format';

type XAxis = 'current' | 'power';
type Source = 'live' | 'rides';

const LIVE_WINDOW_MS = 15 * 60000;

/** Scatter plot of voltage (y) against current or power (x). Draws only real samples. */
const Scatter = memo(function Scatter({ pts, x, height = 200 }: { pts: VIPoint[]; x: XAxis; height?: number }) {
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  const plot = useMemo(() => {
    if (pts.length < 2 || w === 0) return null;
    const data = thin(pts, 500).map((p) => ({ x: x === 'power' ? p.v * p.i : p.i, y: p.v }));
    let x0 = Math.min(...data.map((d) => d.x));
    let x1 = Math.max(...data.map((d) => d.x));
    let y0 = Math.min(...data.map((d) => d.y));
    let y1 = Math.max(...data.map((d) => d.y));
    if (x1 - x0 < 1e-6) { x0 -= 1; x1 += 1; }
    if (y1 - y0 < 1e-6) { y0 -= 0.5; y1 += 0.5; }
    const padL = 36;
    const padB = 18;
    const pw = w - padL - 6;
    const ph = height - padB - 6;
    const sx = (v: number) => padL + ((v - x0) / (x1 - x0)) * pw;
    const sy = (v: number) => 6 + ph - ((v - y0) / (y1 - y0)) * ph;
    return { data, sx, sy, x0, x1, y0, y1, padL, padB, ph };
  }, [pts, w, x, height]);
  return (
    <View onLayout={onLayout} style={{ height }}>
      {plot ? (
        <Svg width={w} height={height}>
          <Line x1={plot.padL} x2={plot.padL} y1={6} y2={6 + plot.ph} stroke="rgba(255,255,255,0.15)" />
          <Line x1={plot.padL} x2={w - 6} y1={6 + plot.ph} y2={6 + plot.ph} stroke="rgba(255,255,255,0.15)" />
          {plot.data.map((d, k) => (
            <Circle key={k} cx={plot.sx(d.x)} cy={plot.sy(d.y)} r={2.4} fill={C.cyan} fillOpacity={0.55} />
          ))}
          <SvgText x={2} y={12} fill={C.textFaint} fontSize={10}>{plot.y1.toFixed(1)}</SvgText>
          <SvgText x={2} y={6 + plot.ph} fill={C.textFaint} fontSize={10}>{plot.y0.toFixed(1)}</SvgText>
          <SvgText x={plot.padL} y={height - 3} fill={C.textFaint} fontSize={10}>{plot.x0.toFixed(0)}</SvgText>
          <SvgText x={w - 6} y={height - 3} fill={C.textFaint} fontSize={10} textAnchor="end">
            {`${plot.x1.toFixed(0)} ${x === 'power' ? 'W' : 'A'}`}
          </SvgText>
        </Svg>
      ) : (
        <View style={{ height, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: C.border }}>
          <Text style={{ color: C.textFaint, fontSize: 12.5 }}>Not enough voltage + current samples yet</Text>
        </View>
      )}
    </View>
  );
});

/** Live figures from telemetryHistory, recomputed about once a second (not per packet). */
const LiveSag = memo(function LiveSag({ x, showScatter }: { x: XAxis; showScatter: boolean }) {
  const version = useHistoryVersion();
  const bucket = Math.floor(version / 5); // history bumps at most every 200 ms → ~1 s
  const connectedAt = useLive((s) => s.connectedAt);
  const { pts, sag } = useMemo(() => {
    const since = Math.max(connectedAt ?? 0, Date.now() - LIVE_WINDOW_MS);
    const joined = joinSeries(getSeries('voltage', since), getSeries('current', since), getSeries('speed', since));
    return { pts: joined, sag: analyzeSag(joined) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucket, connectedAt]);
  return (
    <>
      <Grid cols={3}>
        <StatTile label="Resting voltage" text={sag.restingV != null ? sag.restingV.toFixed(2) : null} unit="V" confidence="measured" source="Scooter BLE" />
        <StatTile label="Under load" text={sag.loadedV != null ? sag.loadedV.toFixed(2) : null} unit="V" confidence="measured" source="Scooter BLE" />
        <StatTile label="Max drop" text={sag.maxDropV != null ? sag.maxDropV.toFixed(2) : null} unit="V" confidence="calculated" source="Calculated" />
      </Grid>
      <Text style={{ color: C.textFaint, fontSize: 11.5, lineHeight: 16, marginTop: 2 }}>
        {sag.loadedA != null ? `Under load: at the highest current seen, ${sag.loadedA.toFixed(1)} A. ` : ''}
        {sag.maxDropV != null
          ? `Largest drop ${sag.maxDropRestingV!.toFixed(2)} V → ${sag.maxDropLoadedV!.toFixed(2)} V at ${sag.maxDropA!.toFixed(1)} A.`
          : sag.restingV == null
            ? `Resting voltage needs a moment stationary with less than ${RESTING_MAX_A} A.`
            : 'Max drop needs a high-load sample near a resting one.'}
      </Text>
      {sag.maxDropV != null && <Note>Higher voltage drop observed during high-load periods.</Note>}
      {showScatter && (
        <GlassCard style={{ marginTop: S.md }}>
          <Text style={F.label}>Voltage vs {x} · this session ({pts.length} samples)</Text>
          <DataTag kind="measured" source="Scooter BLE" />
          <View style={{ marginTop: S.sm }}>
            <Scatter pts={pts} x={x} />
          </View>
        </GlassCard>
      )}
    </>
  );
});

function CurrentValues() {
  const v = useLive((s) => s.snapshot?.batteryVoltage?.value ?? null);
  const i = useLive((s) => s.snapshot?.batteryCurrent?.value ?? null);
  return (
    <Grid cols={2}>
      <StatTile label="Battery voltage" text={v != null ? v.toFixed(2) : null} unit="V" confidence="measured" source="Scooter BLE" />
      <StatTile label="Battery current" text={i != null ? i.toFixed(2) : null} unit="A" confidence="measured" source="Scooter BLE" />
    </Grid>
  );
}

export default function VoltageScreen() {
  const [x, setX] = useState<XAxis>('current');
  const [src, setSrc] = useState<Source>('live');
  const conn = useLive((s) => s.conn);
  const hasV = useLive((s) => s.snapshot?.batteryVoltage != null);
  const hasI = useLive((s) => s.snapshot?.batteryCurrent != null);
  const rides = useRides((s) => s.rides);
  const history = useMemo(() => rideSagHistory(rides), [rides]);
  const ridePts = useMemo(() => {
    // Latest 20 rides that recorded both values; raw data stays in the ride store.
    const all: VIPoint[] = [];
    for (const h of history.slice(0, 20)) all.push(...pointsFromRide(h.ride.points));
    return all;
  }, [history]);
  const connected = conn === 'connected';
  const liveOk = connected && hasV && hasI;

  return (
    <Screen contentStyle={{ paddingTop: 110 }}>
      <Text style={{ color: C.textDim, fontSize: 13, lineHeight: 19 }}>
        How the battery voltage responds to load, from the voltage and current reported by the scooter. Every battery's voltage dips while it delivers current and recovers when the load stops.
      </Text>

      <SectionHeader title="Live" icon="pulse-outline" />
      {!connected ? (
        <Note>Connect to your scooter to see live values.</Note>
      ) : !liveOk ? (
        <GlassCard>
          <Text style={{ color: C.textFaint, fontSize: 15 }}>{NA}</Text>
          <Text style={{ color: C.textDim, fontSize: 12.5, marginTop: 4, lineHeight: 18 }}>
            This needs both battery voltage and battery current from the scooter. {!hasV && !hasI ? 'Neither is' : !hasV ? 'Voltage is not' : 'Current is not'} reported by this scooter/protocol.
          </Text>
        </GlassCard>
      ) : (
        <>
          <CurrentValues />
          <LiveSag x={x} showScatter={src === 'live'} />
        </>
      )}

      <SectionHeader title="Voltage vs load" icon="analytics-outline" />
      <Segmented options={[{ label: 'This session', value: 'live' }, { label: 'Recorded rides', value: 'rides' }]} value={src} onChange={setSrc} />
      <Segmented options={[{ label: 'vs Current', value: 'current' }, { label: 'vs Power', value: 'power' }]} value={x} onChange={setX} style={{ marginTop: S.sm }} />
      {src === 'rides' ? (
        <GlassCard style={{ marginTop: S.md }}>
          <Text style={F.label}>Voltage vs {x} · last {Math.min(20, history.length)} rides ({ridePts.length} samples)</Text>
          <DataTag kind={x === 'power' ? 'calculated' : 'measured'} source={x === 'power' ? 'Calculated' : 'Ride history'} />
          <View style={{ marginTop: S.sm }}>
            <Scatter pts={ridePts} x={x} />
          </View>
        </GlassCard>
      ) : !liveOk ? (
        <Note>The live scatter appears when the scooter reports both voltage and current.</Note>
      ) : null}
      {x === 'power' && <Note>Power on the x-axis is calculated as voltage × current.</Note>}

      <SectionHeader title="Max drop per ride" icon="list-outline" />
      {history.length === 0 ? (
        <EmptyState icon="battery-half-outline" title="No rides with voltage and current" body="Rides record voltage and current only when the scooter reports both. Older rides and scooters without these values show nothing here." />
      ) : (
        <GlassCard>
          {history.slice(0, 50).map(({ ride, result }) => (
            <ListRow
              key={ride.id}
              icon="flash-outline"
              title={`Ride #${ride.number} · ${fmtDateTime(ride.start)}`}
              subtitle={
                result.maxDropV != null
                  ? `Max drop ${result.maxDropV.toFixed(2)} V at ${result.maxDropA!.toFixed(1)} A · resting ${result.maxDropRestingV!.toFixed(2)} V`
                  : `Max drop: ${NA} (${result.restingV == null ? 'no resting sample' : 'no high-load sample near a resting one'})`
              }
              onPress={() => router.push(`/ride/${ride.id}`)}
            />
          ))}
        </GlassCard>
      )}
      <Note>
        Resting: current below {RESTING_MAX_A} A while stationary. Under load: voltage at the highest current. Max drop: resting voltage minus loaded voltage within {DEFAULT_WINDOW_MS / 1000} s. Values depend on how often the scooter reports and on temperature and charge level; they describe what was observed, not the battery's condition.
      </Note>
    </Screen>
  );
}
