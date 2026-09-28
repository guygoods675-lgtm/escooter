import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ProtocolId } from '../data/scooterDatabase';
import type { ScooterIdentity } from '../protocols/types';
import { jsonStorage, uid } from './storage';

export interface ScooterProfile {
  id: string;
  bleId: string | null;
  bleName: string | null;
  nickname: string;
  modelId: string | null; // manual or detected model from the database
  manualModel: boolean;
  protocolId: ProtocolId | null;
  identity: ScooterIdentity | null;
  lastConnected: number | null;
  firstConnected: number | null;
  highestSpeedKmh: number | null;
  lastOdometerKm: number | null;
  icon?: string; // Ionicons name chosen by the user
  imageUri?: string | null; // photo picked by the user, copied into app storage
  autoConnect?: boolean; // per-scooter auto-connect (default true)
  connections?: { start: number; end: number | null; protocol: string | null }[];
  totalRideTimeSec?: number | null; // scooter-reported total riding time, when exposed
}

interface GarageState {
  scooters: ScooterProfile[];
  activeId: string | null;
  upsertFromConnection(bleId: string, bleName: string | null): ScooterProfile;
  update(id: string, patch: Partial<ScooterProfile>): void;
  create(nickname: string, modelId: string | null): ScooterProfile;
  remove(id: string): void;
  setActive(id: string | null): void;
  removeAll(): void;
  logConnection(id: string, protocol: string | null): void;
  endConnection(id: string): void;
}

export const useGarage = create<GarageState>()(
  persist(
    (set, get) => ({
      scooters: [],
      activeId: null,
      upsertFromConnection(bleId, bleName) {
        const existing = get().scooters.find((s) => s.bleId === bleId);
        const now = Date.now();
        if (existing) {
          const updated = { ...existing, bleName: bleName ?? existing.bleName, lastConnected: now };
          set((s) => ({ scooters: s.scooters.map((x) => (x.id === existing.id ? updated : x)), activeId: existing.id }));
          return updated;
        }
        const p: ScooterProfile = {
          id: uid(),
          bleId,
          bleName,
          nickname: bleName ?? 'My scooter',
          modelId: null,
          manualModel: false,
          protocolId: null,
          identity: null,
          lastConnected: now,
          firstConnected: now,
          highestSpeedKmh: null,
          lastOdometerKm: null,
        };
        set((s) => ({ scooters: [...s.scooters, p], activeId: p.id }));
        return p;
      },
      update: (id, patch) => set((s) => ({ scooters: s.scooters.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      create(nickname, modelId) {
        const p: ScooterProfile = {
          id: uid(), bleId: null, bleName: null, nickname, modelId, manualModel: !!modelId, protocolId: null, identity: null,
          lastConnected: null, firstConnected: null, highestSpeedKmh: null, lastOdometerKm: null,
        };
        set((s) => ({ scooters: [...s.scooters, p], activeId: s.activeId ?? p.id }));
        return p;
      },
      remove: (id) => set((s) => ({ scooters: s.scooters.filter((x) => x.id !== id), activeId: s.activeId === id ? null : s.activeId })),
      setActive: (activeId) => set({ activeId }),
      removeAll: () => set({ scooters: [], activeId: null }),
      logConnection: (id, protocol) =>
        set((s) => ({
          scooters: s.scooters.map((x) => (x.id === id ? { ...x, connections: [{ start: Date.now(), end: null, protocol }, ...(x.connections ?? [])].slice(0, 50) } : x)),
        })),
      endConnection: (id) =>
        set((s) => ({
          scooters: s.scooters.map((x) =>
            x.id === id && x.connections?.[0] && x.connections[0].end == null ? { ...x, connections: [{ ...x.connections[0], end: Date.now() }, ...x.connections.slice(1)] } : x,
          ),
        })),
    }),
    { name: 'sh.garage', storage: jsonStorage },
  ),
);

export const useActiveScooter = () => useGarage((s) => s.scooters.find((x) => x.id === s.activeId) ?? null);
