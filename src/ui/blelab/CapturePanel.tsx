import React, { useMemo, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { shortUuid, uuidName } from '../../ble/uuids';
import { getSession } from '../../services/ScooterManager';
import { CAPTURE_CAPACITY, CapturePacket, PacketDir, captureSnapshot, useDevLog } from '../../store/devlog';
import { useLive } from '../../store/live';
import { shareText } from '../../utils/export';
import { fmtDuration, fmtTime } from '../../utils/format';
import { Badge, NeonButton, Note, Segmented } from '../components/Glass';
import { useNow } from '../hooks';
import { C, F, S } from '../theme';
import { buildCaptureCsv, buildCaptureJson, dirGroup } from './captureFormat';
import { parseCompany } from './companyIds';
import { labUnsubscribeAll, useLabSubCount } from './labSubs';

const ROW_H = 46;
const DIR_COLOR: Record<PacketDir, string> = { read: C.cyan, notify: C.cyan, write: C.amber, writeNR: C.amber, event: C.textDim };
const DIR_LABEL: Record<PacketDir, string> = { read: 'READ', notify: 'NOTIF', write: 'WRITE', writeNR: 'WR-NR', event: 'EVENT' };
type Filter = 'all' | 'rx' | 'tx' | 'event';

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

/** Capture session controls, virtualised packet list (≤ 5 fps) and export. */
export function CapturePanel({ onExported }: { onExported: () => void }) {
  const capturing = useDevLog((s) => s.capturing);
  const count = useDevLog((s) => s.captureCount);
  const dropped = useDevLog((s) => s.captureDropped);
  const version = useDevLog((s) => s.captureVersion);
  const startedAt = useDevLog((s) => s.captureStartedAt);
  const stoppedAt = useDevLog((s) => s.captureStoppedAt);
  const labSubs = useLabSubCount();
  // Pausing the view freezes the list at the current version; capture continues.
  const [frozenVersion, setFrozenVersion] = useState<number | null>(null);
  const viewPaused = frozenVersion != null;
  const [filter, setFilter] = useState<Filter>('all');
  const shownVersion = frozenVersion ?? version;
  const now = useNow(capturing ? 1000 : 60000);

  // captureVersion changes at most every 200 ms, so this recomputes ≤ 5×/s.
  const list = useMemo(() => {
    const snap = captureSnapshot();
    const out: CapturePacket[] = [];
    for (let i = snap.length - 1; i >= 0; i--) if (filter === 'all' || dirGroup(snap[i].dir) === filter) out.push(snap[i]);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownVersion, filter]);

  const exportAs = async (kind: 'json' | 'csv') => {
    const packets = captureSnapshot();
    if (packets.length === 0) return Alert.alert('Nothing to export', 'Start a capture session first.');
    const live = useLive.getState();
    const session = getSession();
    const md = session?.manufacturerData ?? null;
    const company = parseCompany(md);
    try {
      if (kind === 'json') {
        const s = useDevLog.getState();
        const json = buildCaptureJson({
          exportedAt: Date.now(),
          app: 'Scooter Hub BLE LAB',
          device: {
            name: live.deviceName,
            id: live.deviceId,
            protocol: live.protocolName,
            rssiDbm: live.rssi,
            mtu: session?.mtu ?? null,
            manufacturerDataHex: md,
            companyId: company.idHex,
            companyName: company.name,
          },
          capture: { startedAt: s.captureStartedAt, stoppedAt: s.captureStoppedAt, capacity: CAPTURE_CAPACITY, droppedOldest: s.captureDropped },
          services: live.services,
          packets,
          nameOf: uuidName,
        });
        await shareText(`scooterhub-ble-capture-${stamp()}.json`, json, 'application/json');
      } else {
        await shareText(`scooterhub-ble-capture-${stamp()}.csv`, buildCaptureCsv(packets, uuidName), 'text/csv');
      }
      onExported();
    } catch (e) {
      Alert.alert('Export failed', e instanceof Error ? e.message : String(e));
    }
  };

  const toggleCapture = () => {
    const s = useDevLog.getState();
    if (s.capturing) s.stopCapture();
    else s.startCapture();
  };

  const duration = startedAt ? ((capturing ? now : stoppedAt ?? now) - startedAt) / 1000 : null;

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.statusRow}>
        <Badge text={capturing ? 'CAPTURING' : 'STOPPED'} color={capturing ? C.red : C.textDim} icon={capturing ? 'radio-button-on' : 'stop-circle-outline'} />
        <Text style={styles.status}>
          {count.toLocaleString()} / {CAPTURE_CAPACITY.toLocaleString()} packets{duration != null ? ` · ${fmtDuration(Math.round(duration))}` : ''}
        </Text>
      </View>
      {dropped > 0 && <Note color={C.amber}>{dropped.toLocaleString()} oldest packets were dropped (buffer holds {CAPTURE_CAPACITY.toLocaleString()}).</Note>}
      <View style={styles.btnRow}>
        <NeonButton small title={capturing ? 'Stop' : 'Start capture'} icon={capturing ? 'stop' : 'radio-button-on'} variant={capturing ? 'danger' : 'primary'} onPress={toggleCapture} style={{ flex: 1.4 }} />
        <NeonButton small variant="ghost" title={viewPaused ? 'Resume view' : 'Pause view'} icon={viewPaused ? 'play' : 'pause'} onPress={() => setFrozenVersion(viewPaused ? null : version)} style={{ flex: 1 }} />
        <NeonButton small variant="ghost" title="Clear" icon="trash-outline" onPress={() => useDevLog.getState().clearCapture()} style={{ flex: 0.8 }} />
      </View>
      <View style={styles.btnRow}>
        <NeonButton small variant="ghost" title="Export JSON" icon="share-outline" onPress={() => exportAs('json')} disabled={count === 0} style={{ flex: 1 }} />
        <NeonButton small variant="ghost" title="Export CSV" icon="grid-outline" onPress={() => exportAs('csv')} disabled={count === 0} style={{ flex: 1 }} />
      </View>
      {labSubs > 0 && (
        <View style={[styles.statusRow, { marginBottom: S.sm }]}>
          <Text style={styles.status}>{labSubs} BLE LAB subscription{labSubs === 1 ? '' : 's'} active</Text>
          <NeonButton small variant="ghost" title="Unsubscribe all" onPress={labUnsubscribeAll} />
        </View>
      )}
      <Note>
        {viewPaused
          ? 'View paused: capture keeps recording in the background.'
          : 'Records every read, notification, write and connection event with timestamps. Capturing sends nothing to the device.'}
      </Note>
      <Segmented
        options={[
          { label: 'All', value: 'all' },
          { label: 'RX', value: 'rx' },
          { label: 'TX', value: 'tx' },
          { label: 'Events', value: 'event' },
        ]}
        value={filter}
        onChange={setFilter}
        style={{ marginVertical: S.sm }}
      />
      <FlatList
        data={list}
        keyExtractor={(p) => String(p.id)}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 80 }}
        getItemLayout={(_, index) => ({ length: ROW_H, offset: ROW_H * index, index })}
        initialNumToRender={20}
        maxToRenderPerBatch={20}
        windowSize={7}
        removeClippedSubviews
        ListEmptyComponent={<Text style={styles.empty}>{capturing ? 'Waiting for BLE traffic…' : 'No captured packets. Tap Start capture.'}</Text>}
        renderItem={({ item }) => <PacketRow p={item} />}
      />
    </View>
  );
}

const PacketRow = React.memo(function PacketRow({ p }: { p: CapturePacket }) {
  const color = DIR_COLOR[p.dir];
  const charLabel = p.char ? uuidName(p.char) ?? shortUuid(p.char).slice(0, 8) : '';
  return (
    <View style={styles.row}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Text style={[styles.dir, { color }]}>{DIR_LABEL[p.dir]}</Text>
        <Text style={styles.time}>
          {fmtTime(p.t)}.{String(p.t % 1000).padStart(3, '0')}
        </Text>
        <Text style={styles.char} numberOfLines={1}>
          {charLabel}
          {p.char ? ` · ${p.len} B` : ''}
        </Text>
      </View>
      <Text style={[styles.hex, p.dir === 'event' && { color: C.textDim }, p.note && p.dir !== 'event' ? { color: C.red } : null]} numberOfLines={1}>
        {p.dir === 'event' ? p.note : p.note ? `${p.hex} (${p.note})` : p.hex || '(empty)'}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: S.sm, marginBottom: S.sm },
  status: { color: C.textDim, fontFamily: F.mono, fontSize: 11.5, flexShrink: 1, textAlign: 'right' },
  btnRow: { flexDirection: 'row', gap: 8, marginBottom: S.sm },
  row: { height: ROW_H, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth, get borderBottomColor() { return C.border; } },
  dir: { fontFamily: F.mono, fontSize: 10.5, fontWeight: '800', width: 44 },
  time: { color: C.textFaint, fontFamily: F.mono, fontSize: 10.5 },
  char: { color: C.purpleLight, fontSize: 11, flexShrink: 1 },
  hex: { color: C.cyan, fontFamily: F.mono, fontSize: 11, marginTop: 2 },
  empty: { color: C.textFaint, textAlign: 'center', marginTop: 40 },
});
