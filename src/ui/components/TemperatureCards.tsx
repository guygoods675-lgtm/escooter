import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useErrors } from '../../store/errors';
import { useLive } from '../../store/live';
import { NA, useUnits } from '../../utils/format';
import { C, F, R, S } from '../theme';
import { Gauge } from './Gauge';

/**
 * Motor / controller / battery temperature cards with animated gauges.
 * A card turns red only when the scooter itself reports an overheat code for that part;
 * no manufacturer limits are published for these readings, so no thresholds are invented.
 */
export function TemperatureCards() {
  const motor = useLive((s) => s.snapshot?.motorTempC?.value ?? null);
  const ctrl = useLive((s) => s.snapshot?.controllerTempC?.value ?? null);
  const batt = useLive((s) => s.snapshot?.batteryTempC?.value ?? null);
  const scooterId = useLive((s) => s.scooterId);
  const records = useErrors((s) => s.records);
  const u = useUnits();
  const active = records.filter((r) => r.active && r.scooterId === scooterId && r.kind === 'error');
  const hot = { motor: false, controller: active.some((r) => r.code === 40), battery: active.some((r) => r.code === 39 || r.code === 41) };
  const cards = [
    { key: 'motor', label: 'MOTOR', v: motor, hot: hot.motor },
    { key: 'controller', label: 'CONTROLLER', v: ctrl, hot: hot.controller },
    { key: 'battery', label: 'BATTERY', v: batt, hot: hot.battery },
  ];
  return (
    <View style={styles.row}>
      {cards.map((c) => (
        <View key={c.key} style={[styles.card, c.hot && { borderColor: C.red }]}>
          <Text style={[styles.label, c.hot && { color: C.red }]}>{c.label}</Text>
          <Gauge
            value={c.v != null ? u.temp(c.v) : null}
            min={u.tempUnit === 'f' ? 32 : 0}
            max={u.tempUnit === 'f' ? 176 : 80}
            size={96}
            stroke={8}
            label=""
            unit={u.tempLabel}
            colors={c.hot ? [C.red, C.red] : [C.amber, C.sunset]}
          />
          <Text style={[styles.state, c.hot && { color: C.red }]}>{c.v == null ? NA : c.hot ? 'Overheat reported' : 'No warning'}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: S.sm },
  card: { flex: 1, alignItems: 'center', backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', paddingVertical: S.sm },
  label: { ...F.label, fontSize: 9.5 },
  state: { color: C.textFaint, fontSize: 10, marginTop: -4, textAlign: 'center' },
});
