import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useGarage } from '../../store/garage';
import type { ConnState } from '../../store/live';
import { useLive } from '../../store/live';
import { useSettings } from '../../store/settings';
import { NA, fmtDuration } from '../../utils/format';
import { useNow, useScooterTitle } from '../hooks';
import { C, F, S, rgba } from '../theme';
import { GlassCard } from './Glass';
import { Pulse } from './Motion';

const STEPS = ['Searching', 'Scooter found', 'Connecting', 'Reading scooter data', 'Connected'] as const;

/** Index of the active step for a connection state; -1 = no step active. */
function stepFor(conn: ConnState): number {
  switch (conn) {
    case 'scanning':
      return 0;
    case 'found':
      return 1;
    case 'connecting':
    case 'reconnecting':
      return 2;
    case 'identifying':
      return 3;
    case 'connected':
      return 4;
    default:
      return -1;
  }
}

function StepDot({ state, index }: { state: 'done' | 'active' | 'todo'; index: number }) {
  const reduce = useSettings((s) => s.reduceMotion || s.oledMode);
  const scale = useRef(new Animated.Value(state === 'active' ? 1 : 0.85)).current;
  useEffect(() => {
    const to = state === 'active' ? 1.12 : state === 'done' ? 1 : 0.85;
    if (reduce) scale.setValue(to);
    else Animated.spring(scale, { toValue: to, useNativeDriver: true, damping: 10, stiffness: 180 }).start();
  }, [state, scale, reduce]);
  const color = state === 'done' ? C.green : state === 'active' ? C.purple : C.textFaint;
  return (
    <View style={styles.dotWrap}>
      <Pulse size={26} active={state === 'active' && !reduce} color={C.purple} />
      <Animated.View style={[styles.dot, { borderColor: color, backgroundColor: state === 'todo' ? 'transparent' : rgba(state === 'done' ? C.green : C.purple, 0.22), transform: [{ scale }] }]}>
        {state === 'done' ? <Ionicons name="checkmark" size={13} color={C.green} /> : <Text style={[styles.dotNum, { color }]}>{index + 1}</Text>}
      </Animated.View>
    </View>
  );
}

/**
 * Shows the connection sequence SEARCHING → SCOOTER FOUND → CONNECTING → READING SCOOTER DATA → CONNECTED,
 * driven only by the live connection state. Hidden while idle/disconnected unless compact === false.
 */
export function ConnectionStepper({ compact }: { compact?: boolean }) {
  const conn = useLive((s) => s.conn);
  const connError = useLive((s) => s.connError);
  const connectedAt = useLive((s) => s.connectedAt);
  const scooterId = useLive((s) => s.scooterId);
  const connections = useGarage((s) => s.scooters.find((x) => x.id === scooterId)?.connections);
  const { title, nickname } = useScooterTitle();
  const active = stepFor(conn);
  const now = useNow();

  // Success haptic only on an observed transition into "connected" (not when mounting already connected).
  const prev = useRef<ConnState>(conn);
  useEffect(() => {
    prev.current = conn;
  }, [conn]);

  const hidden = conn === 'idle' || conn === 'disconnected';
  if (hidden && compact !== false) return null;

  // Connection start: live store first, then the open entry in the garage connection log.
  const open = connections?.[0] && connections[0].end == null ? connections[0].start : null;
  const since = conn === 'connected' ? connectedAt ?? open : null;

  return (
    <GlassCard accent={conn === 'connected' ? C.green : conn === 'error' ? C.red : undefined}>
      {conn === 'connected' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md, marginBottom: compact ? 0 : S.md }}>
          <Ionicons name="checkmark-circle" size={28} color={C.green} />
          <View style={{ flex: 1 }}>
            <Text style={styles.title} numberOfLines={1}>{title} connected</Text>
            <Text style={styles.sub}>
              {nickname ? `${nickname} · ` : ''}connected for <Text style={styles.timer}>{since ? fmtDuration((now - since) / 1000) : NA}</Text>
            </Text>
          </View>
        </View>
      ) : null}
      {!(compact && conn === 'connected') && (
        <View style={styles.row}>
          {STEPS.map((label, i) => {
            const state: 'done' | 'active' | 'todo' = active < 0 ? 'todo' : i < active || (conn === 'connected' && i === active) ? 'done' : i === active ? 'active' : 'todo';
            return (
              <React.Fragment key={label}>
                {i > 0 && <View style={[styles.line, { backgroundColor: i <= active ? C.green : C.border }]} />}
                <View style={styles.step}>
                  <StepDot state={state} index={i} />
                  {!compact && (
                    <Text style={[styles.label, state === 'active' && { color: C.purpleLight }, state === 'done' && { color: C.green }]} numberOfLines={2}>
                      {label.toUpperCase()}
                    </Text>
                  )}
                </View>
              </React.Fragment>
            );
          })}
        </View>
      )}
      {compact && active >= 0 && active < 4 && <Text style={[styles.sub, { marginTop: S.sm, color: C.purpleLight }]}>{STEPS[active].toUpperCase()}…</Text>}
      {conn === 'reconnecting' && <Text style={[styles.sub, { marginTop: S.sm, color: C.amber }]}>Connection lost, reconnecting…</Text>}
      {conn === 'error' && <Text style={[styles.sub, { marginTop: S.sm, color: C.red }]}>Connection failed{connError ? `: ${connError}` : ''}</Text>}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  step: { flex: 1, alignItems: 'center' },
  line: { width: 8, height: 2, marginTop: 12, borderRadius: 1 },
  dotWrap: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  dotNum: { fontSize: 11, fontWeight: '800' },
  label: { color: C.textFaint, fontSize: 8.5, fontWeight: '800', letterSpacing: 0.6, textAlign: 'center', marginTop: 6 },
  title: { color: C.text, fontSize: 17, fontWeight: '800' },
  sub: { color: C.textDim, fontSize: 12.5, marginTop: 2 },
  timer: { color: C.text, fontFamily: F.mono, fontWeight: '700' },
});
