import { create } from 'zustand';
import type { GattServiceInfo } from '../ble/BluetoothManager';
import type { BatteryDetails, ProtocolCapabilities, ScooterExtras, ScooterIdentity, TelemetrySnapshot } from '../protocols/types';

export type ConnState = 'idle' | 'scanning' | 'found' | 'connecting' | 'identifying' | 'connected' | 'reconnecting' | 'disconnected' | 'error';

export interface Alert {
  id: number;
  level: 'info' | 'warning' | 'critical';
  title: string;
  body: string;
  t: number;
}

interface LiveState {
  adapter: string;
  conn: ConnState;
  connError: string | null;
  deviceId: string | null;
  deviceName: string | null;
  scooterId: string | null;
  connectedAt: number | null;
  rssi: number | null;
  protocolId: string | null;
  protocolName: string | null;
  detectionNote: string | null;
  capabilities: ProtocolCapabilities | null;
  identity: ScooterIdentity | null;
  snapshot: TelemetrySnapshot | null;
  battery: BatteryDetails | null;
  extras: ScooterExtras | null;
  services: GattServiceInfo[];
  sessionMaxSpeed: number | null;
  alerts: Alert[];
  patch(p: Partial<LiveState>): void;
  pushAlert(a: Omit<Alert, 'id' | 't'>): void;
  dismissAlert(id: number): void;
}

let alertSeq = 0;

export const useLive = create<LiveState>((set) => ({
  adapter: 'Unknown',
  conn: 'idle',
  connError: null,
  deviceId: null,
  deviceName: null,
  scooterId: null,
  connectedAt: null,
  rssi: null,
  protocolId: null,
  protocolName: null,
  detectionNote: null,
  capabilities: null,
  identity: null,
  snapshot: null,
  battery: null,
  extras: null,
  services: [],
  sessionMaxSpeed: null,
  alerts: [],
  patch: (p) => set(p),
  pushAlert: (a) => set((s) => ({ alerts: [{ ...a, id: ++alertSeq, t: Date.now() }, ...s.alerts].slice(0, 5) })),
  dismissAlert: (id) => set((s) => ({ alerts: s.alerts.filter((x) => x.id !== id) })),
}));
