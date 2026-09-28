import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { feedback } from '../../services/Feedback';
import { useLive } from '../../store/live';
import { useSettings } from '../../store/settings';
import { C, F } from '../theme';

/**
 * Small, optional fun. Everything here is decoration only: overlays never take
 * touches (pointerEvents="none"), never show data, and are skipped when Easter
 * eggs, reduce motion or OLED mode are off/on in Settings.
 */
type Egg = 'scooter' | 'hexrain' | 'confetti' | 'secret';
const listeners = new Set<(e: Egg) => void>();
export const triggerEgg = (e: Egg) => {
  const s = useSettings.getState();
  if (!s.easterEggs) return;
  listeners.forEach((l) => l(e));
};

const LOGO = require('../../../assets/logo.png');

function ScooterGlyph({ color }: { color: string }) {
  return (
    <Svg width={84} height={60} viewBox="0 0 84 60">
      <Path d="M58 8 L64 44" stroke={color} strokeWidth={4} strokeLinecap="round" />
      <Path d="M52 8 H68" stroke={color} strokeWidth={4} strokeLinecap="round" />
      <Rect x={16} y={40} width={48} height={6} rx={3} fill={color} />
      <Circle cx={16} cy={48} r={9} stroke={color} strokeWidth={4} fill="none" />
      <Circle cx={66} cy={48} r={9} stroke={color} strokeWidth={4} fill="none" />
      <Circle cx={70} cy={14} r={3} fill="#FDE68A" />
    </Svg>
  );
}

function DrivingScooter({ onDone }: { onDone: () => void }) {
  const { width, height } = useWindowDimensions();
  const x = useRef(new Animated.Value(-100)).current;
  useEffect(() => {
    Animated.timing(x, { toValue: width + 100, duration: 2600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }).start(onDone);
  }, [x, width, onDone]);
  const bob = x.interpolate({ inputRange: [0, 40, 80], outputRange: [0, -3, 0], extrapolate: 'extend' });
  return (
    <Animated.View style={{ position: 'absolute', top: height * 0.72, left: 0, transform: [{ translateX: x }, { translateY: bob }] }}>
      <ScooterGlyph color={C.purpleLight} />
    </Animated.View>
  );
}

function HexRain({ onDone }: { onDone: () => void }) {
  const { width, height } = useWindowDimensions();
  const cols = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => ({
        x: (i / 12) * width + 6,
        text: Array.from({ length: 14 }, () => Math.floor(Math.random() * 256).toString(16).toUpperCase().padStart(2, '0')).join('\n'),
        d: 1400 + ((i * 373) % 900),
      })),
    [width],
  );
  const vals = useRef(cols.map(() => new Animated.Value(0))).current;
  useEffect(() => {
    Animated.parallel(vals.map((v, i) => Animated.timing(v, { toValue: 1, duration: cols[i].d, easing: Easing.linear, useNativeDriver: true }))).start(onDone);
  }, [vals, cols, onDone]);
  return (
    <>
      {cols.map((c, i) => (
        <Animated.Text
          key={i}
          style={[
            styles.hex,
            { left: c.x, opacity: vals[i].interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0, 0.8, 0.8, 0] }), transform: [{ translateY: vals[i].interpolate({ inputRange: [0, 1], outputRange: [-300, height] }) }] },
          ]}
        >
          {c.text}
        </Animated.Text>
      ))}
    </>
  );
}

function Confetti({ onDone }: { onDone: () => void }) {
  const { width, height } = useWindowDimensions();
  const bits = useMemo(() => Array.from({ length: 36 }, (_, i) => ({ x: (i * 53) % width, c: [C.purple, C.cyan, C.green, C.amber, C.sunset][i % 5], r: (i * 47) % 360, d: 1600 + ((i * 97) % 900) })), [width]);
  const vals = useRef(bits.map(() => new Animated.Value(0))).current;
  useEffect(() => {
    Animated.stagger(25, vals.map((v, i) => Animated.timing(v, { toValue: 1, duration: bits[i].d, easing: Easing.out(Easing.quad), useNativeDriver: true }))).start(onDone);
  }, [vals, bits, onDone]);
  return (
    <>
      {bits.map((b, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            left: b.x,
            top: -20,
            width: 8,
            height: 14,
            borderRadius: 2,
            backgroundColor: b.c,
            opacity: vals[i].interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0] }),
            transform: [{ translateY: vals[i].interpolate({ inputRange: [0, 1], outputRange: [0, height * 0.8] }) }, { rotate: vals[i].interpolate({ inputRange: [0, 1], outputRange: [`${b.r}deg`, `${b.r + 540}deg`] }) }],
          }}
        />
      ))}
    </>
  );
}

function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.sequence([Animated.spring(a, { toValue: 1, useNativeDriver: true }), Animated.delay(2200), Animated.timing(a, { toValue: 0, duration: 250, useNativeDriver: true })]).start(onDone);
  }, [a, onDone]);
  return (
    <Animated.View style={[styles.toast, { opacity: a, transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] }]}>
      <Text style={styles.toastText}>{text}</Text>
    </Animated.View>
  );
}

/** Launch animation: the logo glows in and fades away. Decorative, ~1 s, skipped with reduce motion. */
function BootIntro({ onDone }: { onDone: () => void }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.sequence([
      Animated.timing(a, { toValue: 1, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.delay(250),
      Animated.timing(a, { toValue: 2, duration: 350, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start(onDone);
  }, [a, onDone]);
  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.boot, { opacity: a.interpolate({ inputRange: [0, 0.2, 1, 2], outputRange: [1, 1, 1, 0] }) }]}>
      <Animated.View style={{ transform: [{ scale: a.interpolate({ inputRange: [0, 1, 2], outputRange: [0.7, 1, 1.15] }) }] }}>
        <Image source={LOGO} style={styles.bootLogo} />
      </Animated.View>
      <Animated.Text style={[styles.bootText, { opacity: a.interpolate({ inputRange: [0, 0.6, 1, 2], outputRange: [0, 0, 1, 0] }) }]}>SCOOTER HUB</Animated.Text>
    </Animated.View>
  );
}

export function EasterEggHost() {
  const enabled = useSettings((s) => s.easterEggs && !s.reduceMotion && !s.oledMode);
  const [active, setActive] = useState<{ id: number; egg: Egg | 'boot' }[]>(() => (useSettings.getState().easterEggs && !useSettings.getState().reduceMotion ? [{ id: 0, egg: 'boot' }] : []));
  const seq = useRef(1);
  useEffect(() => {
    const l = (egg: Egg) => setActive((a) => [...a.filter((x) => x.egg !== egg), { id: seq.current++, egg }]);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  // One-time celebration the very first time any scooter connects.
  useEffect(
    () =>
      useLive.subscribe((st, prev) => {
        if (st.conn === 'connected' && prev.conn !== 'connected') {
          const s = useSettings.getState();
          if (!s.firstConnectCelebrated) {
            s.set('firstConnectCelebrated', true);
            triggerEgg('confetti');
          }
        }
      }),
    [],
  );

  const done = (id: number) => () => setActive((a) => a.filter((x) => x.id !== id));
  if (!enabled && !active.some((x) => x.egg === 'boot')) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {active.map(({ id, egg }) => {
        if (egg === 'boot') return <BootIntro key={id} onDone={done(id)} />;
        if (!enabled) return null;
        if (egg === 'scooter') return <DrivingScooter key={id} onDone={done(id)} />;
        if (egg === 'hexrain') return <HexRain key={id} onDone={done(id)} />;
        if (egg === 'confetti') return <Confetti key={id} onDone={done(id)} />;
        return <Toast key={id} text="Secret theme unlocked: Terminal" onDone={done(id)} />;
      })}
    </View>
  );
}

/** Unlock the hidden Terminal theme (long-press the version number in More). */
export function unlockSecretTheme() {
  const s = useSettings.getState();
  if (!s.easterEggs) return;
  if (!s.secretThemeUnlocked) {
    s.set('secretThemeUnlocked', true);
    feedback('achievement');
  }
  triggerEgg('secret');
}

const styles = StyleSheet.create({
  hex: { position: 'absolute', top: 0, color: '#22C55E', fontFamily: F.mono, fontSize: 13, lineHeight: 17 },
  toast: { position: 'absolute', alignSelf: 'center', top: 120, backgroundColor: 'rgba(0,0,0,0.85)', borderColor: '#22C55E', borderWidth: 1, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10 },
  toastText: { color: '#22C55E', fontFamily: F.mono, fontWeight: '700' },
  boot: { backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  bootLogo: { width: 140, height: 140, borderRadius: 70 },
  bootText: { color: C.text, fontWeight: '900', letterSpacing: 6, marginTop: 18, fontSize: 16 },
});
