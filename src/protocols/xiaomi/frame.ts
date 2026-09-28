/**
 * Xiaomi M365 "55 AA" frame codec.
 *
 * Source: etransport/ninebot-docs wiki, "protocol" page
 *   https://github.com/etransport/ninebot-docs/wiki/protocol
 *   55 AA bLen bAddr bCmd bArg bPayload[bLen-2] wChecksumLE
 *   bLen = payload length + 2; checksum = 0xFFFF xor (16-bit sum of bLen..payload), little-endian.
 *   bAddr: 0x20 request->ESC, 0x21 ->BLE, 0x22 ->BMS, 0x23 ESC reply, 0x24 BLE reply, 0x25 BMS reply.
 *   Read registers: bCmd 0x01, bArg = register (16-bit word index), payload [byte count]; reply bCmd 0x01.
 * Cross-checked against captured frames in CamiAlfa/M365-BLE-PROTOCOL, e.g.
 *   request "55AA 03 20 01 1A 02 BF FF" (read ESC firmware version).
 *   https://github.com/CamiAlfa/M365-BLE-PROTOCOL/blob/master/protocolo
 */

export const M365_ADDR = {
  TO_ESC: 0x20,
  TO_BLE: 0x21,
  TO_BMS: 0x22,
  FROM_ESC: 0x23,
  FROM_BLE: 0x24,
  FROM_BMS: 0x25,
} as const;

export const M365_CMD = {
  READ: 0x01,
  /** Write without response. Used by the Mi Home app for cruise/tail light/KERS (CamiAlfa captures). */
  WRITE_NO_RESPONSE: 0x03,
} as const;

export interface M365Frame {
  addr: number;
  cmd: number;
  arg: number;
  payload: Uint8Array;
}

export function checksum16(bytes: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < bytes.length; i++) s += bytes[i];
  return (s & 0xffff) ^ 0xffff;
}

export function encodeM365(addr: number, cmd: number, arg: number, payload: ArrayLike<number> = []): Uint8Array {
  const body = [payload.length + 2, addr, cmd, arg, ...Array.from(payload)];
  const ck = checksum16(body);
  return Uint8Array.from([0x55, 0xaa, ...body, ck & 0xff, (ck >> 8) & 0xff]);
}

export const m365ReadRequest = (target: 'esc' | 'bms', register: number, byteCount: number) =>
  encodeM365(target === 'esc' ? M365_ADDR.TO_ESC : M365_ADDR.TO_BMS, M365_CMD.READ, register, [byteCount]);

/**
 * Streaming decoder: BLE notifications can split or merge frames, so bytes are
 * buffered and complete, checksum-valid frames are emitted.
 */
export class M365FrameParser {
  private buf: number[] = [];
  push(chunk: Uint8Array): M365Frame[] {
    this.buf.push(...Array.from(chunk));
    const frames: M365Frame[] = [];
    for (;;) {
      const start = this.findHeader();
      if (start < 0) {
        // keep a trailing 0x55 in case the header is split
        this.buf = this.buf.length && this.buf[this.buf.length - 1] === 0x55 ? [0x55] : [];
        break;
      }
      if (start > 0) this.buf.splice(0, start);
      if (this.buf.length < 3) break;
      const len = this.buf[2];
      // Layout: 55 AA len addr cmd arg payload[len-2] ckL ckH => 2 + 1 + 1 + len + 2
      const frameLen = 2 + 1 + 1 + len + 2;
      if (this.buf.length < frameLen) break;
      const raw = this.buf.slice(0, frameLen);
      const body = raw.slice(2, frameLen - 2);
      const ck = raw[frameLen - 2] | (raw[frameLen - 1] << 8);
      if (checksum16(body) === ck && len >= 2) {
        frames.push({ addr: raw[3], cmd: raw[4], arg: raw[5], payload: Uint8Array.from(raw.slice(6, frameLen - 2)) });
        this.buf.splice(0, frameLen);
      } else {
        this.buf.splice(0, 1); // resync
      }
    }
    return frames;
  }
  private findHeader(): number {
    for (let i = 0; i < this.buf.length - 1; i++) if (this.buf[i] === 0x55 && this.buf[i + 1] === 0xaa) return i;
    return -1;
  }
  reset() {
    this.buf = [];
  }
}
