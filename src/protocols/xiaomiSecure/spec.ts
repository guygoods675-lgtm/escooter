/**
 * MIoT SPEC frames and the t2336 property map.
 *
 * Source (MIT): https://github.com/mehesbalazs/xiaomi-scooter-4-pro-2/blob/main/docs/protocol.md
 * ("4. Encrypted SPEC channel" and "5. Property map"), and scooter.py build_get/parse_get_value/decode_prop.
 *
 *   frame = [len | 0x2000 : u16 LE][tid : u16 LE][op : u8][count = 1 : u8] body
 *   GET (t2336): op = 2, body [siid u8, piid u16 LE]; reply op = 3,
 *     body [siid, piid u16, status u16, type/length u16, value]; status 0 = OK; value length = tl & 0x0FFF.
 *   FLOAT values are float32 LE sent x100 (scale 0.01).
 *
 * Only GET is implemented. Scooter Hub never sends SET on this channel.
 */

export const T2336_OP_GET = 2;

export function buildGet(siid: number, piid: number, tid: number, op = T2336_OP_GET): Uint8Array {
  const body = [siid & 0xff, piid & 0xff, (piid >> 8) & 0xff];
  const lenflag = ((6 + body.length) | 0x2000) & 0xffff;
  return Uint8Array.from([lenflag & 0xff, lenflag >> 8, tid & 0xff, (tid >> 8) & 0xff, op, 1, ...body]);
}

/** Returns the raw property value bytes, or null if the reply is short or status != 0. */
export function parseGetValue(pt: Uint8Array | null): Uint8Array | null {
  if (!pt || pt.length < 13) return null;
  const status = pt[9] | (pt[10] << 8);
  if (status !== 0) return null;
  const vlen = (pt[11] | (pt[12] << 8)) & 0x0fff;
  return pt.length >= 13 + vlen ? pt.slice(13, 13 + vlen) : null;
}

export type PropKind = 'u8' | 'u16' | 'i8' | 'f' | 'bool' | 'str';

export function decodeProp(raw: Uint8Array | null, kind: PropKind, scale = 1): number | string | null {
  if (!raw || raw.length === 0) return null;
  switch (kind) {
    case 'str': {
      let s = '';
      for (const b of raw) if (b) s += String.fromCharCode(b >= 32 && b < 127 ? b : 0x3f);
      return s;
    }
    case 'i8':
      return (raw[0] >= 128 ? raw[0] - 256 : raw[0]) * scale;
    case 'f':
      return raw.length === 4 ? new DataView(raw.buffer, raw.byteOffset, 4).getFloat32(0, true) * scale : null;
    default: {
      let v = 0;
      for (let i = raw.length - 1; i >= 0; i--) v = v * 256 + raw[i];
      return v * scale;
    }
  }
}

export interface PropDef {
  siid: number;
  piid: number;
  kind: PropKind;
  scale: number;
}
const P = (siid: number, piid: number, kind: PropKind, scale = 1): PropDef => ({ siid, piid, kind, scale });

/** t2336 properties used by Scooter Hub (names from the property map in docs/protocol.md). */
export const T2336 = {
  RIDING_MODE: P(1, 1, 'u8'),
  BATTERY_LEVEL: P(1, 2, 'u8'), // %
  REMAINING_BATTERY: P(1, 3, 'u16'), // mAh
  VOLTAGE: P(1, 4, 'f', 0.01), // V
  CURRENT: P(1, 5, 'f', 0.01), // A
  POWER: P(1, 6, 'f', 0.01), // W
  REMAINING_MILEAGE: P(1, 7, 'f', 0.01), // km
  FAULT: P(1, 8, 'u8'),
  CURRENT_MILEAGE: P(1, 9, 'f', 0.01), // km, current trip
  AVERAGE_SPEED: P(2, 1, 'f', 0.01), // km/h
  CRUISE_IS_ON: P(2, 3, 'bool'),
  TAIL_LIGHT_IS_ON: P(2, 4, 'bool'),
  ENERGY_RECOVERY: P(2, 5, 'u8'),
  TOTAL_MILEAGE: P(2, 6, 'f', 0.01), // km
  RIDING_TIME: P(2, 8, 'f', 1), // s, current trip
  HIGHEST_SPEED: P(2, 9, 'f', 0.01), // km/h
  BATTERY_TEMPERATURE: P(3, 2, 'i8'), // °C
  SCOOTER_TEMPERATURE: P(3, 3, 'i8'), // °C
  IS_CHARGING: P(3, 10, 'bool'),
  NUMBER_OF_CYCLES: P(3, 11, 'u8'),
  SOH: P(3, 12, 'u8'), // %
  BATTERY_SN: P(4, 2, 'str'),
  BMS_FIRMWARE_VERSION: P(4, 3, 'str'),
  SCOOTER_SN: P(4, 4, 'str'),
  FIRMWARE_VERSION: P(4, 5, 'str'),
} as const;
