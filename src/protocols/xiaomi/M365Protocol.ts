import { asciiFrom, s16le, toHex, u16le, u32le } from '../../utils/bytes';
import { describeM365Error } from '../errorCodes';
import { UartRegisterProtocol, RegisterReply, nibbleVersion } from '../UartRegisterProtocol';
import { BatteryDetails, ProtocolCapabilities, ScooterExtras, ScooterIdentity, TelemetrySnapshot, emptyBattery, reading } from '../types';
import { M365FrameParser, M365_ADDR, M365_CMD, encodeM365, m365ReadRequest } from './frame';

/**
 * Xiaomi M365 / M365 Pro family over the unencrypted "55AA" protocol.
 *
 * Register map sources (all offsets are 16-bit word indices):
 *   ESC: https://github.com/etransport/ninebot-docs/wiki/M365ESC
 *   BMS: https://github.com/etransport/ninebot-docs/wiki/M365BMS
 *   Captured app traffic + scaling examples: https://github.com/CamiAlfa/M365-BLE-PROTOCOL/blob/master/protocolo
 *
 * IMPORTANT: newer Xiaomi/Ninebot BLE firmware encrypts this channel
 * (https://www.irmo.de/2023/11/08/e-scooter-bluetooth-hacking/). Scooter Hub does
 * not implement or bypass that encryption; such scooters simply give no replies
 * and the app reports the protocol as unavailable.
 */
export class M365Protocol extends UartRegisterProtocol {
  readonly id = 'xiaomi-m365';
  readonly name = 'Xiaomi M365 (55AA, unencrypted)';
  private parser = new M365FrameParser();

  readonly capabilities: ProtocolCapabilities = {
    telemetry: [
      'speedKmh', 'averageSpeedKmh', 'batteryPercent', 'batteryVoltage', 'batteryCurrent', 'powerW',
      'batteryTempC', 'batteryTemp2C', 'controllerTempC', 'rangeKm', 'odometerKm', 'tripDistanceKm',
      'tripTimeSec', 'tailLight', 'cruiseControl', 'regenLevel', 'errorCode', 'warningCode',
    ],
    battery: true,
    cells: true,
    errors: true,
    clearErrors: false,
    commands: [
      {
        id: 'tailLight',
        label: 'Tail light',
        description: 'Register 0x7D. Values from Mi Home app captures: 0x0002 = on, 0x0000 = off.',
        options: [{ label: 'Off', value: 0 }, { label: 'On', value: 2 }],
        source: 'CamiAlfa/M365-BLE-PROTOCOL "led" capture; ninebot-docs M365ESC reg 7D "Tail light on"',
      },
      {
        id: 'cruise',
        label: 'Cruise control',
        description: 'Register 0x7C. 0x0001 = enabled, 0x0000 = disabled.',
        options: [{ label: 'Off', value: 0 }, { label: 'On', value: 1 }],
        source: 'CamiAlfa/M365-BLE-PROTOCOL "crucero" capture; ninebot-docs M365ESC reg 7C',
      },
      {
        id: 'kers',
        label: 'Regenerative braking (KERS)',
        description: 'Register 0x7B. 0 = weak, 1 = medium, 2 = strong.',
        options: [{ label: 'Weak', value: 0 }, { label: 'Medium', value: 1 }, { label: 'Strong', value: 2 }],
        source: 'CamiAlfa/M365-BLE-PROTOCOL "frenada regenerativa" capture; ninebot-docs M365ESC reg 7B',
      },
    ],
  };

  protected encodeRead = m365ReadRequest;
  protected encodeWrite(_t: 'esc', register: number, data: number[]) {
    // Write without response (T = 0x03), exactly as in the captured Mi Home frames,
    // e.g. "55aa 04 20 03 7d 0200 59ff" (tail light on).
    return encodeM365(M365_ADDR.TO_ESC, M365_CMD.WRITE_NO_RESPONSE, register, data);
  }
  protected commandPayload(commandId: string, value: number) {
    const reg = { tailLight: 0x7d, cruise: 0x7c, kers: 0x7b }[commandId];
    if (reg === undefined) return super.commandPayload(commandId, value);
    return { register: reg, data: [value & 0xff, (value >> 8) & 0xff] };
  }
  protected feed(chunk: Uint8Array): RegisterReply[] {
    return this.parser.push(chunk).map((f) => ({
      device: f.addr === M365_ADDR.FROM_ESC ? 'esc' : f.addr === M365_ADDR.FROM_BMS ? 'bms' : f.addr === M365_ADDR.FROM_BLE ? 'ble' : 'other',
      register: f.arg,
      data: f.payload,
    }));
  }
  protected resetParser() {
    this.parser.reset();
  }
  protected describeFrame(b: Uint8Array) {
    return `55AA len=${b[2]} addr=0x${b[3]?.toString(16)} cmd=0x${b[4]?.toString(16)} reg=0x${b[5]?.toString(16)} data=${toHex(b.slice(6, -2))}`;
  }
  describeError = describeM365Error;

  /** Probe used during detection: read ESC firmware version (reg 0x1A, 2 bytes). */
  async probe(): Promise<boolean> {
    return (await this.tryRead('esc', 0x1a, 2)) !== null;
  }

  async identify(): Promise<ScooterIdentity> {
    const serial = await this.tryRead('esc', 0x10, 14);
    const fw = await this.tryRead('esc', 0x1a, 2);
    const vers = await this.tryRead('esc', 0x67, 4); // 0x67 BMS fw, 0x68 BLE fw
    const bmsInfo = await this.tryRead('bms', 0x18, 2); // factory capacity, mAh
    const factoryCap = bmsInfo ? u16le(bmsInfo, 0) : null;
    return {
      manufacturer: reading('Xiaomi', 'calculated'),
      model: reading('M365 family', 'calculated'),
      modelInferred: factoryCap
        ? `Protocol reply matched the M365 register map. Battery factory capacity reported as ${factoryCap} mAh. Pick your exact model if needed.`
        : 'Protocol reply matched the M365 register map. Pick your exact model if needed.',
      firmware: fw ? reading(nibbleVersion(u16le(fw, 0))) : null,
      hardware: null,
      controllerFirmware: fw ? reading(nibbleVersion(u16le(fw, 0))) : null,
      bmsFirmware: vers ? reading(nibbleVersion(u16le(vers, 0))) : null,
      bleFirmware: vers ? reading(nibbleVersion(u16le(vers, 2))) : null,
      serial: serial ? reading(asciiFrom(serial)) : null,
      protocolVersion: reading('Xiaomi 55AA (unencrypted)', 'calculated'),
      bleName: null,
      bleId: this.transport?.deviceId ?? '',
    };
  }

  async poll(): Promise<TelemetrySnapshot> {
    const s = { ...this.last, timestamp: Date.now() };
    // 0xB0..0xBF block (32 bytes), the same block Mi Home polls ("55aa 03 2001 b0 20").
    const b = await this.tryRead('esc', 0xb0, 0x20);
    if (b) {
      s.errorCode = reading(u16le(b, 0)); // B0 error code
      s.warningCode = reading(u16le(b, 2)); // B1 warning code
      s.batteryPercent = reading(u16le(b, 8)); // B4 battery %
      s.speedKmh = reading(s16le(b, 10) / 1000); // B5 speed, m/h
      s.averageSpeedKmh = reading(u16le(b, 12) / 1000); // B6 average speed, m/h (capture: 0x4650 = 18 km/h)
      s.odometerKm = reading(u32le(b, 14) / 1000); // B7-B8 total mileage, m
      s.tripDistanceKm = reading((u16le(b, 18) * 10) / 1000); // B9 trip distance, m*10
      s.controllerTempC = reading(s16le(b, 22) / 10); // BB frame temperature, 0.1 °C (capture: 0x0118 = 28 °C)
    }
    const range = await this.tryRead('esc', 0x25, 2); // remaining mileage, km*100
    if (range) s.rangeKm = reading(u16le(range, 0) / 100);
    const trip = await this.tryRead('esc', 0x3a, 2); // current trip seconds (CamiAlfa capture)
    if (trip) s.tripTimeSec = reading(u16le(trip, 0));
    const toggles = await this.tryRead('esc', 0x7b, 6); // 7B KERS, 7C cruise, 7D tail light
    if (toggles) {
      s.regenLevel = reading(['Weak', 'Medium', 'Strong'][u16le(toggles, 0)] ?? `Level ${u16le(toggles, 0)}`);
      s.cruiseControl = reading(u16le(toggles, 2) === 1);
      s.tailLight = reading(u16le(toggles, 4) !== 0);
    }
    const bms = await this.tryRead('bms', 0x31, 10); // 31 mAh, 32 %, 33 current, 34 voltage, 35 temps
    if (bms) this.applyBmsLive(s, bms);
    this.last = s;
    return s;
  }

  protected applyBmsLive(s: TelemetrySnapshot, bms: Uint8Array) {
    const current = s16le(bms, 4) / 100; // x10 mA, positive = discharging
    const voltage = u16le(bms, 6) / 100; // x10 mV
    s.batteryCurrent = reading(current);
    s.batteryVoltage = reading(voltage);
    s.powerW = reading(voltage * current, 'calculated');
    s.batteryTempC = reading(bms[8] - 20); // byte temp, 0 = -20 °C
    s.batteryTemp2C = reading(bms[9] - 20);
    if (!s.batteryPercent) s.batteryPercent = reading(u16le(bms, 2));
  }

  async pollBattery(): Promise<BatteryDetails> {
    return readBmsDetails(this);
  }

  async readExtras(): Promise<ScooterExtras> {
    // ESC 0x32 "Total run time" is documented for the M365 without a unit, so it is not shown.
    const date = await this.tryRead('bms', 0x20, 2); // BMS 0x20 "Manufacture date" (packing undocumented)
    return {
      totalRideTimeSec: null,
      totalPowerOnSec: null,
      bmsManufactureDateRaw: date ? reading(`0x${u16le(date, 0).toString(16).padStart(4, '0').toUpperCase()}`) : null,
      batteryChemistry: null,
    };
  }

  /** exposed for readBmsDetails */
  read(target: 'esc' | 'bms', register: number, n: number) {
    return this.tryRead(target, register, n);
  }
}

/** Shared BMS reader: M365 and Ninebot ES2 BMS register maps are identical in the wiki. */
export async function readBmsDetails(p: { read(t: 'esc' | 'bms', r: number, n: number): Promise<Uint8Array | null> }, versionFormat: (v: number) => string = nibbleVersion): Promise<BatteryDetails> {
  const d = emptyBattery();
  const serial = await p.read('bms', 0x10, 14);
  if (serial) d.serial = reading(asciiFrom(serial));
  const info = await p.read('bms', 0x17, 12); // 17 fw, 18 factory cap, 19 actual cap, 1A ?, 1B cycles, 1C charge count
  if (info) {
    d.firmware = reading(versionFormat(u16le(info, 0)));
    d.factoryCapacityMah = reading(u16le(info, 2));
    d.actualCapacityMah = reading(u16le(info, 4));
    d.cycles = reading(u16le(info, 8));
    d.chargeCount = reading(u16le(info, 10));
  }
  const live = await p.read('bms', 0x30, 12); // 30 status, 31 mAh, 32 %, 33 current, 34 voltage, 35 temps
  if (live) {
    const status = u16le(live, 0);
    const current = s16le(live, 6) / 100;
    const voltage = u16le(live, 8) / 100;
    d.remainingMah = reading(u16le(live, 2));
    d.percent = reading(u16le(live, 4));
    d.current = reading(current);
    d.voltage = reading(voltage);
    d.powerW = reading(voltage * current, 'calculated');
    d.temps = reading([live[10] - 20, live[11] - 20]);
    const charging = (status & (1 << 6)) !== 0; // status bit 6 = is charging
    d.charging = reading(charging);
    d.chargingCurrent = charging ? reading(Math.abs(current)) : null;
    d.chargingVoltage = charging ? reading(voltage) : null;
  }
  const health = await p.read('bms', 0x3b, 2);
  if (health) d.healthPercent = reading(u16le(health, 0));
  const cells = await p.read('bms', 0x40, 20); // 40..49 cell voltages, mV
  if (cells) {
    const v: number[] = [];
    for (let i = 0; i < 10; i++) {
      const mv = u16le(cells, i * 2);
      if (mv > 0) v.push(mv / 1000); // unused cell slots read 0 (CamiAlfa capture shows trailing zeros)
    }
    if (v.length) d.cellVoltages = reading(v);
  }
  return d;
}
