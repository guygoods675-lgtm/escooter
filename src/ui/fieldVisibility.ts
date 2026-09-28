import type { TelemetrySnapshot } from '../protocols/types';

export type FieldKey = Exclude<keyof TelemetrySnapshot, 'timestamp'>;

/** Pure rule behind useCanShow. Speed always shows: the phone's GPS fills in (labelled) when the scooter sends none. */
export function canShowField(k: FieldKey, telemetry: readonly string[] | null, snap: Partial<TelemetrySnapshot> | null | undefined, showAll: boolean): boolean {
  return k === 'speedKmh' || showAll || !telemetry || telemetry.includes(k) || snap?.[k] != null;
}
