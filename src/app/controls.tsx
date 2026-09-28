import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import type { CommandDef } from '../protocols/types';
import { sendScooterCommand } from '../services/ScooterManager';
import { useLive } from '../store/live';
import { Badge, EmptyState, GlassCard, KeyValue, NeonButton, Note, SectionHeader } from '../ui/components/Glass';
import { Screen } from '../ui/components/Screen';
import { C, S } from '../ui/theme';
import { NA, onOff } from '../utils/format';

/**
 * Lights, accessories and riding modes. State is shown when the protocol reports it.
 * Controls appear only for commands the protocol adapter lists with a documented source,
 * and each one needs explicit confirmation.
 */
export default function ControlsScreen() {
  const s = useLive((x) => x.snapshot);
  const caps = useLive((x) => x.capabilities);
  const conn = useLive((x) => x.conn);
  if (conn !== 'connected') return <Screen contentStyle={{ paddingTop: 110 }}><EmptyState icon="bulb-outline" title="No scooter connected" /></Screen>;
  const cmds = caps?.commands ?? [];
  const cmd = (id: string) => cmds.find((c) => c.id === id);

  return (
    <Screen contentStyle={{ paddingTop: 110 }}>
      <SectionHeader title="Lights & accessories" icon="bulb-outline" />
      <GlassCard>
        <KeyValue label="Headlight" value={s?.headlight ? onOff(s.headlight) : NA} />
        <KeyValue label="Tail light" value={s?.tailLight ? onOff(s.tailLight) : NA} />
        <KeyValue label="Brake light" value={NA} />
        <KeyValue label="Indicators" value={NA} />
        <KeyValue label="Ambient / underglow" value={NA} />
        <KeyValue label="Horn" value={NA} />
        <KeyValue label="Cruise control" value={s?.cruiseControl ? onOff(s.cruiseControl) : NA} />
        <KeyValue label="Regenerative braking" value={s?.regenLevel?.value ?? NA} />
      </GlassCard>

      <SectionHeader title="Riding mode" icon="speedometer-outline" />
      <GlassCard>
        <KeyValue label="Current mode" value={s?.rideMode?.value ?? NA} />
        <KeyValue label="Change mode" value="Unsupported" note="No documented, verified mode command for this scooter" />
      </GlassCard>

      <SectionHeader title="Controls" icon="toggle-outline" />
      {cmds.length === 0 ? (
        <GlassCard>
          <Text style={{ color: C.textDim, lineHeight: 19 }}>
            Unsupported. This scooter's protocol adapter has no documented write commands, so Scooter Hub stays read-only.
          </Text>
        </GlassCard>
      ) : (
        ['tailLight', 'cruise', 'kers'].map((id) => cmd(id)).filter(Boolean).map((c) => <CommandCard key={c!.id} def={c!} />)
      )}
      <Note>
        Scooter Hub never offers speed-limit changes, safety-system overrides or firmware modification. Controls here mirror settings the manufacturer's own app exposes, using documented frames.
      </Note>
      <View style={{ height: S.xl }} />
    </Screen>
  );
}

function CommandCard({ def }: { def: CommandDef }) {
  const [busy, setBusy] = useState<number | null>(null);
  const run = (value: number, label: string) =>
    Alert.alert(`Set ${def.label} to ${label}?`, `This sends a write command to the scooter.\n\n${def.description}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Send',
        onPress: async () => {
          setBusy(value);
          try {
            await sendScooterCommand(def.id, value);
          } catch (e) {
            Alert.alert('Command failed', e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  return (
    <GlassCard>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: C.text, fontWeight: '700', fontSize: 16 }}>{def.label}</Text>
        <Badge text="WRITE" color={C.amber} icon="create-outline" />
      </View>
      <View style={{ flexDirection: 'row', gap: S.sm, marginTop: S.md }}>
        {def.options.map((o) => (
          <NeonButton key={o.value} small title={o.label} variant="ghost" style={{ flex: 1 }} loading={busy === o.value} onPress={() => run(o.value, o.label)} />
        ))}
      </View>
      <Note>Source: {def.source}. The displayed state updates on the next poll.</Note>
    </GlassCard>
  );
}
