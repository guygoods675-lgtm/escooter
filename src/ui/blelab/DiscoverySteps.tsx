import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GlassCard } from '../components/Glass';
import { C, S } from '../theme';

export type StepState = 'done' | 'active' | 'todo';
export interface DiscoveryStep {
  title: string;
  detail: string;
  state: StepState;
  onPress?: () => void;
}

/** Numbered discovery workflow. Tapping a step only navigates; it never sends anything. */
export function DiscoverySteps({ steps }: { steps: DiscoveryStep[] }) {
  return (
    <GlassCard>
      <Text style={styles.title}>Discovery workflow</Text>
      {steps.map((s, i) => {
        const color = s.state === 'done' ? C.green : s.state === 'active' ? C.purpleLight : C.textFaint;
        return (
          <Pressable key={s.title} onPress={s.onPress} style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]} accessibilityRole="button" accessibilityLabel={`Step ${i + 1}: ${s.title}. ${s.detail}`}>
            <View style={[styles.num, { borderColor: color, backgroundColor: s.state === 'done' ? color : 'transparent' }]}>
              {s.state === 'done' ? <Ionicons name="checkmark" size={13} color={C.bg} /> : <Text style={[styles.numText, { color }]}>{i + 1}</Text>}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.stepTitle, s.state === 'todo' && { color: C.textDim }]}>{s.title}</Text>
              <Text style={styles.detail}>{s.detail}</Text>
            </View>
            {!!s.onPress && <Ionicons name="chevron-forward" size={16} color={C.textFaint} />}
          </Pressable>
        );
      })}
      <Text style={styles.foot}>Only service discovery (on connect) runs automatically. Reads and subscriptions happen when you tap them.</Text>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  title: { color: C.text, fontWeight: '800', fontSize: 15, marginBottom: S.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: 7 },
  num: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  numText: { fontSize: 12, fontWeight: '800' },
  stepTitle: { color: C.text, fontWeight: '700', fontSize: 14 },
  detail: { color: C.textFaint, fontSize: 11.5, marginTop: 1 },
  foot: { color: C.textFaint, fontSize: 11, marginTop: S.sm },
});
