import { useEffect, useState } from 'react';
import { modelById } from '../data/scooterDatabase';
import { useGarage } from '../store/garage';
import { useLive } from '../store/live';

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
