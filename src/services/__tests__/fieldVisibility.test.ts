import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canShowField } from '../../ui/fieldVisibility';

test('fields the scooter can never send are hidden, supported ones always show', () => {
  const caps = ['batteryPercent', 'odometerKm'];
  assert.equal(canShowField('batteryPercent', caps, null, false), true, 'supported but no value yet still shows');
  assert.equal(canShowField('motorRpm', caps, null, false), false, 'never supported is hidden');
  assert.equal(canShowField('motorRpm', caps, null, true), true, '"Show all fields" shows everything');
  assert.equal(canShowField('powerW', caps, { powerW: { value: 120, source: 'calculated' } }, false), true, 'a value that arrives is never hidden');
  assert.equal(canShowField('speedKmh', caps, null, false), true, 'speed shows (phone GPS fallback)');
  assert.equal(canShowField('motorRpm', null, null, false), true, 'nothing hidden while not connected');
});
