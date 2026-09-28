import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { useLive } from '../../store/live';
import { useSettings } from '../../store/settings';
import { useThemeVersion } from '../../store/theme';
import { C, F, S } from '../theme';

type Mode = 'drive' | 'regen' | 'idle' | 'unknown';
const IDLE_W = 5; // below this the flow is shown as idle
const DOT_GAP = 22;

/**
 * BATTERY → CONTROLLER → MOTOR energy flow driven by real telemetry.
 * drive: battery current > 0 and power above ~5 W.
 * regen: battery current < 0 while the scooter reports speed > 1 km/h and the BMS is not charging,
 *        i.e. energy measurably flowing back into the pack.
 * No telemetry → nothing animates.
 */
export function useEnergyMode(): { mode: Mode; watts: number | null } {
  const current = useLive((s) => s.snapshot?.batteryCurrent?.value ?? null);
  const voltage = useLive((s) => s.snapshot?.batteryVoltage?.value ?? null);
  const power = useLive((s) => s.snapshot?.powerW?.value ?? null);
  const speed = useLive((s) => s.snapshot?.speedKmh?.value ?? null);
  const charging = useLive((s) => s.battery?.charging?.value ?? false);
  const watts = power ?? (current != null && voltage != null ? current * voltage : null);
  if (watts == null || current == null) return { mode: watts == null ? 'unknown' : Math.abs(watts) < IDLE_W ? 'idle' : 'drive', watts };
  if (current < -0.05 && (speed ?? 0) > 1 && !charging) return { mode: 'regen', watts };
  if (current > 0 && watts >= IDLE_W) return { mode: 'drive', watts };
  return { mode: 'idle', watts };
}

function FlowLine({ mode, watts, color }: { mode: Mode; watts: number | null; color: string }) {
  const [w, setW] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  const reduce = useSettings((s) => s.reduceMotion || s.oledMode);
  const active = (mode === 'drive' || mode === 'regen') && !reduce;
  // Faster flow for more power, bucketed so the loop only restarts on meaningful changes.
  const bucket = watts == null ? 0 : Math.min(5, Math.floor(Math.abs(watts) / 100));
  useEffect(() => {
    x.setValue(0);
    if (!active) return;
    const loop = Animated.loop(Animated.timing(x, { toValue: 1, duration: 1100 - bucket * 150, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [active, bucket, mode, x]);
  const dots = Math.ceil((w + DOT_GAP * 2) / DOT_GAP);
  const translate = x.interpolate({ inputRange: [0, 1], outputRange: mode === 'regen' ? [0, -DOT_GAP] : [-DOT_GAP, 0] });
  return (
    <View style={styles.line} onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
      <View style={[styles.track, { backgroundColor: active ? `${color}33` : 'rgba(255,255,255,0.08)' }]} />
      {active && (
        <Animated.View style={[styles.dots, { transform: [{ translateX: translate }] }]}>
          {Array.from({ length: dots }, (_, i) => (
            <View key={i} style={[styles.dot, { backgroundColor: color, shadowColor: color }]} />
          ))}
        </Animated.View>
      )}
      {active && <Ionicons name={mode === 'regen' ? 'chevron-back' : 'chevron-forward'} size={14} color={color} style={styles.arrow} />}
    </View>
  );
}

function Node({ icon, label, color, glowOn }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; color: string; glowOn: boolean }) {
  return (
    <View style={{ alignItems: 'center', width: 72 }}>
      <View style={[styles.node, { borderColor: glowOn ? color : C.border, shadowColor: color, shadowOpacity: glowOn ? 0.7 : 0 }]}>
        <Ionicons name={icon} size={24} color={glowOn ? color : C.textDim} />
      </View>
      <Text style={styles.nodeLabel}>{label}</Text>
    </View>
  );
}

export function EnergyFlow() {
  useThemeVersion();
  const { mode, watts } = useEnergyMode();
  const color = mode === 'regen' ? C.green : C.purple;
  const active = mode === 'drive' || mode === 'regen';
  const label =
    mode === 'unknown' ? 'Power data not available from this scooter' : mode === 'regen' ? 'Regenerative braking: energy returning to battery' : mode === 'drive' ? 'Drawing power from battery' : 'Idle';
  return (
    <View>
      <View style={styles.row}>
        <Node icon="battery-charging" label="BATTERY" color={color} glowOn={active} />
        <FlowLine mode={mode} watts={watts} color={color} />
        <Node icon="hardware-chip" label="CONTROLLER" color={color} glowOn={active} />
        <FlowLine mode={mode} watts={watts} color={color} />
        <Node icon="cog" label="MOTOR" color={color} glowOn={active} />
      </View>
      <View style={styles.footer}>
        <Text style={[styles.watts, { color: active ? color : C.textDim }]}>{watts != null ? `${Math.round(Math.abs(watts))} W` : '—'}</Text>
        <Text style={styles.mode}>{label}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  line: { flex: 1, height: 20, justifyContent: 'center', overflow: 'hidden', marginBottom: 18 },
  track: { position: 'absolute', left: 0, right: 0, height: 3, borderRadius: 2 },
  dots: { flexDirection: 'row', position: 'absolute', left: 0 },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: DOT_GAP - 6, shadowOpacity: 0.9, shadowRadius: 5, shadowOffset: { width: 0, height: 0 } },
  arrow: { position: 'absolute', alignSelf: 'center', left: '42%' },
  node: { width: 54, height: 54, borderRadius: 16, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.04)', shadowRadius: 12, shadowOffset: { width: 0, height: 0 }, elevation: 4 },
  nodeLabel: { ...F.label, fontSize: 9.5, marginTop: 6 },
  footer: { flexDirection: 'row', alignItems: 'baseline', gap: S.sm, marginTop: S.sm },
  watts: { fontSize: 22, fontWeight: '900', fontVariant: ['tabular-nums'] },
  mode: { color: C.textDim, fontSize: 12.5, flex: 1 },
});
