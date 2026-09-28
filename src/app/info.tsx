import React from 'react';
import { Text } from 'react-native';
import { modelById, modelFullName } from '../data/scooterDatabase';
import { useGarage } from '../store/garage';
import { useLive } from '../store/live';
import { useSettings } from '../store/settings';
import { Badge, Divider, EmptyState, GlassCard, KeyValue, Note, SectionHeader } from '../ui/components/Glass';
import { FadeIn } from '../ui/components/Motion';
import { Screen } from '../ui/components/Screen';
import { C, S } from '../ui/theme';
import { NA, fmtDateTime, fmtDuration, fmtReading, maskSerial, rssiQuality, useUnits } from '../utils/format';

/**
 * Advanced scooter information. Every value is either reported by the scooter,
 * a manufacturer spec from the local model database (labelled "spec"), or
 * something the app logged itself (connection times). Nothing is estimated.
 */
export default function InfoScreen() {
  const conn = useLive((s) => s.conn);
  const liveScooterId = useLive((s) => s.scooterId);
  const activeId = useGarage((s) => s.activeId);
  const profileId = liveScooterId ?? activeId;
  const profile = useGarage((s) => s.scooters.find((x) => x.id === profileId) ?? null);
  const liveIdentity = useLive((s) => s.identity);
  const battery = useLive((s) => s.battery);
  const snapshot = useLive((s) => s.snapshot);
  const extrasLive = useLive((s) => s.extras);
  const rssi = useLive((s) => s.rssi);
  const protocolName = useLive((s) => s.protocolName);
  const deviceName = useLive((s) => s.deviceName);
  const deviceId = useLive((s) => s.deviceId);
  const hide = useSettings((s) => s.hideSerials);
  const u = useUnits();

  if (!profile && !liveIdentity) {
    return (
      <Screen contentStyle={{ paddingTop: 110 }}>
        <EmptyState icon="information-circle-outline" title="No scooter yet" body="Connect a scooter once and its reported information appears here." />
      </Screen>
    );
  }

  const connected = conn === 'connected' && liveScooterId === profile?.id;
  // Live values only belong to this profile while it is connected.
  const identity = connected ? liveIdentity : profile?.identity ?? null;
  const b = connected ? battery : null;
  const snap = connected ? snapshot : null;
  const extras = connected ? extrasLive : null;
  const model = modelById(profile?.modelId);
  const serial = (v: string | null | undefined) => (v ? (hide ? maskSerial(v) : v) : NA);

  const liveOdo = snap?.odometerKm?.value ?? null;
  const odo = liveOdo ?? profile?.lastOdometerKm ?? null;
  const rideTime = extras?.totalRideTimeSec?.value ?? profile?.totalRideTimeSec ?? null;
  const rideTimeStale = extras?.totalRideTimeSec == null && profile?.totalRideTimeSec != null;
  const connections = profile?.connections ?? [];
  const oldestLogged = connections.length ? connections[connections.length - 1].start : null;
  const firstConn = profile?.firstConnected ?? oldestLogged;
  const q = rssiQuality(connected ? rssi : null);
  const reportedModel = identity?.model?.value ? `${identity.manufacturer?.value ? `${identity.manufacturer.value} ` : ''}${identity.model.value}` : NA;

  return (
    <Screen contentStyle={{ paddingTop: 110 }}>
      <Text style={{ color: C.text, fontSize: 26, fontWeight: '900', letterSpacing: -0.5 }}>{profile?.nickname ?? identity?.bleName ?? 'Scooter'}</Text>
      <Badge text={connected ? 'CONNECTED · LIVE VALUES' : 'NOT CONNECTED · LAST KNOWN VALUES'} color={connected ? C.green : C.textFaint} icon={connected ? 'bluetooth' : 'bluetooth-outline'} />

      <FadeIn index={0}>
        <SectionHeader title="Identity" icon="finger-print-outline" />
        <GlassCard>
          <KeyValue label="Model (reported by scooter)" value={reportedModel} />
          <KeyValue label="Model (database)" value={model ? modelFullName(model) : NA} note={model ? (profile?.manualModel ? 'selected manually' : 'from model database') : undefined} />
          {!!identity?.modelInferred && <Note>{identity.modelInferred}</Note>}
          <Divider />
          <KeyValue label="Protocol" value={(connected ? protocolName : null) ?? profile?.protocolId ?? NA} />
          <KeyValue label="Protocol version (reported)" value={identity?.protocolVersion?.value ?? NA} />
          <KeyValue label="BLE name" value={(connected ? deviceName : null) ?? identity?.bleName ?? profile?.bleName ?? NA} />
          <KeyValue label="BLE id" value={(connected ? deviceId : null) ?? identity?.bleId ?? profile?.bleId ?? NA} mono />
          <KeyValue label="Serial number" value={serial(identity?.serial?.value)} mono note={hide && identity?.serial ? 'masked (Settings)' : undefined} />
          <KeyValue label="Hardware version" value={identity?.hardware?.value ?? NA} />
        </GlassCard>
      </FadeIn>

      <FadeIn index={1}>
        <SectionHeader title="Firmware (as reported)" icon="code-working-outline" />
        <GlassCard>
          <KeyValue label="Firmware" value={identity?.firmware?.value ?? NA} />
          <KeyValue label="ESC / controller" value={identity?.controllerFirmware?.value ?? NA} />
          <KeyValue label="BMS" value={identity?.bmsFirmware?.value ?? b?.firmware?.value ?? NA} />
          <KeyValue label="BLE module" value={identity?.bleFirmware?.value ?? NA} />
        </GlassCard>
      </FadeIn>

      <FadeIn index={2}>
        <SectionHeader title="Battery" icon="battery-half-outline" />
        <GlassCard>
          <KeyValue label="Factory capacity (BMS reported)" value={fmtReading(b?.factoryCapacityMah ?? null, 0)} unit="mAh" />
          <KeyValue label="Actual capacity (BMS estimate)" value={fmtReading(b?.actualCapacityMah ?? null, 0)} unit="mAh" />
          <KeyValue label="Full charge cycles" value={fmtReading(b?.cycles ?? null, 0)} />
          <KeyValue label="Charge count" value={fmtReading(b?.chargeCount ?? null, 0)} />
          <KeyValue label="Battery serial" value={serial(b?.serial?.value)} mono />
          <KeyValue label="Chemistry" value={extras?.batteryChemistry?.value ?? NA} />
          <KeyValue label="BMS manufacture date" value={b?.manufactureDate?.value ?? NA} />
          <KeyValue label="BMS manufacture date word" value={extras?.bmsManufactureDateRaw?.value ?? NA} mono note={extras?.bmsManufactureDateRaw ? 'raw, format undocumented' : undefined} />
          <Divider />
          <KeyValue label="Nominal voltage" value={model?.batteryVoltage != null ? String(model.batteryVoltage) : NA} unit="V" note={model?.batteryVoltage != null ? 'manufacturer spec' : undefined} />
          <KeyValue label="Maximum voltage" value={NA} note="not in the model database" />
          <KeyValue label="Energy capacity" value={model?.batteryCapacityWh != null ? String(model.batteryCapacityWh) : NA} unit="Wh" note={model?.batteryCapacityWh != null ? 'manufacturer spec' : undefined} />
          <KeyValue label="Charge capacity" value={model?.batteryCapacityAh != null ? String(model.batteryCapacityAh) : NA} unit="Ah" note={model?.batteryCapacityAh != null ? 'manufacturer spec' : undefined} />
          <Note>Spec values are manufacturer headline figures for the base variant, not measurements from your scooter.</Note>
        </GlassCard>
      </FadeIn>

      <FadeIn index={3}>
        <SectionHeader title="Usage" icon="speedometer-outline" />
        <GlassCard>
          <KeyValue label="Odometer" value={odo != null ? u.dist(odo).toFixed(1) : NA} unit={u.distLabel} note={liveOdo == null && odo != null ? 'last reading' : undefined} />
          <KeyValue label="Total riding time" value={fmtDuration(rideTime)} note={rideTimeStale ? 'last reading' : rideTime != null ? 'scooter reported' : undefined} />
          <KeyValue label="Total power-on time" value={fmtDuration(extras?.totalPowerOnSec?.value ?? null)} note={extras?.totalPowerOnSec ? 'scooter reported' : undefined} />
          <KeyValue label="Signal (RSSI)" value={connected && rssi != null ? String(rssi) : NA} unit="dBm" note={connected && rssi != null ? q.label : undefined} />
        </GlassCard>
      </FadeIn>

      <FadeIn index={4}>
        <SectionHeader title="Connections" icon="link-outline" />
        <GlassCard>
          <KeyValue label="First connection" value={fmtDateTime(firstConn)} />
          <KeyValue label="Last connection" value={fmtDateTime(profile?.lastConnected ?? null)} />
          <KeyValue label="Logged connections" value={String(connections.length)} note="app keeps the latest 50" />
          {connections.slice(0, 5).map((c, i) => (
            <KeyValue
              key={`${c.start}-${i}`}
              label={fmtDateTime(c.start)}
              value={c.end != null ? fmtDuration((c.end - c.start) / 1000) : i === 0 && connected ? 'active' : NA}
              note={c.protocol ?? undefined}
              dim
            />
          ))}
          <Note>Connection times are logged by Scooter Hub on this phone.</Note>
        </GlassCard>
      </FadeIn>
      <Text style={{ color: C.textFaint, fontSize: 11, marginTop: S.sm, textAlign: 'center' }}>{NA} means the scooter or its protocol does not expose that value.</Text>
    </Screen>
  );
}
