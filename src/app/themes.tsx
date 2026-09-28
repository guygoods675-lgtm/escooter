import { Ionicons } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import { feedback, hapticTap } from '../services/Feedback';
import * as ImagePicker from 'expo-image-picker';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Alert, Image, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { THEMES, ThemePreset } from '../data/themes';
import { BgTheme, useSettings } from '../store/settings';
import { GlassCard, Note, SectionHeader, Segmented } from '../ui/components/Glass';
import { Screen } from '../ui/components/Screen';
import { ACCENTS, AccentKey, C, R, S, glow, rgba } from '../ui/theme';

const DIM_OPTIONS = [
  { label: 'Vivid', value: 0.6 },
  { label: 'Balanced', value: 0.82 },
  { label: 'Dark', value: 0.92 },
];

/** Copy a picked photo into the app's documents folder so it survives cache clears. */
async function pickBackground(): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    Alert.alert('Photo access needed', 'Allow photo access to use your own background.');
    return null;
  }
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, allowsEditing: true, aspect: [9, 19] });
  if (res.canceled || !res.assets?.[0]) return null;
  const dest = new File(Paths.document, `background-${Date.now()}.jpg`);
  await new File(res.assets[0].uri).copy(dest);
  const old = useSettings.getState().customBgUri;
  if (old && old !== dest.uri) {
    try {
      const f = new File(old);
      if (f.exists) f.delete();
    } catch {
      // Old file already gone.
    }
  }
  return dest.uri;
}

function ThemeTile({ t, active, onPress, customUri }: { t: ThemePreset; active: boolean; onPress: () => void; customUri: string | null }) {
  const accent = ACCENTS[t.accent];
  const src = t.id === 'custom' ? (customUri ? { uri: customUri } : null) : t.thumb;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.tile, active && { borderColor: C.purple, ...glow(C.purple, 12) }, { transform: [{ scale: pressed ? 0.97 : 1 }] }]}>
      <View style={[styles.thumb, { backgroundColor: t.base }]}>
        {src ? (
          <Image source={src} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <LinearGradient colors={[rgba(accent.deep, 0.55), t.base]} style={StyleSheet.absoluteFill} />
        )}
        {t.id === 'custom' && !customUri && (
          <View style={styles.center}>
            <Ionicons name="image-outline" size={28} color={C.text} />
          </View>
        )}
        {active && (
          <View style={styles.check}>
            <Ionicons name="checkmark" size={14} color="#fff" />
          </View>
        )}
        {t.stars && (
          <View style={styles.tag}>
            <Ionicons name="sparkles" size={10} color="#fff" />
          </View>
        )}
      </View>
      <Text style={styles.tileName} numberOfLines={1}>{t.name}</Text>
      <Text style={styles.tileDesc} numberOfLines={2}>{t.description}</Text>
    </Pressable>
  );
}

export default function ThemesScreen() {
  const bgTheme = useSettings((s) => s.bgTheme);
  const customUri = useSettings((s) => s.customBgUri);
  const accent = useSettings((s) => s.accent);
  const dynamicAccent = useSettings((s) => s.dynamicAccent);
  const bgDim = useSettings((s) => s.bgDim);
  const twinkle = useSettings((s) => s.twinkle);
  const set = useSettings((s) => s.set);
  const secret = useSettings((s) => s.secretThemeUnlocked);
  const themes = THEMES.filter((t) => !t.hidden || secret);

  const applyTheme = async (id: BgTheme) => {
    const t = THEMES.find((x) => x.id === id)!;
    if (id === 'custom') {
      const uri = customUri && bgTheme === 'custom' ? await pickBackground() : customUri ?? (await pickBackground());
      if (!uri) return;
      set('customBgUri', uri);
    }
    feedback('success');
    set('bgTheme', id);
    // Each preset suggests an accent; the user can change it below.
    if (id !== 'custom') set('accent', t.accent);
  };

  const pickAccent = (k: AccentKey) => {
    hapticTap();
    set('accent', k);
  };

  return (
    <Screen contentStyle={{ paddingTop: 110 }}>
      <SectionHeader title="Background" icon="image-outline" />
      <View style={styles.grid}>
        {themes.map((t) => (
          <View key={t.id} style={styles.cell}>
            <ThemeTile t={t} active={bgTheme === t.id} customUri={customUri} onPress={() => applyTheme(t.id).catch((e) => Alert.alert('Could not set background', String(e)))} />
          </View>
        ))}
      </View>
      {bgTheme === 'custom' && <Note>Tap "Your photo" again to choose a different picture. It is stored only on this phone.</Note>}

      <SectionHeader title="Accent colour" icon="color-palette-outline" />
      <GlassCard>
        <View style={styles.accents}>
          {(Object.keys(ACCENTS) as AccentKey[]).map((k) => {
            const a = ACCENTS[k];
            const on = accent === k;
            return (
              <Pressable key={k} onPress={() => pickAccent(k)} style={styles.accentItem}>
                <LinearGradient colors={[a.deep, a.main]} style={[styles.swatch, on && { borderColor: '#fff', ...glow(a.main, 10) }]}>
                  {on && <Ionicons name="checkmark" size={16} color="#fff" />}
                </LinearGradient>
                <Text style={[styles.accentName, on && { color: C.text }]}>{a.name}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Dynamic accent</Text>
            <Text style={styles.sub}>Turns green while charging, orange on a scooter warning and red on a critical error, from what the scooter reports.</Text>
          </View>
          <Switch value={dynamicAccent} onValueChange={(v) => set('dynamicAccent', v)} trackColor={{ true: C.violet, false: 'rgba(255,255,255,0.15)' }} thumbColor="#fff" />
        </View>
      </GlassCard>

      <SectionHeader title="Look" icon="options-outline" />
      <GlassCard>
        <Text style={[styles.title, { marginBottom: 8 }]}>Background brightness</Text>
        <Segmented options={DIM_OPTIONS} value={DIM_OPTIONS.reduce((b, o) => (Math.abs(o.value - bgDim) < Math.abs(b.value - bgDim) ? o : b)).value} onChange={(v) => set('bgDim', v)} />
        <View style={[styles.row, { marginTop: S.md }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Twinkling stars</Text>
            <Text style={styles.sub}>On the Deep Space, Nebula and Aurora themes</Text>
          </View>
          <Switch value={twinkle} onValueChange={(v) => set('twinkle', v)} trackColor={{ true: C.violet, false: 'rgba(255,255,255,0.15)' }} thumbColor="#fff" />
        </View>
      </GlassCard>

      <Pressable
        onPress={() => {
          set('bgTheme', 'sunset');
          set('accent', 'purple');
          set('bgDim', 0.82);
          set('dynamicAccent', false);
        }}
        style={styles.reset}
      >
        <Ionicons name="refresh" size={14} color={C.textDim} />
        <Text style={styles.resetText}>Back to the original Scooter Hub look</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -S.xs },
  cell: { width: '33.333%', padding: S.xs },
  tile: { borderRadius: R.md, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.08)', backgroundColor: C.card, padding: 6 },
  thumb: { height: 150, borderRadius: R.sm, overflow: 'hidden' },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  check: { position: 'absolute', top: 6, right: 6, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', get backgroundColor() { return C.violet; } },
  tag: { position: 'absolute', bottom: 6, left: 6, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },
  tileName: { color: C.text, fontSize: 12.5, fontWeight: '700', marginTop: 6 },
  tileDesc: { color: C.textFaint, fontSize: 10.5, marginTop: 1, minHeight: 26 },
  accents: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: S.md, marginBottom: S.md },
  accentItem: { width: '25%', alignItems: 'center', gap: 6 },
  swatch: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  accentName: { color: C.textDim, fontSize: 11.5, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: S.md },
  title: { color: C.text, fontSize: 15, fontWeight: '600' },
  sub: { color: C.textDim, fontSize: 12.5, marginTop: 2, lineHeight: 17 },
  reset: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: S.lg },
  resetText: { color: C.textDim, fontSize: 13 },
});
