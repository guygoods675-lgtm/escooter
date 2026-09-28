import { router } from 'expo-router';
import React from 'react';
import { Alert, Text } from 'react-native';
import { SCOOTER_MODELS } from '../data/scooterDatabase';
import { PROTOCOL_LABELS } from '../protocols/registry';
import { connectScooter, disconnectScooter } from '../services/ScooterManager';
import { useGarage } from '../store/garage';
import { useLive } from '../store/live';
import { Divider, GlassCard, ListRow, Note } from '../ui/components/Glass';
import { Screen } from '../ui/components/Screen';
import { C } from '../ui/theme';

/** Manual model selection when automatic identification isn't possible. */
export default function IdentifyScreen() {
  const scooterId = useLive((s) => s.scooterId);
  const profile = useGarage((s) => s.scooters.find((x) => x.id === scooterId));
  const update = useGarage((s) => s.update);

  const choose = async (modelId: string | null) => {
    if (!profile) return router.back();
    update(profile.id, { modelId, manualModel: !!modelId });
    const bleId = profile.bleId;
    router.back();
    if (bleId) {
      // Reconnect so the chosen model's protocol adapter is used.
      await disconnectScooter();
      connectScooter(bleId, profile.bleName);
    }
  };

  return (
    <Screen contentStyle={{ paddingTop: 70 }}>
      <Note>
        Pick the model if Scooter Hub could not identify it. The choice selects which documented protocol adapter to try first. If that protocol does not answer, values remain "Not available".
      </Note>
      <GlassCard style={{ marginTop: 12, paddingVertical: 4 }}>
        <ListRow icon="sparkles-outline" title="Automatic detection" subtitle="Let Scooter Hub probe documented protocols" onPress={() => choose(null)} right={!profile?.manualModel ? <Text style={{ color: C.green }}>✓</Text> : undefined} />
        {SCOOTER_MODELS.map((m) => (
          <React.Fragment key={m.id}>
            <Divider />
            <ListRow
              icon="bicycle"
              title={`${m.manufacturer} ${m.model}`}
              subtitle={PROTOCOL_LABELS[m.protocol]}
              right={profile?.manualModel && profile.modelId === m.id ? <Text style={{ color: C.green }}>✓</Text> : undefined}
              onPress={() =>
                m.protocol === 'generic-ble' && m.id !== 'generic'
                  ? Alert.alert('Limited support', m.protocolNotes, [{ text: 'Cancel', style: 'cancel' }, { text: 'Use anyway', onPress: () => choose(m.id) }])
                  : choose(m.id)
              }
            />
          </React.Fragment>
        ))}
      </GlassCard>
    </Screen>
  );
}
