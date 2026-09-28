// Notification subscriptions started by the developer in BLE LAB. Kept at
// module level so they survive tab switches and can be listed / stopped.
import { create } from 'zustand';
import { shortUuid } from '../../ble/uuids';
import { getSession } from '../../services/ScooterManager';
import { devLog } from '../../store/devlog';
import { charKey } from './charStats';

const unsubs = new Map<string, () => void>();

interface LabSubsState {
  keys: Record<string, true>;
}
export const useLabSubs = create<LabSubsState>(() => ({ keys: {} }));

export const useLabSubscribed = (service: string, char: string) => useLabSubs((s) => !!s.keys[charKey(service, char)]);
export const useLabSubCount = () => useLabSubs((s) => Object.keys(s.keys).length);

/** User-initiated only. Values flow into charStats / the capture via BleSession. */
export function labSubscribe(service: string, char: string): boolean {
  const k = charKey(service, char);
  const session = getSession();
  if (!session || unsubs.has(k)) return false;
  const un = session.subscribe(service, char, (b) => devLog('rx', `notify ${shortUuid(char)}`, b));
  unsubs.set(k, un);
  devLog('info', `BLE LAB subscribed to ${shortUuid(char)}`);
  useLabSubs.setState((s) => ({ keys: { ...s.keys, [k]: true } }));
  return true;
}

export function labUnsubscribe(service: string, char: string) {
  const k = charKey(service, char);
  const un = unsubs.get(k);
  if (!un) return;
  un();
  unsubs.delete(k);
  devLog('info', `BLE LAB unsubscribed from ${shortUuid(char)}`);
  useLabSubs.setState((s) => {
    const { [k]: _drop, ...rest } = s.keys;
    return { keys: rest };
  });
}

export function labUnsubscribeAll() {
  unsubs.forEach((un) => {
    try {
      un();
    } catch {
      /* session may already be gone */
    }
  });
  unsubs.clear();
  useLabSubs.setState({ keys: {} });
}

/** Called when the connection drops: BleSession already removed its monitors. */
export function forgetLabSubs() {
  unsubs.clear();
  if (Object.keys(useLabSubs.getState().keys).length) useLabSubs.setState({ keys: {} });
}
