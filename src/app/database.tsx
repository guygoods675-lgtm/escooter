import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SCOOTER_MODELS } from '../data/scooterDatabase';
import { PROTOCOL_LABELS } from '../protocols/registry';
import { Badge, GlassCard, KeyValue, Note } from '../ui/components/Glass';
import { Screen } from '../ui/components/Screen';
import { C, S } from '../ui/theme';
import { NA } from '../utils/format';

const v = (x: number | string | null, unit = '') => (x == null ? NA : `${x}${unit}`);

export default function DatabaseScreen() {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Screen contentStyle={{ paddingTop: 110 }}>
      <Note>Local model database. Specs are the manufacturer's headline figures for the base variant; regional versions differ. Protocol support is listed only where a public protocol source exists.</Note>
      <View style={{ height: S.md }} />
      {SCOOTER_MODELS.map((m) => (
        <GlassCard key={m.id}>
          <Pressable onPress={() => setOpen(open === m.id ? null : m.id)}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.textDim, fontSize: 12, fontWeight: '700' }}>{m.manufacturer.toUpperCase()}</Text>
                <Text style={{ color: C.text, fontSize: 17, fontWeight: '800' }}>{m.model}</Text>
              </View>
              <Badge text={PROTOCOL_LABELS[m.protocol]} color={m.protocol === 'generic-ble' ? C.textDim : C.green} />
            </View>
          </Pressable>
          {open === m.id && (
            <View style={{ marginTop: S.md }}>
              <KeyValue label="Year" value={v(m.year)} />
              <KeyValue label="Battery voltage" value={v(m.batteryVoltage, ' V')} />
              <KeyValue label="Battery capacity" value={m.batteryCapacityWh ? `${m.batteryCapacityWh} Wh (${m.batteryCapacityAh} Ah)` : NA} />
              <KeyValue label="Motor" value={v(m.motor)} />
              <KeyValue label="Wheel size" value={v(m.wheelSize)} />
              <KeyValue label="Weight" value={v(m.weightKg, ' kg')} />
              <KeyValue label="Top speed" value={v(m.topSpeedKmh, ' km/h')} />
              <KeyValue label="Known BLE services" value={m.knownServices.join('\n') || NA} />
              <KeyValue label="Known telemetry" value={m.knownTelemetry.join(', ') || NA} />
              <KeyValue label="Known error codes" value={m.errorCodes ? `${Object.keys(m.errorCodes).length} documented` : NA} />
              <Note>{m.protocolNotes}</Note>
            </View>
          )}
        </GlassCard>
      ))}
    </Screen>
  );
}
