import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Switch, Text, TextInput, View } from 'react-native';
import { modelById } from '../../data/scooterDatabase';
import { aggregate } from '../../services/stats';
import { useErrors } from '../../store/errors';
import { useGarage } from '../../store/garage';
import { useLive } from '../../store/live';
import { isDefaultItem, maintenanceStatus, useMaintenance } from '../../store/maintenance';
import { useRides } from '../../store/rides';
import { useSettings } from '../../store/settings';
import { Badge, Divider, EmptyState, GlassCard, Grid, KeyValue, ListRow, NeonButton, Note, SectionHeader, StatTile } from '../../ui/components/Glass';
import { Screen } from '../../ui/components/Screen';
import { useNow } from '../../ui/hooks';
import { C, S, severityColor } from '../../ui/theme';
import { NA, fmtDate, fmtDateTime, fmtDuration, maskSerial, useUnits } from '../../utils/format';
import { ScooterAvatar } from '../garage';
import { Scooter3DCard } from '../../ui/components/Scooter3D';

const RIDES_SHOWN = 8;

export default function ScooterProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const p = useGarage((s) => s.scooters.find((x) => x.id === id));
  const setActive = useGarage((s) => s.setActive);
  const update = useGarage((s) => s.update);
  const remove = useGarage((s) => s.remove);
  const allRides = useRides((s) => s.rides);
  const rides = useMemo(() => allRides.filter((r) => r.scooterId === id).sort((a, b) => b.start - a.start), [allRides, id]);
  const allItems = useMaintenance((s) => s.items);
  const items = useMemo(() => allItems.filter((i) => i.scooterId === id), [allItems, id]);
  const ensure = useMaintenance((s) => s.ensureDefaults);
  const removeMaint = useMaintenance((s) => s.removeForScooter);
  const allErrors = useErrors((s) => s.records);
  const errors = useMemo(() => allErrors.filter((e) => e.scooterId === id).sort((a, b) => b.lastSeen - a.lastSeen), [allErrors, id]);
  const liveOdo = useLive((s) => (s.scooterId === id ? s.snapshot?.odometerKm?.value ?? null : null));
  const battery = useLive((s) => (s.scooterId === id ? s.battery : null));
  const isLive = useLive((s) => s.scooterId === id && s.conn === 'connected');
  const hide = useSettings((s) => s.hideSerials);
  const u = useUnits();
  const now = useNow(isLive ? 1000 : 60000);
  const [allRidesShown, setAllRidesShown] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  useEffect(() => {
    if (id) ensure(id);
  }, [id, ensure]);

  const agg = useMemo(() => aggregate(rides), [rides]);
  const stats = useMemo(() => {
    const cons = rides.filter((r) => r.batteryStart != null && r.batteryEnd != null).map((r) => r.batteryStart! - r.batteryEnd!);
    return { cons: cons.length ? cons.reduce((a, b) => a + b, 0) / cons.length : null };
  }, [rides]);

  if (!p) return <Screen contentStyle={{ paddingTop: 110 }}><EmptyState icon="alert" title="Scooter not found" /></Screen>;
  const model = modelById(p.modelId);
  const id_ = p.identity;
  const odo = liveOdo ?? p.lastOdometerKm;
  const last = (name: string) => items.find((i) => isDefaultItem(i.name, name))?.history[0]?.date ?? null;
  const withStatus = items.map((i) => ({ i, st: maintenanceStatus(i, odo) }));
  const dueItems = withStatus.filter((x) => x.st.nextDate != null).sort((a, b) => a.st.nextDate! - b.st.nextDate!);
  const nDue = withStatus.filter((x) => x.st.status === 'due' && (x.i.history.length > 0 || x.i.nextDate != null)).length;
  const nSoon = withStatus.filter((x) => x.st.status === 'due-soon').length;
  const serial = id_?.serial?.value ? (hide ? maskSerial(id_.serial.value) : id_.serial.value) : NA;
  const connections = p.connections ?? [];
  const autoConnect = p.autoConnect !== false;
  const shownRides = allRidesShown ? rides : rides.slice(0, RIDES_SHOWN);
  const openMaintenance = () => {
    setActive(p.id);
    router.push('/maintenance');
  };

  return (
    <Screen contentStyle={{ paddingTop: 110 }}>
      {/* Overview */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, marginBottom: S.md }}>
        <ScooterAvatar p={p} size={64} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.text, fontSize: 28, fontWeight: '900', letterSpacing: -0.5, textTransform: 'uppercase' }} numberOfLines={2}>{p.nickname}</Text>
          <Text style={{ color: C.purpleLight }}>{model ? `${model.manufacturer} ${model.model}` : id_?.model?.value ? `${id_.manufacturer?.value ?? ''} ${id_.model.value}` : 'Generic profile'}</Text>
        </View>
        {isLive && <Badge text="LIVE" color={C.green} />}
      </View>

      <Scooter3DCard live={isLive} />

      <SectionHeader title="Overview" icon="information-circle-outline" />
      <GlassCard>
        <KeyValue label="Model" value={model?.model ?? id_?.model?.value ?? NA} note={p.manualModel ? 'selected manually' : id_?.modelInferred ? 'from protocol match' : undefined} />
        <KeyValue label="Serial number" value={serial} mono />
        <KeyValue label="Protocol" value={p.protocolId ?? NA} />
        <KeyValue label="Total mileage" value={odo != null ? u.dist(odo).toFixed(1) : NA} unit={u.distLabel} note={liveOdo == null && odo != null ? 'last odometer reading' : undefined} />
        <KeyValue label="Distance in recorded rides" value={u.dist(agg.distanceKm).toFixed(1)} unit={u.distLabel} />
        <KeyValue label="Scooter-reported ride time" value={p.totalRideTimeSec != null ? fmtDuration(p.totalRideTimeSec) : NA} />
        <KeyValue label="Battery (BMS) firmware" value={id_?.bmsFirmware?.value ?? battery?.firmware?.value ?? NA} />
        <KeyValue label="First connected" value={fmtDateTime(p.firstConnected)} />
        <KeyValue label="Last connected" value={isLive ? 'Now' : fmtDateTime(p.lastConnected)} />
        {!!id_?.modelInferred && <Note>{id_.modelInferred}</Note>}
      </GlassCard>

      {/* Rides */}
      <SectionHeader title={`Rides (${rides.length})`} icon="navigate-outline" />
      {rides.length === 0 ? (
        <EmptyState icon="navigate-outline" title="No rides recorded" body="Rides recorded while this scooter is connected appear here." />
      ) : (
        <GlassCard style={{ paddingVertical: S.xs }}>
          {shownRides.map((r, i) => (
            <View key={r.id}>
              {i > 0 && <Divider />}
              <ListRow
                icon="navigate"
                title={`Ride #${r.number} · ${u.dist(r.distanceKm).toFixed(2)} ${u.distLabel}`}
                subtitle={`${fmtDateTime(r.start)} · ${fmtDuration(r.durationSec)}${r.maxSpeedKmh != null ? ` · max ${u.speed(r.maxSpeedKmh).toFixed(0)} ${u.speedLabel}` : ''}`}
                onPress={() => router.push({ pathname: '/ride/[id]', params: { id: r.id } })}
              />
            </View>
          ))}
          {rides.length > RIDES_SHOWN && <NeonButton small variant="ghost" title={allRidesShown ? 'Show fewer' : `Show all ${rides.length}`} onPress={() => setAllRidesShown((v) => !v)} style={{ marginVertical: S.sm }} />}
        </GlassCard>
      )}

      {/* Stats */}
      <SectionHeader title="Statistics" icon="stats-chart-outline" />
      <Grid>
        <StatTile label="Rides" text={String(agg.rides)} icon="repeat-outline" />
        <StatTile label="Distance" text={u.dist(agg.distanceKm).toFixed(1)} unit={u.distLabel} icon="map-outline" />
        <StatTile label="Riding time" text={agg.rides ? fmtDuration(agg.timeSec) : null} icon="time-outline" />
        <StatTile label="Max speed (rides)" text={agg.maxSpeedKmh != null ? u.speed(agg.maxSpeedKmh).toFixed(1) : null} unit={u.speedLabel} icon="speedometer-outline" />
        <StatTile label="Energy used" text={agg.energyWh != null ? agg.energyWh.toFixed(0) : null} unit="Wh" icon="flash-outline" />
        <StatTile label="Avg consumption" text={agg.avgWhPerKm != null ? agg.avgWhPerKm.toFixed(1) : null} unit="Wh/km" icon="leaf-outline" />
      </Grid>
      <GlassCard style={{ marginTop: S.sm }}>
        <KeyValue label="Highest recorded speed" value={p.highestSpeedKmh != null ? u.speed(p.highestSpeedKmh).toFixed(1) : NA} unit={u.speedLabel} note="from live telemetry" />
        <KeyValue label="Average ride distance" value={agg.avgDistanceKm != null ? u.dist(agg.avgDistanceKm).toFixed(2) : NA} unit={u.distLabel} />
        <KeyValue label="Average ride duration" value={agg.avgDurationSec != null ? fmtDuration(agg.avgDurationSec) : NA} />
        <KeyValue label="Average battery per ride" value={stats.cons != null ? stats.cons.toFixed(1) : NA} unit="%" />
        <KeyValue label="Longest ride" value={agg.longest ? `${u.dist(agg.longest.distanceKm).toFixed(2)} ${u.distLabel} · ${fmtDate(agg.longest.start)}` : NA} />
        <KeyValue label="Most efficient ride" value={agg.mostEfficient ? `#${agg.mostEfficient.number} · ${fmtDate(agg.mostEfficient.start)}` : NA} />
      </GlassCard>

      {/* Maintenance summary */}
      <SectionHeader title="Maintenance" icon="construct-outline" right={<Text style={{ color: C.purpleLight, fontWeight: '700' }} onPress={openMaintenance}>Open</Text>} />
      <GlassCard>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: S.sm }}>
          <Badge text={`${nDue} DUE`} color={nDue ? C.red : C.textDim} />
          <Badge text={`${nSoon} DUE SOON`} color={nSoon ? C.amber : C.textDim} />
        </View>
        <KeyValue label="Last tire check" value={fmtDate(last('Tires'))} />
        <KeyValue label="Last brake check" value={fmtDate(last('Brakes'))} />
        <KeyValue label="Last cleaning" value={fmtDate(last('Cleaning'))} />
        <KeyValue label="Last service" value={fmtDate(items.flatMap((i) => i.history).sort((a, b) => b.date - a.date)[0]?.date)} />
        <KeyValue label="Next inspection" value={dueItems[0] ? `${dueItems[0].i.name} · ${fmtDate(dueItems[0].st.nextDate)}` : 'Set intervals in Maintenance'} />
        <NeonButton small variant="ghost" icon="construct-outline" title="Open maintenance" onPress={openMaintenance} style={{ marginTop: S.sm }} />
      </GlassCard>

      {/* Errors */}
      <SectionHeader title={`Error history (${errors.length})`} icon="warning-outline" />
      {errors.length === 0 ? (
        <GlassCard><Text style={{ color: C.textDim }}>No error or warning codes reported by this scooter.</Text></GlassCard>
      ) : (
        <GlassCard style={{ paddingVertical: S.xs }}>
          {errors.slice(0, 20).map((e, i) => (
            <View key={e.key}>
              {i > 0 && <Divider />}
              <ListRow
                icon={e.kind === 'warning' ? 'alert-circle-outline' : 'warning-outline'}
                color={severityColor(e.severity)}
                title={`${e.kind === 'warning' ? 'Warning' : 'Error'} ${e.code} · ${e.title}`}
                subtitle={`Last ${fmtDateTime(e.lastSeen)} · first ${fmtDate(e.firstSeen)} · ${e.occurrences}×`}
                right={e.active ? <Badge text="ACTIVE" color={C.red} /> : undefined}
              />
            </View>
          ))}
        </GlassCard>
      )}

      {/* Firmware */}
      <SectionHeader title="Firmware (last seen)" icon="hardware-chip-outline" />
      <GlassCard>
        <KeyValue label="Main / ESC" value={id_?.firmware?.value ?? NA} />
        <KeyValue label="Controller" value={id_?.controllerFirmware?.value ?? NA} />
        <KeyValue label="BMS" value={id_?.bmsFirmware?.value ?? battery?.firmware?.value ?? NA} />
        <KeyValue label="BLE module" value={id_?.bleFirmware?.value ?? NA} />
        <KeyValue label="Hardware" value={id_?.hardware?.value ?? NA} />
        <KeyValue label="Protocol version" value={id_?.protocolVersion?.value ?? NA} />
        <Note>{id_ ? `Read from the scooter on ${fmtDateTime(p.lastConnected)}.` : 'Connect this scooter to read its firmware versions.'}</Note>
      </GlassCard>

      {/* Connection history */}
      <SectionHeader title={`Connection history (${connections.length})`} icon="bluetooth-outline" />
      {connections.length === 0 ? (
        <GlassCard><Text style={{ color: C.textDim }}>No connections logged yet.</Text></GlassCard>
      ) : (
        <GlassCard style={{ paddingVertical: S.xs }}>
          <KeyValue label="Total connected time" value={fmtDuration(connections.reduce((a, c) => a + ((c.end ?? (isLive ? now : c.start)) - c.start) / 1000, 0))} />
          {connections.slice(0, 15).map((c, i) => {
            const open = c.end == null;
            const dur = open ? (isLive && i === 0 ? (now - c.start) / 1000 : null) : (c.end! - c.start) / 1000;
            return (
              <View key={`${c.start}-${i}`}>
                <Divider />
                <KeyValue
                  label={fmtDateTime(c.start)}
                  value={dur != null ? fmtDuration(dur) : NA}
                  note={`${c.protocol ?? 'unknown protocol'}${open ? (isLive && i === 0 ? ' · connected now' : ' · end not recorded') : ''}`}
                />
              </View>
            );
          })}
        </GlassCard>
      )}

      {/* Settings */}
      <SectionHeader title="Settings" icon="settings-outline" />
      <GlassCard>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.text, fontWeight: '700' }}>Auto-connect</Text>
            <Text style={{ color: C.textDim, fontSize: 12.5 }}>Allow the app to connect to this scooter automatically.</Text>
          </View>
          <Switch value={autoConnect} onValueChange={(v) => update(p.id, { autoConnect: v })} trackColor={{ true: C.purple }} />
        </View>
        <Divider />
        {renaming ? (
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: S.sm }}>
            <TextInput value={name} onChangeText={setName} autoFocus placeholder="Scooter name" placeholderTextColor={C.textFaint} style={{ flex: 1, color: C.text, borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 12, height: 42 }} />
            <NeonButton small title="Save" disabled={!name.trim()} onPress={() => { update(p.id, { nickname: name.trim() }); setRenaming(false); }} />
          </View>
        ) : (
          <ListRow icon="pencil" title="Rename" subtitle={p.nickname} onPress={() => { setName(p.nickname); setRenaming(true); }} />
        )}
        <ListRow icon="image-outline" title="Icon & photo" subtitle="Edit in My scooters" onPress={() => router.push('/garage')} />
        <NeonButton title="Make active scooter" variant="ghost" small icon="star-outline" onPress={() => setActive(p.id)} style={{ marginTop: S.md }} />
        <NeonButton
          title="Delete profile"
          variant="danger"
          small
          icon="trash-outline"
          style={{ marginTop: S.md }}
          onPress={() => Alert.alert('Delete profile?', 'Maintenance items for this scooter are removed. Rides stay in history.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => { removeMaint(p.id); remove(p.id); router.back(); } }])}
        />
      </GlassCard>
    </Screen>
  );
}
