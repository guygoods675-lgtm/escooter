import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, ImageBackground, RefreshControl, ScrollView, StyleSheet, View, ViewStyle, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { themeById } from '../../data/themes';
import { useSettings } from '../../store/settings';
import { useThemeStore } from '../../store/theme';
import { C, S, rgba } from '../theme';
import { AlertStack } from './AlertStack';

/** A few softly twinkling stars over the space themes (native-driver opacity only). */
function Twinkle() {
  const { width, height } = useWindowDimensions();
  const stars = useMemo(() => Array.from({ length: 18 }, (_, i) => ({ x: ((i * 97) % 100) / 100, y: ((i * 61 + 13) % 100) / 100, r: 1 + (i % 3), d: 1400 + (i % 5) * 450 })), []);
  const vals = useRef(stars.map(() => new Animated.Value(0.2))).current;
  useEffect(() => {
    const loops = vals.map((v, i) =>
      Animated.loop(Animated.sequence([Animated.timing(v, { toValue: 1, duration: stars[i].d, useNativeDriver: true }), Animated.timing(v, { toValue: 0.15, duration: stars[i].d, useNativeDriver: true })])),
    );
    loops.forEach((l, i) => setTimeout(() => l.start(), i * 170));
    return () => loops.forEach((l) => l.stop());
  }, [vals, stars]);
  return (
    <>
      {stars.map((s, i) => (
        <Animated.View key={i} style={{ position: 'absolute', left: s.x * width, top: s.y * height * 0.7, width: s.r * 2, height: s.r * 2, borderRadius: s.r, backgroundColor: '#fff', opacity: vals[i], shadowColor: '#fff', shadowOpacity: 1, shadowRadius: 4 }} />
      ))}
    </>
  );
}

export function Backdrop({ dim = 1 }: { dim?: number }) {
  useThemeStore((s) => s.version);
  const bgTheme = useSettings((s) => s.bgTheme);
  const customUri = useSettings((s) => s.customBgUri);
  const bgDim = useSettings((s) => s.bgDim);
  const twinkle = useSettings((s) => s.twinkle && !s.reduceMotion);
  const oled = useSettings((s) => s.oledMode);
  const t = themeById(bgTheme);
  // OLED / low-power: pure black, no photo, no animated or gradient layers.
  if (oled) return <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} pointerEvents="none" />;
  const source = bgTheme === 'custom' ? (customUri ? { uri: customUri } : null) : t.image;
  const mid = `rgba(8,5,20,${Math.min(0.97, bgDim).toFixed(2)})`;
  const top = `rgba(5,3,11,${Math.max(0.2, bgDim - 0.3).toFixed(2)})`;
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: t.base }]} pointerEvents="none">
      {source && <ImageBackground source={source} style={StyleSheet.absoluteFill} resizeMode="cover" blurRadius={dim > 1 && !t.stars ? 6 : 0} />}
      {t.stars && twinkle && <Twinkle />}
      <LinearGradient colors={[top, mid, C.bgOverlayBottom]} locations={[0, 0.35, 0.85]} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={[rgba(C.violet, 0.18), 'transparent']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0.6 }} style={StyleSheet.absoluteFill} />
    </View>
  );
}

interface Props {
  children: React.ReactNode;
  scroll?: boolean;
  contentStyle?: ViewStyle;
  refreshing?: boolean;
  onRefresh?: () => void;
  dim?: number;
  topInset?: boolean;
}

export function Screen({ children, scroll = true, contentStyle, refreshing, onRefresh, dim = 2, topInset = false }: Props) {
  const insets = useSafeAreaInsets();
  // Remount content when the user picks a new accent so every colour refreshes.
  const staticVersion = useThemeStore((s) => s.staticVersion);
  const oled = useSettings((s) => s.oledMode);
  const pad = { paddingTop: topInset ? insets.top + S.md : S.md, paddingBottom: insets.bottom + 100, paddingHorizontal: S.lg };
  return (
    <View style={{ flex: 1, backgroundColor: oled ? '#000' : C.bg }}>
      <Backdrop dim={dim} />
      {scroll ? (
        <ScrollView
          key={staticVersion}
          contentContainerStyle={[pad, contentStyle]}
          showsVerticalScrollIndicator={false}
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={C.purple} /> : undefined}
        >
          {children}
        </ScrollView>
      ) : (
        <View key={staticVersion} style={[{ flex: 1 }, pad, contentStyle]}>{children}</View>
      )}
      <AlertStack />
    </View>
  );
}
