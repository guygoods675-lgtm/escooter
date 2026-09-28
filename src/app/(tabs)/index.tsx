import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SCOOTER_MODELS } from '../../data/scooterDatabase';
import { connectScooter, refreshBattery } from '../../services/ScooterManager';
import { useGarage } from '../../store/garage';
import { useLive } from '../../store/live';
import { useSettings } from '../../store/settings';
import { ConnectionStepper } from '../../ui/components/ConnectionStepper';
import { ProtocolNotice } from '../../ui/components/ProtocolNotice';
import { Badge, GlassCard, ListRow, NeonButton, Note, SectionHeader } from '../../ui/components/Glass';
import { triggerEgg } from '../../ui/components/EasterEggs';
import { FadeIn, Pulse } from '../../ui/components/Motion';
import { DashCard, cardsFor } from '../../ui/dashboard/cards';
import { Screen } from '../../ui/components/Screen';
import { SignalBars } from '../../ui/components/SignalBars';
import { useScooterTitle } from '../../ui/hooks';
import { C, F, S, glow } from '../../ui/theme';
import { fmtDateTime, rssiQuality } from '../../utils/format';

const LOGO = require('../../../assets/logo.png');

export default function Dashboard() {
  const conn = useLive((s) => s.conn);
  const connected = conn === 'connected';
  const [refreshing, setRefreshing] = useState(false);
  // Pull to refresh: re-reads the battery block when connected (documented reads only).
  const onRefresh = () => {
    setRefreshing(true);
    const done = () => setRefreshing(false);
    if (connected) refreshBattery().finally(done);
    else setTimeout(done, 400);
  };
  return (
    <Screen topInset refreshing={refreshing} onRefresh={onRefresh}>
      {connected ? <ConnectedDashboard /> : <Disconnected />}
    </Screen>
  );
}

function Header({ right }: { right?: React.ReactNode }) {
  return (
    <View style={styles.header}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Pressable onLongPress={() => triggerEgg('scooter')} delayLongPress={600}>
          <Image source={LOGO} style={styles.logoSmall} />
        </Pressable>
        <View>
          <Text style={styles.brand}>SCOOTER HUB</Text>
          <Text style={styles.brandSub}>Telemetry · Diagnostics · Rides</Text>
        </View>
      </View>
      {right}
    </View>
  );
}

function Disconnected() {
  const adapter = useLive((s) => s.adapter);
  const conn = useLive((s) => s.conn);
  const connError = useLive((s) => s.connError);
  const scooters = useGarage((s) => s.scooters);
  const recent = [...scooters].filter((s) => s.bleId).sort((a, b) => (b.lastConnected ?? 0) - (a.lastConnected ?? 0)).slice(0, 4);
  const btOn = adapter === 'PoweredOn';
  const busy = conn === 'connecting' || conn === 'identifying' || conn === 'reconnecting' || conn === 'found';
  // Only models whose data Scooter Hub can really read. Experimental ones (untested
  // on hardware) are listed apart; recognised-but-unreadable ones only in the Database.
  const readable = SCOOTER_MODELS.filter((m) => m.protocol !== 'generic-ble');
  const supported = readable.filter((m) => !m.protocolNotes.startsWith('Experimental'));
  const experimental = readable.filter((m) => m.protocolNotes.startsWith('Experimental'));
  return (
    <>
      <Header />
      <View style={styles.hero}>
        <View style={{ alignItems: 'center', justifyContent: 'center' }}>
          <Pulse size={200} active={busy || conn === 'scanning'} color={C.purple} />
          <View style={[styles.logoRing, glow(C.violet, 40)]}>
            <Image source={LOGO} style={styles.logoBig} />
          </View>
        </View>
        <Text style={styles.heroTitle}>{conn === 'scanning' ? 'Searching…' : busy ? (conn === 'identifying' ? 'Reading scooter data…' : conn === 'reconnecting' ? 'Reconnecting…' : 'Connecting…') : 'No scooter connected'}</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <Badge text={`Bluetooth ${btOn ? 'on' : adapter === 'PoweredOff' ? 'off' : adapter.toLowerCase()}`} color={btOn ? C.cyan : C.amber} icon="bluetooth" />
        </View>
        {!!connError && conn === 'error' && <Text style={styles.err}>{connError}</Text>}
      </View>
      <ConnectionStepper />
      <NeonButton title="Connect Scooter" icon="flash" onPress={() => router.push('/bluetooth')} loading={busy} style={{ marginBottom: S.md }} />
      <NeonButton title="Scan for scooters" icon="scan" variant="ghost" onPress={() => router.push({ pathname: '/bluetooth', params: { scan: '1' } })} />

      {recent.length > 0 && (
        <>
          <SectionHeader title="Recently connected" icon="time-outline" />
          <GlassCard style={{ paddingVertical: S.xs }}>
            {recent.map((s) => (
              <ListRow
                key={s.id}
                icon="bicycle"
                title={s.nickname}
                subtitle={`${s.bleName ?? s.bleId} · ${fmtDateTime(s.lastConnected)}`}
                onPress={() => s.bleId && connectScooter(s.bleId, s.bleName)}
              />
            ))}
          </GlassCard>
        </>
      )}

      <SectionHeader title="Supported scooters" icon="shield-checkmark-outline" right={<Text style={styles.link} onPress={() => router.push('/database')}>Database</Text>} />
      <GlassCard>
        {supported.map((m) => (
          <View key={m.id} style={styles.supRow}>
            <Ionicons name="checkmark-circle" size={16} color={C.green} />
            <Text style={styles.supText}>{m.manufacturer} {m.model}</Text>
          </View>
        ))}
        {experimental.length > 0 && (
          <>
            <Text style={[F.label, { marginTop: S.md, marginBottom: 4 }]}>Experimental (not tested on a real scooter yet)</Text>
            {experimental.map((m) => (
              <View key={m.id} style={styles.supRow}>
                <Ionicons name="flask-outline" size={16} color={C.amber} />
                <Text style={styles.supText}>{m.manufacturer} {m.model}</Text>
              </View>
            ))}
          </>
        )}
        <Note>
          Other scooters (for example NAVEE and newer Segway models) are recognised by name but their data cannot be read. See the Database for details.
        </Note>
      </GlassCard>
    </>
  );
}

function ConnectedDashboard() {
  const layout = useSettings((x) => x.dashLayout);
  const custom = useSettings((x) => x.dashCards);
  const cards = useMemo(() => cardsFor(layout, custom), [layout, custom]);
  const signal = useLive((x) => rssiQuality(x.rssi).bars);
  return (
    <>
      <Header
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.md }}>
            <Pressable onPress={() => router.push('/dashboard-layout')} hitSlop={8}>
              <Ionicons name="grid-outline" size={20} color={C.textDim} />
            </Pressable>
            <Pressable onPress={() => router.push('/bluetooth')}><SignalBars bars={signal} /></Pressable>
          </View>
        }
      />
      <ConnectedBanner />
      <ProtocolNotice />
      {cards.map((id, i) => (
        <FadeIn key={id} index={i}>
          <DashCard id={id} />
        </FadeIn>
      ))}
    </>
  );
}

/** "<model> connected" banner shown briefly after each new connection. */
function ConnectedBanner() {
  const connectedAt = useLive((x) => x.connectedAt);
  const { model, nickname } = useScooterTitle();
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!connectedAt || Date.now() - connectedAt > 8000) return;
    setShow(true);
    const t = setTimeout(() => setShow(false), 4000);
    return () => clearTimeout(t);
  }, [connectedAt]);
  if (!show) return null;
  return (
    <FadeIn>
      <GlassCard accent={C.green} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Ionicons name="checkmark-circle" size={22} color={C.green} />
        <Text style={{ color: C.text, fontWeight: '700', flex: 1 }}>{nickname || model || 'Scooter'} connected</Text>
      </GlassCard>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: S.lg },
  logoSmall: { width: 38, height: 38, borderRadius: 10 },
  brand: { color: C.text, fontWeight: '900', letterSpacing: 3, fontSize: 15 },
  brandSub: { color: C.textDim, fontSize: 11 },
  hero: { alignItems: 'center', marginVertical: S.xl },
  logoRing: { width: 168, height: 168, borderRadius: 84, borderWidth: 1, get borderColor() { return C.borderStrong; }, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
  logoBig: { width: 150, height: 150, borderRadius: 75 },
  heroTitle: { color: C.text, fontSize: 22, fontWeight: '800', marginTop: S.lg },
  err: { color: C.red, marginTop: 8, textAlign: 'center' },
  link: { get color() { return C.purpleLight; }, fontWeight: '700', fontSize: 13 },
  supRow: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 5 },
  supText: { color: C.text, fontSize: 14, flex: 1 },
});
