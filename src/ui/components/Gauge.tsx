import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useThemeVersion } from '../../store/theme';
import { NA } from '../../utils/format';
import { AnimatedNumber } from './Motion';
import { C } from '../theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface Props {
  value: number | null; // null => "Not available"
  min?: number;
  max: number;
  size?: number;
  label: string;
  unit: string;
  digits?: number;
  colors?: [string, string];
  sub?: string;
  stroke?: number;
}

/** 270° animated arc gauge. Animates between values instead of jumping, so live data never flickers. */
export function Gauge({ value, min = 0, max, size = 200, label, unit, digits = 0, colors = [C.violet, C.purpleLight], sub, stroke = 14 }: Props) {
  useThemeVersion();
  const r = (size - stroke) / 2 - 6;
  const circ = 2 * Math.PI * r;
  const arc = circ * 0.75;
  const anim = useRef(new Animated.Value(0)).current;
  const gid = useRef(`g${Math.random().toString(36).slice(2, 8)}`).current;

  useEffect(() => {
    const p = value == null ? 0 : Math.min(1, Math.max(0, (value - min) / (max - min)));
    Animated.timing(anim, { toValue: p, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [value, min, max, anim]);

  const offset = anim.interpolate({ inputRange: [0, 1], outputRange: [circ, circ - arc] });
  const ticks = Array.from({ length: 28 }, (_, i) => i);

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={gid} x1="0" y1="1" x2="1" y2="0">
            <Stop offset="0" stopColor={colors[0]} />
            <Stop offset="1" stopColor={colors[1]} />
          </LinearGradient>
        </Defs>
        {ticks.map((i) => {
          const a = ((135 + (270 / 27) * i) * Math.PI) / 180;
          const r1 = r - stroke - 2;
          const r2 = r1 - (i % 3 === 0 ? 7 : 3);
          const cx = size / 2;
          return (
            <Circle key={i} cx={cx + Math.cos(a) * ((r1 + r2) / 2)} cy={cx + Math.sin(a) * ((r1 + r2) / 2)} r={i % 3 === 0 ? 1.4 : 0.8} fill={C.textFaint} />
          );
        })}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="rgba(255,255,255,0.07)"
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${arc} ${circ}`}
          strokeLinecap="round"
          transform={`rotate(135 ${size / 2} ${size / 2})`}
        />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={`url(#${gid})`}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${circ} ${circ}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(135 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={{ alignItems: 'center' }}>
        <Text style={styles.label}>{label}</Text>
        {value == null ? (
          <Text style={[styles.na, { fontSize: size * 0.075 }]}>{NA}</Text>
        ) : (
          <AnimatedNumber value={value} digits={digits} style={[styles.value, { fontSize: size * 0.24, textShadowColor: colors[1] }]} />
        )}
        <Text style={styles.unit}>{value == null ? ' ' : unit}</Text>
        {!!sub && <Text style={styles.sub}>{sub}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: C.textDim, fontSize: 11, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase' },
  value: { color: C.text, fontWeight: '800', fontVariant: ['tabular-nums'], letterSpacing: -1, textShadowRadius: 18, textShadowOffset: { width: 0, height: 0 } },
  unit: { color: C.textDim, fontSize: 13, fontWeight: '600', marginTop: -4 },
  sub: { color: C.textFaint, fontSize: 11, marginTop: 4 },
  na: { color: C.textFaint, marginVertical: 12 },
});
