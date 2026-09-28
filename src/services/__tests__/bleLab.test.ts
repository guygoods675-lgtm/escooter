/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAPTURE_CAPACITY, captureSnapshot, recordPacket, useDevLog } from '../../store/devlog';
import { asciiPreview, buildCaptureCsv, buildCaptureJson, decimalPreview } from '../../ui/blelab/captureFormat';
import { parseCompany } from '../../ui/blelab/companyIds';

test('parseCompany reads the little-endian company ID', () => {
  assert.deepEqual(parseCompany('4c000215'), { id: 0x004c, idHex: '0x004C', name: 'Apple' });
  assert.deepEqual(parseCompany('3412ff'), { id: 0x1234, idHex: '0x1234', name: null });
  assert.deepEqual(parseCompany(null), { id: null, idHex: null, name: null });
  assert.deepEqual(parseCompany('4c'), { id: null, idHex: null, name: null });
});

test('byte previews', () => {
  assert.equal(asciiPreview([0x48, 0x69, 0x00, 0x7f]), 'Hi..');
  assert.equal(decimalPreview(new Uint8Array([1, 255, 16])), '1 255 16');
});

test('capture only records while capturing and keeps a bounded ring', () => {
  const s = useDevLog.getState();
  s.clearCapture();
  recordPacket('notify', 'SVC', 'CHR', new Uint8Array([1]));
  assert.equal(captureSnapshot().length, 0);
  s.startCapture(); // records a 'capture started' event
  for (let i = 0; i < CAPTURE_CAPACITY + 10; i++) recordPacket('notify', 'svc', 'chr', new Uint8Array([i & 0xff]));
  s.stopCapture();
  const snap = captureSnapshot();
  assert.equal(snap.length, CAPTURE_CAPACITY);
  assert.equal(snap[snap.length - 1].dir, 'event');
  assert.ok(snap[0].id < snap[1].id, 'oldest first');
  assert.equal(snap[1].char, 'chr');
  assert.equal(captureSnapshot(3).length, 3);
  s.clearCapture();
  assert.equal(captureSnapshot().length, 0);
});

test('JSON and CSV exports', () => {
  const packets = [
    { id: 1, t: 1_700_000_000_000, dir: 'notify' as const, service: 's', char: 'c', hex: '55AA', len: 2 },
    { id: 2, t: 1_700_000_000_100, dir: 'write' as const, service: 's', char: 'c', hex: '01', len: 1, note: 'failed: "x", y' },
  ];
  const json = JSON.parse(
    buildCaptureJson({
      exportedAt: 1_700_000_001_000,
      app: 'test',
      device: { name: 'X', id: 'id', protocol: null, rssiDbm: -60, mtu: null, manufacturerDataHex: null, companyId: null, companyName: null },
      capture: { startedAt: 1_700_000_000_000, stoppedAt: null, capacity: 10, droppedOldest: 0 },
      services: [{ uuid: 's', characteristics: [{ uuid: 'c', readable: true, writableWithResponse: false, writableWithoutResponse: true, notifiable: true, indicatable: false }] }],
      packets,
      nameOf: () => null,
    }),
  );
  assert.deepEqual(json.services[0].characteristics[0].properties, ['read', 'writeWithoutResponse', 'notify']);
  assert.equal(json.packets.length, 2);
  assert.equal(json.packets[0].group, 'rx');
  assert.equal(json.packets[1].group, 'tx');
  assert.equal(json.capture.packetCount, 2);
  const csv = buildCaptureCsv(packets, (u) => (u === 'c' ? 'Name' : null)).trim().split('\n');
  assert.equal(csv.length, 3);
  assert.ok(csv[1].startsWith('1700000000000,2023-11-14T22:13:20.000Z,notify,rx,s,c,Name,2,55AA,'));
  assert.ok(csv[2].endsWith(',"failed: ""x"", y"'));
});
