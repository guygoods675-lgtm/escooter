import { UUID } from '../ble/uuids';
import { toHex } from '../utils/bytes';
import {
  BatteryDetails,
  BleTransport,
  CommandDef,
  ErrorCodeInfo,
  ProtocolCapabilities,
  Reading,
  ScooterIdentity,
  ScooterProtocol,
  TelemetrySnapshot,
  UnsupportedCommandError,
  emptyBattery,
  emptySnapshot,
} from './types';

/**
 * Shared plumbing for scooters that expose a register bus over the Nordic UART
 * Service (Xiaomi M365 "55AA" and Ninebot "5AA5" families). Subclasses supply
 * frame encoding/decoding and the documented register map.
 *
 * Only read requests are sent while polling. The only writes are the
 * documented commands in `capabilities.commands`, sent after user confirmation.
 */
export interface RegisterReply {
  device: 'esc' | 'bms' | 'ble' | 'other';
  register: number;
  data: Uint8Array;
}

export class ProtocolTimeoutError extends Error {}

export abstract class UartRegisterProtocol implements ScooterProtocol {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly capabilities: ProtocolCapabilities;

  protected transport: BleTransport | null = null;
  private unsubscribe: (() => void) | null = null;
  private waiters: { device: string; register: number; resolve: (d: Uint8Array) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  protected last: TelemetrySnapshot = emptySnapshot();
  protected lastBattery: BatteryDetails = emptyBattery();
  protected timeoutMs = 900;

  protected abstract encodeRead(target: 'esc' | 'bms', register: number, byteCount: number): Uint8Array;
  protected abstract encodeWrite(target: 'esc', register: number, data: number[]): Uint8Array;
  protected abstract feed(chunk: Uint8Array): RegisterReply[];
  protected abstract resetParser(): void;
  protected abstract describeFrame(bytes: Uint8Array): string;

  abstract identify(): Promise<ScooterIdentity>;
  abstract poll(): Promise<TelemetrySnapshot>;
  abstract pollBattery(): Promise<BatteryDetails>;
  abstract describeError(code: number, kind: 'error' | 'warning'): ErrorCodeInfo;

  async connect(transport: BleTransport): Promise<void> {
    this.transport = transport;
    this.resetParser();
    this.unsubscribe = transport.subscribe(UUID.NUS_SERVICE, UUID.NUS_TX_NOTIFY, (chunk) => {
      const replies = this.feed(chunk);
      transport.log('rx', `${chunk.length} bytes`, chunk, replies.map((r) => `${r.device}@0x${r.register.toString(16)}: ${toHex(r.data)}`).join(' | ') || undefined);
      for (const r of replies) this.resolveWaiter(r);
    });
  }

  async disconnect(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const w of this.waiters) {
      clearTimeout(w.timer);
      w.reject(new Error('disconnected'));
    }
    this.waiters = [];
    this.transport = null;
  }

  private resolveWaiter(r: RegisterReply) {
    const idx = this.waiters.findIndex((w) => w.device === r.device && w.register === r.register);
    if (idx < 0) return;
    const [w] = this.waiters.splice(idx, 1);
    clearTimeout(w.timer);
    w.resolve(r.data);
  }

  /** Serialised register read; resolves with the register bytes or rejects on timeout. */
  protected readRegister(target: 'esc' | 'bms', register: number, byteCount: number): Promise<Uint8Array> {
    const run = async () => {
      const t = this.transport;
      if (!t) throw new Error('not connected');
      const frame = this.encodeRead(target, register, byteCount);
      const p = new Promise<Uint8Array>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.waiters = this.waiters.filter((w) => w.timer !== timer);
          reject(new ProtocolTimeoutError(`No reply for ${target} register 0x${register.toString(16)}`));
        }, this.timeoutMs);
        this.waiters.push({ device: target, register, resolve, reject, timer });
      });
      t.log('tx', `read ${target} 0x${register.toString(16).padStart(2, '0')} x${byteCount}`, frame, this.describeFrame(frame));
      await this.writeChunked(frame);
      return p;
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Reads, returning null instead of throwing (value becomes "Not available"). */
  protected async tryRead(target: 'esc' | 'bms', register: number, byteCount: number): Promise<Uint8Array | null> {
    try {
      const d = await this.readRegister(target, register, byteCount);
      return d.length >= byteCount ? d : null;
    } catch {
      return null;
    }
  }

  private async writeChunked(frame: Uint8Array) {
    // 20-byte chunks, as in py9b's BLE link (_write_chunk_size = 20, "as in android dumps").
    for (let i = 0; i < frame.length; i += 20) {
      await this.transport!.write(UUID.NUS_SERVICE, UUID.NUS_RX_WRITE, frame.slice(i, i + 20), false);
    }
  }

  async sendCommand(commandId: string, value: number): Promise<void> {
    const def: CommandDef | undefined = this.capabilities.commands.find((c) => c.id === commandId);
    if (!def || !def.options.some((o) => o.value === value)) throw new UnsupportedCommandError(commandId);
    const { register, data } = this.commandPayload(commandId, value);
    const frame = this.encodeWrite('esc', register, data);
    this.transport?.log('tx', `COMMAND ${def.label} = ${value}`, frame, this.describeFrame(frame));
    await this.writeChunked(frame);
  }

  protected commandPayload(commandId: string, _value: number): { register: number; data: number[] } {
    throw new UnsupportedCommandError(commandId);
  }

  getBattery = (): Reading => this.last.batteryPercent;
  getSpeed = (): Reading => this.last.speedKmh;
  getVoltage = (): Reading => this.last.batteryVoltage;
  getCurrent = (): Reading => this.last.batteryCurrent;
  getTemperature = (): Reading => this.last.controllerTempC;
  getOdometer = (): Reading => this.last.odometerKm;
  getTripDistance = (): Reading => this.last.tripDistanceKm;
  getLights = () => ({ headlight: this.last.headlight, tailLight: this.last.tailLight });
  getRideMode = () => this.last.rideMode;
  getErrors() {
    const out: { code: number; kind: 'error' | 'warning' }[] = [];
    if (this.last.errorCode && this.last.errorCode.value !== 0) out.push({ code: this.last.errorCode.value, kind: 'error' });
    if (this.last.warningCode && this.last.warningCode.value !== 0) out.push({ code: this.last.warningCode.value, kind: 'warning' });
    return out;
  }
}

/** Formats a firmware word like 0x0134 as "1.3.4" (format shown in CamiAlfa capture "Var26=version=01.3.4"). */
export const nibbleVersion = (v: number) => `${(v >> 8) & 0xf}.${(v >> 4) & 0xf}.${v & 0xf}`;
