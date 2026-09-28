import * as SecureStore from 'expo-secure-store';
import type { XiaomiCredentials } from '../protocols/xiaomiSecure/XiaomiT2336Protocol';

/**
 * The owner's Xiaomi scooter key (the encrypted BLE key from their Xiaomi account,
 * 64 hex chars) and scooter PIN. Together they let anyone nearby log in to the
 * scooter, so they are kept in the OS keystore (expo-secure-store), stay on this
 * phone, and are never exported, logged or shown again after saving.
 */
const KEY = 'sh.xiaomi.t2336.cloudKey';
const PIN = 'sh.xiaomi.t2336.pin';

export async function loadXiaomiCredentials(): Promise<XiaomiCredentials | null> {
  const [cloudKeyHex, pin] = await Promise.all([SecureStore.getItemAsync(KEY), SecureStore.getItemAsync(PIN)]);
  return cloudKeyHex && pin ? { cloudKeyHex, pin } : null;
}

export async function saveXiaomiCredentials(c: XiaomiCredentials) {
  await SecureStore.setItemAsync(KEY, c.cloudKeyHex.replace(/[\s:-]/g, '').toLowerCase());
  await SecureStore.setItemAsync(PIN, c.pin);
}

export async function clearXiaomiCredentials() {
  await SecureStore.deleteItemAsync(KEY);
  await SecureStore.deleteItemAsync(PIN);
}

export async function hasXiaomiCredentials() {
  return (await loadXiaomiCredentials()) !== null;
}
