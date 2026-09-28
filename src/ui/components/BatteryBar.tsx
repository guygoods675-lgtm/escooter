import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { NA } from '../../utils/format';
import { C, R } from '../theme';

export const batteryColor = (p: number) => (p <= 15 ? C.red : p <= 35 ? C.amber : C.green);

/** Animated horizontal battery with a subtle pulse while charging. */
export function BatteryBar({ percent, charging, height = 44 }: { percent: number | null; charging?: boolean; height?: number }) {
  const w = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(w, { toValue: percent ?? 0, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [percent, w]);
  useEffect(() => {
    if (!charging) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.55, duration: 900, useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [charging, pulse]);
  const color = percent == null ? C.textFaint : batteryColor(percent);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <View style={[styles.shell, { height, borderColor: `${color}88` }]}>
        <Animated.View style={{ width: w.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }), height: '100%', opacity: pulse }}>
          <LinearGradient colors={[`${color}AA`, color]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ flex: 1, borderRadius: R.sm - 3 }} />
        </Animated.View>
        <Text style={styles.text}>{percent == null ? NA : `${percent.toFixed(0)}%`}</Text>
      </View>
      <View style={[styles.cap, { backgroundColor: `${color}88`, height: height * 0.4 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, borderWidth: 2, borderRadius: R.sm, padding: 3, justifyContent: 'center', overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.03)' },
  cap: { width: 5, borderTopRightRadius: 3, borderBottomRightRadius: 3, marginLeft: 2 },
  text: { position: 'absolute', alignSelf: 'center', color: C.text, fontWeight: '800', fontSize: 16, textShadowColor: '#000', textShadowRadius: 6, textShadowOffset: { width: 0, height: 0 } },
});
