import React from 'react';
import { View } from 'react-native';
import { C } from '../theme';

export function SignalBars({ bars, color = C.cyan }: { bars: number; color?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 16 }}>
      {[1, 2, 3, 4].map((b) => (
        <View key={b} style={{ width: 4, height: 4 + b * 3, borderRadius: 1, backgroundColor: b <= bars ? color : 'rgba(255,255,255,0.15)' }} />
      ))}
    </View>
  );
}
