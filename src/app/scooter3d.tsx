import { router } from 'expo-router';
import React, { useRef } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import { useLive } from '../store/live';
import { DataTag } from '../ui/components/DataTag';
import { Divider, GlassCard, NeonButton, Note, SectionHeader } from '../ui/components/Glass';
import { Scooter3D, Scooter3DHandle, useScooterShape } from '../ui/components/Scooter3D';
import { Screen } from '../ui/components/Screen';
import { useScooterTitle } from '../ui/hooks';
import { C, S } from '../ui/theme';

function LegendRow({ part, driven, detail, source }: { part: string; driven: boolean; detail: string; source?: 'Scooter BLE' | 'Scooter BMS' | 'Model database' | 'Phone GPS' }) {
  return (
    <View style={{ paddingVertical: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: S.md }}>
        <Text style={{ color: C.text, fontSize: 14.5, fontWeight: '600' }}>{part}</Text>
        <DataTag kind={driven ? 'measured' : 'unavailable'} source={driven ? source : undefined} />
      </View>
      <Text style={{ color: C.textDim, fontSize: 12.5, marginTop: 2, lineHeight: 17 }}>{detail}</Text>
    </View>
  );
}

export default function Scooter3DScreen() {
  const { height } = useWindowDimensions();
  const viewer = useRef<Scooter3DHandle>(null);
  const { title } = useScooterTitle();
  const { wheelInches, wheelFromDatabase } = useScooterShape();

  const connected = useLive((s) => s.conn === 'connected');
  const hasSpeed = useLive((s) => s.conn === 'connected' && s.snapshot?.speedKmh != null);
  const phoneSpeed = useLive((s) => s.snapshot?.speedKmh?.source === 'phone');
  const hasHead = useLive((s) => s.conn === 'connected' && s.snapshot?.headlight != null);
  const hasBrake = useLive((s) => s.conn === 'connected' && s.snapshot?.brake != null);
  const hasTail = useLive((s) => s.conn === 'connected' && s.snapshot?.tailLight != null);
  const hasBatt = useLive((s) => s.conn === 'connected' && s.snapshot?.batteryPercent != null);

  // No entrance fade: the screen must never depend on an animation finishing. The old
  // fade-in could stay stuck at opacity 0 (Screen remounts its content), so nothing showed.
  const close = () => router.back();

  const wheelText = wheelFromDatabase ? `${wheelInches}" wheel from the official specs` : `No wheel size in the model database; a ${wheelInches}" wheel is assumed, so the spin rate is only visual`;

  return (
    <Screen contentStyle={{ paddingTop: 110 }}>
      <View>
        <GlassCard padded={false} style={{ paddingVertical: S.md, paddingHorizontal: S.sm }}>
          <Scooter3D ref={viewer} height={Math.max(300, Math.min(520, height * 0.5))} interactive live showReset={false} />
        </GlassCard>
        <View style={{ flexDirection: 'row', gap: S.sm }}>
          <NeonButton title="Reset camera" icon="refresh" variant="ghost" small onPress={() => viewer.current?.resetCamera()} style={{ flex: 1 }} />
          <NeonButton title="Close" icon="close" variant="ghost" small onPress={close} style={{ flex: 1 }} />
        </View>
        <Note>Drag to rotate, pinch to zoom, double-tap to reset.</Note>

        <SectionHeader title="Live sync" icon="pulse-outline" />
        <GlassCard>
          {!connected && <Note icon="bluetooth-outline">No scooter connected: the model is static and nothing is lit.</Note>}
          <LegendRow part="Wheel rotation" driven={hasSpeed} source={phoneSpeed ? 'Phone GPS' : 'Scooter BLE'} detail={hasSpeed ? `Spins at the ${phoneSpeed ? "phone's GPS" : 'scooter-reported'} speed. ${wheelText}.` : 'Speed not available, so the wheels stay still.'} />
          <Divider />
          <LegendRow part="Headlight" driven={hasHead} source="Scooter BLE" detail={hasHead ? 'Glows only while the scooter reports the headlight on.' : 'This scooter does not report headlight state, so it is never lit.'} />
          <Divider />
          <LegendRow
            part="Brake / tail light"
            driven={hasBrake || hasTail}
            source="Scooter BLE"
            detail={
              hasBrake && hasTail
                ? 'Dim red when the tail light is reported on, bright red while the brake is reported.'
                : hasBrake
                  ? 'Bright red only while the scooter reports the brake.'
                  : hasTail
                    ? 'Red while the scooter reports the tail light on. Brake state is not reported.'
                    : 'Brake and tail light state are not reported, so it is never lit.'
            }
          />
          <Divider />
          <LegendRow part="Battery strip" driven={hasBatt} source="Scooter BLE" detail={hasBatt ? 'Segments follow the scooter-reported battery %.' : 'Battery % not available: the strip stays grey.'} />
          <Divider />
          <LegendRow part="Turn indicators" driven={false} detail="Not supported: none of the supported scooter protocols report turn-signal state, so they are never lit." />
          <Divider />
          <LegendRow part="Shape" driven={false} detail={wheelFromDatabase ? `Model-based: wheel size and scale follow the official ${wheelInches}" spec of your ${title}. Frame, deck and colours are a standard design, not an exact copy.` : `Standard proportions: no official wheel size is on file for your ${title}. Not an exact copy.`} />
        </GlassCard>
        <Note>Animations here are a visualisation. Read exact values on the dashboard and live data screens.</Note>
      </View>
    </Screen>
  );
}
