import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { modelById } from '../../data/scooterDatabase';
import { estimateRange } from '../../services/rangeEstimator';
import { useGarage } from '../../store/garage';
import { useLive } from '../../store/live';
import { useRides } from '../../store/rides';
import { useThemeVersion } from '../../store/theme';
import { NA, useUnits } from '../../utils/format';
import { C, F, S } from '../theme';
import { DataTag } from './DataTag';
import { GlassCard, KeyValue } from './Glass';

/**
 * Personal range estimate from the user's ride history for the current scooter,
 * with the scooter's own range figure shown separately. Subscribes only to the
 * few primitive values it needs, so it doesn't re-render per telemetry packet.
 */
export function RangeCard() {
  useThemeVersion();
  const u = useUnits();
  const liveId = useLive((s) => s.scooterId);
  const activeId = useGarage((s) => s.activeId);
  const scooterId = liveId ?? activeId;
  const modelId = useGarage((s) => s.scooters.find((x) => x.id === scooterId)?.modelId ?? null);
  const batteryPercent = useLive((s) => s.snapshot?.batteryPercent?.value ?? null);
  const scooterRange = useLive((s) => s.snapshot?.rangeKm?.value ?? null);
  const bmsMah = useLive((s) => s.battery?.actualCapacityMah?.value ?? null);
  const rides = useRides((s) => s.rides);
  // Whole-percent steps are enough; avoids recomputing for tiny fluctuations.
  const pct = batteryPercent != null ? Math.round(batteryPercent) : null;

  const model = modelById(modelId);
  const est = useMemo(
    () =>
      estimateRange({
        rides,
        scooterId: scooterId ?? null,
        batteryPercent: pct,
        bmsActualCapacityMah: bmsMah,
        nominalVoltage: model?.batteryVoltage ?? null,
        specCapacityWh: model?.batteryCapacityWh ?? null,
      }),
    [rides, scooterId, pct, bmsMah, model],
  );

  return (
    <GlassCard>
      <Text style={F.label}>Estimated range</Text>
      {est.km != null ? (
        <>
          <Text style={{ color: C.text, fontSize: 30, fontWeight: '800', marginTop: 4, fontVariant: ['tabular-nums'] }}>
            {u.dist(est.km).toFixed(1)}
            <Text style={{ color: C.textDim, fontSize: 16, fontWeight: '600' }}> {u.distLabel}</Text>
          </Text>
          <DataTag kind="estimated" source="Ride history" />
          <Text style={{ color: est.confidence === 'preliminary' ? C.amber : C.textDim, fontSize: 12.5, lineHeight: 18, marginTop: S.sm }}>
            {est.confidence === 'preliminary' ? est.explanation : 'Based on your recent riding data.'}
          </Text>
          <Text style={{ color: C.textFaint, fontSize: 11.5, lineHeight: 16, marginTop: 4 }}>
            {est.method === 'wh-per-km'
              ? `${est.rate.toFixed(1)} Wh/km from ${est.basis.rides} ride${est.basis.rides === 1 ? '' : 's'} (${u.dist(est.basis.kmUsed).toFixed(1)} ${u.distLabel}) × ${est.energy!.remainingWh.toFixed(0)} Wh remaining (${
                  est.energy!.source === 'bms' ? 'BMS capacity' : 'model spec capacity'
                }).`
              : `${u.dist(est.rate).toFixed(2)} ${u.distLabel} per battery % from ${est.basis.rides} ride${est.basis.rides === 1 ? '' : 's'} (${u.dist(est.basis.kmUsed).toFixed(1)} ${u.distLabel}).`}
          </Text>
          {est.method === 'wh-per-km' && est.energy && (
            <DataTag kind={est.energy.source === 'bms' ? 'calculated' : 'estimated'} source={est.energy.source === 'bms' ? 'Scooter BMS' : 'Model database'} />
          )}
        </>
      ) : (
        <>
          <Text style={{ color: C.textFaint, fontSize: 16, marginTop: 6 }}>{NA}</Text>
          <Text style={{ color: C.textDim, fontSize: 12.5, lineHeight: 18, marginTop: 4 }}>{est.reason}</Text>
        </>
      )}
      <View style={{ marginTop: S.sm }}>
        <KeyValue label="Scooter's own estimate" value={scooterRange != null ? u.dist(scooterRange).toFixed(1) : NA} unit={u.distLabel} note={scooterRange != null ? 'Reported by the scooter; its own calculation' : undefined} />
        {scooterRange != null && <DataTag kind="estimated" source="Scooter BLE" style={{ alignSelf: 'flex-end', marginTop: -4 }} />}
      </View>
    </GlassCard>
  );
}
