/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toHex } from '../../utils/bytes';
import { NinebotFrameParser, encodeNinebot, ninebotReadRequest } from '../ninebot/frame';
import { checkRawWrite } from '../writeGuard';
import { encodeM365 } from '../xiaomi/frame';

test('ninebot read request layout and checksum include bLen (py9b)', () => {
  const f = ninebotReadRequest('esc', 0x1a, 2);
  // 5A A5 len src dst cmd arg payload ck
  assert.equal(toHex(f.slice(0, 8)), '5A A5 01 3E 20 01 1A 02');
  const sum = 0x01 + 0x3e + 0x20 + 0x01 + 0x1a + 0x02;
  const ck = (sum & 0xffff) ^ 0xffff;
  assert.equal(f[8], ck & 0xff);
  assert.equal(f[9], ck >> 8);
});

test('ninebot parser round-trips a reply', () => {
  const reply = encodeNinebot(0x20, 0x3e, 0x04, 0x1a, [0x34, 0x01]);
  const p = new NinebotFrameParser();
  const [fr] = p.push(reply);
  assert.equal(fr.src, 0x20);
  assert.equal(fr.cmd, 0x04);
  assert.deepEqual(Array.from(fr.payload), [0x34, 0x01]);
});

test('write guard blocks firmware, activation and speed-limit frames', () => {
  assert.equal(checkRawWrite(encodeM365(0x20, 0x07, 0x00, [0, 0, 0, 0])).ok, false);
  assert.equal(checkRawWrite(encodeM365(0x20, 0x03, 0x72, [1, 0])).ok, false);
  assert.equal(checkRawWrite(encodeNinebot(0x3e, 0x20, 0x02, 0x73, [0, 0])).ok, false);
  assert.equal(checkRawWrite(encodeM365(0x20, 0x03, 0x7d, [2, 0])).ok, true);
});
