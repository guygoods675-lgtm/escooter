import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import type { PropMap } from '../protocols/xiaomiSecure/spec';
import { XIAOMI_SCOOTER_PIDS, type XiaomiCredentials } from '../protocols/xiaomiSecure/XiaomiT2336Protocol';

/**
 * Xiaomi scooter keys (the Bluetooth key from the owner's Xiaomi account) and PINs.
 * Together they let anyone nearby log in to the scooter, so they are kept in the OS
 * keystore (expo-secure-store), stay on this phone, and are never exported or logged.
 * The official property list per model is public data and lives in AsyncStorage.
 */
const LIST = 'sh.xiaomi.scooters';
// v3.1.0 stored a single 4 Pro 2nd Gen key under these names.
const LEGACY_KEY = 'sh.xiaomi.t2336.cloudKey';
const LEGACY_PIN = 'sh.xiaomi.t2336.pin';
const mapKey = (model: string) => `sh.xiaomi.map.${model.replace(/[^a-z0-9.]/gi, '_')}`;

type Stored = Omit<XiaomiCredentials, 'map'> & { model: string };

async function readList(): Promise<Stored[]> {
  const raw = await SecureStore.getItemAsync(LIST);
  const list: Stored[] = raw ? JSON.parse(raw) : [];
  const [k, p] = await Promise.all([SecureStore.getItemAsync(LEGACY_KEY), SecureStore.getItemAsync(LEGACY_PIN)]);
  if (k && p && !list.some((x) => x.model === 'xiaomi.scooter.t2336')) list.push({ model: 'xiaomi.scooter.t2336', cloudKeyHex: k, pin: p, encryptType: 1 });
  return list;
}

/** Credentials for the scooter with this MiBeacon product id (or the only saved one if the id is unknown). */
export async function loadXiaomiCredentials(productId: number | null): Promise<XiaomiCredentials | null> {
  const list = await readList();
  const wanted = productId !== null ? XIAOMI_SCOOTER_PIDS[productId]?.model : undefined;
  const hit = wanted ? list.find((x) => x.model === wanted) : list.length === 1 ? list[0] : undefined;
  if (!hit) return null;
  const rawMap = await AsyncStorage.getItem(mapKey(hit.model));
  return { ...hit, map: rawMap ? (JSON.parse(rawMap) as PropMap) : undefined };
}

export async function saveXiaomiCredentials(c: XiaomiCredentials) {
  const model = c.model ?? 'xiaomi.scooter.t2336';
  const entry: Stored = { model, name: c.name, cloudKeyHex: c.cloudKeyHex.replace(/[\s:-]/g, '').toLowerCase(), pin: c.pin, encryptType: c.encryptType ?? 1 };
  const list = (await readList()).filter((x) => x.model !== model);
  await SecureStore.setItemAsync(LIST, JSON.stringify([...list, entry]));
  await SecureStore.deleteItemAsync(LEGACY_KEY);
  await SecureStore.deleteItemAsync(LEGACY_PIN);
  if (c.map) await AsyncStorage.setItem(mapKey(model), JSON.stringify(c.map));
}

export async function clearXiaomiCredentials() {
  for (const x of await readList()) await AsyncStorage.removeItem(mapKey(x.model));
  await SecureStore.deleteItemAsync(LIST);
  await SecureStore.deleteItemAsync(LEGACY_KEY);
  await SecureStore.deleteItemAsync(LEGACY_PIN);
}

/** Saved scooters (names and models only, never keys). */
export async function listXiaomiScooters(): Promise<{ model: string; name?: string }[]> {
  return (await readList()).map(({ model, name }) => ({ model, name }));
}

export async function hasXiaomiCredentials() {
  return (await readList()).length > 0;
}
