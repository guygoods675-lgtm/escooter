import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import type { Reading } from '../../protocols/types';
import { useSettings } from '../../store/settings';
import { useThemeVersion } from '../../store/theme';
import { Confidence, DataSource, DataTag, confidenceOf, sourceOf } from './DataTag';
import { NA } from '../../utils/format';
import { C, F, R, S, glow, rgba } from '../theme';
import { hapticTap } from '../../services/Feedback';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

export function GlassCard({ children, style, accent, padded = true }: { children: React.ReactNode; style?: ViewStyle | ViewStyle[]; accent?: string; padded?: boolean }) {
  useThemeVersion();
  const oled = useSettings((s) => s.oledMode);
  return (
    <View style={[styles.card, padded && { padding: S.lg }, oled && { backgroundColor: '#000' }, accent ? { borderColor: accent } : null, style]}>
      {!oled && <LinearGradient colors={[rgba(C.purple, 0.08), 'rgba(0,0,0,0)']} style={[StyleSheet.absoluteFill, { borderRadius: R.lg }]} />}
      {children}
    </View>
  );
}

export function SectionHeader({ title, right, icon }: { title: string; right?: React.ReactNode; icon?: IconName }) {
  useThemeVersion();
  return (
    <View style={styles.sectionHeader}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {icon && <Ionicons name={icon} size={14} color={C.purpleLight} />}
        <Text style={F.label}>{title}</Text>
      </View>
      {right}
    </View>
  );
}

export function Badge({ text, color = C.purple, icon }: { text: string; color?: string; icon?: IconName }) {
  useThemeVersion();
  return (
    <View style={[styles.badge, { borderColor: color, backgroundColor: `${color}22` }]}>
      {icon && <Ionicons name={icon} size={12} color={color} />}
      <Text style={[styles.badgeText, { color }]}>{text}</Text>
    </View>
  );
}

export function NeonButton({
  title, onPress, icon, variant = 'primary', loading, disabled, style, small,
}: { title: string; onPress: () => void; icon?: IconName; variant?: 'primary' | 'ghost' | 'danger'; loading?: boolean; disabled?: boolean; style?: ViewStyle; small?: boolean }) {
  useThemeVersion();
  const primary = variant === 'primary';
  const color = variant === 'danger' ? C.red : C.purple;
  return (
    <Pressable
      disabled={disabled || loading}
      onPress={() => {
        hapticTap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.btn,
        small && styles.btnSmall,
        primary ? glow(C.violet, 18) : { borderWidth: 1, borderColor: color },
        { opacity: disabled ? 0.4 : pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
        style,
      ]}
    >
      {primary && <LinearGradient colors={[C.violet, C.purple]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: R.md }]} />}
      {loading ? <ActivityIndicator color={C.text} /> : icon ? <Ionicons name={icon} size={small ? 16 : 20} color={primary ? '#fff' : color} /> : null}
      <Text style={[styles.btnText, small && { fontSize: 14 }, { color: primary ? '#fff' : color }]}>{title}</Text>
    </Pressable>
  );
}

export function ListRow({ icon, title, subtitle, onPress, right, color = C.purpleLight }: { icon?: IconName; title: string; subtitle?: string; onPress?: () => void; right?: React.ReactNode; color?: string }) {
  useThemeVersion();
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}>
      {icon && (
        <View style={[styles.rowIcon, { backgroundColor: `${color}1F` }]}>
          <Ionicons name={icon} size={18} color={color} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        {!!subtitle && <Text style={styles.rowSub}>{subtitle}</Text>}
      </View>
      {right}
      {onPress && <Ionicons name="chevron-forward" size={18} color={C.textFaint} />}
    </Pressable>
  );
}

export function KeyValue({ label, value, unit, mono, dim, note }: { label: string; value: string; unit?: string; mono?: boolean; dim?: boolean; note?: string }) {
  const na = value === NA || value === 'Unsupported';
  return (
    <View style={styles.kv}>
      <Text style={styles.kvLabel}>{label}</Text>
      <View style={{ alignItems: 'flex-end', flexShrink: 1 }}>
        <Text style={[styles.kvValue, mono && { fontFamily: F.mono, fontSize: 13 }, (na || dim) && { color: C.textFaint, fontWeight: '500' }]} numberOfLines={2}>
          {value}
          {!na && unit ? <Text style={styles.kvUnit}> {unit}</Text> : null}
        </Text>
        {!!note && <Text style={styles.kvNote}>{note}</Text>}
      </View>
    </View>
  );
}

/** Stat tile for a telemetry reading. Unavailable readings say so. */
export function StatTile({ label, reading, unit, digits = 1, convert, icon, color = C.purpleLight, text, style, confidence, source }: {
  label: string; reading?: Reading<number>; unit?: string; digits?: number; convert?: (v: number) => number; icon?: IconName; color?: string; text?: string | null; style?: ViewStyle;
  /** Override the data label; by default it comes from the reading. */
  confidence?: Confidence; source?: DataSource;
}) {
  useThemeVersion();
  const oled = useSettings((s) => s.oledMode);
  const value = text !== undefined ? text : reading ? (convert ? convert(reading.value) : reading.value).toFixed(digits) : null;
  return (
    <View style={[styles.tile, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {icon && <Ionicons name={icon} size={13} color={color} />}
        <Text style={styles.tileLabel} numberOfLines={1}>{label}</Text>
      </View>
      {value != null ? (
        <Text style={[styles.tileValue, oled && styles.tileValueOled]} numberOfLines={1} adjustsFontSizeToFit>
          {value}
          {unit ? <Text style={styles.tileUnit}> {unit}</Text> : null}
        </Text>
      ) : (
        <Text style={styles.tileNA}>{NA}</Text>
      )}
      {value != null && (confidence || reading) ? <DataTag kind={confidence ?? confidenceOf(reading)} source={source ?? sourceOf(reading)} compact /> : null}
    </View>
  );
}

export function Grid({ children, cols = 2 }: { children: React.ReactNode; cols?: number }) {
  const items = React.Children.toArray(children);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -S.xs }}>
      {items.map((c, i) => (
        <View key={i} style={{ width: `${100 / cols}%`, padding: S.xs }}>
          {c}
        </View>
      ))}
    </View>
  );
}

export function Segmented<T extends string | number>({ options, value, onChange, style }: { options: { label: string; value: T }[]; value: T; onChange: (v: T) => void; style?: ViewStyle }) {
  useThemeVersion();
  return (
    <View style={[styles.seg, style]}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => {
              hapticTap();
              onChange(o.value);
            }}
            style={[styles.segItem, active && styles.segActive]}
          >
            <Text style={[styles.segText, active && { color: '#fff' }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function EmptyState({ icon, title, body, children }: { icon: IconName; title: string; body?: string; children?: React.ReactNode }) {
  useThemeVersion();
  return (
    <GlassCard style={{ alignItems: 'center', paddingVertical: S.xxl }}>
      <Ionicons name={icon} size={40} color={C.purpleLight} />
      <Text style={[styles.rowTitle, { marginTop: S.md, fontSize: 17, textAlign: 'center' }]}>{title}</Text>
      {!!body && <Text style={[styles.rowSub, { textAlign: 'center', marginTop: 6, lineHeight: 19 }]}>{body}</Text>}
      {children && <View style={{ marginTop: S.lg, alignSelf: 'stretch' }}>{children}</View>}
    </GlassCard>
  );
}

export function Note({ children, icon = 'information-circle-outline', color = C.textDim, style }: { children: React.ReactNode; icon?: IconName; color?: string; style?: TextStyle }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: S.sm }}>
      <Ionicons name={icon} size={15} color={color} style={{ marginTop: 1 }} />
      <Text style={[{ color, fontSize: 12.5, lineHeight: 18, flex: 1 }, style]}>{children}</Text>
    </View>
  );
}

export const Divider = () => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: C.border, marginVertical: S.sm }} />;

const styles = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: R.lg, borderWidth: 1, get borderColor() { return C.border; }, marginBottom: S.md, overflow: 'hidden' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: S.lg, marginBottom: S.sm },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: R.pill, borderWidth: 1, alignSelf: 'flex-start' },
  badgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  btn: { height: 54, borderRadius: R.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: S.xl },
  btnSmall: { height: 40, paddingHorizontal: S.lg },
  btnText: { fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: S.md, paddingVertical: S.md },
  rowIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { color: C.text, fontSize: 15, fontWeight: '600' },
  rowSub: { color: C.textDim, fontSize: 12.5, marginTop: 2 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 9, gap: S.lg },
  kvLabel: { color: C.textDim, fontSize: 14 },
  kvValue: { color: C.text, fontSize: 14.5, fontWeight: '600', textAlign: 'right', fontVariant: ['tabular-nums'] },
  kvUnit: { color: C.textDim, fontWeight: '500' },
  kvNote: { color: C.textFaint, fontSize: 11, marginTop: 2 },
  tile: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: R.md, borderWidth: 1, get borderColor() { return rgba(C.purple, 0.14); }, padding: S.md, minHeight: 78 },
  tileLabel: { color: C.textDim, fontSize: 11.5, fontWeight: '600', letterSpacing: 0.3, flexShrink: 1 },
  tileValue: { color: C.text, fontSize: 22, fontWeight: '800', marginTop: 6, fontVariant: ['tabular-nums'] },
  tileValueOled: { fontSize: 28, color: '#FFFFFF' },
  tileUnit: { color: C.textDim, fontSize: 13, fontWeight: '600' },
  tileNA: { color: C.textFaint, fontSize: 13, marginTop: 10 },
  seg: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: R.md, padding: 3, borderWidth: 1, get borderColor() { return C.border; } },
  segItem: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: R.sm },
  segActive: { get backgroundColor() { return C.violet; } },
  segText: { color: C.textDim, fontWeight: '700', fontSize: 13 },
});
