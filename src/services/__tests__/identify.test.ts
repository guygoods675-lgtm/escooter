import assert from 'node:assert/strict';
import { test } from 'node:test';
import { identifyAdvert } from '../../ble/identify';

test('scan list names scooters only from documented advertisement data', () => {
  assert.deepEqual(identifyAdvert({ name: 'dreame scooter', serviceUUIDs: [], miBeaconPid: 0x403d }), { brand: 'Xiaomi', model: 'Electric Scooter 4 Pro (2nd Gen)', support: 'needs-key' });
  assert.equal(identifyAdvert({ name: null, serviceUUIDs: [], miBeaconPid: 0x50d3 })?.model, 'Electric Scooter 5 Pro');
  assert.equal(identifyAdvert({ name: null, serviceUUIDs: [], miBeaconPid: 0x50d3 })?.support, 'experimental');
  assert.equal(identifyAdvert({ name: 'MIScooter1234', serviceUUIDs: [] })?.model, 'M365 family');
  assert.deepEqual(identifyAdvert({ name: 'NAVEE ST5 Max', serviceUUIDs: [] }), { brand: 'NAVEE', model: 'ST5 Max', support: 'not-supported' });
  assert.equal(identifyAdvert({ name: 'Mi Band', serviceUUIDs: [], miBeaconPid: 0x1234 }), null, 'other Xiaomi devices are not called scooters');
  assert.equal(identifyAdvert({ name: 'Headphones', serviceUUIDs: [] }), null);
});
