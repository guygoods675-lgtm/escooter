/**
 * Core protocol types.
 *
 * Every telemetry value is a `Reading`: either a real value decoded from the
 * scooter, a value *calculated* by the app from real values (and labelled so),
 * or `null` meaning the connected scooter/protocol does not expose it. The UI
 * renders null as "Not available" and never substitutes a made-up number.
 */

export type Reading<T = number> = { value: T; source: 'scooter' | 'calculated' | 'phone' } | null;

export const reading = <T,>(value: T | null | undefined, source: 'scooter' | 'calculated' | 'phone' = 'scooter'): Reading<T> =>
  value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value)) ? null : { value, source };

export interface TelemetrySnapshot {
  timestamp: number;
  speedKmh: Reading;
  averageSpeedKmh: Reading;
  batteryPercent: Reading;
  batteryVoltage: Reading;
  batteryCurrent: Reading; // amps, positive = discharging
  powerW: Reading;
  batteryTempC: Reading;
  batteryTemp2C: Reading;
  controllerTempC: Reading;
  motorTempC: Reading;
  motorRpm: Reading;
  rangeKm: Reading;
  odometerKm: Reading;
  tripDistanceKm: Reading;
  tripTimeSec: Reading;
  rideMode: Reading<string>;
  headlight: Reading<boolean>;
  tailLight: Reading<boolean>;
  brake: Reading<boolean>;
  accelerator: Reading<number>;
  cruiseControl: Reading<boolean>;
  regenLevel: Reading<string>;
  errorCode: Reading;
  warningCode: Reading;
}

export const emptySnapshot = (): TelemetrySnapshot => ({
  timestamp: Date.now(),
  speedKmh: null,
  averageSpeedKmh: null,
  batteryPercent: null,
  batteryVoltage: null,
  batteryCurrent: null,
  powerW: null,
  batteryTempC: null,
  batteryTemp2C: null,
  controllerTempC: null,
  motorTempC: null,
  motorRpm: null,
  rangeKm: null,
  odometerKm: null,
  tripDistanceKm: null,
  tripTimeSec: null,
  rideMode: null,
  headlight: null,
  tailLight: null,
  brake: null,
  accelerator: null,
  cruiseControl: null,
  regenLevel: null,
  errorCode: null,
  warningCode: null,
});

export interface BatteryDetails {
  percent: Reading;
  voltage: Reading;
  current: Reading;
  powerW: Reading;
  temps: Reading<number[]>;
  cellVoltages: Reading<number[]>; // volts
  cycles: Reading;
  chargeCount: Reading;
  factoryCapacityMah: Reading;
  actualCapacityMah: Reading;
  remainingMah: Reading;
  healthPercent: Reading;
  charging: Reading<boolean>;
  chargingCurrent: Reading;
  chargingVoltage: Reading;
  serial: Reading<string>;
  firmware: Reading<string>;
  manufactureDate: Reading<string>;
}

export const emptyBattery = (): BatteryDetails => ({
  percent: null,
  voltage: null,
  current: null,
  powerW: null,
  temps: null,
  cellVoltages: null,
  cycles: null,
  chargeCount: null,
  factoryCapacityMah: null,
  actualCapacityMah: null,
  remainingMah: null,
  healthPercent: null,
  charging: null,
  chargingCurrent: null,
  chargingVoltage: null,
  serial: null,
  firmware: null,
  manufactureDate: null,
});

export interface ScooterIdentity {
  manufacturer: Reading<string>;
  model: Reading<string>;
  modelInferred?: string; // how the model was chosen when not reported directly
  firmware: Reading<string>;
  hardware: Reading<string>;
  controllerFirmware: Reading<string>;
  bmsFirmware: Reading<string>;
  bleFirmware: Reading<string>;
  serial: Reading<string>;
  protocolVersion: Reading<string>;
  bleName: string | null;
  bleId: string;
}

/** Less frequently read values for the scooter information page. */
export interface ScooterExtras {
  totalRideTimeSec: Reading;
  totalPowerOnSec: Reading;
  bmsManufactureDateRaw: Reading<string>; // raw register word; the date packing is not publicly documented
  batteryChemistry: Reading<string>;
}

export type ErrorSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface ErrorCodeInfo {
  code: number;
  title: string;
  causes: string[];
  severity: ErrorSeverity;
  source: string; // where the meaning comes from
}

export interface CommandDef {
  id: string;
  label: string;
  description: string;
  options: { label: string; value: number }[];
  /** Citation for the documented command. Required: no source, no command. */
  source: string;
}

export interface ProtocolCapabilities {
  telemetry: (keyof TelemetrySnapshot)[];
  battery: boolean;
  cells: boolean;
  errors: boolean;
  clearErrors: false; // no scooter protocol we support documents clearing errors
  commands: CommandDef[];
}

/** Minimal transport the protocol adapters use; implemented by BluetoothManager. */
export interface BleTransport {
  deviceId: string;
  hasService(uuid: string): boolean;
  hasCharacteristic(service: string, characteristic: string): boolean;
  read(service: string, characteristic: string): Promise<Uint8Array>;
  write(service: string, characteristic: string, data: Uint8Array, withResponse: boolean): Promise<void>;
  subscribe(service: string, characteristic: string, onData: (data: Uint8Array) => void): () => void;
  log(kind: 'info' | 'tx' | 'rx' | 'error', message: string, bytes?: Uint8Array, decoded?: string): void;
  /** Optional: advertised service data (from the scan) for a service UUID. */
  advertisedServiceData?(uuid: string): Uint8Array | null;
}

/**
 * The contract every scooter protocol adapter implements. Getters return the
 * most recently polled values; `null` means unavailable for this scooter.
 */
export interface ScooterProtocol {
  readonly id: string;
  readonly name: string;
  readonly capabilities: ProtocolCapabilities;
  connect(transport: BleTransport): Promise<void>;
  disconnect(): Promise<void>;
  identify(): Promise<ScooterIdentity>;
  poll(): Promise<TelemetrySnapshot>;
  pollBattery(): Promise<BatteryDetails>;
  getBattery(): Reading;
  getSpeed(): Reading;
  getVoltage(): Reading;
  getCurrent(): Reading;
  getTemperature(): Reading;
  getOdometer(): Reading;
  getTripDistance(): Reading;
  getErrors(): { code: number; kind: 'error' | 'warning' }[];
  getLights(): { headlight: Reading<boolean>; tailLight: Reading<boolean> };
  getRideMode(): Reading<string>;
  describeError(code: number, kind: 'error' | 'warning'): ErrorCodeInfo;
  /** Optional: rarely changing values (total times, BMS manufacture date). */
  readExtras?(): Promise<ScooterExtras>;
  /** Sends a command from `capabilities.commands` only. Anything else throws. */
  sendCommand(commandId: string, value: number): Promise<void>;
}

export class UnsupportedCommandError extends Error {
  constructor(id: string) {
    super(`Command "${id}" is not supported by this scooter protocol`);
  }
}
