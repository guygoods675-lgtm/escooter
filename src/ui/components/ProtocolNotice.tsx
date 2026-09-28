import { router } from 'expo-router';
import React from 'react';
import { Text } from 'react-native';
import { useLive } from '../../store/live';
import { GlassCard, NeonButton, Note } from './Glass';
import { C, S } from '../theme';

/**
 * Explains, on the dashboard, why values are missing: either the scooter needs a
 * setup step (Xiaomi key) or its protocol is not supported. Never shows guessed data.
 */
export function ProtocolNotice() {
  const conn = useLive((s) => s.conn);
  const action = useLive((s) => s.setupAction);
  const protocolId = useLive((s) => s.protocolId);
  const note = useLive((s) => s.detectionNote);
  if (conn !== 'connected') return null;
  if (action === 'xiaomi-key') {
    return (
      <GlassCard accent={C.amber}>
        <Text style={{ color: C.text, fontWeight: '800', fontSize: 16, marginBottom: 6 }}>One step left to see your scooter's data</Text>
        {!!note && <Note>{note}</Note>}
        <NeonButton title="Add scooter key" icon="key-outline" onPress={() => router.push('/xiaomi-key')} style={{ marginTop: S.md }} />
      </GlassCard>
    );
  }
  if (protocolId === 'generic-ble' && note) {
    return (
      <GlassCard accent={C.amber}>
        <Text style={{ color: C.text, fontWeight: '800', fontSize: 16, marginBottom: 6 }}>Why values show "Not available"</Text>
        <Note>{note}</Note>
        <NeonButton title="Choose model manually" small variant="ghost" icon="list" onPress={() => router.push('/identify')} style={{ marginTop: S.md }} />
      </GlassCard>
    );
  }
  return null;
}
