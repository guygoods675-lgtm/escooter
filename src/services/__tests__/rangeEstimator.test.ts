/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Ride } from '../../store/rides';
import { estimateRange, remainingEnergy } from '../rangeEstimator';

let seq = 0;
const DAY = 86400000;
const ride = (over: Partial<Ride>): Ride => ({
  id: `r${++seq}`, number: seq, scooterId: 's1', start: Date.UTC(2026, 0, 1) + seq * DAY, end: Date.UTC(2026, 0, 1) + seq * DAY + 600000,
  distanceKm: 5, distanceSource: 'gps', durationSec: 600, movingSec: 500, avgSpeedKmh: null, maxSpeedKmh: null,
  batteryStart: null, batteryEnd: null, energyWh: null, elevationGainM: null, elevationLossM: null, stops: 0, maxTempC: null, points: [],
  ...over,
});

test('null with a reason when battery level is missing', () => {
  const r = estimateRange({ rides: [ride({ energyWh: 50 })], scooterId: 's1', batteryPercent: null, specCapacityWh: 280 });
  assert.equal(r.km, null);
  assert.ok('reason' in r && /battery level/i.test(r.reason));
});

test('null with a reason when there are no rides for this scooter', () => {
  const r = estimateRange({ rides: [ride({ scooterId: 'other', energyWh: 50 })], scooterId: 's1', batteryPercent: 80, specCapacityWh: 280 });
  assert.equal(r.km, null);
  assert.ok('reason' in r && /no recorded rides/i.test(r.reason));
});

test('null when neither energy nor battery drop is recorded', () => {
  const r = estimateRange({ rides: [ride({}), ride({})], scooterId: 's1', batteryPercent: 80, specCapacityWh: 280 });
  assert.equal(r.km, null);
});

test('Wh/km method with model spec capacity, normal confidence', () => {
  const rides = [ride({ distanceKm: 5, energyWh: 50 }), ride({ distanceKm: 5, energyWh: 50 }), ride({ distanceKm: 5, energyWh: 50 })];
  const r = estimateRange({ rides, scooterId: 's1', batteryPercent: 50, specCapacityWh: 300 });
  assert.ok(r.km != null);
  if (r.km == null) return;
  assert.equal(r.method, 'wh-per-km');
  assert.equal(r.energy?.source, 'spec');
  assert.ok(Math.abs(r.rate - 10) < 1e-9);
  assert.ok(Math.abs(r.km - 15) < 1e-9); // 150 Wh / 10 Wh/km
  assert.deepEqual(r.basis, { rides: 3, kmUsed: 15 });
  assert.equal(r.confidence, 'normal');
  assert.match(r.explanation, /recent riding data/);
});

test('BMS capacity is preferred over the spec', () => {
  const e = remainingEnergy({ batteryPercent: 50, bmsActualCapacityMah: 10000, nominalVoltage: 36, specCapacityWh: 999 });
  assert.equal(e?.source, 'bms');
  assert.ok(Math.abs(e!.capacityWh - 360) < 1e-9);
  assert.ok(Math.abs(e!.remainingWh - 180) < 1e-9);
  // mAh without a nominal voltage can't be converted: falls back to spec
  assert.equal(remainingEnergy({ batteryPercent: 50, bmsActualCapacityMah: 10000, nominalVoltage: null, specCapacityWh: 280 })?.source, 'spec');
  assert.equal(remainingEnergy({ batteryPercent: 50 }), null);
});

test('recent rides weigh more', () => {
  const old = ride({ start: Date.UTC(2025, 0, 1), distanceKm: 10, energyWh: 200 }); // 20 Wh/km
  const recent = ride({ start: Date.UTC(2026, 5, 1), distanceKm: 10, energyWh: 100 }); // 10 Wh/km
  const r = estimateRange({ rides: [old, recent], scooterId: 's1', batteryPercent: 100, specCapacityWh: 300 });
  assert.ok(r.km != null && r.method === 'wh-per-km');
  if (r.km == null) return;
  assert.ok(r.rate < 15 && r.rate > 10, `rate ${r.rate}`);
});

test('fewer than 3 rides or under 10 km is preliminary with an explanation', () => {
  const r = estimateRange({ rides: [ride({ distanceKm: 20, energyWh: 200 }), ride({ distanceKm: 20, energyWh: 200 })], scooterId: 's1', batteryPercent: 80, specCapacityWh: 300 });
  assert.ok(r.km != null);
  if (r.km == null) return;
  assert.equal(r.confidence, 'preliminary');
  assert.match(r.explanation, /Preliminary/);
  const short = [1, 2, 3].map(() => ride({ distanceKm: 2, energyWh: 20 }));
  const s = estimateRange({ rides: short, scooterId: 's1', batteryPercent: 80, specCapacityWh: 300 });
  assert.ok(s.km != null && s.confidence === 'preliminary');
});

test('falls back to km per battery % when capacity is unknown', () => {
  const rides = [1, 2, 3].map(() => ride({ distanceKm: 6, energyWh: 60, batteryStart: 90, batteryEnd: 80 }));
  const r = estimateRange({ rides, scooterId: 's1', batteryPercent: 50 });
  assert.ok(r.km != null);
  if (r.km == null) return;
  assert.equal(r.method, 'km-per-percent');
  assert.ok(Math.abs(r.rate - 0.6) < 1e-9);
  assert.ok(Math.abs(r.km - 30) < 1e-9);
  assert.equal(r.confidence, 'normal');
});

test('energy rides but no capacity and no battery drop: explains why', () => {
  const r = estimateRange({ rides: [ride({ energyWh: 50 })], scooterId: 's1', batteryPercent: 50 });
  assert.equal(r.km, null);
  assert.ok('reason' in r && /capacity is unknown/.test(r.reason));
});
