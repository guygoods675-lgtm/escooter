/**
 * Cryptography for Xiaomi "securitychip" scooters (Xiaomi Electric Scooter 4 Pro 2nd Gen,
 * model xiaomi.scooter.t2336).
 *
 * Source (MIT licence): mehesbalazs/xiaomi-scooter-4-pro-2
 *   https://github.com/mehesbalazs/xiaomi-scooter-4-pro-2/blob/main/docs/protocol.md
 *   https://github.com/mehesbalazs/xiaomi-scooter-4-pro-2/blob/main/scooter.py
 *
 *   LTMK    = AES-128-CBC-NoPadding-decrypt(key = MD5(PIN), IV = 7aa4c68c590d4031b980d98b41023800, ct = cloud key)
 *   shared  = ECDH-P256(scooter_pub, our_priv).X
 *   derived = HKDF-SHA256(ikm = shared || LTMK, salt "smartcfg-login-salt", info "smartcfg-login-info", 64 bytes)
 *   proof   = AES-CCM(key = derived[16:32], nonce = bytes 16..27, pt = CRC32_LE(scooter_pub), tag 4)
 *   session: dev_key [0:16], app_key [16:32], dev_iv [32:36], app_iv [36:40]
 *   SPEC    : nonce = iv || 00000000 || counter LE32; payload = counter LE16 || AES-CCM(key, nonce, frame, tag 4)
 *
 * Primitives come from the audited @noble libraries. AES-CCM (RFC 3610) is built
 * here on top of AES-ECB/CBC because @noble/ciphers has no CCM mode; the unit
 * tests check it against Node's OpenSSL aes-128-ccm.
 */
import { p256 } from '@noble/curves/nist.js';
import { cbc, ecb } from '@noble/ciphers/aes.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { md5 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';

const LTMK_IV = Uint8Array.from([0x7a, 0xa4, 0xc6, 0x8c, 0x59, 0x0d, 0x40, 0x31, 0xb9, 0x80, 0xd9, 0x8b, 0x41, 0x02, 0x38, 0x00]);
const SALT = new TextEncoder().encode('smartcfg-login-salt');
const INFO = new TextEncoder().encode('smartcfg-login-info');
export const LOGIN_CCM_NONCE = Uint8Array.from({ length: 12 }, (_, i) => 16 + i);

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

/** AES-CCM (RFC 3610) with no associated data. Returns ciphertext || tag. */
export function ccmEncrypt(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array, tagLen = 4): Uint8Array {
  const { s0, stream } = ccmKeystream(key, nonce, plaintext.length);
  const ct = plaintext.map((b, i) => b ^ stream[i]);
  const mac = cbcMac(key, nonce, plaintext, tagLen);
  const tag = mac.slice(0, tagLen).map((b, i) => b ^ s0[i]);
  return concat(ct, tag);
}

/** AES-CCM decrypt + verify. Throws if the tag does not match. */
export function ccmDecrypt(key: Uint8Array, nonce: Uint8Array, data: Uint8Array, tagLen = 4): Uint8Array {
  if (data.length < tagLen) throw new Error('CCM: message too short');
  const ct = data.slice(0, data.length - tagLen);
  const { s0, stream } = ccmKeystream(key, nonce, ct.length);
  const pt = ct.map((b, i) => b ^ stream[i]);
  const expected = cbcMac(key, nonce, pt, tagLen).slice(0, tagLen).map((b, i) => b ^ s0[i]);
  const got = data.slice(data.length - tagLen);
  let diff = 0;
  for (let i = 0; i < tagLen; i++) diff |= expected[i] ^ got[i];
  if (diff) throw new Error('CCM: authentication failed');
  return pt;
}

function ccmL(nonce: Uint8Array) {
  const L = 15 - nonce.length;
  if (L < 2 || L > 8) throw new Error('CCM: bad nonce length');
  return L;
}

function ccmKeystream(key: Uint8Array, nonce: Uint8Array, n: number) {
  const L = ccmL(nonce);
  const blocks = Math.ceil(n / 16) + 1;
  const ctr = new Uint8Array(blocks * 16);
  for (let i = 0; i < blocks; i++) {
    const a = ctr.subarray(i * 16, i * 16 + 16);
    a[0] = L - 1;
    a.set(nonce, 1);
    let c = i;
    for (let j = 15; j > 15 - L; j--) {
      a[j] = c & 0xff;
      c = Math.floor(c / 256);
    }
  }
  const ks = ecb(key, { disablePadding: true }).encrypt(ctr);
  return { s0: ks.slice(0, 16), stream: ks.slice(16) };
}

function cbcMac(key: Uint8Array, nonce: Uint8Array, pt: Uint8Array, tagLen: number) {
  const L = ccmL(nonce);
  const b0 = new Uint8Array(16);
  b0[0] = (((tagLen - 2) / 2) << 3) | (L - 1); // Adata = 0
  b0.set(nonce, 1);
  let len = pt.length;
  for (let j = 15; j > 15 - L; j--) {
    b0[j] = len & 0xff;
    len = Math.floor(len / 256);
  }
  const padded = new Uint8Array(16 + Math.ceil(pt.length / 16) * 16);
  padded.set(b0, 0);
  padded.set(pt, 16);
  const out = cbc(key, new Uint8Array(16), { disablePadding: true }).encrypt(padded);
  return out.slice(out.length - 16);
}

/** CRC-32 (IEEE, as zlib.crc32). */
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c ^= data[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Normalises a pasted cloud key: hex only, 64 hex chars (32 bytes). Returns null if invalid. */
export function parseCloudKey(input: string): Uint8Array | null {
  const hex = input.replace(/[\s:-]/g, '');
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** LTMK = AES-128-CBC-NoPadding-decrypt(MD5(PIN), fixed IV, cloud key). */
export function ltmkFromCloudKey(cloudKey: Uint8Array, pin: string): Uint8Array {
  return cbc(md5(new TextEncoder().encode(pin)), LTMK_IV, { disablePadding: true }).decrypt(cloudKey);
}

export interface SessionKeys {
  devKey: Uint8Array;
  appKey: Uint8Array;
  devIv: Uint8Array;
  appIv: Uint8Array;
}

export interface EphemeralKey {
  secret: Uint8Array;
  /** 64 bytes X || Y */
  publicXY: Uint8Array;
}

/** `seed` must be at least 48 random bytes (noble's minimum for P-256). */
export function ephemeralKey(seed: Uint8Array): EphemeralKey {
  const secret = p256.utils.randomSecretKey(seed);
  return { secret, publicXY: p256.getPublicKey(secret, false).slice(1) };
}

/** Computes the session keys and the login proof from the scooter's 64-byte public key. */
export function loginProof(ours: EphemeralKey, scooterPubXY: Uint8Array, ltmk: Uint8Array): { keys: SessionKeys; proof: Uint8Array } {
  if (scooterPubXY.length !== 64) throw new Error('Scooter public key must be 64 bytes');
  const shared = p256.getSharedSecret(ours.secret, concat(Uint8Array.of(4), scooterPubXY), true).slice(1);
  const derived = hkdf(sha256, concat(shared, ltmk), SALT, INFO, 64);
  const crc = crc32(scooterPubXY);
  const crcLe = Uint8Array.of(crc & 0xff, (crc >>> 8) & 0xff, (crc >>> 16) & 0xff, crc >>> 24);
  return {
    keys: { devKey: derived.slice(0, 16), appKey: derived.slice(16, 32), devIv: derived.slice(32, 36), appIv: derived.slice(36, 40) },
    proof: ccmEncrypt(derived.slice(16, 32), LOGIN_CCM_NONCE, crcLe),
  };
}

const specNonce = (iv: Uint8Array, counter: number) =>
  concat(iv, new Uint8Array(4), Uint8Array.of(counter & 0xff, (counter >>> 8) & 0xff, (counter >>> 16) & 0xff, (counter >>> 24) & 0xff));

/** Encrypts an app->scooter SPEC frame: counter LE16 || CCM ciphertext+tag. */
export function encryptSpec(keys: SessionKeys, counter: number, frame: Uint8Array): Uint8Array {
  return concat(Uint8Array.of(counter & 0xff, (counter >> 8) & 0xff), ccmEncrypt(keys.appKey, specNonce(keys.appIv, counter), frame));
}

/** Decrypts a scooter->app SPEC payload (counter taken from its first two bytes). */
export function decryptSpec(keys: SessionKeys, payload: Uint8Array): Uint8Array {
  const counter = payload[0] | (payload[1] << 8);
  return ccmDecrypt(keys.devKey, specNonce(keys.devIv, counter), payload.slice(2));
}
