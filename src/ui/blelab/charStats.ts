// Per-characteristic RX statistics for BLE LAB, fed by devlog packet listeners.
// Stored outside React; components poll at ≤ 5 fps so BLE bursts never cause
// per-packet renders.
import { useEffect, useState } from 'react';
import { addPacketListener } from '../../store/devlog';

export const FREQ_WINDOW_MS = 5000;
const TICK_MS = 200; // ≤ 5 fps

export interface CharStat {
  /** Reads + notifications received. */
  rxCount: number;
  /** Writes sent by the app (any caller). */
  txCount: number;
  lastT: number | null;
  lastBytes: Uint8Array | null;
  lastDir: 'read' | 'notify' | null;
  /** RX timestamps within the frequency window (pruned on push/read). */
  times: number[];
  v: number;
}

export const charKey = (service: string, char: string) => `${service.toLowerCase()}/${char.toLowerCase()}`;

const stats = new Map<string, CharStat>();
let statsDevice: string | null = null;

const blank = (): CharStat => ({ rxCount: 0, txCount: 0, lastT: null, lastBytes: null, lastDir: null, times: [], v: 0 });

function prune(s: CharStat, now: number) {
  const from = now - FREQ_WINDOW_MS;
  let i = 0;
  while (i < s.times.length && s.times[i] < from) i++;
  if (i > 0) s.times.splice(0, i);
}

addPacketListener((p, bytes) => {
  if (!p.service || !p.char) return;
  const k = charKey(p.service, p.char);
  let s = stats.get(k);
  if (!s) stats.set(k, (s = blank()));
  if (p.dir === 'read' || p.dir === 'notify') {
    s.rxCount++;
    s.lastT = p.t;
    s.lastBytes = bytes ? bytes.slice() : new Uint8Array(0);
    s.lastDir = p.dir;
    s.times.push(p.t);
    prune(s, p.t);
  } else if (!p.note) {
    s.txCount++;
  }
  s.v++;
});

/** Clears statistics when a different device is inspected. */
export function ensureStatsDevice(deviceId: string | null) {
  if (deviceId && deviceId !== statsDevice) {
    statsDevice = deviceId;
    stats.clear();
  }
}

export function charFrequencyHz(s: CharStat | undefined, now = Date.now()): number {
  if (!s) return 0;
  prune(s, now);
  return s.times.length / (FREQ_WINDOW_MS / 1000);
}

/** True once any characteristic has received a read or notification. */
export const anyCharValue = () => {
  for (const s of stats.values()) if (s.rxCount > 0) return true;
  return false;
};

// ---- Shared ticker ---------------------------------------------------------
const tickers = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
function subscribeTick(cb: () => void) {
  tickers.add(cb);
  if (!timer) timer = setInterval(() => tickers.forEach((t) => t()), TICK_MS);
  return () => {
    tickers.delete(cb);
    if (tickers.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/**
 * Snapshot of one characteristic's stats. Re-renders at most 5×/s when the
 * characteristic changes, and once per second while its frequency window
 * still holds packets (so Hz decays to 0 visibly).
 */
export function useCharStat(service: string, char: string): { stat: CharStat | undefined; now: number } {
  const k = charKey(service, char);
  const [state, setState] = useState(() => ({ v: stats.get(k)?.v ?? -1, now: Date.now() }));
  useEffect(
    () =>
      subscribeTick(() => {
        const s = stats.get(k);
        const v = s?.v ?? -1;
        const now = Date.now();
        setState((prev) => (prev.v !== v || (s && s.times.length > 0 && now - prev.now >= 1000) ? { v, now } : prev));
      }),
    [k],
  );
  return { stat: stats.get(k), now: state.now };
}

/** Re-renders at most 5×/s while `fn()` changes; for small derived flags. */
export function usePolled<T>(fn: () => T): T {
  const [v, setV] = useState(fn);
  useEffect(() => subscribeTick(() => setV(() => fn())), [fn]);
  return v;
}
