import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { modelById, modelFullName } from '../data/scooterDatabase';
import { feedback } from '../services/Feedback';
import { computeRecords } from '../services/records';
import { aggregate } from '../services/stats';
import { useGarage } from '../store/garage';
import type { Ride } from '../store/rides';
import { useRides } from '../store/rides';
import { useSettings } from '../store/settings';
import { useThemeVersion } from '../store/theme';
import { DataTag, type Confidence, type DataSource } from '../ui/components/DataTag';
import { IconName, NeonButton } from '../ui/components/Glass';
import { C, R, S, rgba } from '../ui/theme';
import { NA, fmtDate, useUnits } from '../utils/format';

const SLIDE_MS = 5000;

interface Slide {
  id: string;
  icon: IconName;
  kicker: string;
  value: string | null; // null → Not available
  unit?: string;
  sub?: string;
  tag?: { kind: Confidence; source: DataSource };
  rideId?: string;
  big?: boolean;
}

const hoursText = (sec: number) => {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
};

function buildSlides(year: number, rides: Ride[], u: ReturnType<typeof useUnits>, scooterName: (id: string) => string | null): Slide[] {
  const agg = aggregate(rides);
  const rec = computeRecords(rides);
  const moving = rides.reduce((a, r) => a + Math.max(0, r.movingSec), 0);
  const counts = new Map<string, number>();
  for (const r of rides) if (r.scooterId) counts.set(r.scooterId, (counts.get(r.scooterId) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  const d = (km: number) => u.dist(km);
  const long = rec.longestDistance;
  const eff = rec.lowestWhPerKm;
  const fast = rec.highestSpeed;
  return [
    { id: 'intro', icon: 'sparkles-outline', kicker: 'YOUR SCOOTER HUB', value: String(year), big: true, sub: `A look back at your year, made only from the ${rides.length} ride${rides.length === 1 ? '' : 's'} you recorded.` },
    { id: 'distance', icon: 'map-outline', kicker: 'Total distance', value: d(agg.distanceKm).toFixed(1), unit: u.distLabel, tag: { kind: 'measured', source: 'Ride history' } },
    { id: 'rides', icon: 'bicycle-outline', kicker: 'Rides recorded', value: String(agg.rides), sub: agg.avgDistanceKm != null ? `${d(agg.avgDistanceKm).toFixed(1)} ${u.distLabel} per ride on average` : undefined },
    {
      id: 'time', icon: 'time-outline', kicker: 'Riding time', value: moving > 0 ? hoursText(moving) : null,
      sub: moving > 0 ? `Moving time. Total time including stops: ${hoursText(agg.timeSec)}.` : 'No moving time was recorded.', tag: moving > 0 ? { kind: 'calculated', source: 'Ride history' } : undefined,
    },
    {
      id: 'energy', icon: 'flash-outline', kicker: 'Energy used', value: agg.energyWh != null ? (agg.energyWh >= 1000 ? (agg.energyWh / 1000).toFixed(2) : agg.energyWh.toFixed(0)) : null,
      unit: agg.energyWh != null && agg.energyWh >= 1000 ? 'kWh' : 'Wh',
      sub: agg.energyWh != null ? `From the ${agg.energyRides} of ${agg.rides} rides where the scooter reported voltage and current.` : 'None of this year’s rides recorded voltage and current.',
      tag: agg.energyWh != null ? { kind: 'calculated', source: 'Ride history' } : undefined,
    },
    {
      id: 'longest', icon: 'trail-sign-outline', kicker: 'Longest ride', value: long ? d(long.value).toFixed(1) : null, unit: u.distLabel,
      sub: long ? `Ride #${long.ride.number} on ${fmtDate(long.ride.start)}` : undefined, rideId: long?.ride.id, tag: long ? { kind: 'measured', source: 'Ride history' } : undefined,
    },
    {
      id: 'scooter', icon: 'flash', kicker: 'Most-used scooter', value: top ? scooterName(top[0]) ?? 'A scooter no longer in your garage' : null,
      sub: top ? `${top[1]} of ${rides.length} rides` : 'Rides were not linked to a scooter in your garage.',
    },
    {
      id: 'efficient', icon: 'leaf-outline', kicker: 'Most efficient ride', value: eff ? (u.distanceUnit === 'mi' ? (eff.value * 1.609344).toFixed(1) : eff.value.toFixed(1)) : null,
      unit: u.distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km', sub: eff ? `Ride #${eff.ride.number} on ${fmtDate(eff.ride.start)}, ${d(eff.ride.distanceKm).toFixed(1)} ${u.distLabel}` : 'Needs a ride of at least 1 km with energy data.',
      rideId: eff?.ride.id, tag: eff ? { kind: 'calculated', source: 'Ride history' } : undefined,
    },
    {
      id: 'speed', icon: 'speedometer-outline', kicker: 'Highest recorded speed', value: fast ? u.speed(fast.value).toFixed(1) : null, unit: u.speedLabel,
      sub: fast ? `Recorded on ${fmtDate(fast.ride.start)}.` : undefined, rideId: fast?.ride.id, tag: fast ? { kind: 'measured', source: 'Ride history' } : undefined,
    },
    { id: 'outro', icon: 'checkmark-circle-outline', kicker: `That was ${year}`, value: `${d(agg.distanceKm).toFixed(0)} ${u.distLabel}`, sub: 'Everything here comes from rides stored on this phone. Ride safely.' },
  ];
}

export default function WrappedScreen() {
  useThemeVersion();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const u = useUnits();
  const rides = useRides((s) => s.rides);
  const scooters = useGarage((s) => s.scooters);
  const reduceMotion = useSettings((s) => s.reduceMotion);
  const oled = useSettings((s) => s.oledMode);
  const calm = reduceMotion || oled;

  const years = useMemo(() => [...new Set(rides.map((r) => new Date(r.start).getFullYear()))].sort((a, b) => b - a), [rides]);
  const [year, setYear] = useState<number | null>(null);
  const shownYear = year != null && years.includes(year) ? year : years[0] ?? null;

  const scooterName = useCallback(
    (id: string) => {
      const s = scooters.find((x) => x.id === id);
      if (!s) return null;
      const m = modelById(s.modelId);
      return m && s.nickname !== modelFullName(m) ? `${s.nickname} (${modelFullName(m)})` : s.nickname;
    },
    [scooters],
  );
  const slides = useMemo(
    () => (shownYear == null ? [] : buildSlides(shownYear, rides.filter((r) => new Date(r.start).getFullYear() === shownYear), u, scooterName)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shownYear, rides, scooterName, u.distanceUnit, u.speedUnit],
  );

  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const enter = useRef(new Animated.Value(1)).current;
  const progress = useRef(new Animated.Value(0)).current;
  const dir = useRef(1);

  useEffect(() => setIdx(0), [shownYear]);

  // Entrance animation for each slide (content is rendered immediately; only opacity/offset animate).
  useEffect(() => {
    if (calm) {
      enter.setValue(1);
      return;
    }
    enter.setValue(0);
    Animated.spring(enter, { toValue: 1, useNativeDriver: true, damping: 15, stiffness: 120, mass: 0.9 }).start();
  }, [idx, shownYear, calm, enter]);

  // Auto-advance with a story-style progress bar.
  useEffect(() => {
    progress.setValue(0);
    if (paused || reduceMotion || idx >= slides.length - 1) return;
    const anim = Animated.timing(progress, { toValue: 1, duration: SLIDE_MS, easing: Easing.linear, useNativeDriver: false });
    anim.start(({ finished }) => {
      if (finished) {
        dir.current = 1;
        setIdx((i) => Math.min(i + 1, slides.length - 1));
      }
    });
    return () => anim.stop();
  }, [idx, paused, reduceMotion, slides.length, progress]);

  const go = (d: number) => {
    const n = Math.max(0, Math.min(slides.length - 1, idx + d));
    if (n === idx) return;
    dir.current = d;
    feedback('tap');
    setIdx(n);
  };

  const bg = oled ? ['#000000', '#000000'] as const : [rgba(C.violet, 0.55), C.bg] as const;

  if (!years.length || shownYear == null) {
    return (
      <View style={[styles.root, { backgroundColor: oled ? '#000' : C.bg, paddingTop: insets.top + S.xl }]}>
        <LinearGradient colors={bg} style={StyleSheet.absoluteFill} />
        <Pressable onPress={() => router.back()} hitSlop={12} style={[styles.close, { top: insets.top + S.sm }]}>
          <Ionicons name="close" size={26} color={C.text} />
        </Pressable>
        <View style={styles.center}>
          <Ionicons name="sparkles-outline" size={48} color={C.purpleLight} />
          <Text style={styles.emptyTitle}>Your year in rides starts here</Text>
          <Text style={styles.emptyBody}>Once you record a ride, this recap shows your distance, riding time and more, made only from your own data.</Text>
          <NeonButton title="Back" icon="arrow-back" onPress={() => router.back()} style={{ marginTop: S.xl, alignSelf: 'stretch' }} />
        </View>
      </View>
    );
  }

  const slide = slides[Math.min(idx, slides.length - 1)];
  const offset = enter.interpolate({ inputRange: [0, 1], outputRange: [40 * dir.current, 0] });
  const scale = enter.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] });

  return (
    <View style={[styles.root, { backgroundColor: oled ? '#000' : C.bg }]}>
      <LinearGradient colors={bg} style={StyleSheet.absoluteFill} />
      <View style={{ paddingTop: insets.top + S.sm, paddingHorizontal: S.lg }}>
        <View style={styles.bars}>
          {slides.map((s, i) => (
            <View key={s.id} style={styles.barTrack}>
              {i < idx ? (
                <View style={[styles.barFill, { width: '100%' }]} />
              ) : i === idx ? (
                <Animated.View style={[styles.barFill, { width: reduceMotion || paused ? '100%' : progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
              ) : null}
            </View>
          ))}
        </View>
        <View style={styles.topRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} style={{ flex: 1 }}>
            {years.map((y) => (
              <Pressable key={y} onPress={() => setYear(y)} style={[styles.chip, y === shownYear && { backgroundColor: C.violet, borderColor: C.violet }]}>
                <Text style={[styles.chipText, y === shownYear && { color: '#fff' }]}>{y}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable onPress={() => setPaused((p) => !p)} hitSlop={10} style={{ padding: 6 }} accessibilityLabel={paused ? 'Resume' : 'Pause'}>
            <Ionicons name={paused ? 'play' : 'pause'} size={20} color={C.text} />
          </Pressable>
          <Pressable onPress={() => router.back()} hitSlop={10} style={{ padding: 6 }} accessibilityLabel="Close">
            <Ionicons name="close" size={26} color={C.text} />
          </Pressable>
        </View>
      </View>

      <Pressable style={{ flex: 1 }} onPress={(e) => go(e.nativeEvent.pageX < width * 0.3 ? -1 : 1)} accessibilityLabel="Next slide">
        <Animated.View style={[styles.slide, { opacity: enter, transform: [{ translateX: offset }, { scale }] }]}>
          <View style={[styles.iconWrap, { backgroundColor: rgba(C.purple, 0.18), borderColor: C.borderStrong }]}>
            <Ionicons name={slide.icon} size={34} color={C.purpleLight} />
          </View>
          <Text style={styles.kicker}>{slide.kicker}</Text>
          {slide.value != null ? (
            <Text style={[styles.value, slide.big && { fontSize: 88 }, slide.value.length > 12 && { fontSize: 34 }]} adjustsFontSizeToFit numberOfLines={2}>
              {slide.value}
              {slide.unit ? <Text style={styles.unit}> {slide.unit}</Text> : null}
            </Text>
          ) : (
            <Text style={styles.na}>{NA}</Text>
          )}
          {slide.tag && <DataTag kind={slide.tag.kind} source={slide.tag.source} style={{ alignSelf: 'center' }} />}
          {!!slide.sub && <Text style={styles.sub}>{slide.sub}</Text>}
          {slide.rideId && (
            <Pressable onPress={() => router.push(`/ride/${slide.rideId}`)} style={styles.rideBtn}>
              <Text style={{ color: C.purpleLight, fontWeight: '700' }}>View ride</Text>
              <Ionicons name="chevron-forward" size={16} color={C.purpleLight} />
            </Pressable>
          )}
          {slide.id === 'outro' && (
            <Pressable onPress={() => { dir.current = -1; setIdx(0); }} style={styles.rideBtn}>
              <Ionicons name="refresh" size={16} color={C.purpleLight} />
              <Text style={{ color: C.purpleLight, fontWeight: '700' }}>Watch again</Text>
            </Pressable>
          )}
        </Animated.View>
      </Pressable>
      <Text style={[styles.hint, { paddingBottom: insets.bottom + S.md }]}>Tap to continue · tap the left edge to go back</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  close: { position: 'absolute', right: S.lg, zIndex: 2, padding: 6 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: S.xl },
  emptyTitle: { color: C.text, fontSize: 22, fontWeight: '800', marginTop: S.lg, textAlign: 'center' },
  emptyBody: { color: C.textDim, fontSize: 14, lineHeight: 20, marginTop: S.sm, textAlign: 'center' },
  bars: { flexDirection: 'row', gap: 4 },
  barTrack: { flex: 1, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)', overflow: 'hidden' },
  barFill: { height: 3, backgroundColor: '#fff' },
  topRow: { flexDirection: 'row', alignItems: 'center', marginTop: S.md, gap: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: R.pill, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  chipText: { color: C.textDim, fontWeight: '700', fontSize: 13 },
  slide: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: S.xl },
  iconWrap: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', borderWidth: 1, marginBottom: S.lg },
  kicker: { color: C.textDim, fontSize: 14, fontWeight: '800', letterSpacing: 2.4, textTransform: 'uppercase', textAlign: 'center' },
  value: { color: C.text, fontSize: 64, fontWeight: '900', letterSpacing: -1.5, textAlign: 'center', marginTop: S.sm, fontVariant: ['tabular-nums'] },
  unit: { color: C.textDim, fontSize: 24, fontWeight: '700', letterSpacing: 0 },
  na: { color: C.textFaint, fontSize: 28, fontWeight: '700', marginTop: S.md },
  sub: { color: C.textDim, fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: S.md },
  rideBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: S.lg, paddingHorizontal: 14, paddingVertical: 8, borderRadius: R.pill, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  hint: { color: C.textFaint, fontSize: 11.5, textAlign: 'center' },
});
