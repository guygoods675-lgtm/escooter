/**
 * MIoT SPEC frames and property maps for Xiaomi "securitychip" scooters.
 *
 * Frame layout and value types:
 *   https://github.com/mehesbalazs/xiaomi-scooter-4-pro-2/blob/main/docs/protocol.md (MIT; t2336)
 *   https://github.com/KuziaMother/SCOOTER_5_PRO/blob/main/docs/BLE.md (Scooter 5 Pro)
 *
 *   frame = [len | 0x2000 : u16 LE][tid : u16 LE][op : u8][count = 1 : u8] body
 *   GET: op = 2, body [siid u8, piid u16 LE]; reply op = 3 (same on t2336 and 5 Pro),
 *     body [siid, piid u16, status u16, (type << 12 | length) u16, value]; status 0 = OK.
 *   Value types (5 Pro BLE.md "SpecValueType"): BOOL=0 UINT8=1 INT8=2 UINT16=3 INT16=4
 *     UINT32=5 INT32=6 UINT64=7 INT64=8 FLOAT=9 STRING=10.
 *   FLOAT telemetry is sent x100 (t2336 property map "All FLOAT values are sent x100";
 *   the 5 Pro voltage example 1168572416 = float 5344.0 = 53.44 V), riding time is not.
 *   The device answers only the first object per request: read one property at a time.
 *
 * Only GET is implemented. Scooter Hub never sends SET or ACTION on this channel.
 */

export const OP_GET = 2;

export function buildGet(siid: number, piid: number, tid: number, op = OP_GET): Uint8Array {
  const body = [siid & 0xff, piid & 0xff, (piid >> 8) & 0xff];
  const lenflag = ((6 + body.length) | 0x2000) & 0xffff;
  return Uint8Array.from([lenflag & 0xff, lenflag >> 8, tid & 0xff, (tid >> 8) & 0xff, op, 1, ...body]);
}

export interface SpecValue {
  type: number;
  bytes: Uint8Array;
}

/** Returns the raw value and its wire type, or null if the reply is short or status != 0. */
export function parseGetReply(pt: Uint8Array | null): SpecValue | null {
  if (!pt || pt.length < 13) return null;
  const status = pt[9] | (pt[10] << 8);
  if (status !== 0) return null;
  const tl = pt[11] | (pt[12] << 8);
  const vlen = tl & 0x0fff;
  return pt.length >= 13 + vlen ? { type: tl >> 12, bytes: pt.slice(13, 13 + vlen) } : null;
}

/** Raw value bytes only (kept for callers that do not need the type). */
export const parseGetValue = (pt: Uint8Array | null) => parseGetReply(pt)?.bytes ?? null;

export type PropKind = 'u8' | 'u16' | 'i8' | 'f' | 'bool' | 'str';

const WIRE_KIND: Record<number, PropKind | 'i16' | 'u32' | 'i32'> = { 0: 'bool', 1: 'u8', 2: 'i8', 3: 'u16', 4: 'i16', 5: 'u32', 6: 'i32', 9: 'f', 10: 'str' };

/** Decodes by the wire type when the reply carries a known one, else by the expected kind. */
export function decodeSpecValue(v: SpecValue | null, expected: PropKind, scale = 1): number | string | null {
  if (!v || v.bytes.length === 0) return null;
  const WIRE_LEN: Record<string, number> = { bool: 1, u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4, f: 4 };
  const wire = WIRE_KIND[v.type];
  // Trust the wire type only when its size matches the value length.
  const kind = wire && (wire === 'str' || WIRE_LEN[wire] === v.bytes.length) ? wire : expected;
  const b = v.bytes;
  const dv = new DataView(b.buffer, b.byteOffset, b.length);
  switch (kind) {
    case 'str': {
      let s = '';
      for (const x of b) if (x) s += String.fromCharCode(x >= 32 && x < 127 ? x : 0x3f);
      return s;
    }
    case 'f':
      return b.length === 4 ? dv.getFloat32(0, true) * scale : null;
    case 'i8':
      return dv.getInt8(0);
    case 'i16':
      return b.length >= 2 ? dv.getInt16(0, true) : null;
    case 'i32':
      return b.length >= 4 ? dv.getInt32(0, true) : null;
    default: {
      let x = 0;
      for (let i = b.length - 1; i >= 0; i--) x = x * 256 + b[i];
      return x;
    }
  }
}

/** Legacy helper: decode raw bytes with an expected kind (FLOAT scaled). */
export function decodeProp(raw: Uint8Array | null, kind: PropKind, scale = 1): number | string | null {
  return decodeSpecValue(raw ? { type: -1, bytes: raw } : null, kind, scale);
}

/** Values Scooter Hub knows how to show. */
export type SpecField =
  | 'batteryLevel' | 'remainingMah' | 'voltage' | 'current' | 'power' | 'range' | 'fault' | 'tripKm'
  | 'avgSpeed' | 'speed' | 'cruise' | 'tailLight' | 'regen' | 'totalKm' | 'ridingTime' | 'topSpeed'
  | 'batteryTemp' | 'scooterTemp' | 'charging' | 'cycles' | 'soh' | 'ridingMode'
  | 'batterySn' | 'bmsFirmware' | 'scooterSn' | 'firmware';

export interface PropDef {
  siid: number;
  piid: number;
  kind: PropKind;
  scale: number;
  /** value -> label, from the official spec's value-list (e.g. riding modes) */
  values?: Record<number, string>;
}

export type PropMap = Partial<Record<SpecField, PropDef>>;

const P = (siid: number, piid: number, kind: PropKind, scale = 1): PropDef => ({ siid, piid, kind, scale });

/** Xiaomi Electric Scooter 4 Pro (2nd Gen), t2336: property map from docs/protocol.md (mehesbalazs, MIT). */
export const T2336_MAP: PropMap = {
  ridingMode: P(1, 1, 'u8'),
  batteryLevel: P(1, 2, 'u8'),
  remainingMah: P(1, 3, 'u16'),
  voltage: P(1, 4, 'f', 0.01),
  current: P(1, 5, 'f', 0.01),
  power: P(1, 6, 'f', 0.01),
  range: P(1, 7, 'f', 0.01),
  fault: P(1, 8, 'u8'),
  tripKm: P(1, 9, 'f', 0.01),
  avgSpeed: P(2, 1, 'f', 0.01),
  cruise: P(2, 3, 'bool'),
  tailLight: P(2, 4, 'bool'),
  regen: P(2, 5, 'u8'),
  totalKm: P(2, 6, 'f', 0.01),
  ridingTime: P(2, 8, 'f', 1),
  topSpeed: P(2, 9, 'f', 0.01),
  batteryTemp: P(3, 2, 'i8'),
  scooterTemp: P(3, 3, 'i8'),
  charging: P(3, 10, 'bool'),
  cycles: P(3, 11, 'u8'),
  soh: P(3, 12, 'u8'),
  batterySn: P(4, 2, 'str'),
  bmsFirmware: P(4, 3, 'str'),
  scooterSn: P(4, 4, 'str'),
  firmware: P(4, 5, 'str'),
};
/** Back-compat name used by older code and tests. */
export const T2336 = {
  RIDING_MODE: T2336_MAP.ridingMode!,
  BATTERY_LEVEL: T2336_MAP.batteryLevel!,
  VOLTAGE: T2336_MAP.voltage!,
  FIRMWARE_VERSION: T2336_MAP.firmware!,
} as const;

/**
 * Property names in Xiaomi's official MIoT spec (the <name> part of the property type
 * "urn:<ns>:property:<name>:<id>:<model>:<ver>") mapped to Scooter Hub fields. The t2336
 * names (docs/protocol.md "Property map") are the reference; a field is only filled when
 * the scooter's own official spec has a readable property with exactly one of these names.
 */
const SPEC_NAMES: Record<SpecField, string[]> = {
  batteryLevel: ['battery-level'],
  remainingMah: ['remaining-battery'],
  voltage: ['voltage'],
  current: ['current', 'electric-current'],
  power: ['power'],
  range: ['remaining-mileage'],
  fault: ['fault'],
  tripKm: ['current-mileage'],
  avgSpeed: ['average-speed'],
  speed: ['speed', 'current-speed', 'real-time-speed', 'riding-speed', 'vehicle-speed'],
  cruise: ['cruise-is-on'],
  tailLight: ['tail-light-is-on'],
  regen: ['energy-recovery'],
  totalKm: ['total-mileage'],
  ridingTime: ['riding-time'],
  topSpeed: ['highest-speed'],
  batteryTemp: ['battery-temperature'],
  scooterTemp: ['scooter-temperature'],
  charging: ['is-charging'],
  cycles: ['number-of-cycles'],
  soh: ['soh'],
  ridingMode: ['riding-mode'],
  batterySn: ['battery-sn'],
  bmsFirmware: ['bms-firmware-version'],
  scooterSn: ['scooter-sn'],
  firmware: ['firmware-version'],
};
/** FLOAT fields sent x100 on the documented models; riding time is plain seconds. */
const X100 = new Set<SpecField>(['voltage', 'current', 'power', 'range', 'tripKm', 'avgSpeed', 'speed', 'totalKm', 'topSpeed']);

const FORMAT_KIND: Record<string, PropKind> = { bool: 'bool', uint8: 'u8', int8: 'i8', uint16: 'u16', int16: 'u16', uint32: 'u16', int32: 'u16', float: 'f', string: 'str' };

interface MiotSpecJson {
  services?: { iid: number; properties?: { iid: number; type: string; format?: string; access?: string[]; 'value-list'?: { value: number; description: string }[] }[] }[];
}

/** Builds a property map from a device's official MIoT spec JSON (miot-spec.org instance). */
export function mapFromMiotSpec(spec: MiotSpecJson): PropMap {
  const byName = new Map<string, { siid: number; piid: number; format: string; values?: Record<number, string> }>();
  for (const s of spec.services ?? []) {
    for (const p of s.properties ?? []) {
      if (!p.access?.includes('read')) continue;
      const name = p.type?.split(':')[3];
      if (!name || byName.has(name)) continue;
      const values = p['value-list']?.length ? Object.fromEntries(p['value-list'].map((v) => [v.value, v.description])) : undefined;
      byName.set(name, { siid: s.iid, piid: p.iid, format: p.format ?? '', values });
    }
  }
  const map: PropMap = {};
  for (const field of Object.keys(SPEC_NAMES) as SpecField[]) {
    const hit = SPEC_NAMES[field].map((n) => byName.get(n)).find(Boolean);
    if (!hit) continue;
    const kind = FORMAT_KIND[hit.format] ?? 'u16';
    map[field] = { siid: hit.siid, piid: hit.piid, kind, scale: kind === 'f' && X100.has(field) ? 0.01 : 1, values: hit.values };
  }
  return map;
}
