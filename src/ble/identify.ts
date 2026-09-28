import { UUID } from './uuids';
import { XIAOMI_SCOOTER_PIDS, VERIFIED_MODELS } from '../protocols/xiaomiSecure/XiaomiT2336Protocol';

/**
 * Names a scooter from its advertisement only, before connecting. Every rule has a
 * public source; anything else stays unnamed rather than guessed.
 *   Xiaomi MiBeacon product id (FE95 service data bytes 2-3 LE):
 *     0x403D 4 Pro 2nd Gen   github.com/mehesbalazs/xiaomi-scooter-4-pro-2 docs/protocol.md
 *     0x50D3 5 Pro           github.com/KuziaMother/SCOOTER_5_PRO docs/BLE.md §8
 *   "MIScooter…" name        github.com/CamiAlfa/M365-BLE-PROTOCOL (M365 family)
 *   "dreame scooter" name    docs/protocol.md above (4 Pro 2nd Gen)
 *   NAVEE name prefix / GATT service 0000d0ff-3c17-d293-8e48-14fe2e4da212
 *                            github.com/foddy201121/Tbe-Navee, github.com/jsluquelucena-rgb/navee-st3-pro docs/PROTOCOL.md
 *   Manufacturer data "NC" (4E 43) on a NUS scooter = Segway-Ninebot with NinebotCrypto
 *                            github.com/pepperonas/segway-zt3-pro (ZT3 Pro), github.com/scooterhacking/NinebotCrypto
 */
export const XIAOMI_FE95 = '0000fe95-0000-1000-8000-00805f9b34fb';
export const NAVEE_SERVICE = '0000d0ff-3c17-d293-8e48-14fe2e4da212';

export type AdvertSupport = 'supported' | 'needs-key' | 'experimental' | 'not-supported' | 'unknown';

export interface AdvertIdentity {
  brand: string;
  model: string;
  support: AdvertSupport;
}

export function identifyAdvert(d: { name: string | null; serviceUUIDs: string[]; miBeaconPid?: number | null; manufacturerData?: string | null }): AdvertIdentity | null {
  const name = d.name ?? '';
  if (d.miBeaconPid != null && XIAOMI_SCOOTER_PIDS[d.miBeaconPid]) {
    const x = XIAOMI_SCOOTER_PIDS[d.miBeaconPid];
    return { brand: 'Xiaomi', model: x.name, support: VERIFIED_MODELS.has(x.model) ? 'needs-key' : 'experimental' };
  }
  if (/^MIScooter/i.test(name)) return { brand: 'Xiaomi', model: 'M365 family', support: 'supported' };
  if (/^dreame scooter$/i.test(name)) return { brand: 'Xiaomi', model: 'Electric Scooter (encrypted Bluetooth)', support: 'needs-key' };
  if (/^NAVEE/i.test(name) || d.serviceUUIDs.includes(NAVEE_SERVICE)) return { brand: 'NAVEE', model: name.replace(/^NAVEE[\s_-]*/i, '') || 'Scooter', support: 'not-supported' };
  if (d.miBeaconPid != null && /scooter/i.test(name)) return { brand: 'Xiaomi', model: `Scooter (product id 0x${d.miBeaconPid.toString(16).toUpperCase().padStart(4, '0')})`, support: 'experimental' };
  if ((d.manufacturerData ?? '').toLowerCase().startsWith('4e43')) {
    const model = /zt3/i.test(name) ? 'ZT3 Pro' : name || 'Scooter';
    return { brand: 'Segway-Ninebot', model: `${model} (encrypted Bluetooth)`, support: 'not-supported' };
  }
  if (d.serviceUUIDs.includes(UUID.NUS_SERVICE)) return { brand: 'Xiaomi / Ninebot', model: 'UART scooter', support: 'supported' };
  return null;
}

export const SUPPORT_LABEL: Record<AdvertSupport, string> = {
  supported: 'Supported',
  'needs-key': 'Supported · needs key',
  experimental: 'Experimental · needs key',
  'not-supported': 'Not supported yet',
  unknown: 'Unknown',
};
