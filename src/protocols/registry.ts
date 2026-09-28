import { UUID } from '../ble/uuids';
import { NAVEE_SERVICE } from '../ble/identify';
import type { ProtocolId } from '../data/scooterDatabase';
import { GenericBleProtocol } from './generic/GenericBleProtocol';
import { NinebotProtocol } from './ninebot/NinebotProtocol';
import type { BleTransport, ScooterProtocol } from './types';
import { M365Protocol } from './xiaomi/M365Protocol';
import { getRandomBytes } from 'expo-crypto';
import { loadXiaomiCredentials } from '../store/xiaomiKey';
import { XIAOMI_SCOOTER_PIDS, XIAOMI_SEC, XiaomiT2336Protocol, pidFromXiaomiName } from './xiaomiSecure/XiaomiT2336Protocol';

const newT2336 = (productId: number | null = null) => new XiaomiT2336Protocol(loadXiaomiCredentials, () => getRandomBytes(48), productId);

/** MiBeacon product id: bytes 2-3 (LE) of the FE95 service data (docs/protocol.md, mehesbalazs/xiaomi-scooter-4-pro-2). */
export function miBeaconProductId(t: BleTransport): number | null {
  const sd = t.advertisedServiceData?.(XIAOMI_SEC.SERVICE);
  return sd && sd.length >= 4 ? sd[2] | (sd[3] << 8) : null;
}

export const createProtocol = (id: ProtocolId): ScooterProtocol => {
  switch (id) {
    case 'xiaomi-m365':
      return new M365Protocol();
    case 'ninebot-es':
      return new NinebotProtocol();
    case 'xiaomi-t2336':
      return newT2336();
    default:
      return new GenericBleProtocol();
  }
};

export const PROTOCOL_LABELS: Record<ProtocolId, string> = {
  'xiaomi-m365': 'Xiaomi M365 (55AA)',
  'ninebot-es': 'Ninebot ES (5AA5)',
  'xiaomi-t2336': 'Xiaomi encrypted (securitychip)',
  'generic-ble': 'Generic BLE',
};

export interface DetectionResult {
  protocol: ScooterProtocol;
  note: string;
  /** Something the user must do to get data (shown as a card with a button). */
  action?: 'xiaomi-key';
}

/**
 * Xiaomi "securitychip" scooters (FE95 service with the login/SPEC characteristics).
 * The 4 Pro 2nd Gen (product id 0x403D) has a built-in documented property map; other
 * Xiaomi models use the property list from Xiaomi's official MIoT spec, loaded once
 * during key setup, and are marked experimental.
 */
async function detectXiaomiSecure(transport: BleTransport, preferred?: ProtocolId | null, previous?: ProtocolId | null, advertisedName?: string | null): Promise<DetectionResult | null> {
  if (!XiaomiT2336Protocol.matches(transport)) {
    if (transport.hasService(XIAOMI_SEC.SERVICE) || /^xiaomi\.scooter\./i.test(advertisedName ?? '')) {
      const missing = [XIAOMI_SEC.CONTROL, XIAOMI_SEC.LOGIN, XIAOMI_SEC.SPEC_WRITE, XIAOMI_SEC.SPEC_NOTIFY].filter((c) => !transport.hasCharacteristic(XIAOMI_SEC.SERVICE, c));
      transport.log('error', `Xiaomi scooter seen but securitychip characteristics missing: ${missing.map((c) => c.slice(4, 8)).join(', ')}`);
    }
    return null;
  }
  const pid = miBeaconProductId(transport) ?? pidFromXiaomiName(advertisedName);
  const pidText = pid !== null ? `0x${pid.toString(16).toUpperCase().padStart(4, '0')}` : 'not seen';
  transport.log('info', `Xiaomi securitychip service found, product id ${pidText}`);
  const p = newT2336(pid);
  await p.connect(transport);
  const known = pid !== null ? XIAOMI_SCOOTER_PIDS[pid] : undefined;
  const how = known ? `product id ${pidText}` : preferred === 'xiaomi-t2336' ? 'your manual model choice' : previous === 'xiaomi-t2336' ? 'the last connection' : 'its Xiaomi encrypted Bluetooth service';
  const base = known || p.status === 'ok' ? `Xiaomi ${p.modelName} recognised from ${how}.` : `Xiaomi scooter with encrypted Bluetooth recognised (product id ${pidText}).`;
  if (p.status === 'ok') return { protocol: p, note: `${base} ${p.statusMessage}` };
  return { protocol: p, note: `${base} ${p.statusMessage}`, action: 'xiaomi-key' };
}

/**
 * Detection uses read-only requests.
 * 1. If the device exposes the Nordic UART Service, try one documented
 *    register read (ESC firmware version, reg 0x1A) in each framing.
 * 2. Otherwise, or if nothing answers, fall back to the generic adapter.
 * `preferred` (from a manual model selection) is tried first.
 */
export async function detectProtocol(transport: BleTransport, preferred?: ProtocolId | null, advertisedName?: string | null, previous?: ProtocolId | null): Promise<DetectionResult> {
  if (preferred === 'generic-ble' && !XiaomiT2336Protocol.matches(transport)) {
    const g = new GenericBleProtocol();
    await g.connect(transport);
    return { protocol: g, note: 'Generic profile selected manually.' };
  }
  const hasNus = transport.hasCharacteristic(UUID.NUS_SERVICE, UUID.NUS_TX_NOTIFY) && transport.hasCharacteristic(UUID.NUS_SERVICE, UUID.NUS_RX_WRITE);
  // The 4 Pro 2nd Gen has no Nordic UART service; scooters with both try the open protocols first.
  if (!hasNus || preferred === 'xiaomi-t2336') {
    const x = await detectXiaomiSecure(transport, preferred, previous, advertisedName);
    if (x) return x;
  }
  if (hasNus) {
    // Xiaomi first unless the user picked a Ninebot model. The "MIScooter" name prefix
    // (CamiAlfa capture) is only a hint recorded in the log, never proof of the model.
    const order: ProtocolId[] = preferred === 'ninebot-es' ? ['ninebot-es', 'xiaomi-m365'] : ['xiaomi-m365', 'ninebot-es'];
    if (/^MIScooter/i.test(advertisedName ?? '')) transport.log('info', 'Advertised name matches the Xiaomi "MIScooter" pattern');
    for (const id of order) {
      const p = createProtocol(id) as M365Protocol | NinebotProtocol;
      await p.connect(transport);
      transport.log('info', `Probing ${p.name}`);
      if (await p.probe()) return { protocol: p, note: `${p.name} answered a register read.` };
      await p.disconnect();
    }
    const x = await detectXiaomiSecure(transport, preferred, previous, advertisedName);
    if (x) return x;
    const g = new GenericBleProtocol();
    await g.connect(transport);
    return {
      protocol: g,
      note: 'Nordic UART service found but no documented protocol answered. The scooter probably uses newer encrypted Bluetooth firmware. Scooter Hub can only read encrypted models whose protocol is publicly documented (Xiaomi securitychip scooters such as the 4 Pro 2nd Gen).',
    };
  }
  if (transport.hasService(NAVEE_SERVICE) || /^NAVEE/i.test(advertisedName ?? '')) {
    const g = new GenericBleProtocol();
    await g.connect(transport);
    return {
      protocol: g,
      note: 'NAVEE scooter recognised. Not supported yet: NAVEE scooters only share data after a login that uses secret keys hidden inside the NAVEE app. Those keys were only published by people who took the app apart, not by NAVEE, so Scooter Hub does not use them.',
    };
  }
  const g = new GenericBleProtocol();
  await g.connect(transport);
  return { protocol: g, note: 'No known scooter protocol service found. Showing standard BLE data only. If this is a scooter, its Bluetooth protocol is not publicly documented yet.' };
}
