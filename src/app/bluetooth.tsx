import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ScannedDevice, requestBlePermissions, startScan, stopScan } from '../ble/BluetoothManager';
import { UUID, shortUuid, uuidName } from '../ble/uuids';
import { SCOOTER_MODELS } from '../data/scooterDatabase';
import { connectScooter, disconnectScooter } from '../services/ScooterManager';
import { useGarage } from '../store/garage';
import { useLive } from '../store/live';
import { useMaintenance } from '../store/maintenance';
import { useSettings } from '../store/settings';
import { ConnectionStepper } from '../ui/components/ConnectionStepper';
import { Badge, Divider, EmptyState, GlassCard, KeyValue, ListRow, NeonButton, Note, SectionHeader } from '../ui/components/Glass';
import { Screen } from '../ui/components/Screen';
import { SignalBars } from '../ui/components/SignalBars';
import { useNow, useScooterTitle } from '../ui/hooks';
import { C, F, S } from '../ui/theme';
import { NA, fmtDateTime, fmtDuration, rssiQuality } from '../utils/format';

/** A device counts as a supported scooter when it advertises the UART service or matches a known model name. */
const isSupported = (d: ScannedDevice) => d.serviceUUIDs.includes(UUID.NUS_SERVICE) || (!!d.name && SCOOTER_MODELS.some((m) => m.bleNamePattern?.test(d.name!)));

/** Scan-phase states only apply while no connection is in progress or up. */
const BUSY = new Set(['connecting', 'identifying', 'reconnecting', 'connected']);
function setScanConn(next: 'scanning' | 'found' | 'idle') {
  const live = useLive.getState();
  if (BUSY.has(live.conn)) return;
  if (next === 'idle' && live.conn !== 'scanning' && live.conn !== 'found') return;
  if (live.conn !== next) live.patch({ conn: next, connError: null });
}

export default function BluetoothScreen() {
  const params = useLocalSearchParams<{ scan?: string }>();
  const adapter = useLive((s) => s.adapter);
  const conn = useLive((s) => s.conn);
  const deviceId = useLive((s) => s.deviceId);
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<Record<string, ScannedDevice>>({});
  const [showAll, setShowAll] = useState(false);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const foundRef = useRef(false);

  const scan = useCallback(async () => {
    if (!(await requestBlePermissions())) {
      Alert.alert('Permission needed', 'Allow Bluetooth access in system settings to scan for scooters.');
      return;
    }
    setDevices({});
    setScanning(true);
    foundRef.current = false;
    setScanConn('scanning');
    startScan(
      (d) => {
        setDevices((prev) => ({ ...prev, [d.id]: { ...prev[d.id], ...d, name: d.name ?? prev[d.id]?.name ?? null } }));
        if (!foundRef.current && isSupported(d)) {
          foundRef.current = true;
          setScanConn('found');
        }
      },
      (e) => {
        setScanning(false);
        setScanConn('idle');
        Alert.alert('Scan failed', e.message);
      },
    );
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = setTimeout(() => {
      stopScan();
      setScanning(false);
      if (!foundRef.current) setScanConn('idle');
    }, 15000);
  }, []);

  useEffect(() => {
    if (params.scan === '1' && adapter === 'PoweredOn') scan();
    return () => {
      stopScan();
      if (stopTimer.current) clearTimeout(stopTimer.current);
      setScanConn('idle');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter]);

  const list = Object.values(devices)
    .filter((d) => showAll || d.name || d.serviceUUIDs.includes(UUID.NUS_SERVICE))
    .sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));

  const connecting = conn === 'connecting' || conn === 'identifying' || conn === 'reconnecting';

  return (
    <Screen contentStyle={{ paddingTop: 110 }}>
      <GlassCard>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View>
            <Text style={F.label}>Adapter</Text>
            <Text style={styles.big}>{adapter === 'PoweredOn' ? 'Bluetooth on' : adapter === 'PoweredOff' ? 'Bluetooth off' : adapter}</Text>
          </View>
          <Ionicons name="bluetooth" size={34} color={adapter === 'PoweredOn' ? C.cyan : C.textFaint} />
        </View>
        {adapter === 'PoweredOff' && <Note color={C.amber}>Turn Bluetooth on in your phone settings.</Note>}
        {adapter === 'Unsupported' && <Note color={C.amber}>This build has no BLE support. Use a development build on a real device (Expo Go cannot load the BLE module).</Note>}
      </GlassCard>

      <ConnectionStepper />

      {(conn === 'connected' || connecting) && <ConnectedCard />}

      <SectionHeader
        title={scanning ? 'Scanning…' : 'Nearby devices'}
        icon="radio-outline"
        right={
          <Pressable onPress={() => setShowAll((v) => !v)}>
            <Text style={styles.link}>{showAll ? 'Named only' : 'Show all'}</Text>
          </Pressable>
        }
      />
      <NeonButton title={scanning ? 'Stop scan' : 'Scan for scooters'} icon={scanning ? 'stop' : 'scan'} variant={scanning ? 'ghost' : 'primary'} onPress={() => (scanning ? (stopScan(), setScanning(false), foundRef.current || setScanConn('idle')) : scan())} disabled={adapter !== 'PoweredOn'} style={{ marginBottom: S.md }} />
      {list.length === 0 ? (
        <EmptyState icon="search" title={scanning ? 'Looking for devices…' : 'No devices yet'} body="Power on the scooter and keep your phone close to it." />
      ) : (
        <GlassCard style={{ paddingVertical: S.xs }}>
          {list.map((d, i) => {
            const q = rssiQuality(d.rssi);
            const nus = d.serviceUUIDs.includes(UUID.NUS_SERVICE);
            return (
              <View key={d.id}>
                {i > 0 && <Divider />}
                <ListRow
                  icon={nus ? 'bicycle' : 'hardware-chip-outline'}
                  color={nus ? C.purpleLight : C.textDim}
                  title={d.name ?? 'Unnamed device'}
                  subtitle={`${d.id}${d.rssi != null ? ` · ${d.rssi} dBm` : ''}${nus ? ' · UART service' : ''}`}
                  right={<SignalBars bars={q.bars} />}
                  onPress={() => {
                    stopScan();
                    setScanning(false);
                    connectScooter(d.id, d.name);
                  }}
                />
              </View>
            );
          })}
        </GlassCard>
      )}
      {Platform.OS === 'ios' && <Note>iOS does not expose MAC addresses; the identifier shown is assigned by iOS for this phone.</Note>}

      <SavedScooters activeDeviceId={conn === 'connected' ? deviceId : null} />

      <ServicesCard />
      {conn === 'connected' && <NeonButton title="Disconnect" icon="close-circle-outline" variant="danger" onPress={disconnectScooter} style={{ marginTop: S.md }} />}
    </Screen>
  );
}

function ConnectedCard() {
  const conn = useLive((s) => s.conn);
  const rssi = useLive((s) => s.rssi);
  const connectedAt = useLive((s) => s.connectedAt);
  const deviceName = useLive((s) => s.deviceName);
  const deviceId = useLive((s) => s.deviceId);
  const note = useLive((s) => s.detectionNote);
  const reconnect = useSettings((s) => s.reconnect);
  const { title } = useScooterTitle();
  const now = useNow();
  return (
    <GlassCard accent={conn === 'connected' ? C.green : C.amber}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={styles.big}>{deviceName ?? 'Device'}</Text>
        <Badge text={conn.toUpperCase()} color={conn === 'connected' ? C.green : C.amber} />
      </View>
      <KeyValue label="Identified as" value={conn === 'connected' ? title : '…'} />
      <KeyValue label="Identifier" value={deviceId ?? NA} mono />
      <KeyValue label="Signal (RSSI)" value={rssi != null ? `${rssi} dBm (${rssiQuality(rssi).label})` : NA} />
      <KeyValue label="Connected for" value={connectedAt ? fmtDuration((now - connectedAt) / 1000) : NA} />
      <KeyValue label="Auto-reconnect" value={reconnect === 'auto' ? 'On' : 'Off'} />
      {!!note && <Note>{note}</Note>}
      {conn === 'connected' && <NeonButton title="Choose model manually" small variant="ghost" icon="list" onPress={() => router.push('/identify')} style={{ marginTop: S.md }} />}
    </GlassCard>
  );
}

function SavedScooters({ activeDeviceId }: { activeDeviceId: string | null }) {
  const allScooters = useGarage((s) => s.scooters);
  const scooters = allScooters.filter((x) => x.bleId);
  const update = useGarage((s) => s.update);
  const remove = useGarage((s) => s.remove);
  const removeMaint = useMaintenance((s) => s.removeForScooter);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  if (!scooters.length) return null;
  return (
    <>
      <SectionHeader title="Saved scooters" icon="bookmark-outline" />
      <GlassCard style={{ paddingVertical: S.xs }}>
        {scooters.map((s, i) => (
          <View key={s.id}>
            {i > 0 && <Divider />}
            {editing === s.id ? (
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: S.sm }}>
                <TextInput value={name} onChangeText={setName} style={styles.input} autoFocus placeholder="Scooter name" placeholderTextColor={C.textFaint} />
                <NeonButton small title="Save" onPress={() => { update(s.id, { nickname: name.trim() || s.nickname }); setEditing(null); }} />
              </View>
            ) : (
              <ListRow
                icon="bicycle"
                title={s.nickname}
                subtitle={`${s.bleName ?? ''} · last ${fmtDateTime(s.lastConnected)}`}
                right={
                  <View style={{ flexDirection: 'row', gap: 14 }}>
                    <Ionicons name="pencil" size={18} color={C.textDim} onPress={() => { setName(s.nickname); setEditing(s.id); }} />
                    <Ionicons
                      name="trash-outline"
                      size={18}
                      color={C.red}
                      onPress={() =>
                        Alert.alert('Remove scooter?', `${s.nickname} and its maintenance items will be removed. Rides are kept.`, [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Remove', style: 'destructive', onPress: () => { removeMaint(s.id); remove(s.id); } },
                        ])
                      }
                    />
                  </View>
                }
                onPress={s.bleId && s.bleId !== activeDeviceId ? () => connectScooter(s.bleId!, s.bleName) : undefined}
              />
            )}
          </View>
        ))}
      </GlassCard>
    </>
  );
}

function ServicesCard() {
  const services = useLive((s) => s.services);
  const conn = useLive((s) => s.conn);
  if (conn !== 'connected' || !services.length) return null;
  return (
    <>
      <SectionHeader title="GATT services" icon="git-network-outline" right={<Text style={styles.link} onPress={() => router.push('/developer')}>Inspector</Text>} />
      <GlassCard>
        {services.map((s) => (
          <View key={s.uuid} style={{ marginBottom: S.sm }}>
            <Text style={styles.svc}>{uuidName(s.uuid) ?? 'Unknown service'} <Text style={styles.uuid}>{shortUuid(s.uuid)}</Text></Text>
            {s.characteristics.map((c) => (
              <Text key={c.uuid} style={styles.chr}>
                • {uuidName(c.uuid) ?? shortUuid(c.uuid)}{' '}
                <Text style={{ color: C.textFaint }}>
                  [{[c.readable && 'R', c.writableWithResponse && 'W', c.writableWithoutResponse && 'Wnr', c.notifiable && 'N', c.indicatable && 'I'].filter(Boolean).join(' ')}]
                </Text>
              </Text>
            ))}
          </View>
        ))}
      </GlassCard>
    </>
  );
}

const styles = StyleSheet.create({
  big: { color: C.text, fontSize: 19, fontWeight: '800', marginTop: 2 },
  link: { get color() { return C.purpleLight; }, fontWeight: '700', fontSize: 13 },
  input: { flex: 1, color: C.text, borderWidth: 1, get borderColor() { return C.border; }, borderRadius: 10, paddingHorizontal: 12, height: 40 },
  svc: { color: C.text, fontWeight: '700', fontSize: 13.5 },
  uuid: { color: C.textFaint, fontFamily: F.mono, fontSize: 10.5, fontWeight: '400' },
  chr: { color: C.textDim, fontSize: 12.5, marginLeft: 8, marginTop: 3, fontFamily: F.mono },
});
