import React from 'react';
import { Text } from 'react-native';
import { useLive } from '../store/live';
import { useScooterTitle } from '../ui/hooks';
import { EmptyState, GlassCard, KeyValue, Note, SectionHeader } from '../ui/components/Glass';
import { Screen } from '../ui/components/Screen';
import { C } from '../ui/theme';
import { NA } from '../utils/format';

export default function FirmwareScreen() {
  const identity = useLive((s) => s.identity);
  const battery = useLive((s) => s.battery);
  const conn = useLive((s) => s.conn);
  const { profile } = useScooterTitle();
  const id = identity ?? profile?.identity ?? null;
  if (!id) return <Screen contentStyle={{ paddingTop: 110 }}><EmptyState icon="hardware-chip-outline" title="No firmware information yet" body="Connect a scooter to read its versions." /></Screen>;
  return (
    <Screen contentStyle={{ paddingTop: 110 }}>
      {conn !== 'connected' && <Note>Showing the versions read at the last connection.</Note>}
      <GlassCard>
        <KeyValue label="Current firmware" value={id.firmware?.value ?? NA} />
        <KeyValue label="Controller firmware" value={id.controllerFirmware?.value ?? NA} />
        <KeyValue label="BMS firmware" value={id.bmsFirmware?.value ?? battery?.firmware?.value ?? NA} />
        <KeyValue label="BLE firmware" value={id.bleFirmware?.value ?? NA} />
        <KeyValue label="Hardware revision" value={id.hardware?.value ?? NA} />
        <KeyValue label="Protocol" value={id.protocolVersion?.value ?? NA} />
        <KeyValue label="Release information" value={NA} note="No verified release notes source" />
      </GlassCard>
      <SectionHeader title="Firmware updates" icon="shield-outline" />
      <GlassCard accent={C.amber}>
        <Text style={{ color: C.text, lineHeight: 20 }}>
          This page is informational only. Scooter Hub never flashes firmware. A future update feature would require a documented, officially supported update mechanism for the exact model, with image verification, recovery handling and clear warnings.
        </Text>
      </GlassCard>
    </Screen>
  );
}
