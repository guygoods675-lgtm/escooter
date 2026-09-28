import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import type { Reading } from '../../protocols/types';
import { C } from '../theme';

/**
 * Data-integrity labels used across the app.
 *  - measured: received directly from the scooter, phone sensors or GPS
 *  - calculated: derived from measurements (e.g. V × I, Wh/km)
 *  - estimated: a prediction from history (e.g. personal range)
 *  - unavailable: not exposed by this scooter/device
 */
export type Confidence = 'measured' | 'calculated' | 'estimated' | 'unavailable';
export type DataSource = 'Scooter BLE' | 'Scooter BMS' | 'Phone GPS' | 'Phone accelerometer' | 'Ride history' | 'Model database' | 'Calculated';

const COLORS: Record<Confidence, string> = {
  measured: C.green,
  calculated: C.cyan,
  estimated: C.amber,
  unavailable: C.textFaint,
};
const LABEL: Record<Confidence, string> = { measured: 'Measured', calculated: 'Calculated', estimated: 'Estimated', unavailable: 'Unavailable' };

/** Confidence for a protocol Reading: scooter/phone values are measured, derived ones calculated. */
export const confidenceOf = (r: Reading<unknown> | undefined): Confidence => (r == null ? 'unavailable' : r.source === 'calculated' ? 'calculated' : 'measured');
export const sourceOf = (r: Reading<unknown> | undefined, scooter: DataSource = 'Scooter BLE'): DataSource | undefined =>
  r == null ? undefined : r.source === 'calculated' ? 'Calculated' : r.source === 'phone' ? 'Phone GPS' : scooter;

export function DataTag({ kind, source, style, compact }: { kind: Confidence; source?: DataSource; style?: ViewStyle; compact?: boolean }) {
  const color = COLORS[kind];
  return (
    <View style={[styles.row, style]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.text, { color }]} numberOfLines={1}>
        {LABEL[kind]}
        {!compact && source && kind !== 'unavailable' ? <Text style={styles.src}> · {source}</Text> : null}
      </Text>
    </View>
  );
}

/** Tag straight from a Reading. */
export function ReadingTag({ r, source, compact, style }: { r: Reading<unknown> | undefined; source?: DataSource; compact?: boolean; style?: ViewStyle }) {
  return <DataTag kind={confidenceOf(r)} source={source ?? sourceOf(r)} compact={compact} style={style} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  text: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.3 },
  src: { color: C.textFaint, fontWeight: '500' },
});
