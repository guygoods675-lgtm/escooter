import { genericError } from '../errorCodes';
import {
  BatteryDetails, BleTransport, ProtocolCapabilities, Reading, ScooterIdentity, ScooterProtocol,
  TelemetrySnapshot, UnsupportedCommandError, emptyBattery, emptySnapshot, reading,
} from '../types';
import { EphemeralKey, SessionKeys, decryptSpec, encryptSpec, ephemeralKey, loginProof, ltmkFromCloudKey, parseCloudKey } from './crypto';
import { PropDef, PropMap, SpecField, T2336_MAP, buildGet, decodeSpecValue, parseGetReply } from './spec';

/**
 * Xiaomi Electric Scooter 4 Pro (2nd Gen), model xiaomi.scooter.t2336. Read-only.
 *
 * The scooter does not use the open 55AA / Nordic UART protocol. It uses Xiaomi's
 * "securitychip" login (ECDH P-256 + HKDF + AES-CCM) and then an encrypted MIoT
 * SPEC channel. Everything here follows the MIT-licensed reference implementation:
 *   https://github.com/mehesbalazs/xiaomi-scooter-4-pro-2 (docs/protocol.md, scooter.py)
 *
 * The login needs the scooter's own BLE key from the owner's Xiaomi account plus the
 * scooter PIN; nothing is bypassed. It is a login with the existing key, not a new
 * pairing ("register"), so the Mi Home binding is not touched.
 * Only GET requests are sent after login. There is no SET, lock or unlock.
 */

const sig = (h: string) => `0000${h}-0000-1000-8000-00805f9b34fb`;
export const XIAOMI_SEC = {
  SERVICE: sig('fe95'),
  CONTROL: sig('0010'),
  LOGIN: sig('0016'),
  SPEC_WRITE: sig('001a'),
  SPEC_NOTIFY: sig('001b'),
  MCU_INFO: sig('001c'),
  EXTRA_17: sig('0017'),
  EXTRA_18: sig('0018'),
} as const;

/** MiBeacon product id of the t2336 (bytes 2-3 LE of the FE95 service data), from docs/protocol.md. */
export const T2336_PRODUCT_ID = 0x403d;

/** MiBeacon product ids with a public source: t2336 (mehesbalazs docs/protocol.md), 5 Pro (KuziaMother docs/BLE.md §8). */
export const XIAOMI_SCOOTER_PIDS: Record<number, { model: string; name: string }> = {
  0x403d: { model: 'xiaomi.scooter.t2336', name: 'Electric Scooter 4 Pro (2nd Gen)' },
  0x50d3: { model: 'xiaomi.scooter.5pro', name: 'Electric Scooter 5 Pro' },
};

/** Some Xiaomi scooters advertise their MIoT model id as the Bluetooth name (seen on john's 4 Pro 2nd Gen: "xiaomi.scooter.t2336"). */
export function pidFromXiaomiName(name: string | null | undefined): number | null {
  const n = (name ?? '').trim().toLowerCase();
  const hit = Object.entries(XIAOMI_SCOOTER_PIDS).find(([, v]) => v.model === n);
  return hit ? Number(hit[0]) : null;
}

/** Models whose property map and GET opcode were verified on a real scooter by the cited sources. */
export const VERIFIED_MODELS = new Set(['xiaomi.scooter.t2336']);

const A4 = 0xa4;
const LOGIN_START = Uint8Array.of(0x20, 0x00, 0x00, 0x00);
const CFM_OK = 0x21;
const RCV_RDY = [0, 0, 1, 1];
const RCV_OK = [0, 0, 1, 0];
const CTR = 0x00;
const ACK = 0x01;
const MNG = 0x04;
const MNG_ACK = 0x05;
const FRAME = 18;

export interface XiaomiCredentials {
  cloudKeyHex: string;
  pin: string;
  /** Xiaomi model id, e.g. xiaomi.scooter.t2336 (default when unknown) */
  model?: string;
  /** Scooter name from the owner's Xiaomi account */
  name?: string;
  /** askbluetoothkey encrypt_type: 1 = PIN-protected (default), 0 = key is the LTMK itself (5 Pro BLE.md §4) */
  encryptType?: 0 | 1;
  /** Property map built from the model's official MIoT spec; the t2336 map is built in */
  map?: PropMap;
}

export type SecureStatus = 'no-key' | 'bad-key' | 'logging-in' | 'ok' | 'rejected' | 'error';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const eq = (a: Uint8Array, b: number[]) => a.length === b.length && b.every((x, i) => a[i] === x);

class Inbox {
  private q: { src: string; data: Uint8Array }[] = [];
  private waiter: (() => void) | null = null;
  push(src: string, data: Uint8Array) {
    this.q.push({ src, data });
    this.waiter?.();
  }
  drain() {
    this.q = [];
  }
  async get(timeoutMs: number): Promise<{ src: string; data: Uint8Array } | null> {
    const deadline = Date.now() + timeoutMs;
    while (!this.q.length) {
      const left = deadline - Date.now();
      if (left <= 0) return null;
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          this.waiter = null;
          resolve();
        }, left);
        this.waiter = () => {
          clearTimeout(t);
          this.waiter = null;
          resolve();
        };
      });
    }
    return this.q.shift()!;
  }
}

export class XiaomiT2336Protocol implements ScooterProtocol {
  readonly id = 'xiaomi-t2336';
  get name() {
    return `Xiaomi ${this.modelName} (encrypted, read-only${this.verified ? '' : ', experimental'})`;
  }
  get capabilities(): ProtocolCapabilities {
    const fields: [SpecField, keyof TelemetrySnapshot][] = [
      ['avgSpeed', 'averageSpeedKmh'], ['speed', 'speedKmh'], ['batteryLevel', 'batteryPercent'], ['voltage', 'batteryVoltage'],
      ['current', 'batteryCurrent'], ['power', 'powerW'], ['batteryTemp', 'batteryTempC'], ['scooterTemp', 'controllerTempC'],
      ['range', 'rangeKm'], ['totalKm', 'odometerKm'], ['tripKm', 'tripDistanceKm'], ['ridingTime', 'tripTimeSec'],
      ['ridingMode', 'rideMode'], ['tailLight', 'tailLight'], ['cruise', 'cruiseControl'], ['regen', 'regenLevel'], ['fault', 'errorCode'],
    ];
    return {
      telemetry: fields.filter(([f]) => this.map[f]).map(([, t]) => t),
      battery: true,
      cells: false,
      errors: !!this.map.fault,
      clearErrors: false,
      commands: [],
    };
  }

  status: SecureStatus = 'no-key';
  statusMessage = '';
  private t: BleTransport | null = null;
  private unsubs: (() => void)[] = [];
  private ctrl = new Inbox();
  private login = new Inbox();
  private spec = new Inbox();
  private mcu = new Inbox();
  private keys: SessionKeys | null = null;
  private counter = 0;
  private tid = 1;
  private queue: Promise<unknown> = Promise.resolve();
  private last: TelemetrySnapshot = emptySnapshot();
  private lastSlow = 0;

  /**
   * @param loadCredentials returns the owner's cloud key + PIN, or null if not set up
   * @param randomSeed returns >= 48 cryptographically random bytes
   */
  private map: PropMap = T2336_MAP;
  model = 'xiaomi.scooter.t2336';
  modelName = 'Electric Scooter 4 Pro (2nd Gen)';
  productId: number | null = null;

  /**
   * @param loadCredentials returns the owner's key + PIN (+ model/map) for this product id, or null if not set up
   * @param randomSeed returns >= 48 cryptographically random bytes
   */
  constructor(
    private loadCredentials: (productId: number | null) => Promise<XiaomiCredentials | null>,
    private randomSeed: () => Uint8Array,
    productId: number | null = null,
  ) {
    this.productId = productId;
    const known = productId !== null ? XIAOMI_SCOOTER_PIDS[productId] : undefined;
    if (known) {
      this.model = known.model;
      this.modelName = known.name;
    }
  }

  get verified() {
    return VERIFIED_MODELS.has(this.model);
  }

  static matches(t: BleTransport) {
    return [XIAOMI_SEC.CONTROL, XIAOMI_SEC.LOGIN, XIAOMI_SEC.SPEC_WRITE, XIAOMI_SEC.SPEC_NOTIFY].every((c) => t.hasCharacteristic(XIAOMI_SEC.SERVICE, c));
  }

  async connect(transport: BleTransport): Promise<void> {
    this.t = transport;
    const creds = await this.loadCredentials(this.productId).catch(() => null);
    if (!creds) {
      this.setStatus('no-key', 'Your scooter uses encrypted Bluetooth. Add your scooter key and PIN to read its data.');
      return;
    }
    if (creds.model) this.model = creds.model;
    if (creds.name) this.modelName = creds.name;
    const map = creds.map ?? (this.model === 'xiaomi.scooter.t2336' ? T2336_MAP : null);
    if (!map || !Object.keys(map).length) {
      this.setStatus('no-key', 'No property list is saved for this Xiaomi model yet. Use "Get key from my Xiaomi account" once, so Scooter Hub can load its official property list.');
      return;
    }
    this.map = map;
    const cloudKey = parseCloudKey(creds.cloudKeyHex);
    const encType = creds.encryptType ?? 1;
    if (!cloudKey || (encType === 1 && !creds.pin)) {
      this.setStatus('bad-key', 'The saved scooter key is not valid. It must be 64 hex characters.');
      return;
    }
    const ltmk = encType === 1 ? ltmkFromCloudKey(cloudKey, creds.pin) : cloudKey;
    this.subscribeAll();
    this.setStatus('logging-in', 'Logging in to the scooter…');
    try {
      await sleep(400);
      await this.a4Handshake();
      await this.doLogin(ltmk);
      await sleep(300);
      await this.mcuGate();
      await sleep(300);
      this.setStatus('ok', this.verified ? 'Logged in with your scooter key. Reading data (read-only).' : 'Logged in with your scooter key. Reading data (read-only). This model is experimental: its values come from Xiaomi\'s official property list, not yet confirmed on a real scooter. Please compare them with Xiaomi Home.');
    } catch (e) {
      if (this.status !== 'rejected') this.setStatus('error', `Login failed: ${e instanceof Error ? e.message : String(e)}. Close the Mi Home app (the scooter accepts one phone at a time) and try again.`);
    }
  }

  private setStatus(s: SecureStatus, msg: string) {
    this.status = s;
    this.statusMessage = msg;
    this.t?.log(s === 'ok' || s === 'logging-in' ? 'info' : 'error', `t2336: ${msg}`);
  }

  private subscribeAll() {
    const t = this.t!;
    const route: [string, Inbox][] = [
      [XIAOMI_SEC.CONTROL, this.ctrl],
      [XIAOMI_SEC.LOGIN, this.login],
      [XIAOMI_SEC.SPEC_WRITE, this.spec],
      [XIAOMI_SEC.SPEC_NOTIFY, this.spec],
      [XIAOMI_SEC.MCU_INFO, this.mcu],
      [XIAOMI_SEC.EXTRA_17, this.spec],
      [XIAOMI_SEC.EXTRA_18, this.spec],
    ];
    for (const [uuid, box] of route) {
      if (!t.hasCharacteristic(XIAOMI_SEC.SERVICE, uuid)) continue;
      try {
        this.unsubs.push(t.subscribe(XIAOMI_SEC.SERVICE, uuid, (d) => box.push(uuid, d)));
      } catch (e) {
        t.log('info', `notify ${uuid.slice(4, 8)} skipped: ${String(e)}`);
      }
    }
  }

  private async write(uuid: string, data: ArrayLike<number>) {
    const bytes = Uint8Array.from(data as ArrayLike<number>);
    try {
      await this.t!.write(XIAOMI_SEC.SERVICE, uuid, bytes, false);
    } catch {
      await this.t!.write(XIAOMI_SEC.SERVICE, uuid, bytes, true);
    }
  }

  private async need(box: Inbox, ms: number, what: string): Promise<Uint8Array> {
    const m = await box.get(ms);
    if (!m) throw new Error(`no ${what} from scooter`);
    return m.data;
  }

  /** Transport init: A4 -> control, MNG on login channel, answered with MNG_ACK. */
  private async a4Handshake() {
    await this.write(XIAOMI_SEC.CONTROL, [A4]);
    const b = await this.need(this.login, 4000, 'A4 answer');
    if (!(b.length >= 6 && b[0] === 0 && b[1] === 0 && b[2] === MNG)) throw new Error('unexpected A4 answer');
    await this.write(XIAOMI_SEC.LOGIN, [0, 0, MNG_ACK, b[3], b[4], b[5]]);
    await sleep(800); // docs/protocol.md "Timing": login start is only accepted >= ~500 ms after MNG_ACK
    this.login.drain();
    this.ctrl.drain();
  }

  private async sendTyped(type: number, payload: Uint8Array) {
    const n = Math.ceil(payload.length / FRAME);
    await this.write(XIAOMI_SEC.LOGIN, [0, 0, 0, type, n & 0xff, n >> 8]);
    if (!eq(await this.need(this.login, 8000, 'ready'), RCV_RDY)) throw new Error('scooter not ready for login data');
    for (let i = 0; i < payload.length; i += FRAME) {
      await this.write(XIAOMI_SEC.LOGIN, [i / FRAME + 1, 0, ...payload.slice(i, i + FRAME)]);
    }
    if (!eq(await this.need(this.login, 8000, 'receipt'), RCV_OK)) throw new Error('scooter did not confirm login data');
  }

  private async recvTyped(): Promise<Uint8Array> {
    const hdr = await this.need(this.login, 8000, 'public key');
    const n = hdr[4] + 0x100 * hdr[5];
    await this.write(XIAOMI_SEC.LOGIN, RCV_RDY);
    const parts: number[] = [];
    for (let i = 0; i < n; i++) parts.push(...(await this.need(this.login, 8000, 'public key data')).slice(2));
    await this.write(XIAOMI_SEC.LOGIN, RCV_OK);
    return Uint8Array.from(parts);
  }

  private async doLogin(ltmk: Uint8Array) {
    const ours: EphemeralKey = ephemeralKey(this.randomSeed());
    await this.write(XIAOMI_SEC.CONTROL, LOGIN_START);
    await this.sendTyped(3, ours.publicXY);
    const remote = await this.recvTyped();
    if (remote.length !== 64) throw new Error('bad scooter public key');
    const { keys, proof } = loginProof(ours, remote, ltmk);
    await this.sendTyped(5, proof);
    const cfm = await this.need(this.ctrl, 8000, 'login result');
    if (cfm[0] === CFM_OK) {
      this.keys = keys;
      this.counter = 0;
      return;
    }
    this.setStatus('rejected', 'The scooter rejected the login. Check the PIN. If the PIN is right, the key may have changed: get the key again and save it.');
    throw new Error('login rejected');
  }

  /** Mi Home reads MCU info on 0x001C (writes 00 00, then 01 00) before the first SPEC request. */
  private async mcuGate() {
    if (!this.t!.hasCharacteristic(XIAOMI_SEC.SERVICE, XIAOMI_SEC.MCU_INFO)) return;
    await this.write(XIAOMI_SEC.MCU_INFO, [0, 0]);
    await this.mcu.get(3000);
    await this.write(XIAOMI_SEC.MCU_INFO, [1, 0]);
    await this.mcu.get(3000);
    this.spec.drain();
    this.mcu.drain();
  }

  /** One encrypted SPEC request/response exchange (scooter.py spec_request). */
  private async specExchange(frame: Uint8Array, timeoutMs: number): Promise<Uint8Array | null> {
    const keys = this.keys!;
    const payload = encryptSpec(keys, this.counter, frame);
    this.counter = (this.counter + 1) & 0xffff;
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < payload.length; i += FRAME) chunks.push(payload.slice(i, i + FRAME));
    const fc = chunks.length;
    this.spec.drain();
    await this.write(XIAOMI_SEC.SPEC_WRITE, [0, 0, CTR, 0, fc & 0xff, fc >> 8]);
    const resp = new Map<number, Uint8Array>();
    let respCount: number | null = null;
    let sent = false;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const m = await this.spec.get(deadline - Date.now());
      if (!m) break;
      const b = m.data;
      const isCtrl = b.length >= 3 && b[0] === 0 && b[1] === 0;
      if (isCtrl && b[2] === ACK) {
        const st = b.length > 3 ? b[3] : -1;
        if (st === 0x01 && !sent) {
          sent = true;
          for (let n = 1; n <= fc; n++) await this.write(XIAOMI_SEC.SPEC_WRITE, [n & 0xff, n >> 8, ...chunks[n - 1]]);
        } else if (st === MNG_ACK) {
          for (let i = 4; i + 1 < b.length; i += 2) {
            const seq = b[i] | (b[i + 1] << 8);
            if (chunks[seq - 1]) await this.write(XIAOMI_SEC.SPEC_WRITE, [seq & 0xff, seq >> 8, ...chunks[seq - 1]]);
          }
        }
      } else if (isCtrl && b[2] === CTR) {
        respCount = b.length >= 6 ? b[4] | (b[5] << 8) : b.length > 4 ? b[4] : 0;
        await this.write(m.src, [0, 0, ACK, 1]);
      } else if (!isCtrl && b.length >= 2) {
        const seq = b[0] | (b[1] << 8);
        if (seq >= 1) resp.set(seq, b.slice(2));
        if (respCount !== null && resp.size >= respCount) {
          await this.write(m.src, [0, 0, ACK, 0]);
          const parts: number[] = [];
          [...resp.keys()].sort((x, y) => x - y).forEach((k) => parts.push(...resp.get(k)!));
          try {
            return decryptSpec(keys, Uint8Array.from(parts));
          } catch (e) {
            this.t?.log('error', `t2336: could not decrypt reply (${String(e)})`);
            return null;
          }
        }
      }
    }
    return null;
  }

  private async getProp(p: PropDef | undefined): Promise<number | string | null> {
    if (!p) return null;
    const run = async () => {
      if (this.status !== 'ok' || !this.keys || !this.t) return null;
      const frame = buildGet(p.siid, p.piid, this.tid);
      this.tid = (this.tid % 0xfffe) + 1;
      let pt = await this.specExchange(frame, 2500);
      if (!pt) {
        await sleep(200);
        pt = await this.specExchange(frame, 2500); // the reference retries once: the scooter sometimes drops a request
      }
      return decodeSpecValue(parseGetReply(pt), p.kind, p.scale);
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async num(f: SpecField): Promise<number | null> {
    const v = await this.getProp(this.map[f]);
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }
  private async str(f: SpecField): Promise<string | null> {
    const v = await this.getProp(this.map[f]);
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  }

  async disconnect(): Promise<void> {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    this.keys = null;
    this.t = null;
  }

  async identify(): Promise<ScooterIdentity> {
    const fw = await this.str('firmware');
    const bms = await this.str('bmsFirmware');
    const sn = await this.str('scooterSn');
    return {
      manufacturer: reading('Xiaomi', 'calculated'),
      model: reading(this.modelName, 'calculated'),
      modelInferred: `Recognised from the Xiaomi Bluetooth service${this.productId !== null ? ` and product id 0x${this.productId.toString(16).toUpperCase().padStart(4, '0')}` : ''} (${this.model}).`,
      firmware: reading(fw),
      hardware: null,
      controllerFirmware: reading(fw),
      bmsFirmware: reading(bms),
      bleFirmware: null,
      serial: reading(sn),
      protocolVersion: reading('Xiaomi securitychip + MIoT SPEC (encrypted)', 'calculated'),
      bleName: null,
      bleId: this.t?.deviceId ?? '',
    };
  }

  async poll(): Promise<TelemetrySnapshot> {
    const s: TelemetrySnapshot = { ...this.last, timestamp: Date.now() };
    if (this.status !== 'ok') return s;
    // Fast values: these change while riding (docs/protocol.md notes).
    s.batteryPercent = reading(await this.num('batteryLevel'));
    s.powerW = reading(await this.num('power'));
    s.batteryCurrent = reading(await this.num('current'));
    s.batteryVoltage = reading(await this.num('voltage'));
    s.tripDistanceKm = reading(await this.num('tripKm'));
    s.averageSpeedKmh = reading(await this.num('avgSpeed'));
    s.tripTimeSec = reading(await this.num('ridingTime'));
    // Live speed only where the scooter's own property list has one (the t2336 has none).
    if (this.map.speed) s.speedKmh = reading(await this.num('speed'));
    // Slow values: every 10 s.
    if (Date.now() - this.lastSlow > 10000) {
      this.lastSlow = Date.now();
      s.rangeKm = reading(await this.num('range'));
      s.odometerKm = reading(await this.num('totalKm'));
      s.batteryTempC = reading(await this.num('batteryTemp'));
      s.controllerTempC = reading(await this.num('scooterTemp'));
      s.errorCode = reading(await this.num('fault'));
      const mode = await this.num('ridingMode');
      const modeName = mode === null ? undefined : this.map.ridingMode?.values?.[mode];
      s.rideMode = mode === null ? null : reading(modeName ?? `Mode ${mode}`); // names only from the official value-list
      const regen = await this.num('regen');
      s.regenLevel = regen === null ? null : reading(`Level ${regen}`);
      const cruise = await this.num('cruise');
      s.cruiseControl = cruise === null ? null : reading(cruise !== 0);
      const tail = await this.num('tailLight');
      s.tailLight = tail === null ? null : reading(tail !== 0);
    }
    this.last = s;
    return s;
  }

  async pollBattery(): Promise<BatteryDetails> {
    const d = emptyBattery();
    if (this.status !== 'ok') return d;
    d.percent = this.last.batteryPercent;
    d.voltage = this.last.batteryVoltage;
    d.current = this.last.batteryCurrent;
    d.powerW = this.last.powerW;
    d.remainingMah = reading(await this.num('remainingMah'));
    const temp = await this.num('batteryTemp');
    d.temps = temp === null ? null : reading([temp]);
    d.cycles = reading(await this.num('cycles'));
    d.healthPercent = reading(await this.num('soh'));
    const charging = await this.num('charging');
    d.charging = charging === null ? null : reading(charging !== 0);
    d.serial = reading(await this.str('batterySn'));
    d.firmware = reading(await this.str('bmsFirmware'));
    return d;
  }

  getBattery = (): Reading => this.last.batteryPercent;
  getSpeed = (): Reading => this.last.speedKmh; // null on the t2336, which has no live speed property
  getVoltage = (): Reading => this.last.batteryVoltage;
  getCurrent = (): Reading => this.last.batteryCurrent;
  getTemperature = (): Reading => this.last.controllerTempC;
  getOdometer = (): Reading => this.last.odometerKm;
  getTripDistance = (): Reading => this.last.tripDistanceKm;
  getLights = () => ({ headlight: null, tailLight: this.last.tailLight });
  getRideMode = () => this.last.rideMode;
  getErrors() {
    const e = this.last.errorCode;
    return e && e.value !== 0 ? [{ code: e.value, kind: 'error' as const }] : [];
  }
  describeError = genericError;
  async sendCommand(id: string): Promise<void> {
    throw new UnsupportedCommandError(id);
  }
}
