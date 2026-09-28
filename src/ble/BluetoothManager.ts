import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, Characteristic, Device, State, Subscription } from 'react-native-ble-plx';
import type { BleTransport } from '../protocols/types';
import { devLog, recordPacket } from '../store/devlog';
import { base64ToBytes, bytesToBase64 } from '../utils/bytes';

export interface ScannedDevice {
  id: string; // MAC on Android, OS-assigned UUID on iOS (Apple does not expose MACs)
  name: string | null;
  rssi: number | null;
  serviceUUIDs: string[];
  manufacturerData: string | null; // hex
  /** Xiaomi MiBeacon product id from FE95 service data (bytes 2-3 LE), if advertised */
  miBeaconPid?: number | null;
  lastSeen: number;
}

export interface GattCharacteristicInfo {
  uuid: string;
  readable: boolean;
  writableWithResponse: boolean;
  writableWithoutResponse: boolean;
  notifiable: boolean;
  indicatable: boolean;
}
export interface GattServiceInfo {
  uuid: string;
  characteristics: GattCharacteristicInfo[];
}

let manager: BleManager | null = null;
const getManager = () => {
  if (!manager) manager = new BleManager();
  return manager;
};

/** Latest advertised manufacturer data (hex) per device id, remembered from scans. */
const advertisedManufacturerData = new Map<string, string>();
export const getAdvertisedManufacturerData = (deviceId: string): string | null => advertisedManufacturerData.get(deviceId) ?? null;
/** Latest advertised service data per device id and service UUID (lowercase), remembered from scans. */
const advertisedServiceData = new Map<string, Record<string, Uint8Array>>();
export const getAdvertisedServiceData = (deviceId: string, uuid: string): Uint8Array | null => advertisedServiceData.get(deviceId)?.[uuid.toLowerCase()] ?? null;

export type BleAdapterState = `${State}` | 'Unknown';

export async function requestBlePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
  if (apiLevel >= 31) {
    const res = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);
    return Object.values(res).every((r) => r === PermissionsAndroid.RESULTS.GRANTED);
  }
  const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
  return r === PermissionsAndroid.RESULTS.GRANTED;
}

export function onAdapterState(cb: (s: BleAdapterState) => void): () => void {
  try {
    const sub = getManager().onStateChange((s) => cb(s as BleAdapterState), true);
    return () => sub.remove();
  } catch {
    cb('Unsupported');
    return () => undefined;
  }
}

export function startScan(onDevice: (d: ScannedDevice) => void, onError: (e: Error) => void) {
  const m = getManager();
  devLog('conn', 'Scan started');
  m.startDeviceScan(null, { allowDuplicates: true }, (error, device) => {
    if (error) {
      devLog('error', `Scan error: ${error.message}`);
      onError(error);
      return;
    }
    if (!device) return;
    const manufacturerData = device.manufacturerData ? Array.from(base64ToBytes(device.manufacturerData)).map((b) => b.toString(16).padStart(2, '0')).join('') : null;
    if (manufacturerData) advertisedManufacturerData.set(device.id, manufacturerData);
    if (device.serviceData) {
      const sd: Record<string, Uint8Array> = {};
      for (const [u, v] of Object.entries(device.serviceData)) if (v) sd[u.toLowerCase()] = base64ToBytes(v);
      advertisedServiceData.set(device.id, sd);
    }
    onDevice({
      id: device.id,
      name: device.name ?? device.localName ?? null,
      rssi: device.rssi ?? null,
      serviceUUIDs: (device.serviceUUIDs ?? []).map((u) => u.toLowerCase()),
      manufacturerData,
      miBeaconPid: (() => {
        const fe95 = advertisedServiceData.get(device.id)?.['0000fe95-0000-1000-8000-00805f9b34fb'];
        return fe95 && fe95.length >= 4 ? fe95[2] | (fe95[3] << 8) : null;
      })(),
      lastSeen: Date.now(),
    });
  });
}

export function stopScan() {
  manager?.stopDeviceScan();
}

/** A connected GATT session implementing the protocol transport. */
export class BleSession implements BleTransport {
  readonly deviceId: string;
  services: GattServiceInfo[] = [];
  private subs: Subscription[] = [];
  private disconnectSub: Subscription | null = null;
  /** Active notification monitors per "service/characteristic" (lowercase). */
  private notifyRefs = new Map<string, number>();

  private constructor(private device: Device) {
    this.deviceId = device.id;
  }

  static async open(deviceId: string, timeoutMs: number, onDisconnect: (error: string | null) => void): Promise<BleSession> {
    const m = getManager();
    stopScan();
    devLog('conn', `Connecting to ${deviceId}`);
    let device = await m.connectToDevice(deviceId, { timeout: timeoutMs, autoConnect: false });
    if (Platform.OS === 'android') {
      try {
        device = await device.requestMTU(185);
      } catch {
        /* MTU negotiation is optional */
      }
    }
    device = await device.discoverAllServicesAndCharacteristics();
    const session = new BleSession(device);
    await session.loadGatt();
    session.disconnectSub = m.onDeviceDisconnected(deviceId, (err) => {
      devLog('conn', `Disconnected${err ? `: ${err.message}` : ''}`);
      session.cleanup();
      onDisconnect(err?.message ?? null);
    });
    devLog('conn', `Connected. ${session.services.length} services discovered`);
    return session;
  }

  get name() {
    return this.device.name ?? this.device.localName ?? null;
  }

  /** Negotiated ATT MTU reported by react-native-ble-plx (null if not reported). */
  get mtu(): number | null {
    const m = this.device.mtu;
    return typeof m === 'number' && m > 0 ? m : null;
  }

  /** Advertised manufacturer data as hex, from the connected Device or the last scan. */
  get manufacturerData(): string | null {
    const md = this.device.manufacturerData;
    if (md) return Array.from(base64ToBytes(md)).map((b) => b.toString(16).padStart(2, '0')).join('');
    return getAdvertisedManufacturerData(this.deviceId);
  }

  /** Service data advertised for `uuid` in the last scan (e.g. Xiaomi MiBeacon on FE95). */
  advertisedServiceData(uuid: string): Uint8Array | null {
    const sd = this.device.serviceData?.[uuid] ?? this.device.serviceData?.[uuid.toLowerCase()];
    return sd ? base64ToBytes(sd) : getAdvertisedServiceData(this.deviceId, uuid);
  }

  /** Number of active notification subscriptions on a characteristic (any caller). */
  subscriptionCount(service: string, characteristic: string): number {
    return this.notifyRefs.get(`${service.toLowerCase()}/${characteristic.toLowerCase()}`) ?? 0;
  }

  private async loadGatt() {
    const services = await this.device.services();
    const out: GattServiceInfo[] = [];
    for (const s of services) {
      const chars: Characteristic[] = await s.characteristics();
      out.push({
        uuid: s.uuid.toLowerCase(),
        characteristics: chars.map((c) => ({
          uuid: c.uuid.toLowerCase(),
          readable: c.isReadable,
          writableWithResponse: c.isWritableWithResponse,
          writableWithoutResponse: c.isWritableWithoutResponse,
          notifiable: c.isNotifiable,
          indicatable: c.isIndicatable,
        })),
      });
    }
    this.services = out;
  }

  hasService(uuid: string) {
    return this.services.some((s) => s.uuid === uuid.toLowerCase());
  }
  hasCharacteristic(service: string, characteristic: string) {
    return !!this.services.find((s) => s.uuid === service.toLowerCase())?.characteristics.some((c) => c.uuid === characteristic.toLowerCase());
  }

  async read(service: string, characteristic: string): Promise<Uint8Array> {
    const c = await this.device.readCharacteristicForService(service, characteristic);
    const bytes = base64ToBytes(c.value);
    devLog('rx', `read ${characteristic.slice(4, 8)}`, bytes);
    recordPacket('read', service, characteristic, bytes);
    return bytes;
  }

  async write(service: string, characteristic: string, data: Uint8Array, withResponse: boolean): Promise<void> {
    const b64 = bytesToBase64(data);
    const dir = withResponse ? 'write' : 'writeNR';
    try {
      if (withResponse) await this.device.writeCharacteristicWithResponseForService(service, characteristic, b64);
      else await this.device.writeCharacteristicWithoutResponseForService(service, characteristic, b64);
    } catch (e) {
      recordPacket(dir, service, characteristic, data, `failed: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
    recordPacket(dir, service, characteristic, data);
  }

  subscribe(service: string, characteristic: string, onData: (d: Uint8Array) => void): () => void {
    const sub = this.device.monitorCharacteristicForService(service, characteristic, (err, c) => {
      if (err) {
        devLog('error', `Notify ${characteristic}: ${err.message}`);
        return;
      }
      if (c?.value) {
        const bytes = base64ToBytes(c.value);
        recordPacket('notify', service, characteristic, bytes);
        onData(bytes);
      }
    });
    this.subs.push(sub);
    const refKey = `${service.toLowerCase()}/${characteristic.toLowerCase()}`;
    this.notifyRefs.set(refKey, (this.notifyRefs.get(refKey) ?? 0) + 1);
    let removed = false;
    return () => {
      sub.remove();
      this.subs = this.subs.filter((s) => s !== sub);
      if (!removed) {
        removed = true;
        const n = (this.notifyRefs.get(refKey) ?? 1) - 1;
        if (n > 0) this.notifyRefs.set(refKey, n);
        else this.notifyRefs.delete(refKey);
      }
    };
  }

  log(kind: 'info' | 'tx' | 'rx' | 'error', message: string, bytes?: Uint8Array, decoded?: string) {
    devLog(kind, message, bytes, decoded);
  }

  async readRssi(): Promise<number | null> {
    try {
      const d = await this.device.readRSSI();
      return d.rssi ?? null;
    } catch {
      return null;
    }
  }

  private cleanup() {
    this.subs.forEach((s) => s.remove());
    this.subs = [];
    this.notifyRefs.clear();
    this.disconnectSub?.remove();
    this.disconnectSub = null;
  }

  async close() {
    this.cleanup();
    try {
      await getManager().cancelDeviceConnection(this.deviceId);
    } catch {
      /* already disconnected */
    }
  }
}
