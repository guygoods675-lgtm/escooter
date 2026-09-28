import React, { memo, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { refreshBattery } from '../services/ScooterManager';
import { SeriesKey, getSeries, useHistoryVersion } from '../services/telemetryHistory';
import { useLive } from '../store/live';
import { BatteryBar } from '../ui/components/BatteryBar';
import { CellChart } from '../ui/components/CellChart';
import { EnergyFlow } from '../ui/components/EnergyFlow';
import { LineChart } from '../ui/components/LineChart';
import { FadeIn, SkeletonCard } from '../ui/components/Motion';
import { EmptyState, GlassCard, Grid, KeyValue, Note, SectionHeader, StatTile } from '../ui/components/Glass';
import { Screen } from '../ui/components/Screen';
import { C, F, S } from '../ui/theme';
import { NA, fmtReading, useUnits } from '../utils/format';

export default function BatteryScreen() {
  const b = useLive((s) => s.battery);
  const snap = useLive((s) => s.snapshot);
  const conn = useLive((s) => s.conn);
  const caps = useLive((s) => s.capabilities);
  const u = useUnits();
  const [refreshing, setRefreshing] = useState(false);
  // True once the first battery read after connecting has finished (successfully or not).
  const [firstReadDone, setFirstReadDone] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    await refreshBattery().catch(() => undefined);
    setRefreshing(false);
    setFirstReadDone(true);
  };
  useEffect(() => {
    if (conn === 'connected') refresh();
  }, [conn]);

  useEffect(() => {
    if (conn !== 'connected') setFirstReadDone(false);
  }, [conn]);

  if (conn !== 'connected') return <Screen contentStyle={{ paddingTop: 110 }}><EmptyState icon="battery-dead-outline" title="No scooter connected" /></Screen>;

  // Connected, but the first battery read has not come back yet: show placeholders instead of "Not available".
  if (!b && !firstReadDone) {
    return (
      <Screen contentStyle={{ paddingTop: 110 }}>
        <SkeletonCard lines={2} />
        <SkeletonCard lines={3} />
        <SkeletonCard lines={4} />
      </Screen>
    );
  }

  const percent = b?.percent ?? snap?.batteryPercent ?? null;
  const cells = b?.cellVoltages?.value ?? null;
  const cmin = cells ? Math.min(...cells) : null;
  const cmax = cells ? Math.max(...cells) : null;
  const temps = b?.temps?.value ?? null;
  // Remaining energy (calculated) = remaining capacity (mAh) x pack voltage (V) / 1000. Only when both are reported.
  const packV = b?.voltage ?? snap?.batteryVoltage ?? null;
  const remainingWh = b?.remainingMah && packV ? (b.remainingMah.value * packV.value) / 1000 : null;

  return (
    <Screen contentStyle={{ paddingTop: 110 }} refreshing={refreshing} onRefresh={refresh}>
      <GlassCard accent={C.borderStrong}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: S.md }}>
          <Text style={F.label}>State of charge</Text>
          <Text style={{ color: b?.charging?.value ? C.green : C.textDim, fontWeight: '700' }}>{b?.charging ? (b.charging.value ? 'Charging' : 'Not charging') : `Charging state: ${NA}`}</Text>
        </View>
        <BatteryBar percent={percent?.value ?? null} charging={b?.charging?.value} height={56} />
        {!caps?.battery && <Note color={C.amber}>This scooter's protocol exposes no BMS details beyond what is shown.</Note>}
      </GlassCard>
      <Grid cols={3}>
        <StatTile label="Pack voltage" reading={b?.voltage ?? snap?.batteryVoltage} unit="V" digits={2} />
        <StatTile label="Current" reading={b?.current ?? snap?.batteryCurrent} unit="A" digits={2} />
        <StatTile label="Power" reading={b?.powerW ?? snap?.powerW} unit="W" digits={0} />
        <StatTile label="Temp 1" text={temps ? u.temp(temps[0]).toFixed(0) : null} unit={u.tempLabel} />
        <StatTile label="Temp 2" text={temps && temps.length > 1 ? u.temp(temps[1]).toFixed(0) : null} unit={u.tempLabel} />
        <StatTile label="Remaining" reading={b?.remainingMah} unit="mAh" digits={0} />
      </Grid>

      <SectionHeader title="Energy" icon="flash-outline" />
      <GlassCard>
        <KeyValue
          label="Remaining energy"
          value={remainingWh != null ? remainingWh.toFixed(0) : NA}
          unit="Wh"
          note={remainingWh != null ? 'calculated: remaining mAh × pack voltage' : 'Needs remaining capacity and pack voltage from the BMS'}
        />
      </GlassCard>
      <FadeIn>
        <GlassCard>
          <EnergyFlow />
        </GlassCard>
      </FadeIn>

      <SectionHeader title="Live graphs" icon="pulse-outline" />
      <BatteryGraphs />

      <SectionHeader title="Cells" icon="grid-outline" />
      <GlassCard>
        {cells ? (
          <>
            <CellChart volts={cells} />
            <KeyValue label="Cells reported" value={String(cells.length)} />
            <KeyValue label="Minimum cell" value={cmin!.toFixed(3)} unit="V" />
            <KeyValue label="Maximum cell" value={cmax!.toFixed(3)} unit="V" />
            <KeyValue label="Difference" value={((cmax! - cmin!) * 1000).toFixed(0)} unit="mV" note="calculated" />
          </>
        ) : (
          <Text style={{ color: C.textFaint }}>Individual cell data unavailable.</Text>
        )}
      </GlassCard>

      <SectionHeader title="Health & capacity" icon="heart-outline" />
      <GlassCard>
        <KeyValue label="Battery health (BMS)" value={fmtReading(b?.healthPercent ?? null, 0)} unit="%" />
        <KeyValue label="Factory capacity" value={fmtReading(b?.factoryCapacityMah ?? null, 0)} unit="mAh" />
        <KeyValue label="Actual capacity (BMS estimate)" value={fmtReading(b?.actualCapacityMah ?? null, 0)} unit="mAh" />
        <KeyValue label="Full charge cycles" value={fmtReading(b?.cycles ?? null, 0)} />
        <KeyValue label="Charge count" value={fmtReading(b?.chargeCount ?? null, 0)} />
        <KeyValue label="Charging current" value={fmtReading(b?.chargingCurrent ?? null, 2)} unit="A" />
        <KeyValue label="Charging voltage" value={fmtReading(b?.chargingVoltage ?? null, 2)} unit="V" />
        <KeyValue label="BMS firmware" value={b?.firmware?.value ?? NA} />
        <Note>Health and capacity are exactly what the BMS reports. Scooter Hub does not estimate battery health itself.</Note>
      </GlassCard>
    </Screen>
  );
}

const WINDOW_MS = 10 * 60 * 1000;
const GRAPHS: { key: SeriesKey; title: string; unit: string; digits: number; color: () => string }[] = [
  { key: 'battery', title: 'Battery %', unit: '%', digits: 0, color: () => C.green },
  { key: 'voltage', title: 'Pack voltage', unit: ' V', digits: 2, color: () => C.cyan },
  { key: 'power', title: 'Power', unit: ' W', digits: 0, color: () => C.purple },
];

/** Last 10 minutes of real samples. Memoised and driven by the throttled history version, not by every telemetry tick. */
const BatteryGraphs = memo(function BatteryGraphs() {
  useHistoryVersion();
  const now = Date.now();
  const from = now - WINDOW_MS;
  return (
    <>
      {GRAPHS.map((g) => (
        <GlassCard key={g.key}>
          <Text style={F.label}>{g.title}</Text>
          <View style={{ height: 8 }} />
          <LineChart data={getSeries(g.key, from)} color={g.color()} unit={g.unit} digits={g.digits} fromT={from} toT={now} height={110} emptyText="Not available from this scooter" />
        </GlassCard>
      ))}
      <Text style={{ color: C.textFaint, fontSize: 11.5, marginBottom: S.sm }}>Last 10 minutes of samples reported by the scooter.</Text>
    </>
  );
});
