import React, { memo, useMemo } from 'react';
import { Text, View } from 'react-native';
import type { TelemetrySnapshot } from '../protocols/types';
import { useActiveRide } from '../services/RideTracker';
import { accelerationRuns, pointSpeed, summarizeRide } from '../services/rideMath';
import { Sample, SeriesKey, getSeries, useHistoryVersion } from '../services/telemetryHistory';
import { joinSeries } from '../services/voltageSag';
import { useGarage } from '../store/garage';
import { useLive } from '../store/live';
import { useRides } from '../store/rides';
import { Confidence, DataSource, DataTag } from '../ui/components/DataTag';
import { GlassCard, Grid, KeyValue, Note, SectionHeader, StatTile } from '../ui/components/Glass';
import { Gauge } from '../ui/components/Gauge';
import { LineChart } from '../ui/components/LineChart';
import { Screen } from '../ui/components/Screen';
import { C, F, S } from '../ui/theme';
import { NA, useUnits } from '../utils/format';

/*
 * Layout note: the page itself subscribes to nothing that changes per packet.
 * Each section is its own component with narrow (primitive) selectors, and the
 * graphs redraw at most about once a second from telemetryHistory.
 */

const GRAPH_WINDOW_MS = 5 * 60000;
const MAX_GAP_MS = 5000;
const toMph = (v: number) => v / 1.609344;

/** telemetryHistory bumps its version at most every 200 ms; group 5 bumps ≈ 1 s. */
function useHistoryBucket(every = 5) {
  return Math.floor(useHistoryVersion() / every);
}

type NumKey = { [K in keyof TelemetrySnapshot]: TelemetrySnapshot[K] extends { value: number } | null ? K : never }[keyof TelemetrySnapshot];
const useVal = (k: NumKey) => useLive((s) => (s.snapshot?.[k] as { value: number } | null | undefined)?.value ?? null);
const useSrc = (k: NumKey) => useLive((s) => (s.snapshot?.[k] as { source: string } | null | undefined)?.source ?? null);
const tagFor = (src: string | null): { kind: Confidence; source: DataSource } | null =>
  src == null ? null : src === 'calculated' ? { kind: 'calculated', source: 'Calculated' } : src === 'phone' ? { kind: 'measured', source: 'Phone GPS' } : { kind: 'measured', source: 'Scooter BLE' };

const maxOf = (arr: Sample[]) => {
  let m: number | null = null;
  for (const s of arr) if (m == null || s.v > m) m = s.v;
  return m;
};

/** Trapezoid integral of samples (value per hour) over time, skipping gaps; returns value·h. */
function integrateHours(samples: { t: number; v: number }[], positiveOnly = false) {
  let sum = 0;
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i].t - samples[i - 1].t;
    if (dt <= 0 || dt > MAX_GAP_MS) continue;
    let v = (samples[i].v + samples[i - 1].v) / 2;
    if (positiveOnly && v < 0) v = 0;
    sum += (v * dt) / 3600000;
  }
  return sum;
}

// ───────────────────────── existing sections ─────────────────────────

function SpeedGaugeCard() {
  const speed = useVal('speedKmh');
  const u = useUnits();
  return (
    <GlassCard style={{ alignItems: 'center' }}>
      <Gauge value={speed != null ? u.speed(speed) : null} max={u.speedUnit === 'mph' ? 30 : 50} size={220} label="Current speed" unit={u.speedLabel} digits={1} />
    </GlassCard>
  );
}

function PeakTiles() {
  const bucket = useHistoryBucket(1);
  const maxSession = useLive((x) => x.sessionMaxSpeed);
  const scooterId = useLive((x) => x.scooterId);
  const allTime = useGarage((x) => x.scooters.find((p) => p.id === scooterId)?.highestSpeedKmh ?? null);
  const avgScooter = useVal('averageSpeedKmh');
  const rides = useRides((x) => x.rides);
  const u = useUnits();
  const { lastAccel, peakAccel } = useMemo(() => {
    const accel = getSeries('accel');
    return { lastAccel: accel.length ? accel[accel.length - 1].v : null, peakAccel: maxOf(accel) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucket]);
  const avgRide = useMemo(() => {
    const avgSpeeds = rides.map((r) => r.avgSpeedKmh).filter((v): v is number => v != null);
    return avgSpeeds.length ? avgSpeeds.reduce((a, b) => a + b, 0) / avgSpeeds.length : null;
  }, [rides]);
  return (
    <Grid cols={3}>
      <StatTile label="Peak (session)" text={maxSession != null ? u.speed(maxSession).toFixed(1) : null} unit={u.speedLabel} confidence="measured" source="Scooter BLE" />
      <StatTile label="Peak (all time)" text={allTime != null ? u.speed(allTime).toFixed(1) : null} unit={u.speedLabel} confidence="measured" source="Ride history" />
      <StatTile label="Avg speed" text={avgScooter != null ? u.speed(avgScooter).toFixed(1) : null} unit={u.speedLabel} confidence="measured" source="Scooter BLE" />
      <StatTile label="Acceleration" text={lastAccel != null ? lastAccel.toFixed(2) : null} unit="m/s²" confidence="calculated" source="Calculated" />
      <StatTile label="Peak accel." text={peakAccel != null ? peakAccel.toFixed(2) : null} unit="m/s²" confidence="calculated" source="Calculated" />
      <StatTile label="Avg ride speed" text={avgRide != null ? u.speed(avgRide).toFixed(1) : null} unit={u.speedLabel} confidence="calculated" source="Ride history" />
    </Grid>
  );
}

function StandingStart() {
  const bucket = useHistoryBucket();
  const rides = useRides((x) => x.rides);
  const u = useUnits();
  const sessionRuns = useMemo(() => {
    const liveSpeed = getSeries('speed');
    return accelerationRuns(liveSpeed.length ? liveSpeed : getSeries('gpsSpeed'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucket]);
  const historyRuns = useMemo(() => {
    const all: Record<number, number | null> = { 10: null, 20: null, 25: null };
    for (const r of rides) {
      const runs = accelerationRuns(r.points.filter((p) => pointSpeed(p) != null).map((p) => ({ t: p.t, v: pointSpeed(p)! })));
      for (const k of [10, 20, 25]) {
        const v = runs[k]?.seconds;
        if (v != null && (all[k] == null || v < all[k]!)) all[k] = v;
      }
    }
    return all;
  }, [rides]);
  const target = (k: number) => (u.speedUnit === 'mph' ? `0–${(k / 1.609344).toFixed(0)} mph` : `0–${k} km/h`);
  return (
    <>
      <SectionHeader title="Standing-start times" icon="stopwatch-outline" />
      <GlassCard>
        <Text style={{ color: C.textDim, fontSize: 12, marginBottom: S.sm }}>This session · best from saved rides</Text>
        {[10, 20, 25].map((k) => (
          <KeyValue key={k} label={target(k)} value={`${sessionRuns[k] ? sessionRuns[k]!.seconds.toFixed(1) + ' s' : NA}  ·  ${historyRuns[k] != null ? historyRuns[k]!.toFixed(1) + ' s' : NA}`} />
        ))}
      </GlassCard>
    </>
  );
}

// ───────────────────────── advanced section ─────────────────────────

function Row({ label, value, unit, tag }: { label: string; value: string | null; unit?: string; tag: { kind: Confidence; source: DataSource } | null }) {
  return (
    <View>
      <KeyValue label={label} value={value ?? NA} unit={unit} />
      {value != null && tag ? <DataTag kind={tag.kind} source={tag.source} style={{ alignSelf: 'flex-end', marginTop: -6, marginBottom: 2 }} /> : null}
    </View>
  );
}

/** Current values straight from the scooter; peaks from this session's telemetryHistory. */
function AdvancedLive() {
  const u = useUnits();
  const bucket = useHistoryBucket();
  const connectedAt = useLive((s) => s.connectedAt);
  const speed = useVal('speedKmh');
  const speedSrc = useSrc('speedKmh');
  const avg = useVal('averageSpeedKmh');
  const avgSrc = useSrc('averageSpeedKmh');
  const maxSession = useLive((s) => s.sessionMaxSpeed);
  const rpm = useVal('motorRpm');
  const rpmSrc = useSrc('motorRpm');
  const power = useVal('powerW');
  const powerSrc = useSrc('powerW');
  const volt = useVal('batteryVoltage');
  const voltSrc = useSrc('batteryVoltage');
  const amps = useVal('batteryCurrent');
  const ampsSrc = useSrc('batteryCurrent');

  const peaks = useMemo(() => {
    const since = connectedAt ?? undefined;
    const accel = getSeries('accel', since);
    return {
      rpm: maxOf(getSeries('rpm', since)),
      power: maxOf(getSeries('power', since)),
      accel: accel.length ? accel[accel.length - 1].v : null,
      accelPeak: maxOf(accel),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucket, connectedAt]);

  const sp = (v: number | null) => (v != null ? u.speed(v).toFixed(1) : null);
  return (
    <GlassCard>
      <Text style={F.label}>Speed</Text>
      <Row label="Current" value={sp(speed)} unit={u.speedLabel} tag={tagFor(speedSrc)} />
      <Row label="Average (scooter)" value={sp(avg)} unit={u.speedLabel} tag={tagFor(avgSrc)} />
      <Row label="Maximum (session)" value={sp(maxSession)} unit={u.speedLabel} tag={{ kind: 'measured', source: 'Scooter BLE' }} />
      <Text style={[F.label, { marginTop: S.md }]}>Motor</Text>
      <Row label="Motor RPM" value={rpm != null ? rpm.toFixed(0) : null} unit="rpm" tag={tagFor(rpmSrc)} />
      <Row label="Peak RPM (session)" value={peaks.rpm != null ? peaks.rpm.toFixed(0) : null} unit="rpm" tag={tagFor(rpmSrc ?? 'scooter')} />
      <Row label="Electrical power" value={power != null ? power.toFixed(0) : null} unit="W" tag={tagFor(powerSrc)} />
      <Row label="Peak power (session)" value={peaks.power != null ? peaks.power.toFixed(0) : null} unit="W" tag={tagFor(powerSrc ?? 'scooter')} />
      <Text style={[F.label, { marginTop: S.md }]}>Battery</Text>
      <Row label="Battery voltage" value={volt != null ? volt.toFixed(2) : null} unit="V" tag={tagFor(voltSrc)} />
      <Row label="Battery current" value={amps != null ? amps.toFixed(2) : null} unit="A" tag={tagFor(ampsSrc)} />
      <Text style={[F.label, { marginTop: S.md }]}>Acceleration</Text>
      <Row label="Current" value={peaks.accel != null ? peaks.accel.toFixed(2) : null} unit="m/s²" tag={{ kind: 'calculated', source: 'Calculated' }} />
      <Row label="Peak (session)" value={peaks.accelPeak != null ? peaks.accelPeak.toFixed(2) : null} unit="m/s²" tag={{ kind: 'calculated', source: 'Calculated' }} />
      <Note>Acceleration is calculated from consecutive scooter speed readings. RPM and power are shown only when the scooter reports them; power labelled "Calculated" is voltage × current.</Note>
    </GlassCard>
  );
}

/** Distance, energy and Wh/km for the active ride, else for this connection session. */
function RideEnergy() {
  const u = useUnits();
  const active = useActiveRide((s) => s.active);
  const points = useActiveRide((s) => s.points);
  const start = useActiveRide((s) => s.start);
  const bucket = useHistoryBucket(10); // session figures: ~every 2 s
  const connectedAt = useLive((s) => s.connectedAt);

  const ride = useMemo(() => {
    if (!active || start == null || points.length < 2) return null;
    return summarizeRide(points, start, points[points.length - 1].t);
  }, [active, points, start]);

  const session = useMemo(() => {
    if (active || connectedAt == null) return null;
    const speed = getSeries('speed', connectedAt);
    const vi = joinSeries(getSeries('voltage', connectedAt), getSeries('current', connectedAt)).map((p) => ({ t: p.t, v: p.v * p.i }));
    const distanceKm = speed.length >= 2 ? integrateHours(speed) : null;
    const energyWh = vi.length >= 2 ? integrateHours(vi, true) : null;
    return { distanceKm, energyWh, whPerKm: distanceKm != null && energyWh != null && distanceKm > 0.05 ? energyWh / distanceKm : null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, connectedAt, bucket]);

  const per = (whPerKm: number | null) => (whPerKm == null ? null : u.distanceUnit === 'mi' ? (whPerKm * 1.609344).toFixed(1) : whPerKm.toFixed(1));
  const perUnit = u.distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';

  if (ride) {
    const distTag: { kind: Confidence; source: DataSource } | null =
      ride.distanceSource === 'scooter' ? { kind: 'measured', source: 'Scooter BLE' } : ride.distanceSource === 'gps' ? { kind: 'calculated', source: 'Phone GPS' } : null;
    return (
      <GlassCard>
        <Text style={F.label}>Active ride</Text>
        <Row label="Ride distance" value={ride.distanceSource !== 'none' ? u.dist(ride.distanceKm).toFixed(2) : null} unit={u.distLabel} tag={distTag} />
        <Row label="Average speed (moving)" value={ride.avgSpeedKmh != null ? u.speed(ride.avgSpeedKmh).toFixed(1) : null} unit={u.speedLabel} tag={{ kind: 'calculated', source: 'Calculated' }} />
        <Row label="Energy consumed" value={ride.energyWh != null ? ride.energyWh.toFixed(1) : null} unit="Wh" tag={{ kind: 'calculated', source: 'Calculated' }} />
        <Row label="Consumption" value={per(ride.whPerKm ?? null)} unit={perUnit} tag={{ kind: 'calculated', source: 'Calculated' }} />
        <Note>Energy is voltage × current reported by the scooter, integrated over the ride; it is not available when the scooter doesn't report both.</Note>
      </GlassCard>
    );
  }
  return (
    <GlassCard>
      <Text style={F.label}>This session (no ride recording)</Text>
      <Row label="Distance" value={session?.distanceKm != null ? u.dist(session.distanceKm).toFixed(2) : null} unit={u.distLabel} tag={{ kind: 'calculated', source: 'Calculated' }} />
      <Row label="Energy consumed" value={session?.energyWh != null ? session.energyWh.toFixed(1) : null} unit="Wh" tag={{ kind: 'calculated', source: 'Calculated' }} />
      <Row label="Consumption" value={per(session?.whPerKm ?? null)} unit={perUnit} tag={{ kind: 'calculated', source: 'Calculated' }} />
      <Note>
        {connectedAt == null
          ? 'Connect to your scooter, or start a ride, to see distance and energy.'
          : 'Session distance is integrated from scooter speed and energy from voltage × current since connecting. Start a ride for GPS/odometer distance.'}
      </Note>
    </GlassCard>
  );
}

const MemoLineChart = memo(LineChart);

/** One live graph. Only this component re-renders on history updates, at most ~1×/s. */
const LiveGraph = memo(function LiveGraph({ series, title, unit, color, digits = 1, convert, tagKey, calculated }: {
  series: SeriesKey; title: string; unit: string; color: string; digits?: number; convert?: (v: number) => number; tagKey?: NumKey; calculated?: boolean;
}) {
  const bucket = useHistoryBucket();
  const src = useLive((s) => (tagKey ? (s.snapshot?.[tagKey] as { source: string } | null | undefined)?.source ?? null : null));
  const { data, from, to } = useMemo(() => {
    const now = Date.now();
    return { data: getSeries(series, now - GRAPH_WINDOW_MS), from: now - GRAPH_WINDOW_MS, to: now };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bucket, series]);
  const tag = calculated ? { kind: 'calculated' as const, source: 'Calculated' as const } : tagFor(src);
  const last = data.length ? data[data.length - 1].v : null;
  return (
    <GlassCard>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View>
          <Text style={F.label}>{title}</Text>
          {tag && data.length > 0 ? <DataTag kind={tag.kind} source={tag.source} /> : null}
        </View>
        <Text style={{ color: C.text, fontWeight: '800', fontSize: 16, fontVariant: ['tabular-nums'] }}>
          {last != null ? `${(convert ? convert(last) : last).toFixed(digits)} ${unit}` : NA}
        </Text>
      </View>
      <View style={{ marginTop: S.sm }}>
        <MemoLineChart data={data} color={color} unit={` ${unit}`} digits={digits} fromT={from} toT={to} convert={convert} height={110} emptyText="Not reported by this scooter yet" />
      </View>
    </GlassCard>
  );
});

function LiveGraphs() {
  const u = useUnits();
  const mph = u.speedUnit === 'mph';
  return (
    <>
      <SectionHeader title="Live graphs · last 5 min" icon="pulse-outline" />
      <LiveGraph series="speed" title="Speed" unit={u.speedLabel} color={C.purple} convert={mph ? toMph : undefined} tagKey="speedKmh" />
      <LiveGraph series="rpm" title="Motor RPM" unit="rpm" digits={0} color={C.sunset} tagKey="motorRpm" />
      <LiveGraph series="power" title="Electrical power" unit="W" digits={0} color={C.amber} tagKey="powerW" />
      <LiveGraph series="voltage" title="Battery voltage" unit="V" digits={2} color={C.green} tagKey="batteryVoltage" />
      <LiveGraph series="current" title="Battery current" unit="A" digits={2} color={C.cyan} tagKey="batteryCurrent" />
      <LiveGraph series="accel" title="Acceleration" unit="m/s²" digits={2} color={C.red} calculated />
    </>
  );
}

export default function PerformanceScreen() {
  return (
    <Screen contentStyle={{ paddingTop: 110 }}>
      <SpeedGaugeCard />
      <PeakTiles />
      <StandingStart />
      <SectionHeader title="Advanced live data" icon="speedometer-outline" />
      <AdvancedLive />
      <RideEnergy />
      <LiveGraphs />
      <Note>
        Measurements depend on the scooter's telemetry rate and phone GPS accuracy (typically one sample per second), so times can be off by about a second. These figures are for monitoring your scooter, not for racing. Ride safely and within local limits.
      </Note>
      <Note icon="warning-outline" color={C.amber}>Never look at your phone while riding.</Note>
    </Screen>
  );
}
