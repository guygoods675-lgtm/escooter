import { Ionicons } from '@expo/vector-icons';
import { feedback, hapticTap } from '../services/Feedback';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { DashLayout, useSettings } from '../store/settings';
import { CARD_INFO, LAYOUTS } from '../ui/dashboard/cards';
import { Divider, GlassCard, Note, SectionHeader } from '../ui/components/Glass';
import { Screen } from '../ui/components/Screen';
import { C, S } from '../ui/theme';

type CardKey = keyof typeof CARD_INFO;

export default function DashboardLayoutScreen() {
  const layout = useSettings((s) => s.dashLayout);
  const cards = useSettings((s) => s.dashCards);
  const set = useSettings((s) => s.set);

  const choose = (l: DashLayout) => {
    hapticTap();
    set('dashLayout', l);
  };
  const toggle = (id: CardKey) => {
    hapticTap();
    set('dashCards', cards.includes(id) ? cards.filter((c) => c !== id) : [...cards, id]);
    set('dashLayout', 'custom');
  };
  const move = (id: CardKey, dir: -1 | 1) => {
    const i = cards.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cards.length) return;
    const next = [...cards];
    [next[i], next[j]] = [next[j], next[i]];
    set('dashCards', next);
    set('dashLayout', 'custom');
  };

  const presets = Object.entries(LAYOUTS) as [Exclude<DashLayout, 'custom'>, (typeof LAYOUTS)[keyof typeof LAYOUTS]][];
  const selected = cards.filter((c): c is CardKey => c in CARD_INFO);
  const unselected = (Object.keys(CARD_INFO) as CardKey[]).filter((c) => !cards.includes(c));

  return (
    <Screen contentStyle={{ paddingTop: 110 }}>
      <SectionHeader title="Layouts" icon="grid-outline" />
      <GlassCard style={{ paddingVertical: S.xs }}>
        {presets.map(([id, l], i) => (
          <View key={id}>
            {i > 0 && <Divider />}
            <Pressable onPress={() => choose(id)} style={styles.row}>
              <Ionicons name={layout === id ? 'radio-button-on' : 'radio-button-off'} size={20} color={layout === id ? C.purple : C.textFaint} />
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{l.name}</Text>
                <Text style={styles.sub}>{l.description}</Text>
              </View>
            </Pressable>
          </View>
        ))}
        <Divider />
        <Pressable onPress={() => choose('custom')} style={styles.row}>
          <Ionicons name={layout === 'custom' ? 'radio-button-on' : 'radio-button-off'} size={20} color={layout === 'custom' ? C.purple : C.textFaint} />
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Custom</Text>
            <Text style={styles.sub}>Pick and order the cards below</Text>
          </View>
        </Pressable>
      </GlassCard>

      <SectionHeader title="Custom cards" icon="albums-outline" />
      <GlassCard style={{ paddingVertical: S.xs }}>
        {selected.map((id, i) => (
          <View key={id}>
            {i > 0 && <Divider />}
            <View style={styles.row}>
              <Pressable onPress={() => toggle(id)} hitSlop={6}>
                <Ionicons name="checkmark-circle" size={22} color={C.purple} />
              </Pressable>
              <Ionicons name={CARD_INFO[id].icon} size={18} color={C.textDim} />
              <Text style={[styles.title, { flex: 1 }]}>{CARD_INFO[id].title}</Text>
              <Pressable onPress={() => move(id, -1)} hitSlop={6} disabled={i === 0}>
                <Ionicons name="chevron-up" size={20} color={i === 0 ? C.textFaint : C.text} />
              </Pressable>
              <Pressable onPress={() => move(id, 1)} hitSlop={6} disabled={i === selected.length - 1}>
                <Ionicons name="chevron-down" size={20} color={i === selected.length - 1 ? C.textFaint : C.text} />
              </Pressable>
            </View>
          </View>
        ))}
        {unselected.map((id) => (
          <View key={id}>
            <Divider />
            <Pressable onPress={() => toggle(id)} style={styles.row}>
              <Ionicons name="add-circle-outline" size={22} color={C.textFaint} />
              <Ionicons name={CARD_INFO[id].icon} size={18} color={C.textFaint} />
              <Text style={[styles.title, { flex: 1, color: C.textDim }]}>{CARD_INFO[id].title}</Text>
            </Pressable>
          </View>
        ))}
      </GlassCard>
      <Note>Active error codes and the Disconnect button always stay on the dashboard.</Note>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: S.md },
  title: { color: C.text, fontSize: 15, fontWeight: '600' },
  sub: { color: C.textDim, fontSize: 12.5, marginTop: 2 },
});
