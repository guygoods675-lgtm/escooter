/**
 * Request signing and RC4 payload encryption for the Xiaomi cloud API, as used to
 * download the owner's scooter Bluetooth key (/share/askbluetoothkey).
 *
 * Ported from Xiaomi-cloud-tokens-extractor by Piotr Machowski (MIT), as shipped in
 * https://github.com/mehesbalazs/xiaomi-scooter-4-pro-2/blob/main/tokens/token_extractor.py
 * (XiaomiCloudConnector.signed_nonce, generate_nonce, generate_enc_signature,
 * generate_enc_params, encrypt_rc4, decrypt_rc4) and tokens/get_ltmk.py.
 * Pure functions only, so they can be unit-tested outside React Native.
 */
import { sha1 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { base64ToBytes, bytesToBase64 } from '../utils/bytes';

export const XIAOMI_SERVERS = ['de', 'cn', 'us', 'ru', 'tw', 'sg', 'in', 'i2'] as const;
export type XiaomiServer = (typeof XIAOMI_SERVERS)[number];

export const apiUrl = (server: string) => `https://${server === 'cn' ? '' : `${server}.`}api.io.mi.com/app`;

const utf8 = (s: string) => new TextEncoder().encode(s);

/** "&&&START&&&{json}" -> object */
export const parseStartJson = (text: string) => JSON.parse(text.replace('&&&START&&&', ''));

/** nonce = base64(8 random bytes || floor(millis / 60000) as u32 BE) */
export function makeNonce(random8: Uint8Array, millis: number): string {
  const m = Math.floor(millis / 60000);
  return bytesToBase64(Uint8Array.from([...random8.slice(0, 8), (m >>> 24) & 0xff, (m >>> 16) & 0xff, (m >>> 8) & 0xff, m & 0xff]));
}

export function signedNonce(ssecurity: string, nonce: string): string {
  return bytesToBase64(sha256(Uint8Array.from([...base64ToBytes(ssecurity), ...base64ToBytes(nonce)])));
}

/** RC4 with the first 1024 keystream bytes dropped (key = base64-decoded signed nonce). */
export function rc4(keyB64: string, data: Uint8Array): Uint8Array {
  const key = base64ToBytes(keyB64);
  const S = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 0xff;
    [S[i], S[j]] = [S[j], S[i]];
  }
  let i = 0;
  j = 0;
  const next = () => {
    i = (i + 1) & 0xff;
    j = (j + S[i]) & 0xff;
    [S[i], S[j]] = [S[j], S[i]];
    return S[(S[i] + S[j]) & 0xff];
  };
  for (let k = 0; k < 1024; k++) next();
  return data.map((b) => b ^ next());
}

export function encSignature(url: string, method: string, signedNonceB64: string, params: [string, string][]): string {
  const path = url.split('com')[1].replace('/app/', '/');
  const parts = [method.toUpperCase(), path, ...params.map(([k, v]) => `${k}=${v}`), signedNonceB64];
  return bytesToBase64(sha1(utf8(parts.join('&'))));
}

/** Returns the ordered query fields for an encrypted API call. */
export function encParams(url: string, method: string, signedNonceB64: string, nonce: string, params: [string, string][], ssecurity: string): [string, string][] {
  const withHash: [string, string][] = [...params, ['rc4_hash__', encSignature(url, method, signedNonceB64, params)]];
  const encrypted: [string, string][] = withHash.map(([k, v]) => [k, bytesToBase64(rc4(signedNonceB64, utf8(v)))]);
  return [...encrypted, ['signature', encSignature(url, method, signedNonceB64, encrypted)], ['ssecurity', ssecurity], ['_nonce', nonce]];
}

export const toQuery = (fields: [string, string][]) => fields.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

/** Decrypts an encrypted API response body (base64 RC4 with signed_nonce(_nonce)). */
export function decryptResponse(ssecurity: string, nonce: string, body: string): string {
  const pt = rc4(signedNonce(ssecurity, nonce), base64ToBytes(body.trim()));
  return new TextDecoder('utf-8').decode(pt);
}
