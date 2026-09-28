import { Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { shortUuid, uuidName } from '../ble/uuids';
import { checkRawWrite } from '../protocols/writeGuard';
import { getSession } from '../services/ScooterManager';
import { LogEntry, devLog, useDevLog } from '../store/devlog';
import { useLive } from '../store/live';
import { useSettings } from '../store/settings';
import { DataTag } from '../ui/components/DataTag';
import { Badge, EmptyState, GlassCard, KeyValue, NeonButton, Note, SectionHeader, Segmented } from '../ui/components/Glass';
import { Screen } from '../ui/components/Screen';
import { CapturePanel } from '../ui/blelab/CapturePanel';
import { CharacteristicRow } from '../ui/blelab/CharacteristicRow';
import { anyCharValue, ensureStatsDevice, usePolled } from '../ui/blelab/charStats';
import { parseCompany } from '../ui/blelab/companyIds';
import { DiscoveryStep, DiscoverySteps, StepState } from '../ui/blelab/DiscoverySteps';
import { forgetLabSubs } from '../ui/blelab/labSubs';
import { useNow } from '../ui/hooks';
import { C, F, S } from '../ui/theme';
import { hexToBytes, toHex } from '../utils/bytes';
import { shareText } from '../utils/export';
import { NA, fmtTime, rssiQuality } from '../utils/format';

const KIND_COLOR: Record<LogEntry['kind'], string> = { info: C.textDim, tx: C.amber, rx: C.cyan, error: C.red, conn: C.purpleLight };

const TITLE = 'BLE LAB';
const RATE_WINDOW_MS = 5000;
type Tab = 'gatt' | 'capture' | 'log';

export default function DeveloperScreen() {
  const dev = useSettings((s) => s.developerMode);
  const [tab, setTab] = useState<Tab>('gatt');
  const [exported, setExported] = useState(false);
  const conn = useLive((s) => s.conn);
  const deviceId = useLive((s) => s.deviceId);
  useEffect(() => {
    if (conn === 'connected') ensureStatsDevice(deviceId);
    else forgetLabSubs(); // BleSession removes its monitors on disconnect
  }, [conn, deviceId]);
  if (!dev)
    return (
      <Screen contentStyle={{ paddingTop: 110 }}>
        <Stack.Screen options={{ title: TITLE }} />
        <EmptyState icon="lock-closed-outline" title="Developer mode is off" body="Tap the Scooter Hub logo on the More tab seven times to enable it." />
      </Screen>
    );
  return (
    <Screen contentStyle={{ paddingTop: 110 }} scroll={tab === 'gatt'}>
      <Stack.Screen options={{ title: TITLE }} />
      <DeviceCard />
      {tab === 'gatt' && <Steps goTo={setTab} exported={exported} />}
      <Segmented
        options={[
          { label: 'GATT', value: 'gatt' },
          { label: 'Capture', value: 'capture' },
          { label: 'Logs', value: 'log' },
        ]}
        value={tab}
        onChange={setTab}
        style={{ marginBottom: S.md }}
      />
      {tab === 'gatt' ? <Gatt /> : tab === 'capture' ? <CapturePanel onExported={() => setExported(true)} /> : <Log />}
    </Screen>
  );
}

/** Step-by-step discovery workflow; states derive from real GATT / capture state. */
function Steps({ goTo, exported }: { goTo: (t: Tab) => void; exported: boolean }) {
  const conn = useLive((s) => s.conn);
  const services = useLive((s) => s.services);
  const capturing = useDevLog((s) => s.capturing);
  const captureCount = useDevLog((s) => s.captureCount);
  const hasValues = usePolled(anyCharValue);
  const connected = conn === 'connected';
  const nChars = useMemo(() => services.reduce((n, s) => n + s.characteristics.length, 0), [services]);
  const st = (done: boolean, active: boolean): StepState => (done ? 'done' : active ? 'active' : 'todo');
  const steps: DiscoveryStep[] = [
    {
      title: 'Discover services',
      detail: connected ? `${services.length} services found on connect` : 'Connect a device first',
      state: st(connected && services.length > 0, !connected),
    },
    {
      title: 'Inspect characteristics',
      detail: connected ? `${nChars} characteristics with their capabilities below` : 'Available after connecting',
      state: st(connected && nChars > 0, false),
      onPress: () => goTo('gatt'),
    },
    {
      title: 'Read / Subscribe',
      detail: hasValues ? 'Values received; see each characteristic' : 'Tap Read or Subscribe on a characteristic',
      state: st(hasValues, connected && !hasValues),
      onPress: () => goTo('gatt'),
    },
    {
      title: 'Capture session',
      detail: capturing ? `Recording… ${captureCount.toLocaleString()} packets` : captureCount > 0 ? `${captureCount.toLocaleString()} packets captured` : 'Record all RX / TX traffic with timestamps',
      state: st(!capturing && captureCount > 0, capturing || (hasValues && captureCount === 0)),
      onPress: () => goTo('capture'),
    },
    {
      title: 'Export',
      detail: exported ? 'Exported this session' : 'Debug JSON or CSV via the share sheet',
      state: st(exported, !capturing && captureCount > 0 && !exported),
      onPress: () => goTo('capture'),
    },
  ];
  return <DiscoverySteps steps={steps} />;
}

/** Connected device summary plus live RX/TX packet rates computed from devlog timestamps. */
function DeviceCard() {
  const conn = useLive((s) => s.conn);
  const deviceName = useLive((s) => s.deviceName);
  const deviceId = useLive((s) => s.deviceId);
  const rssi = useLive((s) => s.rssi);
  const protocolName = useLive((s) => s.protocolName);
  const services = useLive((s) => s.services);
  const entries = useDevLog((s) => s.entries);
  const paused = useDevLog((s) => s.paused);
  const now = useNow(1000);
  const rate = useMemo(() => {
    const from = now - RATE_WINDOW_MS;
    let rx = 0;
    let tx = 0;
    for (let i = entries.length - 1; i >= 0 && entries[i].t >= from; i--) {
      if (entries[i].kind === 'rx') rx++;
      else if (entries[i].kind === 'tx') tx++;
    }
    return { rx: rx / (RATE_WINDOW_MS / 1000), tx: tx / (RATE_WINDOW_MS / 1000) };
  }, [entries, now]);
  const connected = conn === 'connected';
  const session = connected ? getSession() : null;
  // Negotiated MTU as reported by react-native-ble-plx (iOS negotiates automatically; may be absent).
  const mtu = session?.mtu ?? null;
  const manufacturerHex = session?.manufacturerData ?? null;
  const company = useMemo(() => parseCompany(manufacturerHex), [manufacturerHex]);
  const nChars = useMemo(() => services.reduce((n, s) => n + s.characteristics.length, 0), [services]);
  const manufacturer = !connected
    ? NA
    : company.idHex == null
      ? 'Not advertised'
      : company.name
        ? `${company.name} (${company.idHex})`
        : `Unknown (${company.idHex})`;
  return (
    <GlassCard accent={connected ? C.green : undefined}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={styles.svc}>{connected ? deviceName ?? 'Unnamed device' : 'No device connected'}</Text>
        <Badge text={conn.toUpperCase()} color={connected ? C.green : C.textDim} />
      </View>
      {connected && <DataTag kind="measured" source="Scooter BLE" />}
      <KeyValue label="Identifier" value={connected && deviceId ? deviceId : NA} mono />
      <KeyValue label="Manufacturer" value={manufacturer} note={connected && company.idHex ? 'Bluetooth SIG company ID from advertised manufacturer data' : undefined} />
      <KeyValue label="BLE Services" value={connected ? String(services.length) : NA} />
      <KeyValue label="Characteristics" value={connected ? String(nChars) : NA} />
      <KeyValue label="RSSI" value={connected && rssi != null ? `${rssi} dBm (${rssiQuality(rssi).label})` : NA} />
      <KeyValue label="MTU" value={mtu != null ? String(mtu) : NA} unit={mtu != null ? 'bytes' : undefined} />
      <KeyValue label="Protocol" value={connected ? protocolName ?? NA : NA} />
      <View style={{ flexDirection: 'row', gap: S.sm, marginTop: S.sm }}>
        <View style={[styles.rate, { borderColor: C.cyan }]}>
          <Text style={[styles.rateVal, { color: C.cyan }]}>{rate.rx.toFixed(1)}</Text>
          <Text style={styles.rateLbl}>RX packets/s</Text>
        </View>
        <View style={[styles.rate, { borderColor: C.amber }]}>
          <Text style={[styles.rateVal, { color: C.amber }]}>{rate.tx.toFixed(1)}</Text>
          <Text style={styles.rateLbl}>TX packets/s</Text>
        </View>
      </View>
      <Note>{paused ? 'Log is paused, so packet rates read 0 until you resume it.' : `Averaged over the last ${RATE_WINDOW_MS / 1000} s of logged packets.`}</Note>
    </GlassCard>
  );
}

function Gatt() {
  const services = useLive((s) => s.services);
  const conn = useLive((s) => s.conn);
  if (conn !== 'connected') return <EmptyState icon="bluetooth-outline" title="Not connected" body="Connect a device to inspect its services." />;
  return (
    <>
      <Note>Reading and subscribing are passive and only happen when you tap them. Writing is only available below, behind a separate switch and a confirmation.</Note>
      {services.length === 0 && <Note>No services were discovered on this device.</Note>}
      {services.map((s) => (
        <GlassCard key={s.uuid}>
          <Text style={styles.svc}>{uuidName(s.uuid) ?? 'Unknown service'}</Text>
          <Text style={styles.uuid} selectable>
            {s.uuid}
          </Text>
          <Text style={styles.uuid}>
            {s.characteristics.length} characteristic{s.characteristics.length === 1 ? '' : 's'}
          </Text>
          {s.characteristics.map((c) => (
            <CharacteristicRow key={c.uuid} service={s.uuid} c={c} />
          ))}
        </GlassCard>
      ))}
      <RawWrite />
    </>
  );
}

function RawWrite() {
  const services = useLive((s) => s.services);
  const enabled = useSettings((s) => s.devWritesEnabled);
  const set = useSettings((s) => s.set);
  const writable = useMemo(() => services.flatMap((s) => s.characteristics.filter((c) => c.writableWithResponse || c.writableWithoutResponse).map((c) => ({ s: s.uuid, c }))), [services]);
  const [target, setTarget] = useState(0);
  const [hex, setHex] = useState('');
  const t = writable[target];
  const send = () => {
    const bytes = hexToBytes(hex);
    if (!bytes || !t) return Alert.alert('Invalid input', 'Enter hex bytes, e.g. 55 AA 03 20 01 1A 02 BF FF');
    const guard = checkRawWrite(bytes);
    if (!guard.ok) return Alert.alert('Write blocked', guard.reason);
    Alert.alert(
      'Send raw write?',
      `${bytes.length} bytes to ${uuidName(t.c.uuid) ?? t.c.uuid}\n\n${toHex(bytes)}\n\nRaw writes can change scooter settings. Only send packets you have verified from documentation.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send',
          style: 'destructive',
          onPress: async () => {
            try {
              devLog('tx', `RAW WRITE ${shortUuid(t.c.uuid)}`, bytes, 'manual developer write');
              await getSession()!.write(t.s, t.c.uuid, bytes, t.c.writableWithResponse);
            } catch (e) {
              Alert.alert('Write failed', e instanceof Error ? e.message : String(e));
            }
          },
        },
      ],
    );
  };
  return (
    <>
      <SectionHeader title="Manual write (advanced)" icon="warning-outline" />
      <GlassCard accent={enabled ? C.amber : undefined}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: C.text, fontWeight: '700' }}>Enable manual writes</Text>
          <Switch value={enabled} onValueChange={(v) => set('devWritesEnabled', v)} trackColor={{ true: C.amber }} />
        </View>
        <Note color={C.amber}>Never sent automatically. Firmware, activation, reset, odometer and speed-limit commands are always blocked.</Note>
        {enabled && writable.length > 0 && (
          <>
            <Segmented options={writable.slice(0, 4).map((w, i) => ({ label: uuidName(w.c.uuid) ?? shortUuid(w.c.uuid).slice(0, 8), value: i }))} value={target} onChange={setTarget} style={{ marginTop: S.md }} />
            <TextInput value={hex} onChangeText={setHex} placeholder="Hex bytes" placeholderTextColor={C.textFaint} autoCapitalize="characters" style={styles.input} />
            <NeonButton small title="Review & send" icon="send" variant="danger" onPress={send} style={{ marginTop: S.sm }} />
          </>
        )}
        {enabled && writable.length === 0 && <Note>No writable characteristics on this device.</Note>}
      </GlassCard>
    </>
  );
}

function Log() {
  const entries = useDevLog((s) => s.entries);
  const paused = useDevLog((s) => s.paused);
  const setPaused = useDevLog((s) => s.setPaused);
  const clear = useDevLog((s) => s.clear);
  const identity = useLive((s) => s.identity);
  const services = useLive((s) => s.services);
  const protocolName = useLive((s) => s.protocolName);
  const [filter, setFilter] = useState<'all' | 'rx' | 'tx' | 'conn'>('all');
  const list = useMemo(() => entries.filter((e) => filter === 'all' || e.kind === filter || (filter === 'conn' && (e.kind === 'error' || e.kind === 'info'))).slice().reverse(), [entries, filter]);
  const exportLog = () =>
    shareText(
      `scooterhub-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      JSON.stringify({ exportedAt: new Date().toISOString(), protocol: protocolName, identity, services, log: entries }, null, 2),
    ).catch((e) => Alert.alert('Export failed', String(e)));
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: S.sm }}>
        <NeonButton small variant="ghost" title={paused ? 'Resume' : 'Pause'} icon={paused ? 'play' : 'pause'} onPress={() => setPaused(!paused)} style={{ flex: 1 }} />
        <NeonButton small variant="ghost" title="Clear" icon="trash-outline" onPress={clear} style={{ flex: 1 }} />
        <NeonButton small title="Export" icon="share-outline" onPress={exportLog} style={{ flex: 1 }} />
      </View>
      <Segmented options={[{ label: 'All', value: 'all' }, { label: 'RX', value: 'rx' }, { label: 'TX', value: 'tx' }, { label: 'Conn', value: 'conn' }]} value={filter} onChange={setFilter} style={{ marginBottom: S.sm }} />
      <FlatList
        data={list}
        keyExtractor={(e) => String(e.id)}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 80 }}
        ListEmptyComponent={<Text style={{ color: C.textFaint, textAlign: 'center', marginTop: 40 }}>No log entries</Text>}
        renderItem={({ item: e }) => (
          <Pressable style={styles.logRow}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Text style={[styles.logKind, { color: KIND_COLOR[e.kind] }]}>{e.kind.toUpperCase()}</Text>
              <Text style={styles.logTime}>{fmtTime(e.t)}.{String(e.t % 1000).padStart(3, '0')}</Text>
              <Ionicons name={e.kind === 'rx' ? 'arrow-down' : e.kind === 'tx' ? 'arrow-up' : 'ellipse'} size={10} color={KIND_COLOR[e.kind]} />
            </View>
            <Text style={styles.logMsg}>{e.message}</Text>
            {!!e.hex && <Text style={styles.hex}>{e.hex}</Text>}
            {!!e.decoded && <Text style={styles.decoded}>{e.decoded}</Text>}
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  svc: { color: C.text, fontWeight: '800', fontSize: 15 },
  uuid: { color: C.textFaint, fontFamily: F.mono, fontSize: 10.5 },
  input: { color: C.text, fontFamily: F.mono, borderWidth: 1, get borderColor() { return C.border; }, borderRadius: 12, paddingHorizontal: 12, height: 44, marginTop: S.sm },
  logRow: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, get borderBottomColor() { return C.border; } },
  logKind: { fontFamily: F.mono, fontSize: 10.5, fontWeight: '800', width: 42 },
  logTime: { color: C.textFaint, fontFamily: F.mono, fontSize: 10.5 },
  logMsg: { color: C.text, fontSize: 12.5, marginTop: 2 },
  hex: { color: C.cyan, fontFamily: F.mono, fontSize: 11, marginTop: 2 },
  decoded: { color: C.green, fontFamily: F.mono, fontSize: 11, marginTop: 2 },
  rate: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 8, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.03)' },
  rateVal: { fontFamily: F.mono, fontSize: 20, fontWeight: '800' },
  rateLbl: { color: C.textDim, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.4, marginTop: 2 },
});
