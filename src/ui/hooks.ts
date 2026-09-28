import { useEffect, useState } from 'react';
import { modelById } from '../data/scooterDatabase';
import { useGarage } from '../store/garage';
import { canShowField, type FieldKey } from './fieldVisibility';
import { useLive } from '../store/live';
import { useSettings } from '../store/settings';

/** Brand/model text for the connected scooter: manual choice > protocol identity > generic fallback. */
export function useScooterTitle() {
  const scooterId = useLive((s) => s.scooterId);
  const identity = useLive((s) => s.identity);
  const profile = useGarage((s) => s.scooters.find((x) => x.id === scooterId) ?? null);
  const manual = profile?.manualModel ? modelById(profile.modelId) : null;
  const brand = manual?.manufacturer ?? identity?.manufacturer?.value ?? null;
  const model = manual?.model ?? identity?.model?.value ?? null;
  return {
    brand,
    model,
    title: brand || model ? [brand, model].filter(Boolean).join(' ') : 'Generic BLE device',
    nickname: profile?.nickname ?? identity?.bleName ?? null,
    manual: !!manual,
    profile,
  };
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export type { FieldKey } from './fieldVisibility';

/**
 * Whether a telemetry field should be shown. Fields the connected scooter's protocol can
 * never provide (not in its capability list, and no value has arrived) are hidden unless
 * "Show all fields" is on. Supported fields always show, even before their first value.
 * Nothing is hidden while no scooter is connected.
 */
export function useCanShow(): (k: FieldKey) => boolean {
  const caps = useLive((s) => s.capabilities);
  const snap = useLive((s) => s.snapshot);
  const showAll = useSettings((s) => s.showAllFields);
  return (k) => canShowField(k, caps?.telemetry ?? null, snap, showAll);
}

/** True when the scooter itself reports speed (max speed, acceleration never use phone GPS). */
export function useScooterSpeed(): boolean {
  const caps = useLive((s) => s.capabilities);
  const showAll = useSettings((s) => s.showAllFields);
  return showAll || !caps || caps.telemetry.includes('speedKmh');
}
