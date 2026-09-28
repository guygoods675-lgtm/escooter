/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hexToBytes, toHex } from '../../utils/bytes';
import { nibbleVersion } from '../UartRegisterProtocol';
import type { BleTransport } from '../types';
import { M365FrameParser, encodeM365, m365ReadRequest } from '../xiaomi/frame';
import { M365Protocol } from '../xiaomi/M365Protocol';

// Frames below are copied from CamiAlfa/M365-BLE-PROTOCOL "protocolo" captures.
const h = (s: string) => hexToBytes(s)!;

test('encodes read requests exactly as captured from Mi Home', () => {
  assert.equal(toHex(m365ReadRequest('esc', 0x1a, 2)), toHex(h('55AA 03 2001 1A 02 BFFF')));
  assert.equal(toHex(m365ReadRequest('esc', 0xb0, 0x20)), toHex(h('55aa 03 2001 b0 20 0bff')));
  assert.equal(toHex(m365ReadRequest('esc', 0x10, 0x0e)), toHex(h('55aa 03 2001 10 0e bdff')));
  assert.equal(toHex(m365ReadRequest('bms', 0x31, 0x0a)), toHex(h('55aa 03 2201 31 0a 9eff')));
});

test('encodes documented writes exactly as captured (tail light, cruise)', () => {
  assert.equal(toHex(encodeM365(0x20, 0x03, 0x7d, [0x02, 0x00])), toHex(h('55aa 04 2003 7d 0200 59ff')));
  assert.equal(toHex(encodeM365(0x20, 0x03, 0x7c, [0x01, 0x00])), toHex(h('55aa 04 2003 7c 0100 5bff')));
});

test('parses split and merged notifications', () => {
  const p = new M365FrameParser();
  const frame = h('55aa 04 2301 1a 3401 88ff');
  assert.deepEqual(p.push(frame.slice(0, 4)), []);
  const out = p.push(Uint8Array.from([...frame.slice(4), ...frame]));
  assert.equal(out.length, 2);
  assert.equal(out[0].arg, 0x1a);
  assert.equal(nibbleVersion(out[0].payload[0] | (out[0].payload[1] << 8)), '1.3.4');
});

test('rejects frames with a bad checksum', () => {
  const p = new M365FrameParser();
  assert.deepEqual(p.push(h('55aa 04 2301 1a 3401 00ff')), []);
});

/** Fake transport that answers reads with captured reply frames. */
function fakeTransport(replies: Record<string, string>): BleTransport {
  let listener: ((d: Uint8Array) => void) | null = null;
  return {
    deviceId: 'test',
    hasService: () => true,
    hasCharacteristic: () => true,
    read: async () => new Uint8Array(),
    async write(_s, _c, data) {
      const key = toHex(data).replace(/ /g, '');
      const r = replies[key];
      if (r) setTimeout(() => listener?.(h(r)), 1);
    },
    subscribe(_s, _c, cb) {
      listener = cb;
      return () => (listener = null);
    },
    log: () => undefined,
  };
}

test('decodes live telemetry from captured replies', async () => {
  const t = fakeTransport({
    '55AA032001B0200BFF':
      '55aa 22 2301 b0 0000 0000 0000 0000 3d00 0000 5046 8a08 0000 0500 7c02 1801 0000 0000 0000 0000 08fd',
    '55AA0320012502B4FF': '55aa 04 2301 25 2607 85ff',
    // The app asks for 2 bytes (Mi Home asked for 4); the captured 4-byte reply still decodes.
    '55AA0320013A029FFF': '55aa 06 2301 3a 7b02 0a00 14ff',
    '55AA032201310A9EFF': '55aa 0c 2501 31 361e 6300 0100 0910 3131 69fe',
  });
  const p = new M365Protocol();
  await p.connect(t);
  const s = await p.poll();
  assert.equal(s.batteryPercent?.value, 61); // 0x3d
  assert.equal(s.speedKmh?.value, 0);
  assert.equal(s.averageSpeedKmh?.value, 18); // 0x4650 m/h
  assert.equal(s.odometerKm?.value, 2.186); // 0x088a m
  assert.equal(s.controllerTempC?.value, 28); // 0x0118 / 10
  assert.equal(s.rangeKm?.value, 18.3); // 0x0726 / 100
  assert.equal(s.tripTimeSec?.value, 635); // 0x027b
  assert.equal(s.batteryVoltage?.value, 41.05); // 0x1009 x10mV
  assert.equal(s.batteryCurrent?.value, 0.01);
  assert.equal(s.batteryTempC?.value, 29); // 0x31 - 20
  assert.equal(s.errorCode?.value, 0);
  assert.equal(s.powerW?.source, 'calculated');
  // Unanswered registers stay unavailable instead of being guessed.
  assert.equal(s.cruiseControl, null);
  assert.equal(s.motorTempC, null);
  assert.equal(s.motorRpm, null);
  await p.disconnect();
});

test('rejects undocumented commands', async () => {
  const p = new M365Protocol();
  await assert.rejects(() => p.sendCommand('speedLimit', 1));
  await assert.rejects(() => p.sendCommand('tailLight', 7));
});
