/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Ride } from '../../store/rides';
import { ACHIEVEMENTS, achievementInputs, aggregate, periodStart, rideWhPerKm } from '../stats';

let seq = 0;
const ride = (over: Partial<Ride>): Ride => ({
  id: `r${++seq}`, number: seq, scooterId: 's1', start: Date.UTC(2026, 0, 1), end: Date.UTC(2026, 0, 1) + 600000,
  distanceKm: 1, distanceSource: 'gps', durationSec: 600, movingSec: 500, avgSpeedKmh: null, maxSpeedKmh: null,
  batteryStart: null, batteryEnd: null, energyWh: null, elevationGainM: null, elevationLossM: null, stops: 0, maxTempC: null, points: [],
  ...over,
});

test('aggregate of no rides has nulls, not zeros, for unavailable values', () => {
  const a = aggregate([]);
  assert.equal(a.rides, 0);
  assert.equal(a.distanceKm, 0);
  assert.equal(a.energyWh, null);
  assert.equal(a.maxSpeedKmh, null);
  assert.equal(a.avgWhPerKm, null);
  assert.equal(a.longest, null);
  assert.equal(a.mostEfficient, null);
  assert.equal(a.batteryUsedPct, null);
});

test('aggregate sums, finds longest and most efficient ride', () => {
  const a1 = ride({ distanceKm: 10, durationSec: 1800, energyWh: 150, maxSpeedKmh: 20, batteryStart: 90, batteryEnd: 70 });
  const a2 = ride({ distanceKm: 4, durationSec: 900, energyWh: 40, maxSpeedKmh: 24 });
  const a3 = ride({ distanceKm: 2, durationSec: 300 }); // no energy data
  const a = aggregate([a1, a2, a3]);
  assert.equal(a.rides, 3);
  assert.equal(a.distanceKm, 16);
  assert.equal(a.timeSec, 3000);
  assert.equal(a.energyWh, 190);
  assert.equal(a.energyRides, 2);
  assert.equal(a.maxSpeedKmh, 24);
  assert.equal(a.longest?.id, a1.id);
  assert.equal(a.mostEfficient?.id, a2.id); // 10 Wh/km vs 15 Wh/km
  assert.ok(Math.abs(a.avgWhPerKm! - 190 / 14) < 1e-9); // distance-weighted over rides with data
  assert.equal(a.batteryUsedPct, 20);
});

test('most efficient ignores very short rides', () => {
  const short = ride({ distanceKm: 0.2, energyWh: 0.5 });
  const a = aggregate([short]);
  assert.equal(a.mostEfficient, null);
  assert.equal(a.avgWhPerKm, null);
});

test('rideWhPerKm is null without energy data', () => {
  assert.equal(rideWhPerKm(ride({ distanceKm: 5, energyWh: null })), null);
  assert.equal(rideWhPerKm(ride({ distanceKm: 0, energyWh: 10 })), null);
  assert.equal(rideWhPerKm(ride({ distanceKm: 5, energyWh: 50 })), 10);
  assert.equal(rideWhPerKm(ride({ distanceKm: 5, energyWh: 50, whPerKm: 12 })), 12);
});

test('periodStart boundaries', () => {
  const now = new Date(2026, 8, 30, 15, 42); // Wednesday 30 Sep 2026, local time
  assert.equal(periodStart('today', now), new Date(2026, 8, 30).getTime());
  assert.equal(periodStart('week', now), new Date(2026, 8, 28).getTime()); // Monday
  assert.equal(periodStart('month', now), new Date(2026, 8, 1).getTime());
  assert.equal(periodStart('year', now), new Date(2026, 0, 1).getTime());
  assert.equal(periodStart('all', now), 0);
  const sunday = new Date(2026, 9, 4, 23, 0);
  assert.equal(periodStart('week', sunday), new Date(2026, 8, 28).getTime());
});

test('achievements never reward speed', () => {
  for (const a of ACHIEVEMENTS) {
    assert.doesNotMatch(`${a.id} ${a.title} ${a.description}`, /speed|fast|km\/h|mph|quick|record time/i, a.id);
  }
  const slow = [ride({ distanceKm: 30, maxSpeedKmh: 10, avgSpeedKmh: 8 }), ride({ distanceKm: 5, maxSpeedKmh: 12 })];
  const fast = slow.map((r) => ({ ...r, maxSpeedKmh: 60, avgSpeedKmh: 45 }));
  const inSlow = achievementInputs(slow, []);
  const inFast = achievementInputs(fast, []);
  assert.deepEqual(inFast, inSlow);
  for (const a of ACHIEVEMENTS) assert.deepEqual(a.progress(inFast), a.progress(inSlow));
  assert.ok(!Object.keys(inSlow).some((k) => /speed/i.test(k)));
});

test('achievement inputs count distance, rides, weeks and maintenance logs', () => {
  const rides = [ride({ distanceKm: 12, start: new Date(2026, 8, 28, 10).getTime() }), ride({ distanceKm: 3, start: new Date(2026, 8, 29, 10).getTime() }), ride({ distanceKm: 5, start: new Date(2026, 8, 21, 10).getTime() })];
  const items = [{ id: 'm', scooterId: 's1', name: 'Tires', icon: 'disc-outline', intervalDays: null, intervalKm: null, custom: false, notes: '', history: [{ id: 'e', date: 1, odometerKm: null, notes: '' }] }];
  const i = achievementInputs(rides, items);
  assert.deepEqual(i, { totalKm: 20, rides: 3, longestKm: 12, maintLogs: 1, weeksActive: 2, rideHours: 1500 / 3600, efficientRides: 0 });
});

test('riding hours use moving time; efficient ride needs >= 1 km and valid Wh/km', () => {
  const rides = [
    ride({ movingSec: 7200, distanceKm: 0.5, energyWh: 10 }), // too short
    ride({ movingSec: 1800, distanceKm: 3, energyWh: 30 }),
    ride({ movingSec: 1800, distanceKm: 5, energyWh: null }),
  ];
  const i = achievementInputs(rides, []);
  assert.equal(i.rideHours, 3);
  assert.equal(i.efficientRides, 1);
  const byId = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));
  assert.deepEqual(byId['hours-10'].progress(i), { value: 3, target: 10 });
  assert.deepEqual(byId['hours-50'].progress(i), { value: 3, target: 50 });
  assert.deepEqual(byId['efficient-1'].progress(i), { value: 1, target: 1 });
  assert.ok(byId['rides-50'] && byId['rides-100'] && byId['single-10']);
});
