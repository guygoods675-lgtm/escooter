import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleProp, Text, TextStyle, View, ViewStyle } from 'react-native';
import { useSettings } from '../../store/settings';
import { C, R } from '../theme';

/** Number that glides to new values instead of jumping. Re-renders only itself. */
export function AnimatedNumber({ value, digits = 0, style, duration = 450 }: { value: number; digits?: number; style?: StyleProp<TextStyle>; duration?: number }) {
  const reduce = useSettings((s) => s.reduceMotion || s.oledMode);
  const anim = useRef(new Animated.Value(value)).current;
  const [shown, setShown] = useState(value);
  const frame = useRef<number | null>(null);
  useEffect(() => {
    const id = anim.addListener(({ value: v }) => {
      if (frame.current != null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        setShown(v);
      });
    });
    return () => {
      anim.removeListener(id);
      if (frame.current != null) cancelAnimationFrame(frame.current);
    };
  }, [anim]);
  useEffect(() => {
    if (reduce) {
      anim.setValue(value);
      setShown(value);
      return;
    }
    Animated.timing(anim, { toValue: value, duration, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(() => setShown(value));
  }, [value, anim, duration, reduce]);
  return <Text style={style}>{shown.toFixed(digits)}</Text>;
}

/** Spring-in entrance (fade + rise). `index` staggers lists. */
export function FadeIn({ children, index = 0, style }: { children: React.ReactNode; index?: number; style?: StyleProp<ViewStyle> }) {
  const reduce = useSettings((s) => s.reduceMotion || s.oledMode);
  const a = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) return;
    Animated.spring(a, { toValue: 1, delay: Math.min(index, 8) * 45, useNativeDriver: true, damping: 16, stiffness: 140, mass: 0.8 }).start();
  }, [a, index, reduce]);
  return (
    <Animated.View style={[style, { opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }]}>{children}</Animated.View>
  );
}

/** Shimmering placeholder while the first reading loads. */
export function Skeleton({ height = 16, width = '100%', radius = R.sm, style }: { height?: number; width?: number | `${number}%`; radius?: number; style?: StyleProp<ViewStyle> }) {
  const a = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(a, { toValue: 0.8, duration: 700, useNativeDriver: true }),
        Animated.timing(a, { toValue: 0.35, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [a]);
  return <Animated.View style={[{ height, width, borderRadius: radius, backgroundColor: 'rgba(255,255,255,0.08)', opacity: a }, style]} />;
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <View style={{ backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, borderColor: C.border, padding: 16, marginBottom: 12, gap: 10 }}>
      <Skeleton height={12} width="40%" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={18} width={i % 2 ? '70%' : '90%'} />
      ))}
    </View>
  );
}

/** Pulsing radar rings used while searching / connecting. */
export function Pulse({ size, active, color }: { size: number; active: boolean; color: string }) {
  const rings = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];
  useEffect(() => {
    if (!active) {
      rings.forEach((r) => r.setValue(0));
      return;
    }
    const loops = rings.map((r, i) =>
      Animated.loop(Animated.sequence([Animated.delay(i * 600), Animated.timing(r, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }), Animated.timing(r, { toValue: 0, duration: 0, useNativeDriver: true })])),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  if (!active) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {rings.map((r, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: 2,
            borderColor: color,
            opacity: r.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] }),
            transform: [{ scale: r.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1.5] }) }],
          }}
        />
      ))}
    </View>
  );
}
