import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import type { ErrorSeverity } from '../../protocols/types';
import { ErrorRecord, useErrors } from '../../store/errors';
import { useLive } from '../../store/live';
import { Badge, EmptyState, GlassCard, KeyValue, NeonButton, Note, SectionHeader, Segmented } from '../../ui/components/Glass';
import { Screen } from '../../ui/components/Screen';
import { C, S, severityColor } from '../../ui/theme';
import { fmtDateTime } from '../../utils/format';

export default function DiagnosticsScreen() {
  const records = useErrors((s) => s.records);
  const clearHistory = useErrors((s) => s.clearHistory);
  const caps = useLive((s) => s.capabilities);
  const conn = useLive((s) => s.conn);
  const scooterId = useLive((s) => s.scooterId);
  const [filter, setFilter] = useState<'ALL' | ErrorSeverity>('ALL');
  const mine = records.filter((r) => !scooterId || r.scooterId === scooterId);
  const active = mine.filter((r) => r.active);
  const history = mine.filter((r) => !r.active && (filter === 'ALL' || r.severity === filter)).sort((a, b) => b.lastSeen - a.lastSeen);
  const counts = { CRITICAL: active.filter((r) => r.severity === 'CRITICAL').length, WARNING: active.filter((r) => r.severity === 'WARNING').length, INFO: active.filter((r) => r.severity === 'INFO').length };

  return (
    <Screen topInset>
      <Text style={styles.title}>Diagnostics</Text>
      <View style={{ flexDirection: 'row', gap: S.sm, marginBottom: S.md }}>
        {(['CRITICAL', 'WARNING', 'INFO'] as const).map((k) => (
          <GlassCard key={k} style={{ flex: 1, marginBottom: 0 }} accent={counts[k] ? severityColor(k) : undefined}>
            <Text style={[styles.count, { color: counts[k] ? severityColor(k) : C.textFaint }]}>{counts[k]}</Text>
            <Text style={styles.countLabel}>{k}</Text>
          </GlassCard>
        ))}
      </View>

      {conn === 'connected' && caps && !caps.errors && (
        <Note color={C.amber}>This scooter's protocol does not expose error codes. Errors are Not available.</Note>
      )}

      <SectionHeader title="Current errors" icon="alert-circle-outline" />
      {active.length === 0 ? (
        <GlassCard>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Ionicons name="checkmark-circle" size={24} color={conn === 'connected' && caps?.errors ? C.green : C.textFaint} />
            <Text style={{ color: C.text, fontSize: 15 }}>
              {conn === 'connected' ? (caps?.errors ? 'No active error codes reported' : 'Error reporting not available') : 'Connect a scooter to read errors'}
            </Text>
          </View>
        </GlassCard>
      ) : (
        active.map((r) => <ErrorCard key={r.key} r={r} />)
      )}

      <SectionHeader title="Error history" icon="time-outline" />
      <Segmented
        options={[{ label: 'All', value: 'ALL' }, { label: 'Critical', value: 'CRITICAL' }, { label: 'Warning', value: 'WARNING' }, { label: 'Info', value: 'INFO' }]}
        value={filter}
        onChange={setFilter}
        style={{ marginBottom: S.md }}
      />
      {history.length === 0 ? <EmptyState icon="document-text-outline" title="No past errors" /> : history.map((r) => <ErrorCard key={r.key} r={r} />)}

      <SectionHeader title="Clear errors" icon="refresh-outline" />
      <GlassCard>
        <Text style={{ color: C.textDim, fontSize: 13.5, lineHeight: 19 }}>
          Clearing error codes on the scooter is Unsupported: none of the supported protocols documents a clear-errors command, so Scooter Hub never sends one.
        </Text>
        {history.length > 0 && (
          <NeonButton
            title="Delete local history"
            small
            variant="ghost"
            style={{ marginTop: S.md }}
            onPress={() => Alert.alert('Delete error history?', 'Only the history stored in this app is removed.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: clearHistory }])}
          />
        )}
      </GlassCard>
    </Screen>
  );
}

function ErrorCard({ r }: { r: ErrorRecord }) {
  const color = severityColor(r.severity);
  return (
    <GlassCard accent={r.active ? color : undefined}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={[styles.code, { color }]}>{r.kind === 'error' ? 'E' : 'W'}{r.code}</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Badge text={r.severity} color={color} />
          <Badge text={r.active ? 'ACTIVE' : 'CLEARED'} color={r.active ? C.red : C.textDim} />
        </View>
      </View>
      <Text style={styles.errTitle}>{r.title}</Text>
      {r.causes.length > 0 && (
        <View style={{ marginTop: S.sm }}>
          <Text style={styles.causeHead}>Possible causes</Text>
          {r.causes.map((c) => (
            <Text key={c} style={styles.cause}>• {c}</Text>
          ))}
        </View>
      )}
      <KeyValue label="First detected" value={fmtDateTime(r.firstSeen)} />
      <KeyValue label="Last detected" value={fmtDateTime(r.lastSeen)} />
      <KeyValue label="Occurrences" value={String(r.occurrences)} />
      <Note>Meaning: {r.source}. Severity and causes are general guidance, not a diagnosis of a specific part.</Note>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  title: { color: C.text, fontSize: 30, fontWeight: '900', marginBottom: S.md, letterSpacing: -0.5 },
  count: { fontSize: 30, fontWeight: '900', textAlign: 'center' },
  countLabel: { color: C.textDim, fontSize: 10.5, fontWeight: '800', letterSpacing: 1, textAlign: 'center' },
  code: { fontSize: 28, fontWeight: '900', letterSpacing: -0.5 },
  errTitle: { color: C.text, fontSize: 16, fontWeight: '700', marginTop: 4 },
  causeHead: { color: C.textDim, fontSize: 12, fontWeight: '700', marginBottom: 2 },
  cause: { color: C.text, fontSize: 13.5, marginLeft: 4, marginTop: 2 },
});
