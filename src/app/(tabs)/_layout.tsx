import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Tabs } from 'expo-router';
import React from 'react';
import { ColorValue, Platform, StyleSheet, View } from 'react-native';
import { useSettings } from '../../store/settings';
import { useThemeVersion } from '../../store/theme';
import { C, rgba } from '../../ui/theme';

type Icon = React.ComponentProps<typeof Ionicons>['name'];
const icon = (name: Icon, active: Icon) =>
  function TabIcon({ color, focused }: { color: ColorValue; focused: boolean }) {
    return (
      <View style={focused ? styles.activeWrap : undefined}>
        <Ionicons name={focused ? active : name} size={22} color={color} />
      </View>
    );
  };

const TabBarBackground = () => (
  <BlurView
    intensity={45}
    tint="dark"
    experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
    style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(8,5,18,0.55)' }]}
  />
);

export default function TabsLayout() {
  useThemeVersion();
  const reduceMotion = useSettings((s) => s.reduceMotion);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        animation: reduceMotion ? 'none' : 'shift',
        tabBarBackground: TabBarBackground,
        tabBarActiveTintColor: C.purpleLight,
        tabBarInactiveTintColor: C.textFaint,
        tabBarStyle: styles.bar,
        tabBarLabelStyle: { fontSize: 10.5, fontWeight: '700' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Dashboard', tabBarIcon: icon('speedometer-outline', 'speedometer') }} />
      <Tabs.Screen name="live" options={{ title: 'Live', tabBarIcon: icon('pulse-outline', 'pulse') }} />
      <Tabs.Screen name="ride" options={{ title: 'Ride', tabBarIcon: icon('navigate-outline', 'navigate') }} />
      <Tabs.Screen name="diagnostics" options={{ title: 'Diagnostics', tabBarIcon: icon('medkit-outline', 'medkit') }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: icon('grid-outline', 'grid') }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    backgroundColor: 'transparent',
    borderTopWidth: StyleSheet.hairlineWidth,
    get borderTopColor() { return rgba(C.purple, 0.25); },
    height: 84,
    paddingTop: 8,
  },
  activeWrap: { get shadowColor() { return C.purple; }, shadowOpacity: 0.9, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } },
});
