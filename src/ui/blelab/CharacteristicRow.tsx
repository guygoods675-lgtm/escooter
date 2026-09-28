import React, { memo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { GattCharacteristicInfo } from '../../ble/BluetoothManager';
import { shortUuid, uuidName } from '../../ble/uuids';
import { getSession } from '../../services/ScooterManager';
import { toHex } from '../../utils/bytes';
import { NA, fmtTime } from '../../utils/format';
import { DataTag } from '../components/DataTag';
import { Badge, NeonButton } from '../components/Glass';
import { C, F, S } from '../theme';
import { asciiPreview, decimalPreview } from './captureFormat';
import { FREQ_WINDOW_MS, charFrequencyHz, useCharStat } from './charStats';
import { labSubscribe, labUnsubscribe, useLabSubscribed } from './labSubs';

const PREVIEW_MAX = 64;

/** One characteristic: identity, capability chips, user-initiated read/subscribe and its latest RX value. */
export const CharacteristicRow = memo(function CharacteristicRow({ service, c }: { service: string; c: GattCharacteristicInfo }) {
  const { stat, now } = useCharStat(service, c.uuid);
  const labSubscribed = useLabSubscribed(service, c.uuid);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const session = getSession();
  // Another part of the app (the protocol driver) already listens here; its notifications still show below.
  const driverSubscribed = !labSubscribed && !!session && session.subscriptionCount(service, c.uuid) > 0;
  const name = uuidName(c.uuid);

  const read = async () => {
    const s = getSession();
    if (!s) return;
    setBusy(true);
    setError(null);
    try {
      await s.read(service, c.uuid); // value lands in charStats via BleSession
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const toggle = () => {
    setError(null);
    try {
      if (labSubscribed) labUnsubscribe(service, c.uuid);
      else labSubscribe(service, c.uuid);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const bytes = stat?.lastBytes ?? null;
  const shown = bytes ? bytes.subarray(0, PREVIEW_MAX) : null;
  const more = bytes && bytes.length > PREVIEW_MAX ? ` … (${bytes.length} bytes)` : '';
  const hz = charFrequencyHz(stat, now);

  return (
    <View style={styles.chr}>
      <Text style={styles.chrName}>{name ?? 'Unknown characteristic'}</Text>
      <Text style={styles.uuid} selectable>
        Char {c.uuid}
      </Text>
      <Text style={styles.uuid} selectable>
        Service {shortUuid(service)}
      </Text>
      <View style={styles.chips}>
        {c.readable && <Badge text="READ" color={C.cyan} />}
        {c.writableWithResponse && <Badge text="WRITE" color={C.amber} />}
        {c.writableWithoutResponse && <Badge text="WRITE NR" color={C.amber} />}
        {c.notifiable && <Badge text="NOTIFY" color={C.purpleLight} />}
        {c.indicatable && <Badge text="INDICATE" color={C.purpleLight} />}
        {driverSubscribed && <Badge text="DRIVER SUBSCRIBED" color={C.green} />}
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
        {c.readable && <NeonButton small variant="ghost" title="Read" icon="download-outline" loading={busy} onPress={read} />}
        {(c.notifiable || c.indicatable) && !driverSubscribed && (
          <NeonButton small variant="ghost" title={labSubscribed ? 'Unsubscribe' : 'Subscribe'} icon={labSubscribed ? 'notifications-off-outline' : 'notifications-outline'} onPress={toggle} />
        )}
      </View>
      {!!error && <Text style={styles.err}>Error: {error}</Text>}
      {stat && stat.rxCount > 0 && shown ? (
        <View style={styles.valBox}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <DataTag kind="measured" source="Scooter BLE" />
            <Text style={styles.meta}>
              {stat.lastDir === 'notify' ? 'notify' : 'read'} · {stat.lastT ? `${fmtTime(stat.lastT)}.${String(stat.lastT % 1000).padStart(3, '0')}` : NA}
            </Text>
          </View>
          <Text style={styles.lbl}>Hex</Text>
          <Text style={styles.val} selectable>
            {shown.length ? toHex(shown) : '(empty)'}
            {more}
          </Text>
          <Text style={styles.lbl}>Bytes (decimal)</Text>
          <Text style={styles.val} selectable>
            {shown.length ? decimalPreview(shown) : '(empty)'}
          </Text>
          <Text style={styles.lbl}>ASCII</Text>
          <Text style={styles.val}>{shown.length ? `"${asciiPreview(shown)}"` : '(empty)'}</Text>
          <Text style={styles.meta}>
            {stat.rxCount} received · {hz.toFixed(1)} Hz (last {FREQ_WINDOW_MS / 1000} s){stat.txCount ? ` · ${stat.txCount} written` : ''}
          </Text>
        </View>
      ) : (
        <Text style={styles.none}>{c.readable || c.notifiable || c.indicatable ? 'No value received yet' : 'Not readable'}</Text>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  chr: { marginTop: S.md, paddingTop: S.sm, borderTopWidth: StyleSheet.hairlineWidth, get borderTopColor() { return C.border; } },
  chrName: { get color() { return C.purpleLight; }, fontWeight: '700' },
  uuid: { color: C.textFaint, fontFamily: F.mono, fontSize: 10.5 },
  chips: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 4 },
  valBox: { marginTop: S.sm, padding: S.sm, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.03)' },
  lbl: { color: C.textDim, fontSize: 10.5, fontWeight: '700', marginTop: 6 },
  val: { color: C.cyan, fontFamily: F.mono, fontSize: 11.5 },
  meta: { color: C.textFaint, fontFamily: F.mono, fontSize: 10.5, marginTop: 4 },
  err: { color: C.red, fontSize: 12, marginTop: 6 },
  none: { color: C.textFaint, fontSize: 11.5, marginTop: 6 },
});
