/**
 * Ninebot "5A A5" frame codec (Ninebot ES series).
 *
 * Source: etransport/ninebot-docs wiki, "protocol" page
 *   https://github.com/etransport/ninebot-docs/wiki/protocol
 *   5A A5 bLen bSrcAddr bDstAddr bCmd bArg bPayload[bLen] wChecksumLE, bLen = payload length.
 *   Addresses: 0x20 ESC, 0x21 BLE, 0x22 BMS, 0x23 external BMS, 0x3D-0x3F application.
 *   Read registers: bCmd 0x01, payload [byte count]; Ninebot replies with bCmd 0x04.
 * Checksum: the wiki text lists <bSrcAddr..payload>, but the reference implementation
 * by the same authors includes bLen in the sum (checksum(pkt) where pkt starts with bLen):
 *   https://github.com/etransport/py9b/blob/master/py9b/transport/ninebot.py
 * We follow the implementation. Host address 0x3E is from py9b/transport/base.py (HOST = 0x3E).
 */

import { checksum16 } from '../xiaomi/frame';

export const NB_ADDR = { ESC: 0x20, BLE: 0x21, BMS: 0x22, EXT_BMS: 0x23, HOST: 0x3e } as const;
export const NB_CMD = { READ: 0x01, READ_REPLY: 0x04 } as const;

export interface NinebotFrame {
  src: number;
  dst: number;
  cmd: number;
  arg: number;
  payload: Uint8Array;
}

export function encodeNinebot(src: number, dst: number, cmd: number, arg: number, payload: ArrayLike<number> = []): Uint8Array {
  const body = [payload.length, src, dst, cmd, arg, ...Array.from(payload)];
  const ck = checksum16(body);
  return Uint8Array.from([0x5a, 0xa5, ...body, ck & 0xff, (ck >> 8) & 0xff]);
}

export const ninebotReadRequest = (target: 'esc' | 'bms', register: number, byteCount: number) =>
  encodeNinebot(NB_ADDR.HOST, target === 'esc' ? NB_ADDR.ESC : NB_ADDR.BMS, NB_CMD.READ, register, [byteCount]);

export class NinebotFrameParser {
  private buf: number[] = [];
  push(chunk: Uint8Array): NinebotFrame[] {
    this.buf.push(...Array.from(chunk));
    const frames: NinebotFrame[] = [];
    for (;;) {
      const start = this.findHeader();
      if (start < 0) {
        this.buf = this.buf.length && this.buf[this.buf.length - 1] === 0x5a ? [0x5a] : [];
        break;
      }
      if (start > 0) this.buf.splice(0, start);
      if (this.buf.length < 3) break;
      const len = this.buf[2];
      // 5A A5 len src dst cmd arg payload[len] ckL ckH
      const frameLen = 2 + 5 + len + 2;
      if (this.buf.length < frameLen) break;
      const raw = this.buf.slice(0, frameLen);
      const ck = raw[frameLen - 2] | (raw[frameLen - 1] << 8);
      if (checksum16(raw.slice(2, frameLen - 2)) === ck) {
        frames.push({ src: raw[3], dst: raw[4], cmd: raw[5], arg: raw[6], payload: Uint8Array.from(raw.slice(7, frameLen - 2)) });
        this.buf.splice(0, frameLen);
      } else {
        this.buf.splice(0, 1);
      }
    }
    return frames;
  }
  private findHeader(): number {
    for (let i = 0; i < this.buf.length - 1; i++) if (this.buf[i] === 0x5a && this.buf[i + 1] === 0xa5) return i;
    return -1;
  }
  reset() {
    this.buf = [];
  }
}
