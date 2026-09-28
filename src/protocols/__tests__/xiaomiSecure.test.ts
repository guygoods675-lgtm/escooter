/* Xiaomi 4 Pro 2nd Gen (t2336): crypto and the login/SPEC exchange against a simulated scooter. */
import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { p256 } from '@noble/curves/nist.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type { BleTransport } from '../types';
import { LOGIN_CCM_NONCE, ccmDecrypt, ccmEncrypt, crc32, decryptSpec, encryptSpec, ltmkFromCloudKey, parseCloudKey } from '../xiaomiSecure/crypto';
import { buildGet, decodeProp, parseGetValue } from '../xiaomiSecure/spec';
import { XIAOMI_SEC, XiaomiT2336Protocol } from '../xiaomiSecure/XiaomiT2336Protocol';



const nodeCcm = (key: Uint8Array, nonce: Uint8Array, pt: Uint8Array) => {
  const c = createCipheriv('aes-128-ccm', key, nonce, { authTagLength: 4 });
  const ct = Buffer.concat([c.update(pt), c.final()]);
  return Uint8Array.from(Buffer.concat([ct, c.getAuthTag()]));
};

test('AES-CCM matches OpenSSL for several lengths', () => {
  for (const len of [1, 4, 9, 15, 16, 17, 31, 40]) {
    const key = randomBytes(16);
    const nonce = randomBytes(12);
    const pt = randomBytes(len);
    const ours = ccmEncrypt(key, nonce, pt);
    assert.deepEqual(Buffer.from(ours).toString('hex'), Buffer.from(nodeCcm(key, nonce, pt)).toString('hex'), `len ${len}`);
    assert.deepEqual(Buffer.from(ccmDecrypt(key, nonce, ours)), pt);
  }
});

test('AES-CCM rejects a tampered tag', () => {
  const key = randomBytes(16);
  const nonce = randomBytes(12);
  const ct = ccmEncrypt(key, nonce, Uint8Array.of(1, 2, 3));
  ct[ct.length - 1] ^= 1;
  assert.throws(() => ccmDecrypt(key, nonce, ct));
});

test('CRC32 matches zlib check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('LTMK = AES-CBC-decrypt(MD5(PIN), fixed IV, cloud key)', () => {
  const ltmk = randomBytes(32);
  const iv = Buffer.from('7aa4c68c590d4031b980d98b41023800', 'hex');
  const key = createHash('md5').update('123456').digest();
  const c = createCipheriv('aes-128-cbc', key, iv);
  c.setAutoPadding(false);
  const cloud = Buffer.concat([c.update(ltmk), c.final()]);
  assert.deepEqual(Buffer.from(ltmkFromCloudKey(parseCloudKey(cloud.toString('hex'))!, '123456')), ltmk);
  assert.equal(parseCloudKey('abc'), null);
  assert.ok(parseCloudKey(cloud.toString('hex').toUpperCase().replace(/(..)/g, '$1 ')));
});

test('GET frame layout and reply parsing', () => {
  // [len|0x2000][tid][op=2][count=1][siid][piid u16]
  assert.equal(Buffer.from(buildGet(1, 2, 1)).toString('hex'), '09200100020101' + '0200');
  const reply = Uint8Array.from([0x0f, 0x20, 1, 0, 3, 1, 1, 2, 0, 0, 0, 0x01, 0x00, 0x57]);
  assert.equal(decodeProp(parseGetValue(reply), 'u8'), 0x57);
  const f = Buffer.alloc(4);
  f.writeFloatLE(3712);
  const freply = Uint8Array.from([0x12, 0x20, 1, 0, 3, 1, 1, 4, 0, 0, 0, 0x04, 0x00, ...f]);
  assert.equal(decodeProp(parseGetValue(freply), 'f', 0.01), 37.12);
  const bad = Uint8Array.from([0x0b, 0x20, 1, 0, 3, 1, 1, 2, 0, 0x01, 0x10]);
  assert.equal(parseGetValue(bad), null);
});

/** A simulated t2336 following docs/protocol.md, used to test the whole client flow. */
function simulatedScooter(ltmk: Uint8Array, props: Record<string, Uint8Array>) {
  const listeners = new Map<string, (d: Uint8Array) => void>();
  const notify = (uuid: string, d: number[] | Uint8Array) => setTimeout(() => listeners.get(uuid)?.(Uint8Array.from(d)), 1);
  const sk = p256.utils.randomSecretKey();
  const pub = p256.getPublicKey(sk, false).slice(1);
  let state = 'idle';
  let rx: number[] = [];
  let expect = 0;
  let keys: ReturnType<typeof deriveKeys> | null = null;
  let specIn: number[] = [];
  let specCount = 0;
  let devCounter = 100;
  let pendingOut: Uint8Array[] = [];
  const writes: string[] = [];
  const deriveKeys = (appPub: Uint8Array) => {
    const shared = p256.getSharedSecret(sk, Uint8Array.from([4, ...appPub]), true).slice(1);
    const d = hkdf(sha256, Uint8Array.from([...shared, ...ltmk]), new TextEncoder().encode('smartcfg-login-salt'), new TextEncoder().encode('smartcfg-login-info'), 64);
    return { devKey: d.slice(0, 16), appKey: d.slice(16, 32), devIv: d.slice(32, 36), appIv: d.slice(36, 40) };
  };
  let appPub: Uint8Array | null = null;
  const onWrite = (uuid: string, d: Uint8Array) => {
    writes.push(`${uuid.slice(4, 8)}:${Buffer.from(d).toString('hex')}`);
    if (uuid === XIAOMI_SEC.CONTROL && d[0] === 0xa4) return notify(XIAOMI_SEC.LOGIN, [0, 0, 4, 0, 1, 20]);
    if (uuid === XIAOMI_SEC.CONTROL && d[0] === 0x20) return void (state = 'await-pub');
    if (uuid === XIAOMI_SEC.LOGIN) {
      if (d[0] === 0 && d[1] === 0 && d[2] === 0) {
        expect = d[4];
        rx = [];
        return notify(XIAOMI_SEC.LOGIN, [0, 0, 1, 1]);
      }
      if (d[0] === 0 && d[1] === 0 && d[2] === 1 && d[3] === 1 && state === 'send-pub') {
        for (let i = 0; i < 4; i++) notify(XIAOMI_SEC.LOGIN, [i + 1, 0, ...pub.slice(i * 18, i * 18 + 18)]);
        return;
      }
      if (d[0] === 0 && d[1] === 0 && d[2] === 1 && d[3] === 0 && state === 'send-pub') return void (state = 'await-proof');
      if (d[0] === 0 && d[1] === 0) return;
      rx.push(...d.slice(2));
      if (--expect > 0) return;
      notify(XIAOMI_SEC.LOGIN, [0, 0, 1, 0]);
      if (state === 'await-pub') {
        appPub = Uint8Array.from(rx);
        state = 'send-pub';
        notify(XIAOMI_SEC.LOGIN, [0, 0, 0, 3, 4, 0]);
      } else if (state === 'await-proof') {
        keys = deriveKeys(appPub!);
        const crc = crc32(pub);
        let ok = false;
        try {
          const pt = ccmDecrypt(keys.appKey, LOGIN_CCM_NONCE, Uint8Array.from(rx));
          ok = pt[0] === (crc & 0xff) && pt[3] === crc >>> 24;
        } catch {
          ok = false;
        }
        state = ok ? 'ready' : 'rejected';
        notify(XIAOMI_SEC.CONTROL, [ok ? 0x21 : 0x22]);
      }
      return;
    }
    if (uuid === XIAOMI_SEC.MCU_INFO) return notify(XIAOMI_SEC.MCU_INFO, [1, 2, 3]);
    if ((uuid === XIAOMI_SEC.SPEC_WRITE || uuid === XIAOMI_SEC.SPEC_NOTIFY) && keys) {
      if (d[0] === 0 && d[1] === 0 && d[2] === 0) {
        specCount = d[4];
        specIn = [];
        return notify(XIAOMI_SEC.SPEC_NOTIFY, [0, 0, 1, 1]);
      }
      if (d[0] === 0 && d[1] === 0 && d[2] === 1 && d[3] === 1) {
        pendingOut.forEach((c, i) => notify(XIAOMI_SEC.SPEC_NOTIFY, [i + 1, 0, ...c]));
        return;
      }
      if (d[0] === 0 && d[1] === 0) return;
      specIn.push(...d.slice(2));
      if (--specCount > 0) return;
      const frame = ccmDecrypt(keys.appKey, Uint8Array.from([...keys.appIv, 0, 0, 0, 0, specIn[0], specIn[1], 0, 0]), Uint8Array.from(specIn.slice(2)));
      assert.equal(frame[4], 2, 'client must only send GET (op=2)');
      const [siid, piid] = [frame[6], frame[7]];
      const v = props[`${siid},${piid}`];
      const body = v ? [siid, piid, 0, 0, 0, v.length & 0xff, v.length >> 8, ...v] : [siid, piid, 0, 1, 0x10];
      const out = Uint8Array.from([(6 + body.length) & 0xff, 0x20, frame[2], frame[3], 3, 1, ...body]);
      const enc = encryptSpec({ appKey: keys.devKey, appIv: keys.devIv, devKey: keys.devKey, devIv: keys.devIv }, devCounter++, out);
      pendingOut = [];
      for (let i = 0; i < enc.length; i += 18) pendingOut.push(enc.slice(i, i + 18));
      notify(XIAOMI_SEC.SPEC_NOTIFY, [0, 0, 0, 0, pendingOut.length, 0]);
    }
  };
  const chars = [XIAOMI_SEC.CONTROL, XIAOMI_SEC.LOGIN, XIAOMI_SEC.SPEC_WRITE, XIAOMI_SEC.SPEC_NOTIFY, XIAOMI_SEC.MCU_INFO];
  const transport: BleTransport = {
    deviceId: 'sim',
    hasService: (u) => u === XIAOMI_SEC.SERVICE,
    hasCharacteristic: (s, c) => s === XIAOMI_SEC.SERVICE && chars.includes(c as never),
    read: async () => new Uint8Array(0),
    write: async (_s, c, d) => void onWrite(c, d),
    subscribe: (_s, c, cb) => {
      listeners.set(c, cb);
      return () => listeners.delete(c);
    },
    log: () => undefined,
  };
  return { transport, writes, state: () => state };
}

const f32 = (v: number) => {
  const b = Buffer.alloc(4);
  b.writeFloatLE(v);
  return Uint8Array.from(b);
};

test('logs in and reads telemetry from a simulated t2336 (GET only)', { timeout: 20000 }, async () => {
  const ltmk = randomBytes(32);
  const pin = '424242';
  const iv = Buffer.from('7aa4c68c590d4031b980d98b41023800', 'hex');
  const c = createCipheriv('aes-128-cbc', createHash('md5').update(pin).digest(), iv);
  c.setAutoPadding(false);
  const cloudKeyHex = Buffer.concat([c.update(ltmk), c.final()]).toString('hex');
  const sim = simulatedScooter(ltmk, {
    '1,2': Uint8Array.of(87),
    '1,4': f32(4012),
    '1,5': f32(-150),
    '1,6': f32(0),
    '2,6': f32(123456),
    '3,3': Uint8Array.of(0xfe),
    '4,5': new TextEncoder().encode('0.1.5'),
  });
  const p = new XiaomiT2336Protocol(async () => ({ cloudKeyHex, pin }), () => randomBytes(48));
  assert.ok(XiaomiT2336Protocol.matches(sim.transport));
  await p.connect(sim.transport);
  assert.equal(p.status, 'ok', p.statusMessage);
  const snap = await p.poll();
  assert.equal(snap.batteryPercent?.value, 87);
  assert.equal(snap.batteryVoltage?.value.toFixed(2), '40.12');
  assert.equal(snap.batteryCurrent?.value.toFixed(2), '-1.50');
  assert.equal(snap.odometerKm?.value.toFixed(2), '1234.56');
  assert.equal(snap.controllerTempC?.value, -2);
  assert.equal(snap.speedKmh, null, 'no instantaneous speed on this model: must stay unavailable');
  assert.equal(snap.rangeKm, null, 'unanswered property stays unavailable');
  const id = await p.identify();
  assert.equal(id.firmware?.value, '0.1.5');
  await p.disconnect();
});

test('wrong PIN is reported as rejected, and no key means no BLE traffic', { timeout: 20000 }, async () => {
  const ltmk = randomBytes(32);
  const sim = simulatedScooter(ltmk, {});
  const p = new XiaomiT2336Protocol(async () => ({ cloudKeyHex: randomBytes(32).toString('hex'), pin: '000000' }), () => randomBytes(48));
  await p.connect(sim.transport);
  assert.equal(p.status, 'rejected');
  assert.equal(sim.state(), 'rejected');

  const sim2 = simulatedScooter(ltmk, {});
  const q = new XiaomiT2336Protocol(async () => null, () => randomBytes(48));
  await q.connect(sim2.transport);
  assert.equal(q.status, 'no-key');
  assert.equal(sim2.writes.length, 0);
  assert.equal((await q.poll()).batteryPercent, null);
});

void decryptSpec;
