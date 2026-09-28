/**
 * Only UUIDs with a public source live here.
 *
 * Bluetooth SIG assigned numbers (16-bit UUIDs expand to 0000xxxx-0000-1000-8000-00805f9b34fb):
 *   https://www.bluetooth.com/specifications/assigned-numbers/
 *   Battery Service 0x180F / Battery Level 0x2A19
 *   Device Information 0x180A / Manufacturer Name 0x2A29, Model Number 0x2A24,
 *   Serial Number 0x2A25, Firmware Rev 0x2A26, Hardware Rev 0x2A27, Software Rev 0x2A28
 *   Generic Access 0x1800 / Device Name 0x2A00
 *
 * Nordic UART Service (NUS), documented by Nordic Semiconductor:
 *   https://docs.nordicsemi.com/bundle/ncs-latest/page/nrf/libraries/bluetooth/services/nus.html
 *   Service 6E400001-B5A3-F393-E0A9-E50E24DCCA9E
 *   RX (phone writes)  6E400002-...   TX (scooter notifies) 6E400003-...
 * Xiaomi M365 and Ninebot scooters tunnel their UART bus over NUS:
 *   https://github.com/CamiAlfa/M365-BLE-PROTOCOL/blob/master/protocolo (advertises NUS)
 *   https://github.com/etransport/py9b/blob/master/py9b/link/ble.py (_rx_char_uuid / _tx_char_uuid)
 */

export const sig16 = (short: string) => `0000${short.toLowerCase()}-0000-1000-8000-00805f9b34fb`;

export const UUID = {
  GENERIC_ACCESS: sig16('1800'),
  DEVICE_NAME: sig16('2a00'),
  BATTERY_SERVICE: sig16('180f'),
  BATTERY_LEVEL: sig16('2a19'),
  DEVICE_INFO: sig16('180a'),
  MANUFACTURER_NAME: sig16('2a29'),
  MODEL_NUMBER: sig16('2a24'),
  SERIAL_NUMBER: sig16('2a25'),
  FIRMWARE_REV: sig16('2a26'),
  HARDWARE_REV: sig16('2a27'),
  SOFTWARE_REV: sig16('2a28'),
  NUS_SERVICE: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  NUS_RX_WRITE: '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
  NUS_TX_NOTIFY: '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
} as const;

const KNOWN_NAMES: Record<string, string> = {
  [UUID.GENERIC_ACCESS]: 'Generic Access',
  [sig16('1801')]: 'Generic Attribute',
  [UUID.DEVICE_NAME]: 'Device Name',
  [sig16('2a01')]: 'Appearance',
  [sig16('2a05')]: 'Service Changed',
  [UUID.BATTERY_SERVICE]: 'Battery Service',
  [UUID.BATTERY_LEVEL]: 'Battery Level',
  [UUID.DEVICE_INFO]: 'Device Information',
  [UUID.MANUFACTURER_NAME]: 'Manufacturer Name',
  [UUID.MODEL_NUMBER]: 'Model Number',
  [UUID.SERIAL_NUMBER]: 'Serial Number',
  [UUID.FIRMWARE_REV]: 'Firmware Revision',
  [UUID.HARDWARE_REV]: 'Hardware Revision',
  [UUID.SOFTWARE_REV]: 'Software Revision',
  [UUID.NUS_SERVICE]: 'Nordic UART Service',
  [UUID.NUS_RX_WRITE]: 'NUS RX (write)',
  [UUID.NUS_TX_NOTIFY]: 'NUS TX (notify)',
};

export const uuidName = (uuid: string): string | null => KNOWN_NAMES[uuid.toLowerCase()] ?? null;

export const shortUuid = (uuid: string): string => {
  const u = uuid.toLowerCase();
  return u.endsWith('-0000-1000-8000-00805f9b34fb') && u.startsWith('0000') ? `0x${u.slice(4, 8).toUpperCase()}` : u.toUpperCase();
};
