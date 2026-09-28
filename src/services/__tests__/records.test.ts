/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Ride } from '../../store/rides';
import { computeRecords, monthTotals } from '../records';

let seq = 0;
const ride = (over: Partial<Ride>): Ride => ({
  id: `r${++seq}`, number: seq, scooterId: 's1', start: new Date(2026, 0, 1 + seq).getTime(), end: new Date(2026, 0, 1 + seq).getTime() + 600000,
  distanceKm: 1, distanceSource: 'gps', durationSec: 600, movingSec: 500, avgSpeedKmh: null, maxSpeedKmh: null,
  batteryStart: null, batteryEnd: null, energyWh: null, elevationGainM: null, elevationLossM: null, stops: 0, maxTempC: null, points: [],
  ...over,
});

test('no rides → every record is null', () => {
  const r = computeRecords([]);
  for (const v of Object.values(r)) assert.equal(v, null);
});

test('records reference the ride they came from', () => {
  const a = ride({ distanceKm: 12, durationSec: 3000, movingSec: 2500, maxSpeedKmh: 24, avgSpeedKmh: 18, energyWh: 150, elevationGainM: 40 });
  const b = ride({ distanceKm: 5, durationSec: 4000, movingSec: 1000, maxSpeedKmh: 20, avgSpeedKmh: 20, energyWh: 40, elevationGainM: 80 });
  const c = ride({ distanceKm: 0.8, energyWh: 2, avgSpeedKmh: 30 }); // too short for efficiency, allowed for avg (>= 0.5 km)
  const r = computeRecords([a, b, c]);
  assert.equal(r.longestDistance?.ride.id, a.id);
  assert.equal(r.longestDuration?.ride.id, b.id);
  assert.equal(r.longestMoving?.ride.id, a.id);
  assert.equal(r.highestSpeed?.ride.id, a.id);
  assert.equal(r.highestAvgSpeed?.ride.id, c.id);
  assert.equal(r.lowestWhPerKm?.ride.id, b.id); // 8 Wh/km vs 12.5; c excluded (< 1 km)
  assert.equal(r.lowestWhPerKm?.value, 8);
  assert.equal(r.highestElevationGain?.ride.id, b.id);
  assert.equal(r.mostEnergy?.ride.id, a.id);
});

test('lowest Wh/km needs valid energy and at least 1 km', () => {
  const r = computeRecords([ride({ distanceKm: 3, energyWh: null }), ride({ distanceKm: 0.9, energyWh: 5 }), ride({ distanceKm: 3, energyWh: 0 })]);
  assert.equal(r.lowestWhPerKm, null);
  assert.equal(r.mostEnergy?.value, 5);
});

test('ties keep the earlier ride', () => {
  const first = ride({ distanceKm: 7, start: new Date(2026, 1, 1).getTime() });
  const second = ride({ distanceKm: 7, start: new Date(2026, 1, 5).getTime() });
  assert.equal(computeRecords([second, first]).longestDistance?.ride.id, first.id);
});

test('most distance in one calendar month lists that month’s rides', () => {
  const jan = [ride({ distanceKm: 10, start: new Date(2026, 0, 3).getTime() }), ride({ distanceKm: 10, start: new Date(2026, 0, 20).getTime() })];
  const feb = [ride({ distanceKm: 15, start: new Date(2026, 1, 3).getTime() })];
  const r = computeRecords([...jan, ...feb]);
  assert.equal(r.mostDistanceMonth?.year, 2026);
  assert.equal(r.mostDistanceMonth?.month, 0);
  assert.equal(r.mostDistanceMonth?.distanceKm, 20);
  assert.deepEqual(r.mostDistanceMonth?.rides.map((x) => x.id), [jan[1].id, jan[0].id]);
  assert.equal(monthTotals([...jan, ...feb]).length, 2);
});
