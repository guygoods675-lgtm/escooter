import React, { useEffect, useState } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, G as SvgG, Line, Polyline, Text as SvgText } from 'react-native-svg';
import {
  G,
  MotionSourceId,
  MotionState,
  SourceReading,
  cancelCalibration,
  clearCalibration,
  resetPeaks,
  startCalibration,
  useMotion,
  useMotionSession,
} from '../services/motion';
import { Confidence, DataSource, DataTag } from '../ui/components/DataTag';
import { Divider, GlassCard, KeyValue, NeonButton, Note, SectionHeader, Segmented } from '../ui/components/Glass';
import { Screen } from '../ui/components/Screen';
import { C, S, rgba } from '../ui/theme';
import { NA } from '../utils/format';

const META: Record<MotionSourceId, { label: string; kind: Confidence; source: DataSource; tag: string }> = {
  scooter: { label: 'Scooter', kind: 'calculated', source: 'Scooter BLE', tag: 'Calculated · Scooter BLE speed' },
  gps: { label: 'GPS', kind: 'estimated', source: 'Phone GPS', tag: 'Estimated · Phone GPS' },
  phone: { label: 'Phone', kind: 'measured', source: 'Phone accelerometer', tag: 'Measured · Phone accelerometer (mount-dependent)' },
};

const PLOT_MAX_G = 0.5;
const fmtG = (ms2: number | null | undefined, digits = 2) => (ms2 == null ? NA : `${(ms2 / G).toFixed(digits)} g`);
const fmtMs2 = (ms2: number | null | undefined) => (ms2 == null ? '' : `${ms2.toFixed(2)} m/s²`);

function GPlot({ size, reading, trail, lateralKnown, magnitudeOnly }: { size: number; reading: SourceReading; trail: { x: number; y: number }[]; lateralKnown: boolean; magnitudeOnly: boolean }) {
  const c = size / 2;
  const rMax = c - 18;
  const k = rMax / PLOT_MAX_G;
  const clampPt = (x: number, y: number) => {
    const m = Math.hypot(x, y);
    const s = m > PLOT_MAX_G ? PLOT_MAX_G / m : 1;
    return { px: c + x * s * k, py: c - y * s * k };
  };
  const pts = trail.map((p) => clampPt(lateralKnown ? p.x : 0, p.y));
  const cur = reading.available && reading.longMs2 != null ? clampPt(lateralKnown && reading.latMs2 != null ? reading.latMs2 / G : 0, reading.longMs2 / G) : null;
  const magR = magnitudeOnly && reading.magMs2 != null ? Math.min(PLOT_MAX_G, reading.magMs2 / G) * k : null;
  return (
    <Svg width={size} height={size}>
      {[0.1, 0.25, 0.5].map((g) => (
        <SvgG key={g}>
          <Circle cx={c} cy={c} r={g * k} stroke={rgba('#FFFFFF', g === 0.5 ? 0.25 : 0.12)} strokeWidth={1} fill="none" />
          <SvgText x={c + 4} y={c - g * k + 12} fill={C.textFaint} fontSize={10}>{`${g} g`}</SvgText>
        </SvgG>
      ))}
      <Line x1={c} y1={c - rMax} x2={c} y2={c + rMax} stroke={rgba('#FFFFFF', 0.12)} />
      <Line x1={c - rMax} y1={c} x2={c + rMax} y2={c} stroke={rgba('#FFFFFF', lateralKnown ? 0.12 : 0.05)} strokeDasharray={lateralKnown ? undefined : '4 4'} />
      <SvgText x={c} y={12} fill={C.textDim} fontSize={11} textAnchor="middle">Accelerate</SvgText>
      <SvgText x={c} y={size - 4} fill={C.textDim} fontSize={11} textAnchor="middle">Brake</SvgText>
      {lateralKnown && (
        <>
          <SvgText x={4} y={c - 6} fill={C.textDim} fontSize={11}>Left</SvgText>
          <SvgText x={size - 4} y={c - 6} fill={C.textDim} fontSize={11} textAnchor="end">Right</SvgText>
        </>
      )}
      {pts.length > 1 && <Polyline points={pts.map((p) => `${p.px.toFixed(1)},${p.py.toFixed(1)}`).join(' ')} stroke={rgba(C.purple, 0.45)} strokeWidth={3} fill="none" strokeLinejoin="round" strokeLinecap="round" />}
      {magR != null && <Circle cx={c} cy={c} r={Math.max(2, magR)} stroke={C.purpleLight} strokeWidth={3} fill={rgba(C.purple, 0.12)} />}
      {cur && <Circle cx={cur.px} cy={cur.py} r={9} fill={C.purpleLight} stroke="#fff" strokeWidth={2} />}
    </Svg>
  );
}

function SourceRow({ id, st }: { id: MotionSourceId; st: MotionState }) {
  const r = st[id];
  const meta = META[id];
  let value: string;
  if (!r.available) value = NA;
  else if (r.longMs2 != null) value = fmtG(r.longMs2);
  else value = r.magMs2 != null ? `${fmtG(r.magMs2)} (magnitude)` : NA;
  return (
    <View style={{ paddingVertical: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: S.md }}>
        <Text style={{ color: C.text, fontWeight: '600', fontSize: 14.5 }}>{meta.label}</Text>
        <Text style={{ color: r.available ? C.text : C.textFaint, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{value}</Text>
      </View>
      <DataTag kind={r.available ? meta.kind : 'unavailable'} source={meta.source} />
      {!r.available && !!r.reason && <Text style={{ color: C.textFaint, fontSize: 12, marginTop: 2 }}>{r.reason}</Text>}
    </View>
  );
}

export default function GForceScreen() {
  useMotionSession();
  const st = useMotion();
  const { width } = useWindowDimensions();
  const [src, setSrc] = useState<MotionSourceId | null>(null);

  // Pick a sensible default once something is available; the user can switch freely.
  const auto: MotionSourceId = st.calibrated && st.phone.available ? 'phone' : st.scooter.available ? 'scooter' : st.gps.available ? 'gps' : 'phone';
  useEffect(() => {
    if (src == null && (st.scooter.available || st.gps.available || st.phone.available)) setSrc(auto);
  }, [src, auto, st.scooter.available, st.gps.available, st.phone.available]);
  const sel: MotionSourceId = src ?? auto;
  const r = st[sel];
  const meta = META[sel];
  const lateralKnown = sel === 'phone' && st.calibrated;
  const magnitudeOnly = sel === 'phone' && !st.calibrated;
  const peaks = st.peaks[sel];
  const long = r.available ? r.longMs2 : null;
  const cal = st.calib;
  const calibrating = cal.status === 'still' || cal.status === 'moving';

  return (
    <Screen contentStyle={{ paddingTop: 110 }}>
      <Segmented
        options={[{ label: 'Scooter', value: 'scooter' as MotionSourceId }, { label: 'GPS', value: 'gps' as MotionSourceId }, { label: 'Phone', value: 'phone' as MotionSourceId }]}
        value={sel}
        onChange={setSrc}
        style={{ marginBottom: S.md }}
      />
      <GlassCard style={{ alignItems: 'center' }}>
        <DataTag kind={r.available ? meta.kind : 'unavailable'} source={meta.source} />
        <Text style={{ color: C.textDim, fontSize: 12, marginTop: 2 }}>{r.available ? meta.tag : r.reason ?? 'Unavailable'}</Text>
        <GPlot size={Math.min(width - 64, 320)} reading={r} trail={st.trail[sel]} lateralKnown={lateralKnown} magnitudeOnly={magnitudeOnly} />
        {magnitudeOnly && <Note>Phone not calibrated: showing total acceleration magnitude only (ring). Direction and lateral force need a calibration.</Note>}
      </GlassCard>

      <GlassCard>
        {magnitudeOnly ? (
          <KeyValue label="Acceleration magnitude" value={r.available && r.magMs2 != null ? fmtG(r.magMs2) : NA} note={r.available ? fmtMs2(r.magMs2) : undefined} />
        ) : (
          <>
            <KeyValue label="Longitudinal" value={long != null ? fmtG(long) : NA} note={long != null ? fmtMs2(long) : undefined} />
            <KeyValue label="Braking deceleration" value={long != null ? fmtG(Math.max(0, -long)) : NA} note={long != null ? fmtMs2(Math.max(0, -long)) : undefined} />
          </>
        )}
        <KeyValue
          label="Lateral"
          value={lateralKnown && r.available && r.latMs2 != null ? fmtG(r.latMs2) : 'Unavailable'}
          note={lateralKnown ? 'Left/right sign depends on how the phone reports its axes' : sel === 'phone' ? 'Needs a phone mount calibration' : 'Only the calibrated phone accelerometer can measure lateral force'}
        />
        <DataTag kind={r.available ? meta.kind : 'unavailable'} source={meta.source} />
      </GlassCard>

      <SectionHeader title={`Session peaks · ${meta.label}`} icon="trending-up-outline" right={<NeonButton title="Reset" icon="refresh" variant="ghost" small onPress={resetPeaks} />} />
      <GlassCard>
        {magnitudeOnly ? (
          <KeyValue label="Peak magnitude" value={fmtG(peaks.mag)} note={fmtMs2(peaks.mag)} />
        ) : (
          <>
            <KeyValue label="Peak acceleration" value={fmtG(peaks.accel)} note={fmtMs2(peaks.accel)} />
            <KeyValue label="Peak braking" value={fmtG(peaks.brake)} note={fmtMs2(peaks.brake)} />
          </>
        )}
        <DataTag kind={peaks.accel != null || peaks.brake != null || peaks.mag != null ? meta.kind : 'unavailable'} source={meta.source} />
        <Note>Peaks are kept for this visit only and are per source.</Note>
      </GlassCard>

      <SectionHeader title="Phone mount calibration" icon="phone-portrait-outline" />
      <GlassCard>
        <Text style={{ color: C.text, fontWeight: '700', fontSize: 15 }}>
          {st.calibrated && !calibrating ? 'Calibrated' : calibrating ? (cal.status === 'still' ? 'Step 1 of 2: keep still' : 'Step 2 of 2: ride straight') : cal.status === 'failed' ? 'Calibration not applied' : 'Not calibrated'}
        </Text>
        {!!cal.message && <Text style={{ color: cal.status === 'failed' ? C.amber : C.textDim, fontSize: 13, marginTop: 4, lineHeight: 18 }}>{cal.message}</Text>}
        {calibrating && (
          <View style={{ height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', marginTop: S.md, overflow: 'hidden' }}>
            <View style={{ height: 6, width: `${Math.round(cal.progress * 100)}%`, backgroundColor: C.purple }} />
          </View>
        )}
        {!calibrating && (
          <Note>
            Mount the phone firmly on the scooter. Tap Calibrate with the scooter standing still, keep still for 2 seconds, then ride off in a straight line and accelerate gently. It finishes by itself, so you never need to touch the phone while riding. Only do this where it is safe.
          </Note>
        )}
        <View style={{ flexDirection: 'row', gap: S.sm, marginTop: S.md }}>
          {calibrating ? (
            <NeonButton title="Cancel" icon="close" variant="ghost" small onPress={cancelCalibration} style={{ flex: 1 }} />
          ) : (
            <NeonButton title={st.calibrated ? 'Recalibrate' : 'Calibrate'} icon="locate-outline" small onPress={startCalibration} disabled={!st.phone.available} style={{ flex: 1 }} />
          )}
          {st.calibrated && !calibrating && <NeonButton title="Clear" icon="trash-outline" variant="ghost" small onPress={clearCalibration} style={{ flex: 1 }} />}
        </View>
      </GlassCard>

      <SectionHeader title="All sources" icon="layers-outline" />
      <GlassCard>
        <SourceRow id="scooter" st={st} />
        <Divider />
        <SourceRow id="gps" st={st} />
        <Divider />
        <SourceRow id="phone" st={st} />
      </GlassCard>

      <Note icon="alert-circle-outline" color={C.amber}>
        Phone sensors and GPS are not precision instruments. Values depend on the mount, vibration and signal quality; scooter-derived values only update as often as the scooter reports speed. Use them as a rough guide only.
      </Note>
      <View style={{ height: S.xl }} />
    </Screen>
  );
}
