import { UUID } from '../ble/uuids';
import type { ProtocolId } from '../data/scooterDatabase';
import { GenericBleProtocol } from './generic/GenericBleProtocol';
import { NinebotProtocol } from './ninebot/NinebotProtocol';
import type { BleTransport, ScooterProtocol } from './types';
import { M365Protocol } from './xiaomi/M365Protocol';

export const createProtocol = (id: ProtocolId): ScooterProtocol => {
  switch (id) {
    case 'xiaomi-m365':
      return new M365Protocol();
    case 'ninebot-es':
      return new NinebotProtocol();
    default:
      return new GenericBleProtocol();
  }
};

export const PROTOCOL_LABELS: Record<ProtocolId, string> = {
  'xiaomi-m365': 'Xiaomi M365 (55AA)',
  'ninebot-es': 'Ninebot ES (5AA5)',
  'generic-ble': 'Generic BLE',
};

export interface DetectionResult {
  protocol: ScooterProtocol;
  note: string;
}

/**
 * Detection uses read-only requests.
 * 1. If the device exposes the Nordic UART Service, try one documented
 *    register read (ESC firmware version, reg 0x1A) in each framing.
 * 2. Otherwise, or if nothing answers, fall back to the generic adapter.
 * `preferred` (from a manual model selection) is tried first.
 */
export async function detectProtocol(transport: BleTransport, preferred?: ProtocolId | null, advertisedName?: string | null): Promise<DetectionResult> {
  if (preferred === 'generic-ble') {
    const g = new GenericBleProtocol();
    await g.connect(transport);
    return { protocol: g, note: 'Generic profile selected manually.' };
  }
  if (transport.hasCharacteristic(UUID.NUS_SERVICE, UUID.NUS_TX_NOTIFY) && transport.hasCharacteristic(UUID.NUS_SERVICE, UUID.NUS_RX_WRITE)) {
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
    const g = new GenericBleProtocol();
    await g.connect(transport);
    return {
      protocol: g,
      note: 'Nordic UART service found but no documented protocol answered. The scooter may use encrypted BLE firmware, which Scooter Hub does not support.',
    };
  }
  const g = new GenericBleProtocol();
  await g.connect(transport);
  return { protocol: g, note: 'No known scooter protocol service found. Showing standard BLE data only.' };
}
