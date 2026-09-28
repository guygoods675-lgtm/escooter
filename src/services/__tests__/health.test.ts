/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ProtocolCapabilities, ScooterIdentity, TelemetrySnapshot } from '../../protocols/types';
import { emptySnapshot } from '../../protocols/types';
import type { ErrorRecord } from '../../store/errors';
import { computeHealth, type HealthInput } from '../health';

const caps: ProtocolCapabilities = { telemetry: [], battery: true, cells: true, errors: true, clearErrors: false, commands: [] };
const identity: ScooterIdentity = {
  manufacturer: null, model: null, firmware: { value: '1.5.5', source: 'scooter' }, hardware: null, controllerFirmware: null,
  bmsFirmware: null, bleFirmware: null, serial: null, protocolVersion: null, bleName: 'MIScooter1234', bleId: 'AA:BB',
};
const snap = (over: Partial<TelemetrySnapshot> = {}): TelemetrySnapshot => ({ ...emptySnapshot(), batteryPercent: { value: 80, source: 'scooter' }, ...over });
const code = (c: number, severity: ErrorRecord['severity'], kind: ErrorRecord['kind'] = 'error'): ErrorRecord => ({
  key: `s1:${kind}:${c}`, scooterId: 's1', code: c, kind, title: `Code ${c}`, severity, causes: [], source: 'test', firstSeen: 0, lastSeen: 0, occurrences: 1, active: true,
});
const input = (over: Partial<HealthInput> = {}): HealthInput => ({
  connected: true, conn: 'connected', rssi: -60, snapshot: snap(), battery: null, identity, capabilities: caps, activeCodes: [], lowBatteryPercent: 15, fmtTemp: (c) => `${c} °C`, ...over,
});
const byCat = (r: ReturnType<typeof computeHealth>, c: string) => r.items.find((i) => i.category === c)!;

test('status is unknown when disconnected with no current data', () => {
  const r = computeHealth(input({ connected: false, conn: 'disconnected', rssi: null, snapshot: null, identity: null, capabilities: null }));
  assert.equal(r.overall, 'unknown');
  for (const i of r.items) assert.equal(i.status, 'unknown', i.category);
});

test('normal when connected, error reporting supported and no codes active', () => {
  const r = computeHealth(input());
  assert.equal(r.overall, 'normal');
  assert.equal(byCat(r, 'errors').status, 'normal');
});

test('critical when a CRITICAL-coded error is active', () => {
  const r = computeHealth(input({ activeCodes: [code(11, 'CRITICAL')] }));
  assert.equal(r.overall, 'critical');
  assert.equal(byCat(r, 'motor').status, 'critical');
  assert.equal(byCat(r, 'motor').codes.length, 1);
  assert.equal(byCat(r, 'errors').status, 'critical');
  assert.equal(byCat(r, 'battery').status, 'normal');
});

test('warning-coded error raises warning, not critical', () => {
  const r = computeHealth(input({ activeCodes: [code(14, 'WARNING')] }));
  assert.equal(r.overall, 'warning');
  assert.equal(byCat(r, 'controller').status, 'warning');
});

test('lights are always unknown (no protocol reports light faults)', () => {
  assert.equal(byCat(computeHealth(input()), 'lights').status, 'unknown');
  assert.equal(byCat(computeHealth(input({ snapshot: snap({ headlight: { value: true, source: 'scooter' } }) })), 'lights').status, 'unknown');
});

test('categories are unknown, not normal, when the protocol reports no errors', () => {
  const r = computeHealth(input({ capabilities: { ...caps, errors: false } }));
  assert.equal(byCat(r, 'battery').status, 'unknown');
  assert.equal(byCat(r, 'motor').status, 'unknown');
  assert.equal(byCat(r, 'errors').status, 'unknown');
});
