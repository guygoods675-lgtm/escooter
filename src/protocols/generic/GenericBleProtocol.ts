import { UUID } from '../../ble/uuids';
import { utf8Decode } from '../../utils/bytes';
import { genericError } from '../errorCodes';
import {
  BatteryDetails, BleTransport, ProtocolCapabilities, Reading, ScooterIdentity, ScooterProtocol,
  TelemetrySnapshot, UnsupportedCommandError, emptyBattery, emptySnapshot, reading,
} from '../types';

/**
 * Generic fallback: reads only standard Bluetooth SIG services if the device
 * exposes them (Device Information 0x180A, Battery Service 0x180F).
 * https://www.bluetooth.com/specifications/assigned-numbers/
 * Everything else is reported as unavailable. Never writes.
 */
export class GenericBleProtocol implements ScooterProtocol {
  readonly id = 'generic-ble';
  readonly name = 'Generic BLE (standard services only)';
  readonly capabilities: ProtocolCapabilities = { telemetry: ['batteryPercent'], battery: false, cells: false, errors: false, clearErrors: false, commands: [] };
  private t: BleTransport | null = null;
  private last: TelemetrySnapshot = emptySnapshot();
  private unsub: (() => void) | null = null;

  async connect(transport: BleTransport) {
    this.t = transport;
    if (transport.hasCharacteristic(UUID.BATTERY_SERVICE, UUID.BATTERY_LEVEL)) {
      try {
        this.unsub = transport.subscribe(UUID.BATTERY_SERVICE, UUID.BATTERY_LEVEL, (d) => {
          if (d.length) this.last = { ...this.last, batteryPercent: reading(d[0]) };
        });
      } catch {
        // Battery Level notify is optional in the spec; polling still works.
      }
    }
  }
  async disconnect() {
    this.unsub?.();
    this.t = null;
  }

  private async readStr(char: string): Promise<Reading<string>> {
    if (!this.t?.hasCharacteristic(UUID.DEVICE_INFO, char)) return null;
    try {
      const s = utf8Decode(await this.t.read(UUID.DEVICE_INFO, char));
      return s ? reading(s) : null;
    } catch {
      return null;
    }
  }

  async identify(): Promise<ScooterIdentity> {
    return {
      manufacturer: await this.readStr(UUID.MANUFACTURER_NAME),
      model: await this.readStr(UUID.MODEL_NUMBER),
      firmware: await this.readStr(UUID.FIRMWARE_REV),
      hardware: await this.readStr(UUID.HARDWARE_REV),
      controllerFirmware: null,
      bmsFirmware: null,
      bleFirmware: await this.readStr(UUID.SOFTWARE_REV),
      serial: await this.readStr(UUID.SERIAL_NUMBER),
      protocolVersion: reading('Standard BLE services', 'calculated'),
      bleName: null,
      bleId: this.t?.deviceId ?? '',
    };
  }

  async poll(): Promise<TelemetrySnapshot> {
    const s = { ...this.last, timestamp: Date.now() };
    if (this.t?.hasCharacteristic(UUID.BATTERY_SERVICE, UUID.BATTERY_LEVEL)) {
      try {
        const d = await this.t.read(UUID.BATTERY_SERVICE, UUID.BATTERY_LEVEL);
        if (d.length) s.batteryPercent = reading(d[0]); // uint8, 0-100 %
      } catch {
        /* keep previous */
      }
    }
    this.last = s;
    return s;
  }
  async pollBattery(): Promise<BatteryDetails> {
    return { ...emptyBattery(), percent: this.last.batteryPercent };
  }
  getBattery = () => this.last.batteryPercent;
  getSpeed = () => null;
  getVoltage = () => null;
  getCurrent = () => null;
  getTemperature = () => null;
  getOdometer = () => null;
  getTripDistance = () => null;
  getErrors = () => [];
  getLights = () => ({ headlight: null, tailLight: null });
  getRideMode = () => null;
  describeError = genericError;
  async sendCommand(id: string): Promise<void> {
    throw new UnsupportedCommandError(id);
  }
}
