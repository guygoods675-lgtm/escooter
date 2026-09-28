import * as Haptics from 'expo-haptics';
import { BleSession, onAdapterState, requestBlePermissions } from '../ble/BluetoothManager';
import { ProtocolId, modelById } from '../data/scooterDatabase';
import { detectProtocol } from '../protocols/registry';
import { acquirePhoneGps } from './motion';
import type { ScooterProtocol } from '../protocols/types';
import { devLog } from '../store/devlog';
import { useErrors } from '../store/errors';
import { useGarage } from '../store/garage';
import { useLive } from '../store/live';
import { useSettings } from '../store/settings';
import { notify } from './Notifier';
import { useActiveRide, startRide } from './RideTracker';
import { updateWidgets } from '../widgets/updateWidgets';
import { clearHistory, recordSnapshot } from './telemetryHistory';
import { feedback } from './Feedback';
import { getLastFix } from './GPSManager';
import { reading } from '../protocols/types';

/**
 * ScooterManager sits between the UI and the BLE/protocol layers:
 *   UI -> ScooterManager -> BleSession (BLE) -> ScooterProtocol -> model decoder
 * It owns the connection lifecycle, polling loop, error tracking and alerts.
 */

let session: BleSession | null = null;
let protocol: ScooterProtocol | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let rssiTimer: ReturnType<typeof setInterval> | null = null;
let userDisconnect = false;
let reconnectAttempts = 0;
let lowBatteryWarned = false;
let lastBatteryPoll = 0;
let autoRideCounter = 0;
let wasCharging: boolean | null = null;
let chargeDoneNotified = false;

const POLL_MS = 600;
const BATTERY_POLL_MS = 8000;
const MAX_RECONNECTS = 6;

export function initScooterManager() {
  // Light haptic tick on every connection-state step (searching → found → connecting → reading → connected).
  let prev = useLive.getState().conn;
  const unsubConn = useLive.subscribe((st) => {
    if (st.conn === prev) return;
    prev = st.conn;
    if (['found', 'connecting', 'identifying'].includes(st.conn) && useSettings.getState().haptics) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    updateWidgets();
  });
  const unsubAdapter = onAdapterState((s) => useLive.getState().patch({ adapter: s }));
  return () => {
    unsubConn();
    unsubAdapter();
  };
}

let releaseConnGps: (() => void) | null = null;

export async function connectScooter(deviceId: string, advertisedName: string | null) {
  const live = useLive.getState();
  if (live.conn === 'connecting' || live.conn === 'identifying') return;
  if (session) await disconnectScooter();
  userDisconnect = false;
  if (!(await requestBlePermissions())) {
    live.patch({ conn: 'error', connError: 'Bluetooth permission denied' });
    return;
  }
  live.patch({ conn: reconnectAttempts > 0 ? 'reconnecting' : 'connecting', connError: null, deviceId, deviceName: advertisedName });
  try {
    const timeout = useSettings.getState().connectionTimeoutSec * 1000;
    session = await BleSession.open(deviceId, timeout, onUnexpectedDisconnect);
    const name = session.name ?? advertisedName;
    const profile = useGarage.getState().upsertFromConnection(deviceId, name);
    // A saved auto-detected 'generic-ble' is never reused: it would skip detection forever
    // (john's 4 Pro 2nd Gen stayed "Generic BLE" after updating to a version that supports it).
    const saved = profile.protocolId === 'generic-ble' ? null : profile.protocolId;
    const preferred: ProtocolId | null = profile.manualModel ? modelById(profile.modelId)?.protocol ?? null : saved;
    live.patch({ conn: 'identifying', services: session.services, deviceName: name, scooterId: profile.id });

    const det = await detectProtocol(session, preferred, name, profile.protocolId as ProtocolId | null);
    protocol = det.protocol;
    const identity = { ...(await protocol.identify()), bleName: name, bleId: deviceId };
    // If the scooter didn't report a model, fall back to the user's manual choice.
    const model = profile.manualModel ? modelById(profile.modelId) : null;
    useGarage.getState().update(profile.id, { protocolId: protocol.id as ProtocolId, identity, lastConnected: Date.now() });
    useGarage.getState().logConnection(profile.id, protocol.id);
    const extras = protocol.readExtras ? await protocol.readExtras().catch(() => null) : null;
    if (extras?.totalRideTimeSec) useGarage.getState().update(profile.id, { totalRideTimeSec: extras.totalRideTimeSec.value });
    wasCharging = null;
    chargeDoneNotified = false;
    clearHistory();
    lowBatteryWarned = false;
    reconnectAttempts = 0;
    live.patch({
      conn: 'connected',
      connectedAt: Date.now(),
      protocolId: protocol.id,
      protocolName: protocol.name,
      detectionNote: det.note + (model ? ` Model set manually: ${model.manufacturer} ${model.model}.` : ''),
      setupAction: det.action ?? null,
      capabilities: protocol.capabilities,
      identity,
      snapshot: null,
      battery: null,
      extras,
      sessionMaxSpeed: null,
    });
    feedback('connect');
    // No live speed from this scooter: keep phone GPS on while connected so the gauge can
    // show the phone's speed, labelled "Phone GPS".
    startPolling(); // stops any previous polling (and its GPS hold) first
    if (!protocol.capabilities.telemetry.includes('speedKmh')) releaseConnGps = acquirePhoneGps();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    devLog('error', `Connect failed: ${msg}`);
    await session?.close();
    session = null;
    protocol = null;
    if (reconnectAttempts > 0) scheduleReconnect(deviceId, advertisedName);
    else live.patch({ conn: 'error', connError: msg });
  }
}

function startPolling() {
  stopPolling();
  const loop = async () => {
    if (!protocol || !session) return;
    try {
      const scooterSnap = await protocol.poll();
      recordSnapshot(scooterSnap);
      const live = useLive.getState();
      const speed = scooterSnap.speedKmh?.value ?? null;
      const max = speed != null ? Math.max(live.sessionMaxSpeed ?? 0, speed) : live.sessionMaxSpeed;
      // Scooters without a live speed value (Xiaomi 4 Pro 2nd Gen) show the phone's GPS speed
      // (GPS is held on while connected), labelled "Phone GPS". Never stored as scooter data.
      let snap = scooterSnap;
      const fix = getLastFix();
      if (!scooterSnap.speedKmh && !protocol.capabilities.telemetry.includes('speedKmh') && fix?.speedKmh != null && Date.now() - fix.t < 3000) {
        snap = { ...scooterSnap, speedKmh: reading(fix.speedKmh, 'phone') };
      }
      live.patch({ snapshot: snap, sessionMaxSpeed: max });
      trackProfile(speed, snap.odometerKm?.value ?? null);
      handleErrors();
      handleAlerts();
      handleAutoRide(speed);
      if (Date.now() - lastBatteryPoll > BATTERY_POLL_MS && protocol.capabilities.battery) {
        lastBatteryPoll = Date.now();
        const battery = await protocol.pollBattery();
        live.patch({ battery });
        handleCharging(battery.charging?.value ?? null, battery.percent?.value ?? snap.batteryPercent?.value ?? null);
      }
      updateWidgets();
    } catch (e) {
      devLog('error', `Poll failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    pollTimer = setTimeout(loop, POLL_MS);
  };
  lastBatteryPoll = 0;
  loop();
  rssiTimer = setInterval(async () => {
    const r = await session?.readRssi();
    if (r != null) useLive.getState().patch({ rssi: r });
  }, 3000);
}

function stopPolling() {
  releaseConnGps?.();
  releaseConnGps = null;
  if (pollTimer) clearTimeout(pollTimer);
  if (rssiTimer) clearInterval(rssiTimer);
  pollTimer = null;
  rssiTimer = null;
}

function trackProfile(speed: number | null, odo: number | null) {
  const id = useLive.getState().scooterId;
  if (!id) return;
  const p = useGarage.getState().scooters.find((s) => s.id === id);
  if (!p) return;
  const patch: Record<string, number> = {};
  if (speed != null && speed > (p.highestSpeedKmh ?? 0)) patch.highestSpeedKmh = speed;
  if (odo != null && odo !== p.lastOdometerKm) patch.lastOdometerKm = odo;
  if (Object.keys(patch).length) useGarage.getState().update(id, patch);
}

function handleErrors() {
  if (!protocol) return;
  const live = useLive.getState();
  const active = protocol.getErrors().map((e) => {
    const info = protocol!.describeError(e.code, e.kind);
    return { code: e.code, kind: e.kind, title: info.title, severity: info.severity, causes: info.causes, source: info.source };
  });
  const fresh = useErrors.getState().observe(live.scooterId, active);
  for (const f of fresh) {
    if (f.kind === 'warning') {
      // Scooter-reported alarm/warning code: the only "abnormal telemetry" we can detect reliably.
      notify('abnormal', `Scooter warning ${f.code}`, `${f.title}. Reported by the scooter.`, 'warning');
    } else {
      notify('error', `Error ${f.code}`, f.title, f.severity === 'CRITICAL' ? 'critical' : 'warning');
      if (/overheat/i.test(f.title)) notify('highTemp', 'High temperature', `The scooter reports: ${f.title}.`, 'critical');
    }
  }
  if (fresh.length) feedback('warning');
}

function handleCharging(charging: boolean | null, percent: number | null) {
  if (charging == null) return;
  // "Charging complete" = the BMS reports 100 %, or the BMS charging flag turns off at 98 % or more.
  const done = (charging && percent === 100) || (wasCharging === true && !charging && percent != null && percent >= 98);
  if (done && !chargeDoneNotified) {
    chargeDoneNotified = true;
    notify('chargingComplete', 'Charging complete', `Battery at ${percent}% (reported by the BMS).`, 'info');
  }
  if (charging && percent != null && percent < 95) chargeDoneNotified = false;
  wasCharging = charging;
}

function handleAlerts() {
  const s = useSettings.getState();
  const live = useLive.getState();
  const b = live.snapshot?.batteryPercent?.value;
  if (s.notifyLowBattery && b != null) {
    if (b <= s.lowBatteryPercent && !lowBatteryWarned) {
      lowBatteryWarned = true;
      notify('lowBattery', 'Low battery', `Battery at ${b}% (your alert threshold is ${s.lowBatteryPercent}%).`);
    } else if (b > s.lowBatteryPercent + 5) lowBatteryWarned = false;
  }
}

function handleAutoRide(speed: number | null) {
  if (!useSettings.getState().autoRideDetection || useActiveRide.getState().active) return;
  // Starts a ride after ~5 s of continuous movement reported by the scooter.
  autoRideCounter = speed != null && speed > 5 ? autoRideCounter + 1 : 0;
  if (autoRideCounter * POLL_MS >= 5000) {
    autoRideCounter = 0;
    startRide();
    notify('info', 'Ride started', 'Automatic ride detection started recording.', 'info');
  }
}

function onUnexpectedDisconnect() {
  stopPolling();
  const live = useLive.getState();
  protocol?.disconnect();
  protocol = null;
  session = null;
  useErrors.getState().markAllInactive(live.scooterId);
  if (live.scooterId) useGarage.getState().endConnection(live.scooterId);
  if (userDisconnect) {
    live.patch({ conn: 'disconnected', connectedAt: null });
    return;
  }
  notify('disconnect', 'Scooter disconnected', useSettings.getState().reconnect === 'auto' ? 'The Bluetooth connection was lost. Reconnecting…' : 'The Bluetooth connection was lost.');
  feedback('disconnect');
  if (useSettings.getState().reconnect === 'auto' && live.deviceId) {
    reconnectAttempts = 1;
    scheduleReconnect(live.deviceId, live.deviceName);
  } else live.patch({ conn: 'disconnected', connectedAt: null });
}

function scheduleReconnect(deviceId: string, name: string | null) {
  if (userDisconnect || reconnectAttempts > MAX_RECONNECTS) {
    reconnectAttempts = 0;
    useLive.getState().patch({ conn: 'disconnected', connectedAt: null });
    return;
  }
  useLive.getState().patch({ conn: 'reconnecting' });
  const delay = Math.min(1000 * 2 ** (reconnectAttempts - 1), 15000);
  devLog('conn', `Reconnect attempt ${reconnectAttempts} in ${delay} ms`);
  setTimeout(() => {
    if (userDisconnect) return;
    reconnectAttempts++;
    connectScooter(deviceId, name);
  }, delay);
}

export async function disconnectScooter() {
  userDisconnect = true;
  reconnectAttempts = 0;
  stopPolling();
  await protocol?.disconnect();
  await session?.close();
  protocol = null;
  session = null;
  const sid = useLive.getState().scooterId;
  useErrors.getState().markAllInactive(sid);
  if (sid) useGarage.getState().endConnection(sid);
  useLive.getState().patch({ conn: 'disconnected', connectedAt: null, rssi: null });
}

export async function refreshBattery() {
  if (!protocol) return;
  lastBatteryPoll = Date.now();
  useLive.getState().patch({ battery: await protocol.pollBattery() });
}

export async function sendScooterCommand(id: string, value: number) {
  if (!protocol) throw new Error('Not connected');
  await protocol.sendCommand(id, value);
  feedback('success');
}

/** Reconnects to the current scooter (e.g. after saving a Xiaomi key). */
export async function reconnectCurrent() {
  const { deviceId, deviceName } = useLive.getState();
  if (!deviceId) return;
  await disconnectScooter();
  await connectScooter(deviceId, deviceName);
}

export const getSession = () => session;
export const getProtocol = () => protocol;
