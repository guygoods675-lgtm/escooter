/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RidePoint } from '../../store/rides';
import { accelerationRuns, summarizeRide } from '../rideMath';

const pt = (t: number, over: Partial<RidePoint>): RidePoint => ({
  t, lat: null, lon: null, alt: null, accuracy: 5, gpsSpeedKmh: null, speedKmh: null, battery: null, tempC: null, voltage: null, current: null, odoKm: null, ...over,
});

test('summarizes a ride from scooter data', () => {
  const pts: RidePoint[] = [];
  for (let i = 0; i <= 60; i++) {
    const moving = i < 20 || i > 30; // 11 s stop in the middle
    pts.push(pt(i * 1000, { speedKmh: moving ? 18 : 0, battery: 90 - Math.floor(i / 30), voltage: 40, current: moving ? 5 : 0, odoKm: 100 + i * 0.005 }));
  }
  const r = summarizeRide(pts, 0, 60000);
  assert.equal(r.distanceSource, 'scooter');
  assert.ok(Math.abs(r.distanceKm - 0.3) < 1e-9);
  assert.equal(r.stops, 1);
  assert.equal(r.maxSpeedKmh, 18);
  assert.equal(r.batteryStart, 90);
  assert.equal(r.batteryEnd, 88);
  assert.ok(r.energyWh! > 0);
  assert.equal(r.elevationGainM, null);
});

test('acceleration runs from standstill', () => {
  const s = [0, 0, 5, 11, 16, 21, 26].map((v, i) => ({ t: i * 1000, v }));
  const runs = accelerationRuns(s);
  assert.equal(runs[10]?.seconds, 2);
  assert.equal(runs[20]?.seconds, 4);
  assert.equal(runs[25]?.seconds, 5);
});
