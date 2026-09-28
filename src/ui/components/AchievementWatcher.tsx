import { Ionicons } from '@expo/vector-icons';
import { feedback } from '../../services/Feedback';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ACHIEVEMENTS, achievementInputs, type AchievementDef } from '../../services/stats';
import { useAchievements } from '../../store/achievements';
import { useMaintenance } from '../../store/maintenance';
import { useRides } from '../../store/rides';
import { useSettings } from '../../store/settings';
import { C, R, S, glow, rgba } from '../theme';
import type { IconName } from './Glass';

type Persisted = { persist: { hasHydrated(): boolean; onFinishHydration(fn: () => void): () => void } };

function useHydrated(store: Persisted) {
  const [done, setDone] = useState(() => store.persist.hasHydrated());
  useEffect(() => {
    if (store.persist.hasHydrated()) setDone(true);
    return store.persist.onFinishHydration(() => setDone(true));
  }, [store]);
  return done;
}

const HOLD_MS = 2800;

/**
 * Watches recorded rides and maintenance logs and unlocks achievements as they
 * are met, showing a toast for each one. Mounted once at the app root.
 */
export function AchievementWatcher() {
  const rides = useRides((s) => s.rides);
  const items = useMaintenance((s) => s.items);
  const reduceMotion = useSettings((s) => s.reduceMotion || s.oledMode);
  const hydrated = [useHydrated(useRides), useHydrated(useMaintenance), useHydrated(useAchievements)].every(Boolean);
  const firstEval = useRef(true);
  const [queue, setQueue] = useState<AchievementDef[]>([]);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!hydrated) return;
    const { unlocked, unlock } = useAchievements.getState();
    const inputs = achievementInputs(rides, items);
    const met = ACHIEVEMENTS.filter((a) => unlocked[a.id] == null && (() => {
      const p = a.progress(inputs);
      return p.value >= p.target;
    })());
    // First evaluation with no stored unlocks (fresh install or an update that added
    // achievements): record what is already met silently instead of a burst of toasts.
    const silent = firstEval.current && Object.keys(unlocked).length === 0;
    firstEval.current = false;
    if (!met.length) return;
    unlock(met.map((a) => a.id));
    if (!silent) setQueue((q) => [...q, ...met]);
  }, [hydrated, rides, items]);

  const current = queue[0] ?? null;
  const a = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!current) return;
    feedback('achievement');
    a.setValue(0);
    const enter = reduceMotion
      ? Animated.timing(a, { toValue: 1, duration: 120, useNativeDriver: true })
      : Animated.spring(a, { toValue: 1, useNativeDriver: true, damping: 12, stiffness: 180, mass: 0.8 });
    const seq = Animated.sequence([enter, Animated.delay(HOLD_MS), Animated.timing(a, { toValue: 0, duration: reduceMotion ? 120 : 220, useNativeDriver: true })]);
    seq.start(({ finished }) => {
      if (finished) setQueue((q) => q.slice(1));
    });
    return () => seq.stop();
  }, [current, a, reduceMotion]);

  const dismiss = () => {
    Animated.timing(a, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => setQueue((q) => q.slice(1)));
  };

  if (!current) return null;
  const scale = reduceMotion ? 1 : a.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] });
  const translateY = reduceMotion ? 0 : a.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] });

  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 1000, elevation: 1000 }]}>
      <Animated.View style={[styles.wrap, { top: insets.top + S.sm, opacity: a, transform: [{ translateY }, { scale }] }]}>
        <Pressable onPress={dismiss} style={[styles.toast, glow(C.violet, 18)]} accessibilityRole="alert" accessibilityLabel={`Achievement unlocked: ${current.title}`}>
          <View style={styles.icon}>
            <Ionicons name={current.icon as IconName} size={24} color={C.purpleLight} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.kicker}>Achievement unlocked</Text>
            <Text style={styles.title} numberOfLines={1}>{current.title}</Text>
            <Text style={styles.desc} numberOfLines={1}>{current.description}</Text>
          </View>
          {queue.length > 1 && <Text style={styles.more}>+{queue.length - 1}</Text>}
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: S.lg, right: S.lg },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: S.md,
    padding: S.md,
    borderRadius: R.lg,
    borderWidth: 1,
    get borderColor() {
      return C.borderStrong;
    },
    backgroundColor: C.cardStrong,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    get backgroundColor() {
      return rgba(C.purple, 0.22);
    },
  },
  kicker: { color: C.green, fontSize: 10.5, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' },
  title: { color: C.text, fontSize: 16, fontWeight: '800', marginTop: 1 },
  desc: { color: C.textDim, fontSize: 12.5, marginTop: 1 },
  more: { color: C.textDim, fontWeight: '700', fontSize: 12 },
});
