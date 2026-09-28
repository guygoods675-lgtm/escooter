import { asciiFrom, s16le, s32le, toHex, u16le, u32le } from '../../utils/bytes';
import { describeES2Error } from '../errorCodes';
import { UartRegisterProtocol, RegisterReply } from '../UartRegisterProtocol';
import { readBmsDetails } from '../xiaomi/M365Protocol';
import { BatteryDetails, ProtocolCapabilities, ScooterExtras, ScooterIdentity, TelemetrySnapshot, reading } from '../types';
import { NB_ADDR, NB_CMD, NinebotFrameParser, ninebotReadRequest } from './frame';

/**
 * Ninebot ES series over the unencrypted "5AA5" protocol. Read-only.
 *
 * Register map: https://github.com/etransport/ninebot-docs/wiki/ES2ESC (ESC)
 *               https://github.com/etransport/ninebot-docs/wiki/ES2BMS (BMS)
 * Framing:      https://github.com/etransport/py9b/blob/master/py9b/transport/ninebot.py
 *
 * Firmware words are shown as raw hex: the wiki documents the register but not
 * how the version number is packed for Ninebot.
 * As with Xiaomi, newer BLE firmware encrypts this link and is not supported.
 * Mode switching (reg 0x75) and lights are documented as writable but no captured
 * app traffic confirms the exact frames, so no write commands are offered.
 */
const hexWord = (v: number) => `0x${v.toString(16).padStart(4, '0').toUpperCase()}`;

export class NinebotProtocol extends UartRegisterProtocol {
  readonly id = 'ninebot-es';
  readonly name = 'Ninebot ES (5AA5, unencrypted)';
  private parser = new NinebotFrameParser();

  readonly capabilities: ProtocolCapabilities = {
    telemetry: [
      'speedKmh', 'averageSpeedKmh', 'batteryPercent', 'batteryVoltage', 'batteryCurrent', 'powerW',
      'batteryTempC', 'batteryTemp2C', 'controllerTempC', 'rangeKm', 'odometerKm', 'tripDistanceKm',
      'tripTimeSec', 'rideMode', 'errorCode', 'warningCode',
    ],
    battery: true,
    cells: true,
    errors: true,
    clearErrors: false,
    commands: [],
  };

  protected encodeRead = ninebotReadRequest;
  protected encodeWrite(): Uint8Array {
    throw new Error('Ninebot adapter is read-only');
  }
  protected feed(chunk: Uint8Array): RegisterReply[] {
    return this.parser
      .push(chunk)
      .filter((f) => f.cmd === NB_CMD.READ_REPLY && f.dst === NB_ADDR.HOST)
      .map((f) => ({
        device: f.src === NB_ADDR.ESC ? 'esc' : f.src === NB_ADDR.BMS ? 'bms' : f.src === NB_ADDR.BLE ? 'ble' : 'other',
        register: f.arg,
        data: f.payload,
      }));
  }
  protected resetParser() {
    this.parser.reset();
  }
  protected describeFrame(b: Uint8Array) {
    return `5AA5 len=${b[2]} src=0x${b[3]?.toString(16)} dst=0x${b[4]?.toString(16)} cmd=0x${b[5]?.toString(16)} reg=0x${b[6]?.toString(16)} data=${toHex(b.slice(7, -2))}`;
  }
  describeError = describeES2Error;

  async probe(): Promise<boolean> {
    return (await this.tryRead('esc', 0x1a, 2)) !== null;
  }

  read(target: 'esc' | 'bms', register: number, n: number) {
    return this.tryRead(target, register, n);
  }

  async identify(): Promise<ScooterIdentity> {
    const serial = await this.tryRead('esc', 0x10, 14);
    const fw = await this.tryRead('esc', 0x1a, 2);
    const vers = await this.tryRead('esc', 0x66, 6); // 66 ext BMS fw, 67 int BMS fw, 68 BLE fw
    return {
      manufacturer: reading('Ninebot / Segway-Ninebot', 'calculated'),
      model: reading('ES family', 'calculated'),
      modelInferred: 'Protocol reply matched the Ninebot ES register map. Pick your exact model if needed.',
      firmware: fw ? reading(hexWord(u16le(fw, 0))) : null,
      hardware: null,
      controllerFirmware: fw ? reading(hexWord(u16le(fw, 0))) : null,
      bmsFirmware: vers ? reading(hexWord(u16le(vers, 2))) : null,
      bleFirmware: vers ? reading(hexWord(u16le(vers, 4))) : null,
      serial: serial ? reading(asciiFrom(serial)) : null,
      protocolVersion: reading('Ninebot 5AA5 (unencrypted)', 'calculated'),
      bleName: null,
      bleId: this.transport?.deviceId ?? '',
    };
  }

  async poll(): Promise<TelemetrySnapshot> {
    const s = { ...this.last, timestamp: Date.now() };
    const b = await this.tryRead('esc', 0xb0, 0x20); // B0..BF
    if (b) {
      s.errorCode = reading(u16le(b, 0)); // B0 error code
      s.warningCode = reading(u16le(b, 2)); // B1 alarm code
      s.batteryPercent = reading(u16le(b, 8)); // B4 battery level 0-100 %
      s.speedKmh = reading(s16le(b, 10) / 10); // B5 current speed, 0.1 km/h
      s.averageSpeedKmh = reading(s16le(b, 12) / 10); // B6 average speed, 0.1 km/h
      s.odometerKm = reading(u32le(b, 14) / 1000); // B7 total mileage, m
      s.tripDistanceKm = reading((s16le(b, 18) * 10) / 1000); // B9 single mileage, m*10
      s.controllerTempC = reading(s16le(b, 22) / 10); // BB frame temperature, 0.1 °C
      s.powerW = reading(s16le(b, 26)); // BD scooter power, W
      s.rangeKm = reading(s16le(b, 30) / 100); // BF predicted remaining mileage, km*100
    }
    const mode = await this.tryRead('esc', 0x1f, 2); // 0 NORMAL, 1 ECO, 2 SPORT
    if (mode) s.rideMode = reading(['Normal', 'Eco', 'Sport'][u16le(mode, 0)] ?? `Mode ${u16le(mode, 0)}`);
    const trip = await this.tryRead('esc', 0x3a, 2); // single operation time, sec
    if (trip) s.tripTimeSec = reading(s16le(trip, 0));
    const bms = await this.tryRead('bms', 0x31, 10);
    if (bms) {
      const current = s16le(bms, 4) / 100;
      const voltage = u16le(bms, 6) / 100;
      s.batteryCurrent = reading(current);
      s.batteryVoltage = reading(voltage);
      if (!s.powerW) s.powerW = reading(voltage * current, 'calculated');
      s.batteryTempC = reading(bms[8] - 20);
      s.batteryTemp2C = reading(bms[9] - 20);
    }
    this.last = s;
    return s;
  }

  async readExtras(): Promise<ScooterExtras> {
    const times = await this.tryRead('esc', 0x32, 8); // 32 total operation time (S32 sec), 34 total riding time (S32 sec)
    const date = await this.tryRead('bms', 0x20, 2); // BMS 0x20 "Manufacture date" (packing undocumented)
    return {
      totalPowerOnSec: times ? reading(s32le(times, 0)) : null,
      totalRideTimeSec: times ? reading(s32le(times, 4)) : null,
      bmsManufactureDateRaw: date ? reading(hexWord(u16le(date, 0))) : null,
      batteryChemistry: null,
    };
  }

  async pollBattery(): Promise<BatteryDetails> {
    return readBmsDetails(this, hexWord);
  }
}
