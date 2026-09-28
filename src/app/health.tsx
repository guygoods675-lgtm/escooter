import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { LayoutAnimation, Platform, Pressable, Text, UIManager, View } from 'react-native';
import { computeHealth, type HealthItem, type HealthStatus } from '../services/health';
import { useErrors } from '../store/errors';
import { useLive } from '../store/live';
import { useSettings } from '../store/settings';
import { Badge, Divider, GlassCard, IconName, KeyValue, Note, SectionHeader } from '../ui/components/Glass';
import { FadeIn } from '../ui/components/Motion';
import { Screen } from '../ui/components/Screen';
import { C, F, R, S, severityColor } from '../ui/theme';
import { useUnits } from '../utils/format';

// Legacy-architecture Android needs this for LayoutAnimation; it is a no-op on the new architecture.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental && !(globalThis as { nativeFabricUIManager?: unknown }).nativeFabricUIManager) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const STATUS: Record<HealthStatus, { label: string; icon: IconName; color: () => string }> = {
  normal: { label: 'Normal', icon: 'checkmark-circle', color: () => C.green },
  warning: { label: 'Warning', icon: 'warning', color: () => C.amber },
  critical: { label: 'Critical', icon: 'alert-circle', color: () => C.red },
  unknown: { label: 'Unknown', icon: 'help-circle', color: () => C.textFaint },
};

const DISCONNECTED_REASON: Record<string, string> = {
  idle: 'No scooter is connected.',
  scanning: 'Scanning for scooters. Health is read from a connected scooter.',
  found: 'A scooter was found but is not connected yet.',
  connecting: 'Connecting to the scooter.',
  identifying: 'Identifying the scooter protocol.',
  reconnecting: 'The Bluetooth link dropped; reconnecting.',
  disconnected: 'The scooter is disconnected.',
  error: 'The last connection attempt failed.',
};

export default function HealthScreen() {
  const conn = useLive((s) => s.conn);
  const connError = useLive((s) => s.connError);
  const rssi = useLive((s) => s.rssi);
  const snapshot = useLive((s) => s.snapshot);
  const battery = useLive((s) => s.battery);
  const identity = useLive((s) => s.identity);
  const capabilities = useLive((s) => s.capabilities);
  const scooterId = useLive((s) => s.scooterId);
  const records = useErrors((s) => s.records);
  const lowBatteryPercent = useSettings((s) => s.lowBatteryPercent);
  const reduceMotion = useSettings((s) => s.reduceMotion);
  const u = useUnits();
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const connected = conn === 'connected';
  const activeCodes = useMemo(() => (connected ? records.filter((r) => r.active && r.scooterId === scooterId) : []), [records, scooterId, connected]);
  const health = useMemo(
    () =>
      computeHealth({
        connected,
        conn,
        rssi: connected ? rssi : null,
        // Values left over from a previous session are not current, so they are not judged.
        snapshot: connected ? snapshot : null,
        battery: connected ? battery : null,
        identity: connected ? identity : null,
        capabilities: connected ? capabilities : null,
        activeCodes,
        lowBatteryPercent,
        fmtTemp: (c) => `${u.temp(c).toFixed(0)} ${u.tempLabel}`,
      }),
    [connected, conn, rssi, snapshot, battery, identity, capabilities, activeCodes, lowBatteryPercent, u.temp, u.tempLabel],
  );
  const overall: HealthStatus = connected ? health.overall : 'unknown';
  const st = STATUS[overall];
  const color = st.color();

  const toggle = (k: string) => {
    if (!reduceMotion) LayoutAnimation.configureNext(LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
    setOpen((o) => ({ ...o, [k]: !o[k] }));
  };

  return (
    <Screen contentStyle={{ paddingTop: 110 }}>
      <FadeIn>
        <GlassCard accent={color} style={{ alignItems: 'center', paddingVertical: S.xl }}>
          <Ionicons name={st.icon} size={56} color={color} />
          <Text style={[F.label, { marginTop: S.md }]}>Overall status</Text>
          <Text style={{ color, fontSize: 34, fontWeight: '900', letterSpacing: -0.5, marginTop: 2 }}>{st.label}</Text>
          {connected ? (
            <Text style={{ color: C.textDim, textAlign: 'center', marginTop: 6, fontSize: 13, lineHeight: 18 }}>
              {activeCodes.length ? `${activeCodes.length} active code${activeCodes.length > 1 ? 's' : ''} reported by the scooter` : capabilities?.errors ? 'No active error or warning codes reported' : 'This protocol does not report error codes'}
            </Text>
          ) : (
            <Text style={{ color: C.textDim, textAlign: 'center', marginTop: 6, fontSize: 13, lineHeight: 18 }}>
              Status is unknown. {DISCONNECTED_REASON[conn] ?? 'No scooter is connected.'}
              {conn === 'error' && connError ? ` (${connError})` : ''}
            </Text>
          )}
        </GlassCard>
      </FadeIn>
      <Note>
        Health is based only on what the scooter reports: its documented error and warning codes, the Bluetooth link and live readings. Scooter Hub does not diagnose damage itself, and a category with no data is shown as Unknown rather than Normal.
      </Note>

      <SectionHeader title="Categories" icon="pulse-outline" />
      {health.items.map((item, i) => (
        <FadeIn key={item.category} index={i + 1}>
          <CategoryCard item={item} connected={connected} open={!!open[item.category]} onToggle={() => toggle(item.category)} />
        </FadeIn>
      ))}
    </Screen>
  );
}

function CategoryCard({ item, connected, open, onToggle }: { item: HealthItem; connected: boolean; open: boolean; onToggle: () => void }) {
  const status: HealthStatus = connected ? item.status : 'unknown';
  const st = STATUS[status];
  const color = st.color();
  return (
    <GlassCard padded={false} accent={status === 'critical' || status === 'warning' ? color : undefined}>
      <Pressable onPress={onToggle} style={({ pressed }) => ({ padding: S.lg, flexDirection: 'row', alignItems: 'center', gap: S.md, opacity: pressed ? 0.75 : 1 })}>
        <View style={{ width: 38, height: 38, borderRadius: R.sm, backgroundColor: `${color}22`, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={item.icon as IconName} size={20} color={color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.text, fontSize: 16, fontWeight: '700' }}>{item.title}</Text>
          <Text style={{ color: C.textDim, fontSize: 12.5, marginTop: 2 }} numberOfLines={open ? undefined : 1}>
            {connected ? item.summary : 'Not connected'}
          </Text>
        </View>
        <Badge text={st.label.toUpperCase()} color={color} />
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={C.textFaint} />
      </Pressable>
      {open && (
        <View style={{ paddingHorizontal: S.lg, paddingBottom: S.lg }}>
          <Divider />
          {item.details.length ? (
            item.details.map((d, i) => <KeyValue key={`${d.label}-${i}`} label={d.label} value={d.value} />)
          ) : (
            <Text style={{ color: C.textFaint, fontSize: 13, paddingVertical: S.sm }}>No details reported.</Text>
          )}
          {item.codes.length > 0 && (
            <>
              <Text style={[F.label, { marginTop: S.md, marginBottom: S.xs }]}>Active codes</Text>
              {item.codes.map((c) => (
                <View key={c.key} style={{ paddingVertical: S.sm }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.sm }}>
                    <Badge text={`${c.kind === 'error' ? 'E' : 'W'}${c.code}`} color={severityColor(c.severity)} />
                    <Text style={{ color: C.text, fontWeight: '600', flex: 1 }}>{c.title}</Text>
                  </View>
                  {c.causes.length > 0 && <Text style={{ color: C.textDim, fontSize: 12.5, marginTop: 4, lineHeight: 18 }}>Documented causes: {c.causes.join('; ')}</Text>}
                  <Text style={{ color: C.textFaint, fontSize: 11, marginTop: 2 }}>Source: {c.source}</Text>
                </View>
              ))}
            </>
          )}
          {item.category === 'lights' && <Note>No supported protocol reports light faults, so this stays Unknown. Only on/off state is shown.</Note>}
        </View>
      )}
    </GlassCard>
  );
}
