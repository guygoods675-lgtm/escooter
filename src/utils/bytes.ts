// Byte helpers. react-native-ble-plx exchanges characteristic values as base64
// strings, and React Native has no Buffer, so we keep a tiny codec here.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP: Record<string, number> = {};
for (let i = 0; i < B64.length; i++) B64_LOOKUP[B64[i]] = i;

export function base64ToBytes(b64: string | null | undefined): Uint8Array {
  if (!b64) return new Uint8Array(0);
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64_LOOKUP[clean[i]] ?? 0;
    const b = B64_LOOKUP[clean[i + 1]] ?? 0;
    const c = clean[i + 2] !== undefined ? B64_LOOKUP[clean[i + 2]] : undefined;
    const d = clean[i + 3] !== undefined ? B64_LOOKUP[clean[i + 3]] : undefined;
    out.push(((a << 2) | (b >> 4)) & 0xff);
    if (c !== undefined) out.push((((b & 0x0f) << 4) | (c >> 2)) & 0xff);
    if (d !== undefined && c !== undefined) out.push((((c & 0x03) << 6) | d) & 0xff);
  }
  return Uint8Array.from(out);
}

export function bytesToBase64(bytes: Uint8Array | number[]): string {
  let out = '';
  const arr = Array.from(bytes);
  for (let i = 0; i < arr.length; i += 3) {
    const a = arr[i];
    const b = arr[i + 1];
    const c = arr[i + 2];
    out += B64[a >> 2];
    out += B64[((a & 0x03) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? '=' : B64[((b & 0x0f) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : B64[c & 0x3f];
  }
  return out;
}

export function toHex(bytes: Uint8Array | number[], sep = ' '): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(sep);
}

export function hexToBytes(hex: string): Uint8Array | null {
  const clean = hex.replace(/0x/gi, '').replace(/[\s:,-]/g, '');
  if (clean.length === 0 || clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

export function u16le(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8);
}
export function s16le(b: Uint8Array, o: number): number {
  const v = u16le(b, o);
  return v & 0x8000 ? v - 0x10000 : v;
}
export function u32le(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;
}
export function s32le(b: Uint8Array, o: number): number {
  const v = u32le(b, o);
  return v >= 0x80000000 ? v - 0x100000000 : v;
}

export function asciiFrom(b: Uint8Array): string {
  let s = '';
  for (const c of b) {
    if (c === 0) break;
    s += c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '';
  }
  return s.trim();
}

export function utf8Decode(b: Uint8Array): string {
  try {
    // TextDecoder exists in Hermes on current React Native versions.
    return new TextDecoder('utf-8').decode(b).replace(/\0+$/, '').trim();
  } catch {
    return asciiFrom(b);
  }
}
