import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { DashLayout } from '../../store/settings';
import { disconnectScooter } from '../../services/ScooterManager';
import { startRide, stopRide, useActiveRide } from '../../services/RideTracker';
import { useLive } from '../../store/live';
import { summarizeRide } from '../../services/rideMath';
import { getSeries, useHistoryVersion } from '../../services/telemetryHistory';
import { RangeCard } from '../components/RangeCard';
import { Scooter3DCard } from '../components/Scooter3D';
import { NA, fmtDuration, onOff, rssiQuality, useUnits } from '../../utils/format';
import { BatteryBar } from '../components/BatteryBar';
import { EnergyFlow } from '../components/EnergyFlow';
import { Gauge } from '../components/Gauge';
import { Badge, GlassCard, Grid, NeonButton, SectionHeader, StatTile } from '../components/Glass';
import { TemperatureCards } from '../components/TemperatureCards';
import { useNow, useScooterTitle } from '../hooks';
import { C, F, S } from '../theme';

/**
 * Dashboard cards. Each card selects only the fields it shows, so a telemetry
 * tick re-renders the cards whose values changed instead of the whole screen.
 */

export type CardId = 'header' | 'speed' | 'speedLarge' | 'miniGauges' | 'quick' | 'battery' | 'alerts' | 'energy' | 'temps' | 'power' | 'distance' | 'status' | 'ride' | 'actions' | 'range' | 'scooter3d' | 'perf' | 'batteryDetail' | 'ble' | 'cockpit' | 'minimal';

export const CARD_INFO: Record<Exclude<CardId, 'alerts' | 'actions'>, { title: string; icon: React.ComponentProps<typeof Ionicons>['name'] }> = {
  header: { title: 'Scooter & connection', icon: 'bicycle-outline' },
  speed: { title: 'Speed gauge', icon: 'speedometer-outline' },
  speedLarge: { title: 'Large speed', icon: 'speedometer' },
  miniGauges: { title: 'Battery & temperature gauges', icon: 'pie-chart-outline' },
  quick: { title: 'Compact stats', icon: 'apps-outline' },
  battery: { title: 'Battery bar', icon: 'battery-half-outline' },
  energy: { title: 'Energy flow', icon: 'git-merge-outline' },
  temps: { title: 'Temperatures', icon: 'thermometer-outline' },
  power: { title: 'Power', icon: 'flash-outline' },
  distance: { title: 'Distance', icon: 'map-outline' },
  status: { title: 'Lights & status', icon: 'options-outline' },
  ride: { title: 'Ride controls', icon: 'navigate-outline' },
  minimal: { title: 'Large speed + battery', icon: 'remove-outline' },
  range: { title: 'Personal range estimate', icon: 'analytics-outline' },
  scooter3d: { title: '3D scooter', icon: 'cube-outline' },
  perf: { title: 'Performance (speed, power, accel, temps)', icon: 'rocket-outline' },
  batteryDetail: { title: 'Voltage, current, Wh/km', icon: 'battery-charging-outline' },
  ble: { title: 'Bluetooth link', icon: 'bluetooth-outline' },
  cockpit: { title: 'Open Cockpit mode', icon: 'speedometer-outline' },
};

// 'alerts' and 'actions' are always included so active codes and Disconnect are never hidden.
export const LAYOUTS: Record<Exclude<DashLayout, 'custom'>, { name: string; description: string; cards: CardId[] }> = {
  default: { name: 'Classic', description: 'The original dashboard plus energy flow, range and 3D', cards: ['header', 'speed', 'miniGauges', 'battery', 'alerts', 'range', 'energy', 'scooter3d', 'power', 'distance', 'status', 'actions'] },
  minimal: { name: 'Minimal', description: 'Large speed and battery, nothing else', cards: ['minimal', 'alerts', 'actions'] },
  performance: { name: 'Performance', description: 'Speed, power, acceleration and temperatures', cards: ['header', 'speed', 'alerts', 'perf', 'temps', 'actions'] },
  cockpit: { name: 'Cockpit', description: 'Large readable speed and essentials; opens full-screen Cockpit', cards: ['cockpit', 'speedLarge', 'battery', 'alerts', 'range', 'actions'] },
  compact: { name: 'Compact', description: 'Key numbers on one screen', cards: ['header', 'quick', 'battery', 'alerts', 'distance', 'actions'] },
  'large-speed': { name: 'Large speed', description: 'A big speedometer for riding', cards: ['speedLarge', 'battery', 'alerts', 'actions'] },
  battery: { name: 'Battery', description: 'Battery, voltage, current, Wh/km and estimated range', cards: ['header', 'battery', 'miniGauges', 'alerts', 'batteryDetail', 'range', 'energy', 'actions'] },
  diagnostic: { name: 'Diagnostic', description: 'Temperatures, voltage, current, errors and Bluetooth', cards: ['header', 'alerts', 'temps', 'power', 'ble', 'status', 'actions'] },
  ride: { name: 'Ride mode', description: 'Speed, battery, trip and ride controls', cards: ['speedLarge', 'battery', 'alerts', 'distance', 'ride', 'actions'] },
};

export function cardsFor(layout: DashLayout, custom: string[]): CardId[] {
  if (layout !== 'custom') return LAYOUTS[layout].cards;
  const picked = custom.filter((c): c is CardId => c in CARD_INFO);
  return [...picked.slice(0, 1), 'alerts', ...picked.slice(1), 'actions'];
}

function HeaderCard() {
  const rssi = useLive((x) => x.rssi);
  const connectedAt = useLive((x) => x.connectedAt);
  const protocolName = useLive((x) => x.protocolName);
  const { brand, model, nickname } = useScooterTitle();
  const now = useNow();
  const q = rssiQuality(rssi);
  return (
    <GlassCard accent={C.borderStrong}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Text style={F.label}>{brand ?? 'Unknown brand'}</Text>
          <Text style={styles.model}>{model ?? 'Unknown model'}</Text>
          {!!nickname && <Text style={styles.nick}>{nickname}</Text>}
        </View>
        <Badge text="CONNECTED" color={C.green} icon="radio-button-on" />
      </View>
      <View style={styles.connRow}>
        <Text style={styles.connText}><Ionicons name="bluetooth" size={12} /> {rssi != null ? `${rssi} dBm · ${q.label}` : 'Signal ' + NA}</Text>
        <Text style={styles.connText}><Ionicons name="time-outline" size={12} /> {connectedAt ? fmtDuration((now - connectedAt) / 1000) : NA}</Text>
      </View>
      <Text style={styles.proto}>{protocolName}</Text>
    </GlassCard>
  );
}

function SpeedCard({ large }: { large?: boolean }) {
  const speed = useLive((x) => x.snapshot?.speedKmh?.value ?? null);
  const maxSpeed = useLive((x) => x.sessionMaxSpeed);
  const u = useUnits();
  return (
    <View style={{ alignItems: 'center', marginVertical: large ? S.lg : S.sm }}>
      <Gauge
        value={speed != null ? u.speed(speed) : null}
        max={u.speedUnit === 'mph' ? 30 : 50}
        size={large ? 330 : 260}
        label="Speed"
        unit={u.speedLabel}
        digits={1}
        stroke={large ? 20 : 16}
        sub={maxSpeed != null ? `max ${u.speed(maxSpeed).toFixed(1)} ${u.speedLabel}` : undefined}
      />
    </View>
  );
}

function MiniGauges() {
  const pct = useLive((x) => x.snapshot?.batteryPercent?.value ?? null);
  const motor = useLive((x) => x.snapshot?.motorTempC?.value ?? null);
  const ctrl = useLive((x) => x.snapshot?.controllerTempC?.value ?? null);
  const u = useUnits();
  const temp = motor ?? ctrl;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-around', marginBottom: S.md }}>
      <Gauge value={pct} max={100} size={150} label="Battery" unit="%" colors={[C.green, C.cyan]} />
      <Gauge
        value={temp != null ? u.temp(temp) : null}
        min={u.tempUnit === 'f' ? 32 : 0}
        max={u.tempUnit === 'f' ? 176 : 80}
        size={150}
        label={motor != null ? 'Motor' : 'Controller'}
        unit={u.tempLabel}
        colors={[C.amber, C.sunset]}
      />
    </View>
  );
}

function QuickStats() {
  const s = useLive((x) => x.snapshot);
  const u = useUnits();
  return (
    <Grid cols={3}>
      <StatTile label="Speed" reading={s?.speedKmh} unit={u.speedLabel} convert={u.speed} icon="speedometer-outline" />
      <StatTile label="Battery" reading={s?.batteryPercent} unit="%" digits={0} icon="battery-half-outline" color={C.green} />
      <StatTile label="Power" reading={s?.powerW} unit="W" digits={0} icon="flash-outline" color={C.amber} />
      <StatTile label="Voltage" reading={s?.batteryVoltage} unit="V" />
      <StatTile label="Range est." reading={s?.rangeKm} unit={u.distLabel} convert={u.dist} />
      <StatTile label="Ride mode" text={s?.rideMode?.value ?? null} />
    </Grid>
  );
}

function BatteryCard() {
  const pct = useLive((x) => x.snapshot?.batteryPercent?.value ?? null);
  const charging = useLive((x) => x.battery?.charging?.value);
  const rideActive = useActiveRide((x) => x.active);
  return (
    <Pressable onPress={() => router.push('/battery')}>
      <GlassCard>
        <BatteryBar percent={pct} charging={charging} />
        {rideActive && <Badge text="RIDE RECORDING" color={C.red} icon="radio-button-on" />}
      </GlassCard>
    </Pressable>
  );
}

function AlertsCard() {
  const err = useLive((x) => x.snapshot?.errorCode?.value ?? 0);
  const warn = useLive((x) => x.snapshot?.warningCode?.value ?? 0);
  const n = (err ? 1 : 0) + (warn ? 1 : 0);
  if (!n) return null;
  return (
    <Pressable onPress={() => router.push('/health')}>
      <GlassCard accent={C.amber}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Ionicons name="warning" size={22} color={C.amber} />
          <Text style={{ color: C.text, fontWeight: '700', flex: 1 }}>
            {n} active code{n > 1 ? 's' : ''} reported by the scooter
          </Text>
          <Ionicons name="chevron-forward" size={18} color={C.textDim} />
        </View>
      </GlassCard>
    </Pressable>
  );
}

function PowerCard() {
  const s = useLive((x) => x.snapshot);
  const u = useUnits();
  return (
    <>
      <SectionHeader title="Power" icon="flash-outline" />
      <Grid cols={3}>
        <StatTile label="Voltage" reading={s?.batteryVoltage} unit="V" />
        <StatTile label="Current" reading={s?.batteryCurrent} unit="A" digits={2} />
        <StatTile label="Power" reading={s?.powerW} unit="W" digits={0} />
        <StatTile label="Battery temp" reading={s?.batteryTempC} unit={u.tempLabel} convert={u.temp} digits={0} />
        <StatTile label="Controller" reading={s?.controllerTempC} unit={u.tempLabel} convert={u.temp} />
        <StatTile label="Motor temp" reading={s?.motorTempC} unit={u.tempLabel} convert={u.temp} />
      </Grid>
    </>
  );
}

function DistanceCard() {
  const s = useLive((x) => x.snapshot);
  const maxSpeed = useLive((x) => x.sessionMaxSpeed);
  const u = useUnits();
  return (
    <>
      <SectionHeader title="Distance" icon="map-outline" />
      <Grid cols={3}>
        <StatTile label="Range est." reading={s?.rangeKm} unit={u.distLabel} convert={u.dist} />
        <StatTile label="Odometer" reading={s?.odometerKm} unit={u.distLabel} convert={u.dist} />
        <StatTile label="Trip" reading={s?.tripDistanceKm} unit={u.distLabel} convert={u.dist} digits={2} />
        <StatTile label="Trip time" text={s?.tripTimeSec ? fmtDuration(s.tripTimeSec.value) : null} />
        <StatTile label="Max speed" text={maxSpeed != null ? u.speed(maxSpeed).toFixed(1) : null} unit={u.speedLabel} />
        <StatTile label="Motor RPM" reading={s?.motorRpm} digits={0} />
      </Grid>
    </>
  );
}

function StatusCard() {
  const s = useLive((x) => x.snapshot);
  return (
    <>
      <SectionHeader title="Status" icon="options-outline" right={<Text style={styles.link} onPress={() => router.push('/controls')}>Controls</Text>} />
      <Grid cols={3}>
        <StatTile label="Ride mode" text={s?.rideMode?.value ?? null} />
        <StatTile label="Headlight" text={s?.headlight ? onOff(s.headlight) : null} />
        <StatTile label="Tail light" text={s?.tailLight ? onOff(s.tailLight) : null} />
        <StatTile label="Brake" text={s?.brake ? onOff(s.brake) : null} />
        <StatTile label="Accelerator" reading={s?.accelerator} unit="%" digits={0} />
        <StatTile label="Cruise" text={s?.cruiseControl ? onOff(s.cruiseControl) : null} />
        <StatTile label="Errors" text={s?.errorCode ? (s.errorCode.value === 0 ? 'None' : `E${s.errorCode.value}`) : null} color={C.amber} />
        <StatTile label="Warnings" text={s?.warningCode ? (s.warningCode.value === 0 ? 'None' : `W${s.warningCode.value}`) : null} />
        <StatTile label="Regen" text={s?.regenLevel?.value ?? null} />
      </Grid>
    </>
  );
}

function RideCard() {
  const active = useActiveRide((x) => x.active);
  return (
    <GlassCard style={{ marginTop: S.md }}>
      <NeonButton
        title={active ? 'Stop ride' : 'Start ride'}
        icon={active ? 'stop-circle' : 'play-circle'}
        variant={active ? 'danger' : 'primary'}
        onPress={() => {
          if (active) {
            const r = stopRide();
            if (r) router.push(`/ride/${r.id}`);
          } else startRide().catch(() => undefined);
        }}
      />
    </GlassCard>
  );
}

function ActionsCard() {
  return (
    <>
      <View style={{ flexDirection: 'row', gap: S.md, marginTop: S.lg }}>
        <NeonButton title="Battery" icon="battery-charging" variant="ghost" small style={{ flex: 1 }} onPress={() => router.push('/battery')} />
        <NeonButton title="Motor" icon="cog" variant="ghost" small style={{ flex: 1 }} onPress={() => router.push('/motor')} />
      </View>
      <View style={{ flexDirection: 'row', gap: S.md, marginTop: S.md }}>
        <NeonButton title="Health" icon="pulse" variant="ghost" small style={{ flex: 1 }} onPress={() => router.push('/health')} />
        <NeonButton title="Info" icon="information-circle-outline" variant="ghost" small style={{ flex: 1 }} onPress={() => router.push('/info')} />
      </View>
      <NeonButton title="Disconnect" icon="close-circle-outline" variant="danger" small style={{ marginTop: S.md }} onPress={disconnectScooter} />
    </>
  );
}

function MinimalCard() {
  const speed = useLive((x) => x.snapshot?.speedKmh?.value ?? null);
  const pct = useLive((x) => x.snapshot?.batteryPercent?.value ?? null);
  const u = useUnits();
  return (
    <View style={{ alignItems: 'center', paddingVertical: S.xl }}>
      <Text style={styles.bigSpeed}>{speed != null ? u.speed(speed).toFixed(1) : '--'}</Text>
      <Text style={styles.bigUnit}>{speed != null ? u.speedLabel : 'Speed not available'}</Text>
      <Text style={styles.bigBattery}>{pct != null ? `${pct.toFixed(0)}%` : 'Battery not available'}</Text>
    </View>
  );
}

function PerfCard() {
  const s = useLive((x) => x.snapshot);
  const u = useUnits();
  const accel = useAccel();
  return (
    <>
      <SectionHeader title="Performance" icon="rocket-outline" right={<Text style={styles.link} onPress={() => router.push('/performance')}>Details</Text>} />
      <Grid cols={3}>
        <StatTile label="Speed" reading={s?.speedKmh} unit={u.speedLabel} convert={u.speed} />
        <StatTile label="Power" reading={s?.powerW} unit="W" digits={0} />
        <StatTile label="Accel." text={accel != null ? accel.toFixed(1) : null} unit="m/s²" confidence="calculated" source="Calculated" />
        <StatTile label="Motor RPM" reading={s?.motorRpm} digits={0} />
        <StatTile label="Motor" reading={s?.motorTempC} unit={u.tempLabel} convert={u.temp} />
        <StatTile label="Controller" reading={s?.controllerTempC} unit={u.tempLabel} convert={u.temp} />
      </Grid>
    </>
  );
}

/** Latest scooter-speed-derived acceleration, refreshed with the throttled history version. */
function useAccel(): number | null {
  useHistoryVersion();
  const a = getSeries('accel');
  const last = a[a.length - 1];
  return last && Date.now() - last.t < 3000 ? last.v : null;
}

function BatteryDetailCard() {
  const s = useLive((x) => x.snapshot);
  const pts = useActiveRide((x) => x.points);
  const whKm = useMemo(() => {
    if (pts.length < 2) return null;
    const r = summarizeRide(pts, pts[0].t, pts[pts.length - 1].t);
    return r.whPerKm ?? null;
  }, [pts]);
  return (
    <>
      <SectionHeader title="Battery detail" icon="battery-charging-outline" right={<Text style={styles.link} onPress={() => router.push('/voltage')}>Voltage sag</Text>} />
      <Grid cols={3}>
        <StatTile label="Voltage" reading={s?.batteryVoltage} unit="V" />
        <StatTile label="Current" reading={s?.batteryCurrent} unit="A" digits={2} />
        <StatTile label="Wh/km (ride)" text={whKm != null ? whKm.toFixed(1) : null} confidence="calculated" source="Calculated" />
      </Grid>
    </>
  );
}

function BleCard() {
  const rssi = useLive((x) => x.rssi);
  const protocol = useLive((x) => x.protocolName);
  const name = useLive((x) => x.deviceName);
  return (
    <Pressable onPress={() => router.push('/bluetooth')}>
      <GlassCard>
        <SectionHeader title="Bluetooth link" icon="bluetooth-outline" />
        <Grid cols={3}>
          <StatTile label="RSSI" text={rssi != null ? String(rssi) : null} unit="dBm" confidence="measured" source="Scooter BLE" />
          <StatTile label="Quality" text={rssi != null ? rssiQuality(rssi).label : null} />
          <StatTile label="Device" text={name ?? null} />
        </Grid>
        <Text style={styles.proto}>{protocol ?? 'Protocol not identified'}</Text>
      </GlassCard>
    </Pressable>
  );
}

function CockpitLaunch() {
  return <NeonButton title="Open Cockpit mode" icon="expand-outline" onPress={() => router.push('/cockpit')} style={{ marginBottom: S.md }} />;
}

export function DashCard({ id }: { id: CardId }) {
  switch (id) {
    case 'header':
      return <HeaderCard />;
    case 'speed':
      return <SpeedCard />;
    case 'speedLarge':
      return <SpeedCard large />;
    case 'miniGauges':
      return <MiniGauges />;
    case 'quick':
      return <QuickStats />;
    case 'battery':
      return <BatteryCard />;
    case 'alerts':
      return <AlertsCard />;
    case 'energy':
      return <EnergyFlow />;
    case 'temps':
      return <TemperatureCards />;
    case 'power':
      return <PowerCard />;
    case 'distance':
      return <DistanceCard />;
    case 'status':
      return <StatusCard />;
    case 'ride':
      return <RideCard />;
    case 'actions':
      return <ActionsCard />;
    case 'minimal':
      return <MinimalCard />;
    case 'range':
      return <RangeCard />;
    case 'scooter3d':
      return <Scooter3DCard />;
    case 'perf':
      return <PerfCard />;
    case 'batteryDetail':
      return <BatteryDetailCard />;
    case 'ble':
      return <BleCard />;
    case 'cockpit':
      return <CockpitLaunch />;
  }
}

const styles = StyleSheet.create({
  link: { get color() { return C.purpleLight; }, fontWeight: '700', fontSize: 13 },
  model: { color: C.text, fontSize: 26, fontWeight: '900', letterSpacing: -0.5, marginTop: 2 },
  nick: { get color() { return C.purpleLight; }, fontSize: 13, marginTop: 2 },
  connRow: { flexDirection: 'row', gap: S.lg, marginTop: S.md },
  connText: { color: C.textDim, fontSize: 12.5 },
  proto: { color: C.textFaint, fontSize: 11, marginTop: 6 },
  bigSpeed: { color: C.text, fontSize: 120, fontWeight: '900', letterSpacing: -4, fontVariant: ['tabular-nums'] },
  bigUnit: { color: C.textDim, fontSize: 22, fontWeight: '700', marginTop: -10 },
  bigBattery: { color: C.green, fontSize: 44, fontWeight: '800', marginTop: S.lg },
});
