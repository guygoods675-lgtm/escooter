import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { C } from '../theme';

/** Bar chart of per-cell voltages, scaled between the pack's own min and max for contrast. */
export function CellChart({ volts }: { volts: number[] }) {
  const min = Math.min(...volts);
  const max = Math.max(...volts);
  const span = Math.max(max - min, 0.02);
  return (
    <View>
      <View style={styles.row}>
        {volts.map((v, i) => {
          const h = 30 + ((v - min) / span) * 70;
          const color = v === min ? C.amber : v === max ? C.green : C.purple;
          return (
            <View key={i} style={styles.col}>
              <Text style={styles.v}>{v.toFixed(3)}</Text>
              <View style={[styles.bar, { height: h, backgroundColor: `${color}CC`, shadowColor: color }]} />
              <Text style={styles.idx}>{i + 1}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 140 },
  col: { flex: 1, alignItems: 'center', marginHorizontal: 2 },
  bar: { width: '70%', borderRadius: 4, shadowOpacity: 0.6, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  v: { color: C.textDim, fontSize: 8, marginBottom: 3, transform: [{ rotate: '-50deg' }], width: 34, textAlign: 'center' },
  idx: { color: C.textFaint, fontSize: 10, marginTop: 4 },
});
