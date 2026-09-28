import { DeviceMotion, type DeviceMotionMeasurement } from 'expo-sensors';
import { useEffect, useSyncExternalStore } from 'react';
import { useLive } from '../store/live';
import { GpsFix, getLastFix, onGps, startGps, stopGps } from './GPSManager';
import { useActiveRide } from './RideTracker';
import { getSeries } from './telemetryHistory';

/**
 * Live acceleration from three independent sources, each kept separate and
 * labelled on screen:
 *  - scooter: Δspeed/Δt of scooter-reported speed (telemetryHistory 'accel'), longitudinal only. Calculated.
 *  - gps:     Δ GPS speed/Δt between phone fixes, longitudinal only. Estimated.
 *  - phone:   DeviceMotion gravity-removed acceleration. Longitudinal/lateral only after a mount
 *             calibration; otherwise magnitude only. Measured, mount-dependent.
 * Sensors sample at 25 Hz; subscribers are notified at most ~15 times per second.
 */

export const G = 9.80665;
export type MotionSourceId = 'scooter' | 'gps' | 'phone';

export interface SourceReading {
  /** When the latest value was produced; null = never. */
  t: number | null;
  /** Forward acceleration in m/s² (negative = braking). */
  longMs2: number | null;
  /** Lateral acceleration in m/s² (positive = towards the phone's calibrated right side). Phone only. */
  latMs2: number | null;
  /** Magnitude in m/s² (phone uncalibrated uses this). */
  magMs2: number | null;
  available: boolean;
  reason: string | null;
}

export interface Peaks {
  accel: number | null; // max positive longitudinal, m/s²
  brake: number | null; // max braking deceleration (positive number), m/s²
  mag: number | null; // max magnitude, m/s² (phone uncalibrated)
}

export type CalibStatus = 'none' | 'still' | 'moving' | 'done' | 'failed';

export interface MotionState {
  running: boolean;
  scooter: SourceReading;
  gps: SourceReading;
  phone: SourceReading;
  calib: { status: CalibStatus; message: string | null; progress: number };
  calibrated: boolean;
  peaks: Record<MotionSourceId, Peaks>;
  /** Recent plot points in g: x = lateral (0 when unknown), y = longitudinal. */
  trail: Record<MotionSourceId, { x: number; y: number }[]>;
}

const emptyReading = (reason: string | null = null): SourceReading => ({ t: null, longMs2: null, latMs2: null, magMs2: null, available: false, reason });
const emptyPeaks = (): Peaks => ({ accel: null, brake: null, mag: null });
const TRAIL_LEN = 30;
const PUBLISH_MS = 66; // ≤ 15 fps
const STALE_MS = 4000;

// ---------- vector helpers (pure, exported for testing) ----------
export type V3 = [number, number, number];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a: V3) => Math.sqrt(dot(a, a));
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const unit = (a: V3): V3 => {
  const n = norm(a);
  return n > 1e-9 ? scale(a, 1 / n) : [0, 0, 0];
};
/** Component of `a` perpendicular to unit axis `g`. */
export const horizontal = (a: V3, g: V3): V3 => sub(a, scale(g, dot(a, g)));

/** Dominant direction of a set of horizontal vectors (principal eigenvector of their covariance), sign chosen so the net sum is positive. */
export function principalAxis(samples: V3[], g: V3): V3 | null {
  if (samples.length < 3) return null;
  const c = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const sum: V3 = [0, 0, 0];
  for (const s of samples) {
    for (let i = 0; i < 3; i++) {
      sum[i] += s[i];
      for (let j = 0; j < 3; j++) c[i * 3 + j] += s[i] * s[j];
    }
  }
  let v: V3 = norm(sum) > 1e-6 ? unit(sum) : unit(horizontal([1, 0.3, 0.2], g));
  for (let k = 0; k < 40; k++) {
    const n: V3 = [c[0] * v[0] + c[1] * v[1] + c[2] * v[2], c[3] * v[0] + c[4] * v[1] + c[5] * v[2], c[6] * v[0] + c[7] * v[1] + c[8] * v[2]];
    const h = horizontal(n, g);
    if (norm(h) < 1e-9) return null;
    v = unit(h);
  }
  // Riding away from a stop gains speed, so the summed acceleration points forward.
  if (dot(v, sum) < 0) v = scale(v, -1);
  return v;
}

// ---------- internal state ----------
let refCount = 0;
let state: MotionState = {
  running: false,
  scooter: emptyReading(),
  gps: emptyReading(),
  phone: emptyReading(),
  calib: { status: 'none', message: null, progress: 0 },
  calibrated: false,
  peaks: { scooter: emptyPeaks(), gps: emptyPeaks(), phone: emptyPeaks() },
  trail: { scooter: [], gps: [], phone: [] },
};
/** The snapshot subscribers see; only replaced when publishing (≤ 15 fps). */
let published: MotionState = state;
const listeners = new Set<() => void>();
let dirty = false;
let publishTimer: ReturnType<typeof setTimeout> | null = null;

function publish(immediate = false) {
  dirty = true;
  if (publishTimer && !immediate) return;
  if (publishTimer) clearTimeout(publishTimer);
  publishTimer = setTimeout(
    () => {
      publishTimer = null;
      if (!dirty) return;
      dirty = false;
      state = { ...state, trail: { scooter: [...trail.scooter], gps: [...trail.gps], phone: [...trail.phone] }, peaks: { scooter: { ...peaks.scooter }, gps: { ...peaks.gps }, phone: { ...peaks.phone } } };
      published = state;
      listeners.forEach((l) => l());
    },
    immediate ? 0 : PUBLISH_MS,
  );
}

const trail: Record<MotionSourceId, { x: number; y: number }[]> = { scooter: [], gps: [], phone: [] };
const peaks: Record<MotionSourceId, Peaks> = { scooter: emptyPeaks(), gps: emptyPeaks(), phone: emptyPeaks() };

function pushTrail(id: MotionSourceId, x: number, y: number) {
  const arr = trail[id];
  arr.push({ x, y });
  if (arr.length > TRAIL_LEN) arr.splice(0, arr.length - TRAIL_LEN);
}
function updatePeaks(id: MotionSourceId, long: number | null, mag: number | null) {
  const p = peaks[id];
  if (long != null) {
    if (long > 0) p.accel = p.accel == null ? long : Math.max(p.accel, long);
    if (long < 0) p.brake = p.brake == null ? -long : Math.max(p.brake, -long);
  }
  if (mag != null) p.mag = p.mag == null ? mag : Math.max(p.mag, mag);
}
function setReading(id: MotionSourceId, r: SourceReading) {
  state = { ...state, [id]: r };
}

// ---------- scooter source ----------
let scooterTimer: ReturnType<typeof setInterval> | null = null;
let lastScooterT = 0;
function pollScooter() {
  const connected = useLive.getState().conn === 'connected';
  const s = getSeries('accel');
  const last = s.length ? s[s.length - 1] : null;
  const now = Date.now();
  if (!connected || !useLive.getState().snapshot?.speedKmh) {
    const reason = connected ? 'This scooter does not report speed' : 'No scooter connected';
    if (state.scooter.available || state.scooter.reason !== reason) {
      setReading('scooter', emptyReading(reason));
      publish();
    }
    return;
  }
  if (last && last.t !== lastScooterT) {
    lastScooterT = last.t;
    setReading('scooter', { t: last.t, longMs2: last.v, latMs2: null, magMs2: Math.abs(last.v), available: true, reason: null });
    updatePeaks('scooter', last.v, null);
    pushTrail('scooter', 0, last.v / G);
    publish();
  } else if (state.scooter.available && state.scooter.t != null && now - state.scooter.t > STALE_MS) {
    setReading('scooter', emptyReading('Waiting for scooter speed samples'));
    publish();
  } else if (!state.scooter.available && state.scooter.reason !== 'Waiting for scooter speed samples') {
    setReading('scooter', emptyReading('Waiting for scooter speed samples'));
    publish();
  }
}

// ---------- phone GPS (shared, ref-counted) ----------
let gpsHolders = 0;
let gpsStartedByUs = false;
let rideUnsub: (() => void) | null = null;
let gpsOk: boolean | null = null;
const gpsOkListeners = new Set<() => void>();
const setGpsOk = (v: boolean | null) => {
  gpsOk = v;
  gpsOkListeners.forEach((l) => l());
};

async function ensureGps() {
  const ok = await startGps();
  gpsStartedByUs = gpsStartedByUs || ok;
  setGpsOk(ok);
}

/**
 * Keep phone GPS on while a screen needs it. Never stops GPS that an active
 * ride recording is using; restarts it if a ride ends while still held.
 */
export function acquirePhoneGps(): () => void {
  gpsHolders++;
  if (gpsHolders === 1) {
    ensureGps().catch(() => setGpsOk(false));
    rideUnsub = useActiveRide.subscribe((s, prev) => {
      if (prev.active && !s.active && gpsHolders > 0) ensureGps().catch(() => setGpsOk(false));
    });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    gpsHolders--;
    if (gpsHolders === 0) {
      rideUnsub?.();
      rideUnsub = null;
      if (gpsStartedByUs && !useActiveRide.getState().active) stopGps();
      gpsStartedByUs = false;
      setGpsOk(null);
    }
  };
}

/** Whether phone location is running for this screen: null = starting, false = denied/disabled. */
export function usePhoneGpsOk() {
  return useSyncExternalStore(
    (cb) => {
      gpsOkListeners.add(cb);
      return () => gpsOkListeners.delete(cb);
    },
    () => gpsOk,
  );
}

let fixVersion = 0;
let currentFix: GpsFix | null = null;
const fixListeners = new Set<() => void>();
let fixUnsub: (() => void) | null = null;
function ensureFixFeed() {
  if (fixUnsub) return;
  fixUnsub = onGps((f) => {
    currentFix = f;
    fixVersion++;
    fixListeners.forEach((l) => l());
  });
}
/** Latest phone GPS fix (re-renders once per fix). Use with acquirePhoneGps(). */
export function usePhoneGpsFix(): GpsFix | null {
  useSyncExternalStore(
    (cb) => {
      ensureFixFeed();
      fixListeners.add(cb);
      return () => {
        fixListeners.delete(cb);
        if (fixListeners.size === 0 && fixUnsub) {
          fixUnsub();
          fixUnsub = null;
        }
      };
    },
    () => fixVersion,
  );
  const f = currentFix ?? getLastFix();
  return f && Date.now() - f.t < 10000 ? f : null;
}

// ---------- GPS source ----------
let gpsSourceUnsub: (() => void) | null = null;
let releaseGps: (() => void) | null = null;
let gpsTimer: ReturnType<typeof setInterval> | null = null;
let prevGps: { t: number; v: number } | null = null;
function onGpsFix(f: GpsFix) {
  if (f.speedKmh == null) return;
  const cur = { t: f.t, v: f.speedKmh };
  if (prevGps) {
    const dt = (cur.t - prevGps.t) / 1000;
    if (dt > 0.5 && dt < 5) {
      const a = (cur.v - prevGps.v) / 3.6 / dt;
      setReading('gps', { t: Date.now(), longMs2: a, latMs2: null, magMs2: Math.abs(a), available: true, reason: null });
      updatePeaks('gps', a, null);
      pushTrail('gps', 0, a / G);
      publish();
    }
  }
  prevGps = cur;
}
function checkGpsStale() {
  if (gpsOk === false) {
    if (state.gps.reason !== 'Location permission denied or location turned off') {
      setReading('gps', emptyReading('Location permission denied or location turned off'));
      publish();
    }
    return;
  }
  if (state.gps.available && state.gps.t != null && Date.now() - state.gps.t > STALE_MS + 2000) {
    setReading('gps', emptyReading('Waiting for GPS speed'));
    publish();
  } else if (!state.gps.available && state.gps.reason !== 'Waiting for GPS speed') {
    setReading('gps', emptyReading('Waiting for GPS speed'));
    publish();
  }
}

// ---------- phone accelerometer ----------
let motionSub: { remove(): void } | null = null;
let accF: V3 | null = null; // low-passed linear acceleration (device frame)
let gravF: V3 | null = null; // slowly filtered gravity (device frame)
const ACC_ALPHA = 0.3;
const GRAV_ALPHA = 0.05;

interface Calibration {
  g: V3; // unit gravity axis
  fwd: V3; // unit forward axis
  lat: V3; // unit lateral axis
}
let calibration: Calibration | null = null;
let calibStillG: V3[] = [];
let calibStillMag: number[] = [];
let calibMove: V3[] = [];
let calibStrong = 0;
let calibStart = 0;
let calibG: V3 | null = null;
let mountMovedSince: number | null = null;
const STILL_MS = 2000;
const MOVE_MIN_MS = 3000;
const MOVE_MAX_MS = 12000;
const STRONG_MS2 = 0.4;
const STRONG_NEEDED = 30; // ~1.2 s of clear acceleration at 25 Hz

function setCalib(status: CalibStatus, message: string | null, progress = 0) {
  const changed = status !== state.calib.status || message !== state.calib.message;
  state = { ...state, calib: { status, message, progress }, calibrated: calibration != null };
  publish(changed);
}

function onMotion(m: DeviceMotionMeasurement) {
  if (!m.acceleration) {
    if (state.phone.reason !== 'This phone does not provide gravity-removed acceleration') {
      setReading('phone', emptyReading('This phone does not provide gravity-removed acceleration'));
      publish();
    }
    return;
  }
  const a: V3 = [m.acceleration.x, m.acceleration.y, m.acceleration.z];
  const inc = m.accelerationIncludingGravity;
  // Gravity in the same frame as `acceleration`, whatever the platform's sign convention.
  const g: V3 = inc ? [inc.x - a[0], inc.y - a[1], inc.z - a[2]] : [0, 0, 0];
  accF = accF ? [accF[0] + ACC_ALPHA * (a[0] - accF[0]), accF[1] + ACC_ALPHA * (a[1] - accF[1]), accF[2] + ACC_ALPHA * (a[2] - accF[2])] : a;
  gravF = gravF ? [gravF[0] + GRAV_ALPHA * (g[0] - gravF[0]), gravF[1] + GRAV_ALPHA * (g[1] - gravF[1]), gravF[2] + GRAV_ALPHA * (g[2] - gravF[2])] : g;
  const now = Date.now();

  // calibration state machine
  const cs = state.calib.status;
  if (cs === 'still') {
    calibStillG.push(g);
    calibStillMag.push(norm(a));
    const el = now - calibStart;
    if (el >= STILL_MS) {
      const meanMag = calibStillMag.reduce((s, x) => s + x, 0) / calibStillMag.length;
      const sumG = calibStillG.reduce<V3>((s, x) => [s[0] + x[0], s[1] + x[1], s[2] + x[2]], [0, 0, 0]);
      if (meanMag > 0.6 || norm(sumG) < 1) {
        setCalib('failed', 'The phone was moving. Keep the scooter and phone completely still, then try again.');
      } else {
        calibG = unit(sumG);
        calibMove = [];
        calibStrong = 0;
        calibStart = now;
        setCalib('moving', 'Now ride off in a straight line and accelerate gently. No need to touch the phone; this finishes by itself.', 0);
      }
    } else setCalib('still', 'Hold still…', el / STILL_MS);
  } else if (cs === 'moving' && calibG) {
    const h = horizontal(accF, calibG);
    calibMove.push(h);
    if (norm(h) > STRONG_MS2) calibStrong++;
    const el = now - calibStart;
    if (calibStrong >= STRONG_NEEDED && el >= MOVE_MIN_MS) {
      const strong = calibMove.filter((v) => norm(v) > STRONG_MS2);
      const fwd = principalAxis(strong, calibG);
      if (!fwd) setCalib('failed', 'Could not find a clear forward direction. Try again on a straight, flat path.');
      else {
        calibration = { g: calibG, fwd, lat: unit(cross(fwd, calibG)) };
        peaks.phone = emptyPeaks();
        trail.phone = [];
        setCalib('done', 'Calibrated for this mount. Recalibrate if you move the phone.', 1);
      }
    } else if (el >= MOVE_MAX_MS) {
      setCalib('failed', 'Not enough forward acceleration was detected. Try again and accelerate a little more firmly (safely).');
    } else {
      setCalib('moving', state.calib.message, Math.min(0.99, calibStrong / STRONG_NEEDED));
    }
  }

  // mount-moved detection
  if (calibration && gravF) {
    const cosang = dot(unit(gravF), calibration.g);
    if (cosang < Math.cos((20 * Math.PI) / 180)) {
      mountMovedSince = mountMovedSince ?? now;
      if (now - mountMovedSince > 1000) {
        calibration = null;
        setCalib('failed', 'The phone orientation changed, so the calibration no longer applies. Recalibrate after mounting the phone.');
      }
    } else mountMovedSince = null;
  }

  if (calibration) {
    const long = dot(accF, calibration.fwd);
    const lat = dot(accF, calibration.lat);
    setReading('phone', { t: now, longMs2: long, latMs2: lat, magMs2: norm(horizontal(accF, calibration.g)), available: true, reason: null });
    updatePeaks('phone', long, null);
    pushTrail('phone', lat / G, long / G);
  } else {
    const mag = norm(accF);
    setReading('phone', { t: now, longMs2: null, latMs2: null, magMs2: mag, available: true, reason: null });
    updatePeaks('phone', null, mag);
  }
  publish();
}

async function startPhone() {
  try {
    const ok = await DeviceMotion.isAvailableAsync();
    if (!ok) {
      setReading('phone', emptyReading('Motion sensors are not available on this device'));
      publish();
      return;
    }
    if (refCount === 0 || motionSub) return;
    DeviceMotion.setUpdateInterval(40); // 25 Hz
    motionSub = DeviceMotion.addListener(onMotion);
    setReading('phone', emptyReading('Waiting for motion data'));
    publish();
  } catch {
    setReading('phone', emptyReading('Motion sensor permission denied or unavailable'));
    publish();
  }
}

// ---------- public API ----------
export function startMotion() {
  refCount++;
  if (refCount > 1) return;
  state = { ...state, running: true, calibrated: calibration != null };
  scooterTimer = setInterval(pollScooter, 100);
  pollScooter();
  releaseGps = acquirePhoneGps();
  gpsSourceUnsub = onGps(onGpsFix);
  gpsTimer = setInterval(checkGpsStale, 1000);
  startPhone();
  publish(true);
}

export function stopMotion() {
  if (refCount === 0) return;
  refCount--;
  if (refCount > 0) return;
  if (scooterTimer) clearInterval(scooterTimer);
  if (gpsTimer) clearInterval(gpsTimer);
  scooterTimer = null;
  gpsTimer = null;
  gpsSourceUnsub?.();
  gpsSourceUnsub = null;
  releaseGps?.();
  releaseGps = null;
  motionSub?.remove();
  motionSub = null;
  accF = null;
  gravF = null;
  prevGps = null;
  if (state.calib.status === 'still' || state.calib.status === 'moving') setCalib(calibration ? 'done' : 'none', null);
  state = { ...state, running: false, scooter: emptyReading(), gps: emptyReading(), phone: emptyReading() };
  publish(true);
}

export function subscribeMotion(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
export const getMotionState = () => published;

export function useMotion(): MotionState {
  return useSyncExternalStore(subscribeMotion, getMotionState);
}

/** Starts the sensors while the calling component is mounted. */
export function useMotionSession() {
  useEffect(() => {
    startMotion();
    return () => stopMotion();
  }, []);
}

export function resetPeaks() {
  (Object.keys(peaks) as MotionSourceId[]).forEach((k) => {
    peaks[k] = emptyPeaks();
    trail[k] = [];
  });
  publish(true);
}

/** Two-step mount calibration: keep still (gravity axis), then ride straight (forward axis). */
export function startCalibration() {
  if (!motionSub) {
    setCalib('failed', 'Motion sensors are not running.');
    return;
  }
  calibration = null;
  calibStillG = [];
  calibStillMag = [];
  calibMove = [];
  calibStrong = 0;
  calibG = null;
  calibStart = Date.now();
  setCalib('still', 'Hold still…', 0);
}

export function cancelCalibration() {
  setCalib(calibration ? 'done' : 'none', null);
}

export function clearCalibration() {
  calibration = null;
  peaks.phone = emptyPeaks();
  trail.phone = [];
  setCalib('none', null);
}
