/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Ride, RidePoint } from '../../store/rides';
import { analyzeRide, buildHeatSegments, compareRides, distanceTrack, energyByThirds, nearestIndex, positionAt, powerOf, tempSensors } from '../rideAnalysis';

const pt = (t: number, over: Partial<RidePoint> = {}): RidePoint => ({
  t, lat: null, lon: null, alt: null, accuracy: 5, gpsSpeedKmh: null, speedKmh: null, battery: null, tempC: null, voltage: null, current: null, odoKm: null, ...over,
});

const ride = (points: RidePoint[], over: Partial<Ride> = {}): Ride => ({
  id: 'r', number: 1, scooterId: null, start: points[0]?.t ?? 0, end: points[points.length - 1]?.t ?? 0, distanceKm: 0, distanceSource: 'none', durationSec: 0, movingSec: 0,
  avgSpeedKmh: null, maxSpeedKmh: null, batteryStart: null, batteryEnd: null, energyWh: null, elevationGainM: null, elevationLossM: null, stops: 0, maxTempC: null, points, ...over,
});

test('no sentences when nothing was recorded', () => {
  const r = ride([pt(0), pt(1000), pt(2000)]);
  assert.deepEqual(analyzeRide(r), []);
});

test('energy by thirds finds the heaviest third by distance', () => {
  const pts: RidePoint[] = [];
  for (let i = 0; i <= 90; i++) pts.push(pt(i * 1000, { odoKm: 10 + i * 0.01, voltage: 40, current: i > 60 ? 15 : 5 }));
  const r = ride(pts, { distanceKm: 0.9 });
  const th = energyByThirds(r)!;
  assert.equal(th.by, 'distance');
  assert.equal(th.most, 'end');
  const items = analyzeRide(r);
  assert.ok(items.find((i) => i.id === 'energy-thirds')!.text.includes('last third'));
  assert.ok(items.find((i) => i.id === 'wh-per-km'));
});

test('no thirds sentence without V×I samples', () => {
  const pts = Array.from({ length: 30 }, (_, i) => pt(i * 1000, { odoKm: i * 0.01, powerW: 300 }));
  assert.equal(energyByThirds(ride(pts)), null);
});

test('temperature sensors: per-sensor for new rides, legacy for old ones', () => {
  assert.deepEqual(tempSensors([pt(0, { motorTempC: 40, controllerTempC: 35 }), pt(1, { tempC: 35 })]), ['motor', 'controller']);
  assert.deepEqual(tempSensors([pt(0, { tempC: 30 })]), ['legacy']);
  assert.deepEqual(tempSensors([pt(0)]), []);
  const items = analyzeRide(ride([pt(0, { motorTempC: 40 }), pt(1000, { motorTempC: 52 })]));
  assert.equal(items.find((i) => i.id === 'peak-temp-motor')!.text, 'Peak motor temperature: 52 °C.');
});

test('power prefers scooter-reported, then calculated', () => {
  assert.deepEqual(powerOf(pt(0, { powerW: 250, voltage: 40, current: 5 })), { w: 250, source: 'scooter' });
  assert.deepEqual(powerOf(pt(0, { voltage: 40, current: 5 })), { w: 200, source: 'calculated' });
  assert.equal(powerOf(pt(0, { voltage: 40 })), null);
});

test('positionAt interpolates only across short GPS gaps', () => {
  const pts = [pt(0, { lat: 0, lon: 0 }), pt(2000, { lat: 0, lon: 0.002 }), pt(60000, { lat: 0, lon: 0.1 })];
  const mid = positionAt(pts, 1000)!;
  assert.ok(Math.abs(mid.lon - 0.001) < 1e-9);
  assert.equal(positionAt(pts, 30000), null); // inside a 58 s gap
  assert.deepEqual(positionAt(pts, 61000), { lat: 0, lon: 0.1 }); // snaps within 3 s
  assert.equal(nearestIndex(pts, 1400), 1);
});

test('distance track from GPS', () => {
  const pts = [pt(0, { lat: 0, lon: 0 }), pt(1000), pt(10000, { lat: 0, lon: 0.001 })];
  const d = distanceTrack(pts);
  assert.equal(d.source, 'gps');
  assert.equal(d.km[1], null);
  assert.ok(d.km[2]! > 0.1 && d.km[2]! < 0.12);
});

test('comparison sentences only for values both rides have', () => {
  const a = ride([pt(0)], { id: 'a', distanceKm: 5, energyWh: 60, whPerKm: 12, avgSpeedKmh: 18, batteryStart: 90, batteryEnd: 80 });
  const b = ride([pt(0)], { id: 'b', distanceKm: 5, energyWh: 75, whPerKm: 15, avgSpeedKmh: 18.1, batteryStart: null, batteryEnd: null });
  const items = compareRides(a, b);
  assert.equal(items.find((i) => i.id === 'cmp-wh-per-km')!.text, 'Ride A used less energy per km than Ride B (12.0 Wh/km vs 15.0 Wh/km).');
  assert.ok(items.find((i) => i.id === 'cmp-avg-speed')!.text.includes('about the same'));
  assert.equal(items.find((i) => i.id === 'cmp-battery-per-km'), undefined);
  assert.equal(items.find((i) => i.id === 'cmp-elevation'), undefined);
});

test('heatmap: caps segments, skips points without GPS and missing values', () => {
  const pts: RidePoint[] = [];
  for (let i = 0; i < 5000; i++) pts.push(pt(i * 1000, i % 10 === 5 ? {} : { lat: 50, lon: 14 + i * 0.00005, speedKmh: i < 2500 ? 15 : null }));
  const r = ride(pts);
  const h = buildHeatSegments([r, ride([pt(0), pt(1)], { id: 'nogps' })], 'speed', 3000);
  assert.ok(h.segments.length <= 3000);
  assert.ok(h.segments.length > 500);
  assert.equal(h.ridesWithoutGps, 1);
  assert.equal(h.lo, 15);
  assert.equal(h.hi, 15);
  assert.equal(buildHeatSegments([r], 'power').segments.length, 0);
});

test('heatmap battery rate over stretches of at least 0.5 km', () => {
  // ~0.0111 km per 0.0001° latitude step; 1 s apart would be 40 km/h
  const pts = Array.from({ length: 200 }, (_, i) => pt(i * 1000, { lat: 50 + i * 0.0001, lon: 14, battery: 90 - Math.floor(i / 50) }));
  const h = buildHeatSegments([ride(pts)], 'battery');
  assert.ok(h.segments.length > 0);
  assert.ok(h.hi < 5 && h.lo >= 0, `${h.lo}..${h.hi}`);
});
