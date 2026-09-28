import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Ride } from '../../store/rides';
import { NA, fmtDateTime, fmtDuration, useUnits } from '../../utils/format';
import { C, F, S } from '../theme';
import { GlassCard, Grid, KeyValue, Note, SectionHeader, StatTile } from './Glass';
import { LineChart } from './LineChart';
import { pointPower, pointSpeed, summarizeRide } from '../../services/rideMath';
import type { Sample } from '../../services/telemetryHistory';

function series(points: Ride['points'], pick: (p: Ride['points'][number]) => number | null): Sample[] {
  const out: Sample[] = [];
  for (const p of points) {
    const v = pick(p);
    if (v != null && Number.isFinite(v)) out.push({ t: p.t, v });
  }
  return out;
}

function RideGraph({ title, data, color, unit, digits = 1, convert, note }: { title: string; data: Sample[]; color: string; unit: string; digits?: number; convert?: (v: number) => number; note?: string }) {
  return (
    <GlassCard>
      <Text style={F.label}>{title}</Text>
      <View style={{ height: 8 }} />
      {data.length >= 2 ? (
        <LineChart data={data} color={color} unit={unit} digits={digits} convert={convert} height={110} emptyText={NA} />
      ) : (
        <Text style={{ color: C.textFaint }}>{NA}: this ride has no recorded samples for this value.</Text>
      )}
      {!!note && data.length >= 2 && <Text style={styles.graphNote}>{note}</Text>}
    </GlassCard>
  );
}

export function RideSummary({ ride }: { ride: Ride }) {
  const u = useUnits();
  const consumed = ride.batteryStart != null && ride.batteryEnd != null ? ride.batteryStart - ride.batteryEnd : null;
  const speedData = ride.points.filter((p) => pointSpeed(p) != null).map((p) => ({ t: p.t, v: pointSpeed(p)! }));
  // Rides saved before power stats existed lack avgPowerW/peakPowerW/whPerKm: recompute from the stored points.
  const power = useMemo(() => {
    if (ride.avgPowerW !== undefined && ride.peakPowerW !== undefined && ride.whPerKm !== undefined) {
      return { avg: ride.avgPowerW, peak: ride.peakPowerW, whKm: ride.whPerKm };
    }
    const s = summarizeRide(ride.points, ride.start, ride.end);
    return { avg: s.avgPowerW ?? null, peak: s.peakPowerW ?? null, whKm: s.whPerKm ?? null };
  }, [ride]);
  const graphs = useMemo(
    () => ({
      battery: series(ride.points, (p) => p.battery),
      power: series(ride.points, pointPower),
      temp: series(ride.points, (p) => p.tempC),
      alt: series(ride.points, (p) => p.alt),
    }),
    [ride.points],
  );
  return (
    <>
      <GlassCard accent={C.borderStrong}>
        <Text style={F.label}>Ride #{ride.number}</Text>
        <Text style={styles.big}>
          {u.dist(ride.distanceKm).toFixed(2)} <Text style={styles.unit}>{u.distLabel}</Text>
        </Text>
        <Text style={styles.date}>{fmtDateTime(ride.start)}</Text>
        {ride.distanceSource === 'none' && <Note color={C.amber}>No GPS or scooter distance was available for this ride.</Note>}
        {ride.distanceSource === 'scooter' && <Note>Distance from the scooter's odometer.</Note>}
        {ride.distanceSource === 'gps' && <Note>Distance from phone GPS.</Note>}
      </GlassCard>
      <Grid cols={2}>
        <StatTile label="Time" text={fmtDuration(ride.durationSec)} icon="time-outline" />
        <StatTile label="Moving time" text={fmtDuration(ride.movingSec)} icon="walk-outline" />
        <StatTile label="Average" text={ride.avgSpeedKmh != null ? u.speed(ride.avgSpeedKmh).toFixed(1) : null} unit={u.speedLabel} icon="speedometer-outline" />
        <StatTile label="Max" text={ride.maxSpeedKmh != null ? u.speed(ride.maxSpeedKmh).toFixed(1) : null} unit={u.speedLabel} icon="rocket-outline" />
        <StatTile label="Battery" text={ride.batteryStart != null && ride.batteryEnd != null ? `${ride.batteryStart}% → ${ride.batteryEnd}%` : null} icon="battery-half-outline" />
        <StatTile label="Consumption" text={consumed != null ? `${consumed}%` : null} icon="trending-down-outline" />
        <StatTile label="Energy used" text={ride.energyWh != null ? ride.energyWh.toFixed(1) : null} unit="Wh" icon="flash-outline" />
        <StatTile label="Elevation (GPS)" text={ride.elevationGainM != null ? `+${ride.elevationGainM.toFixed(0)} / -${(ride.elevationLossM ?? 0).toFixed(0)}` : null} unit="m" icon="trending-up-outline" />
        <StatTile label="Stops" text={String(ride.stops)} icon="hand-left-outline" />
        <StatTile label="Max temp" text={ride.maxTempC != null ? u.temp(ride.maxTempC).toFixed(0) : null} unit={u.tempLabel} icon="thermometer-outline" />
      </Grid>
      <GlassCard style={{ marginTop: S.md }}>
        <Text style={F.label}>Speed</Text>
        <View style={{ height: 8 }} />
        <LineChart data={speedData} convert={u.speed} unit={` ${u.speedLabel}`} emptyText={NA} />
      </GlassCard>

      <SectionHeader title="Power & efficiency" icon="flash-outline" />
      <GlassCard>
        <KeyValue label="Average power" value={power.avg != null ? power.avg.toFixed(0) : NA} unit="W" note={power.avg != null ? 'calculated from voltage × current' : undefined} />
        <KeyValue label="Peak power" value={power.peak != null ? power.peak.toFixed(0) : NA} unit="W" note={power.peak != null ? 'calculated from voltage × current' : undefined} />
        <KeyValue
          label={u.distanceUnit === 'mi' ? 'Energy per mile' : 'Energy per km'}
          value={power.whKm != null ? (u.distanceUnit === 'mi' ? power.whKm * 1.609344 : power.whKm).toFixed(1) : NA}
          unit={u.distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km'}
          note={power.whKm != null ? 'calculated: energy used ÷ distance' : undefined}
        />
        <KeyValue label="Elevation gain (GPS)" value={ride.elevationGainM != null ? ride.elevationGainM.toFixed(0) : NA} unit="m" />
        <KeyValue label="Elevation loss (GPS)" value={ride.elevationLossM != null ? ride.elevationLossM.toFixed(0) : NA} unit="m" />
      </GlassCard>

      <SectionHeader title="Over the ride" icon="analytics-outline" />
      <RideGraph title="Battery %" data={graphs.battery} color={C.green} unit="%" digits={0} />
      <RideGraph title="Power" data={graphs.power} color={C.purple} unit=" W" digits={0} note="calculated from scooter voltage × current" />
      <RideGraph title="Temperature" data={graphs.temp} color={C.amber} unit={u.tempLabel} digits={0} convert={u.temp} />
      <RideGraph title="Elevation (GPS)" data={graphs.alt} color={C.cyan} unit=" m" digits={0} note="Phone GPS altitude, unfiltered" />
      <Note>Energy is integrated from scooter-reported voltage × current and is only shown when both are available. Elevation uses phone GPS altitude with a 3 m noise filter.</Note>
    </>
  );
}

const styles = StyleSheet.create({
  big: { color: C.text, fontSize: 44, fontWeight: '900', letterSpacing: -1.5, marginTop: 4 },
  unit: { fontSize: 18, color: C.textDim, fontWeight: '700' },
  date: { color: C.textDim, marginTop: 2 },
  graphNote: { color: C.textFaint, fontSize: 11, marginTop: 2 },
});
