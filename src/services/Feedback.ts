import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { useSettings } from '../store/settings';

/**
 * One place for haptics and UI sounds, so both respect Settings and nothing
 * fires per telemetry packet. Only discrete events call this.
 */
export type FeedbackEvent = 'connect' | 'disconnect' | 'rideStart' | 'rideEnd' | 'achievement' | 'tap' | 'warning' | 'error' | 'success';

const SOUNDS: Partial<Record<FeedbackEvent, number>> = {
  connect: require('../../assets/sounds/connect.wav'),
  disconnect: require('../../assets/sounds/disconnect.wav'),
  rideStart: require('../../assets/sounds/ride-start.wav'),
  rideEnd: require('../../assets/sounds/ride-end.wav'),
  achievement: require('../../assets/sounds/achievement.wav'),
  tap: require('../../assets/sounds/tap.wav'),
  warning: require('../../assets/sounds/warning.wav'),
  error: require('../../assets/sounds/warning.wav'),
};

const players = new Map<FeedbackEvent, AudioPlayer>();
let audioReady = false;
const lastFired = new Map<FeedbackEvent, number>();
// Minimum gap per event so repeated warnings can never become a buzz loop.
const MIN_GAP: Record<FeedbackEvent, number> = { connect: 2000, disconnect: 2000, rideStart: 1000, rideEnd: 1000, achievement: 1500, tap: 60, warning: 5000, error: 5000, success: 800 };

function playSound(e: FeedbackEvent) {
  const src = SOUNDS[e];
  if (src == null) return;
  try {
    if (!audioReady) {
      audioReady = true;
      // Mix with music/navigation instead of pausing it, and stay silent in silent mode.
      setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers', shouldPlayInBackground: false }).catch(() => undefined);
    }
    let p = players.get(e);
    if (!p) {
      p = createAudioPlayer(src);
      p.volume = e === 'tap' ? 0.35 : 0.6;
      players.set(e, p);
    }
    p.seekTo(0).catch(() => undefined);
    p.play();
  } catch {
    // Sound is optional; never let it break the app.
  }
}

function playHaptic(e: FeedbackEvent) {
  const H = Haptics;
  const run = (): Promise<void> => {
    switch (e) {
      case 'tap':
        return H.selectionAsync();
      case 'connect':
      case 'achievement':
      case 'success':
        return H.notificationAsync(H.NotificationFeedbackType.Success);
      case 'warning':
        return H.notificationAsync(H.NotificationFeedbackType.Warning);
      case 'error':
      case 'disconnect':
        return H.notificationAsync(H.NotificationFeedbackType.Error);
      case 'rideStart':
      case 'rideEnd':
        return H.impactAsync(H.ImpactFeedbackStyle.Medium);
    }
  };
  run().catch(() => undefined);
}

export function feedback(e: FeedbackEvent, opts: { sound?: boolean } = {}) {
  const now = Date.now();
  if (now - (lastFired.get(e) ?? 0) < MIN_GAP[e]) return;
  lastFired.set(e, now);
  const s = useSettings.getState();
  if (s.haptics) playHaptic(e);
  // Taps only make a sound when the user also enabled button sounds.
  if (s.sounds && opts.sound !== false && (e !== 'tap' || s.tapSounds)) playSound(e);
}

export const hapticTap = () => feedback('tap');
