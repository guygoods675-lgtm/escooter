import React from 'react';
import { View } from 'react-native';
import { useErrors } from '../store/errors';
import { useLive } from '../store/live';
import { EmptyState, GlassCard, Grid, KeyValue, Note, SectionHeader, StatTile } from '../ui/components/Glass';
import { Gauge } from '../ui/components/Gauge';
import { Screen } from '../ui/components/Screen';
import { TemperatureCards } from '../ui/components/TemperatureCards';
import { C, S } from '../ui/theme';
import { NA, useUnits } from '../utils/format';

export default function MotorScreen() {
  const s = useLive((x) => x.snapshot);
  const conn = useLive((x) => x.conn);
  const identity = useLive((x) => x.identity);
  const scooterId = useLive((x) => x.scooterId);
  const records = useErrors((x) => x.records);
  const overheat = records.filter((r) => r.active && r.scooterId === scooterId && /overheat/i.test(r.title));
  const u = useUnits();
  if (conn !== 'connected') return <Screen contentStyle={{ paddingTop: 110 }}><EmptyState icon="cog-outline" title="No scooter connected" /></Screen>;
  const tmin = u.tempUnit === 'f' ? 32 : 0;
  const tmax = u.tempUnit === 'f' ? 176 : 80;
  return (
    <Screen contentStyle={{ paddingTop: 110 }}>
      <SectionHeader title="Temperatures" icon="thermometer-outline" />
      <TemperatureCards />
      <View style={{ height: S.md }} />
      <View style={{ flexDirection: 'row', justifyContent: 'space-around' }}>
        <Gauge value={s?.motorTempC ? u.temp(s.motorTempC.value) : null} min={tmin} max={tmax} size={165} label="Motor" unit={u.tempLabel} colors={[C.amber, C.red]} />
        <Gauge value={s?.controllerTempC ? u.temp(s.controllerTempC.value) : null} min={tmin} max={tmax} size={165} label="Controller" unit={u.tempLabel} digits={1} colors={[C.amber, C.sunset]} />
      </View>
      {overheat.length > 0 &&
        overheat.map((o) => (
          <GlassCard key={o.key} accent={C.red}>
            <Note color={C.red} icon="warning">The scooter reports: {o.title} (code {o.code}).</Note>
          </GlassCard>
        ))}
      <Note>
        Temperature warnings come only from over-temperature codes the scooter itself reports. No manufacturer safe range is published for these values, so Scooter Hub sets no thresholds of its own.
      </Note>
      <SectionHeader title="Electrical" icon="flash-outline" />
      <Grid cols={3}>
        <StatTile label="Voltage" reading={s?.batteryVoltage} unit="V" digits={2} />
        <StatTile label="Current" reading={s?.batteryCurrent} unit="A" digits={2} />
        <StatTile label="Power" reading={s?.powerW} unit="W" digits={0} />
        <StatTile label="Motor RPM" reading={s?.motorRpm} digits={0} />
        <StatTile label="Motor output" text={null} />
        <StatTile label="Error state" text={s?.errorCode ? (s.errorCode.value === 0 ? 'OK' : `E${s.errorCode.value}`) : null} />
      </Grid>
      <SectionHeader title="Identification" icon="finger-print-outline" />
      <GlassCard>
        <KeyValue label="Controller firmware" value={identity?.controllerFirmware?.value ?? NA} />
        <KeyValue label="Controller serial" value={identity?.serial?.value ?? NA} mono />
        <KeyValue label="Motor model" value={NA} />
        <Note>Power is battery-side (voltage × current) unless the scooter reports power directly. Mechanical motor output is not exposed by any supported protocol.</Note>
      </GlassCard>
      <View style={{ height: S.xl }} />
    </Screen>
  );
}
