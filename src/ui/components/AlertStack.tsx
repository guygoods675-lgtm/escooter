import { Ionicons } from '@expo/vector-icons';
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLive } from '../../store/live';
import { C, R, S } from '../theme';

export function AlertStack() {
  const alerts = useLive((s) => s.alerts);
  const dismiss = useLive((s) => s.dismissAlert);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!alerts.length) return;
    const t = setTimeout(() => dismiss(alerts[alerts.length - 1].id), 6000);
    return () => clearTimeout(t);
  }, [alerts, dismiss]);
  if (!alerts.length) return null;
  const a = alerts[0];
  const color = a.level === 'critical' ? C.red : a.level === 'warning' ? C.amber : C.cyan;
  return (
    <View style={[styles.wrap, { top: insets.top + 8 }]} pointerEvents="box-none">
      <Pressable onPress={() => dismiss(a.id)} style={[styles.card, { borderColor: color }]}>
        <Ionicons name={a.level === 'info' ? 'information-circle' : 'warning'} size={22} color={color} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{a.title}</Text>
          <Text style={styles.body}>{a.body}</Text>
        </View>
        <Ionicons name="close" size={18} color={C.textDim} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: S.lg, right: S.lg },
  card: { flexDirection: 'row', gap: S.md, alignItems: 'center', padding: S.md, borderRadius: R.md, borderWidth: 1, backgroundColor: 'rgba(12,8,24,0.96)' },
  title: { color: C.text, fontWeight: '700', fontSize: 14 },
  body: { color: C.textDim, fontSize: 13, marginTop: 2 },
});
