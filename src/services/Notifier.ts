import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { useLive } from '../store/live';
import { maintenanceStatus, useMaintenance } from '../store/maintenance';
import { useGarage } from '../store/garage';
import { Settings, useSettings } from '../store/settings';

/**
 * Alert categories. Each one has its own switch in Settings; an alert only
 * fires when its category is on. Everything is local: no push server.
 */
export type AlertCategory = 'lowBattery' | 'highTemp' | 'error' | 'disconnect' | 'maintenance' | 'chargingComplete' | 'abnormal' | 'info';

const TOGGLE: Record<AlertCategory, keyof Settings | null> = {
  lowBattery: 'notifyLowBattery',
  highTemp: 'notifyHighTemp',
  error: 'notifyErrors',
  disconnect: 'notifyDisconnect',
  maintenance: 'notifyMaintenance',
  chargingComplete: 'notifyChargingComplete',
  abnormal: 'notifyAbnormal',
  info: null,
};

let permission: boolean | null = null;

export async function initNotifications() {
  // In the foreground the in-app banner already shows the alert, so the OS banner is suppressed.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('scooter-alerts', { name: 'Scooter alerts', importance: Notifications.AndroidImportance.HIGH }).catch(() => undefined);
  }
}

async function ensurePermission(): Promise<boolean> {
  if (permission != null) return permission;
  try {
    const cur = await Notifications.getPermissionsAsync();
    permission = cur.granted || (await Notifications.requestPermissionsAsync()).granted;
  } catch {
    permission = false;
  }
  return permission;
}

export function notify(category: AlertCategory, title: string, body: string, level: 'info' | 'warning' | 'critical' = 'warning') {
  const s = useSettings.getState();
  const key = TOGGLE[category];
  if (key && !s[key]) return;
  useLive.getState().pushAlert({ level, title, body });
  if (!s.systemNotifications || category === 'info') return;
  ensurePermission().then((ok) => {
    if (!ok) return;
    Notifications.scheduleNotificationAsync({ content: { title, body, data: { category } }, trigger: null }).catch(() => undefined);
  });
}

/** Schedules OS reminders for maintenance items with a next date (user-set intervals only). */
export async function scheduleMaintenanceReminders() {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(scheduled.filter((n) => n.content.data?.category === 'maintenance').map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
    const s = useSettings.getState();
    if (!s.notifyMaintenance || !s.systemNotifications || !(await ensurePermission())) return;
    const scooters = useGarage.getState().scooters;
    const now = Date.now();
    const upcoming = useMaintenance
      .getState()
      .items.map((i) => ({ i, st: maintenanceStatus(i, scooters.find((x) => x.id === i.scooterId)?.lastOdometerKm ?? null) }))
      .filter((x) => x.st.nextDate != null && x.st.nextDate > now)
      .sort((a, b) => a.st.nextDate! - b.st.nextDate!)
      .slice(0, 20);
    for (const { i, st } of upcoming) {
      const name = scooters.find((x) => x.id === i.scooterId)?.nickname ?? 'Scooter';
      await Notifications.scheduleNotificationAsync({
        content: { title: `Maintenance due: ${i.name}`, body: `${name}: the reminder you set for ${i.name.toLowerCase()} is due.`, data: { category: 'maintenance' } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(st.nextDate!) },
      });
    }
  } catch {
    /* notifications unavailable (e.g. web) */
  }
}

/** In-app check at startup: items already due or due soon. */
export function checkMaintenanceNow() {
  const scooters = useGarage.getState().scooters;
  const items = useMaintenance.getState().items;
  const due = items.filter((i) => {
    const st = maintenanceStatus(i, scooters.find((x) => x.id === i.scooterId)?.lastOdometerKm ?? null).status;
    return st === 'due' && i.history.length > 0;
  });
  if (due.length) notify('maintenance', 'Maintenance due', `${due.length} item${due.length > 1 ? 's are' : ' is'} due: ${due.slice(0, 3).map((d) => d.name).join(', ')}`, 'info');
}
