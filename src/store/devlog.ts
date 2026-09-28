import { create } from 'zustand';
import { toHex } from '../utils/bytes';

export interface LogEntry {
  id: number;
  t: number;
  kind: 'info' | 'tx' | 'rx' | 'error' | 'conn';
  message: string;
  hex?: string;
  decoded?: string;
}

/**
 * One GATT-level packet as seen by BleSession.
 *  read / notify: bytes received from the device (RX)
 *  write / writeNR: bytes the app sent (TX, with / without response)
 *  event: connection or error events (no characteristic)
 */
export type PacketDir = 'read' | 'notify' | 'write' | 'writeNR' | 'event';
export interface CapturePacket {
  id: number;
  t: number;
  dir: PacketDir;
  service: string | null;
  char: string | null;
  hex: string;
  len: number;
  note?: string;
}
export const isRxDir = (d: PacketDir) => d === 'read' || d === 'notify';
export const isTxDir = (d: PacketDir) => d === 'write' || d === 'writeNR';

const MAX = 1500;
export const CAPTURE_CAPACITY = 20000;
const CAPTURE_FLUSH_MS = 200; // store updates at most 5 per second
let seq = 0;
let packetSeq = 0;

interface DevLogState {
  entries: LogEntry[];
  paused: boolean;
  add(kind: LogEntry['kind'], message: string, bytes?: Uint8Array, decoded?: string): void;
  clear(): void;
  setPaused(p: boolean): void;
  /** Capture session state. The packets themselves live in a ring buffer outside React state. */
  capturing: boolean;
  captureStartedAt: number | null;
  captureStoppedAt: number | null;
  /** Packets currently held (≤ CAPTURE_CAPACITY). */
  captureCount: number;
  /** Packets dropped from the front because the ring buffer was full. */
  captureDropped: number;
  /** Bumped (throttled) whenever the ring buffer changes. */
  captureVersion: number;
  startCapture(): void;
  stopCapture(): void;
  clearCapture(): void;
}

// Entries are batched to avoid re-rendering on every BLE notification.
let pending: LogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

// ---- Capture ring buffer ---------------------------------------------------
const ring: (CapturePacket | undefined)[] = new Array(CAPTURE_CAPACITY);
let ringHead = 0; // index of the oldest packet
let ringCount = 0;
let ringDropped = 0;
let captureTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleCaptureFlush() {
  if (captureTimer) return;
  captureTimer = setTimeout(() => {
    captureTimer = null;
    useDevLog.setState((s) => ({ captureCount: ringCount, captureDropped: ringDropped, captureVersion: s.captureVersion + 1 }));
  }, CAPTURE_FLUSH_MS);
}

function pushCapture(p: CapturePacket) {
  if (ringCount < CAPTURE_CAPACITY) {
    ring[(ringHead + ringCount) % CAPTURE_CAPACITY] = p;
    ringCount++;
  } else {
    ring[ringHead] = p;
    ringHead = (ringHead + 1) % CAPTURE_CAPACITY;
    ringDropped++;
  }
  scheduleCaptureFlush();
}

/** Oldest-first copy of the captured packets (optionally only the newest `limit`). */
export function captureSnapshot(limit = CAPTURE_CAPACITY): CapturePacket[] {
  const n = Math.min(limit, ringCount);
  const out: CapturePacket[] = new Array(n);
  const start = ringCount - n;
  for (let i = 0; i < n; i++) out[i] = ring[(ringHead + start + i) % CAPTURE_CAPACITY]!;
  return out;
}

// ---- Packet listeners (per-characteristic stats etc.) ----------------------
type PacketListener = (p: CapturePacket, bytes: Uint8Array | null) => void;
const listeners = new Set<PacketListener>();
export function addPacketListener(l: PacketListener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/**
 * Called by BleSession for every GATT read / notification / write. Cheap: no
 * React state is touched synchronously. Captured only while a capture session runs.
 */
export function recordPacket(dir: PacketDir, service: string | null, char: string | null, bytes: Uint8Array | null, note?: string) {
  const p: CapturePacket = {
    id: ++packetSeq,
    t: Date.now(),
    dir,
    service: service ? service.toLowerCase() : null,
    char: char ? char.toLowerCase() : null,
    hex: bytes ? toHex(bytes, '') : '',
    len: bytes ? bytes.length : 0,
    note,
  };
  if (useDevLog.getState().capturing) pushCapture(p);
  listeners.forEach((l) => {
    try {
      l(p, bytes);
    } catch {
      /* a listener must never break the BLE path */
    }
  });
}

export const useDevLog = create<DevLogState>((set, get) => ({
  entries: [],
  paused: false,
  add(kind, message, bytes, decoded) {
    // Connection / error events are also part of a capture session.
    if ((kind === 'conn' || kind === 'error') && get().capturing) recordPacket('event', null, null, null, `${kind}: ${message}`);
    pending.push({ id: ++seq, t: Date.now(), kind, message, hex: bytes ? toHex(bytes) : undefined, decoded });
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        const batch = pending;
        pending = [];
        if (get().paused) return;
        set((s) => ({ entries: [...s.entries, ...batch].slice(-MAX) }));
      }, 250);
    }
  },
  clear: () => set({ entries: [] }),
  setPaused: (paused) => set({ paused }),

  capturing: false,
  captureStartedAt: null,
  captureStoppedAt: null,
  captureCount: 0,
  captureDropped: 0,
  captureVersion: 0,
  startCapture() {
    if (get().capturing) return;
    set({ capturing: true, captureStartedAt: get().captureStartedAt ?? Date.now(), captureStoppedAt: null });
    recordPacket('event', null, null, null, 'capture started');
  },
  stopCapture() {
    if (!get().capturing) return;
    recordPacket('event', null, null, null, 'capture stopped');
    set({ capturing: false, captureStoppedAt: Date.now() });
  },
  clearCapture() {
    ring.fill(undefined);
    ringHead = 0;
    ringCount = 0;
    ringDropped = 0;
    set((s) => ({
      captureCount: 0,
      captureDropped: 0,
      captureVersion: s.captureVersion + 1,
      captureStartedAt: s.capturing ? Date.now() : null,
      captureStoppedAt: null,
    }));
  },
}));

export const devLog = (kind: LogEntry['kind'], message: string, bytes?: Uint8Array, decoded?: string) =>
  useDevLog.getState().add(kind, message, bytes, decoded);
