import { Ionicons } from '@expo/vector-icons';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import MapView, { Polyline } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { acquirePhoneGps, usePhoneGpsFix, usePhoneGpsOk } from '../services/motion';
import { useActiveRide } from '../services/RideTracker';
import { summarizeRide } from '../services/rideMath';
import { useLive } from '../store/live';
import { useSettings } from '../store/settings';
import { Confidence, DataSource, DataTag } from '../ui/components/DataTag';
import { useNow } from '../ui/hooks';
import { C } from '../ui/theme';
import { NA, fmtDuration, useUnits } from '../utils/format';

/**
 * Cockpit Mode: a minimal, high-contrast screen for a phone mounted on the
 * scooter. Scooter-reported values first; phone GPS only as a labelled
 * fallback; anything missing reads "Not available".
 */

const PAGES = ['Speed', 'Power', 'Map', 'Ride'] as const;
const connectedSel = (s: ReturnType<typeof useLive.getState>) => s.conn === 'connected';

// ------------------------------------------------------------------ shared bits
function useScooterNum(pick: (s: NonNullable<ReturnType<typeof useLive.getState>['snapshot']>) => { value: number; source: string } | null) {
  const value = useLive((s) => (s.conn === 'connected' && s.snapshot ? pick(s.snapshot)?.value ?? null : null));
  const calculated = useLive((s) => (s.conn === 'connected' && s.snapshot ? pick(s.snapshot)?.source === 'calculated' : false));
  return { value, calculated };
}

function Mini({ label, value, unit, kind, source }: { label: string; value: string | null; unit?: string; kind: Confidence; source?: DataSource }) {
  return (
    <View style={styles.mini}>
      <Text style={styles.miniLabel} numberOfLines={1}>{label}</Text>
      {value != null ? (
        <Text style={styles.miniValue} numberOfLines={1} adjustsFontSizeToFit>
          {value}
          {unit ? <Text style={styles.miniUnit}> {unit}</Text> : null}
        </Text>
      ) : (
        <Text style={styles.miniNA} numberOfLines={1}>{NA}</Text>
      )}
      {value != null && <DataTag kind={kind} source={source} compact />}
    </View>
  );
}

function Big({ label, value, unit, kind, source, size }: { label: string; value: string | null; unit?: string; kind: Confidence; source?: DataSource; size: number }) {
  return (
    <View style={{ alignItems: 'center', flex: 1, justifyContent: 'center' }}>
      <Text style={styles.bigLabel}>{label}</Text>
      {value != null ? (
        <>
          <Text style={[styles.bigValue, { fontSize: size, lineHeight: size * 1.05 }]} numberOfLines={1} adjustsFontSizeToFit>
            {value}
          </Text>
          {!!unit && <Text style={styles.bigUnit}>{unit}</Text>}
          <DataTag kind={kind} source={source} style={{ marginTop: 6 }} />
        </>
      ) : (
        <Text style={styles.bigNA}>{NA}</Text>
      )}
    </View>
  );
}

// ------------------------------------------------------------------ ride stats (active ride or scooter trip)
function useRideStats() {
  const active = useActiveRide((s) => s.active);
  const start = useActiveRide((s) => s.start);
  const nPoints = useActiveRide((s) => s.points.length);
  const now = useNow(1000);
  const tripKm = useScooterNum((s) => s.tripDistanceKm);
  const tripSec = useScooterNum((s) => s.tripTimeSec);
  const avgKmh = useScooterNum((s) => s.averageSpeedKmh);
  const battery = useScooterNum((s) => s.batteryPercent);
  // Summary recomputed only when a ride point is added (1 Hz).
  const summary = useMemo(() => {
    if (!active || start == null) return null;
    const pts = useActiveRide.getState().points;
    return pts.length ? summarizeRide(pts, start, pts[pts.length - 1].t) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, start, nPoints]);
  const firstBattery = useMemo(() => {
    if (!active) return null;
    return useActiveRide.getState().points.find((p) => p.battery != null)?.battery ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, nPoints > 0]);

  const distance: { km: number | null; kind: Confidence; source?: DataSource; label: string } =
    tripKm.value != null
      ? { km: tripKm.value, kind: 'measured', source: 'Scooter BLE', label: 'Scooter trip' }
      : summary && summary.distanceSource !== 'none'
        ? { km: summary.distanceKm, kind: 'calculated', source: summary.distanceSource === 'gps' ? 'Phone GPS' : 'Scooter BLE', label: 'This ride' }
        : { km: null, kind: 'unavailable', label: 'Trip' };
  const duration: { sec: number | null; kind: Confidence; source?: DataSource } =
    active && start != null
      ? { sec: (now - start) / 1000, kind: 'measured', source: 'Ride history' }
      : tripSec.value != null
        ? { sec: tripSec.value, kind: 'measured', source: 'Scooter BLE' }
        : { sec: null, kind: 'unavailable' };
  const avg: { kmh: number | null; kind: Confidence; source?: DataSource } =
    summary?.avgSpeedKmh != null
      ? { kmh: summary.avgSpeedKmh, kind: 'calculated', source: 'Ride history' }
      : avgKmh.value != null
        ? { kmh: avgKmh.value, kind: avgKmh.calculated ? 'calculated' : 'measured', source: avgKmh.calculated ? 'Calculated' : 'Scooter BLE' }
        : { kmh: null, kind: 'unavailable' };
  const used = active && firstBattery != null && battery.value != null ? Math.max(0, firstBattery - battery.value) : null;
  return { active, distance, duration, avg, batteryUsed: used };
}

// ------------------------------------------------------------------ page 1: speed + battery
const SpeedPage = memo(function SpeedPage({ w, h, landscape }: { w: number; h: number; landscape: boolean }) {
  const u = useUnits();
  const scooterSpeed = useScooterNum((s) => s.speedKmh);
  const fix = usePhoneGpsFix();
  const gpsOk = usePhoneGpsOk();
  const battery = useScooterNum((s) => s.batteryPercent);
  const voltage = useScooterNum((s) => s.batteryVoltage);
  const power = useScooterNum((s) => s.powerW);
  const motor = useScooterNum((s) => s.motorTempC);
  const ctrl = useScooterNum((s) => s.controllerTempC);
  const stats = useRideStats();

  const useGps = scooterSpeed.value == null && fix?.speedKmh != null;
  const speedKmh = scooterSpeed.value ?? (useGps ? fix!.speedKmh : null);
  const big = landscape ? Math.min(h * 0.55, w * 0.3) : Math.min(w * 0.42, h * 0.26);

  const speedBlock = (
    <View style={{ alignItems: 'center', justifyContent: 'center', flex: landscape ? 1.2 : undefined }}>
      {useGps && (
        <View style={styles.gpsBadge}>
          <Text style={styles.gpsBadgeText}>GPS</Text>
        </View>
      )}
      {speedKmh != null ? (
        <Text style={[styles.speed, { fontSize: big * 1.45, lineHeight: big * 1.5 }]} numberOfLines={1} adjustsFontSizeToFit>
          {Math.max(0, u.speed(speedKmh)).toFixed(0)}
        </Text>
      ) : (
        <Text style={[styles.speedNA, { fontSize: big * 0.32 }]}>{NA}</Text>
      )}
      <Text style={styles.unit}>{u.speedLabel}</Text>
      {speedKmh != null ? (
        <DataTag kind={useGps ? 'measured' : scooterSpeed.calculated ? 'calculated' : 'measured'} source={useGps ? 'Phone GPS' : 'Scooter BLE'} style={{ marginTop: 6, alignSelf: 'center' }} />
      ) : (
        <Text style={styles.hint}>{gpsOk === false ? 'No scooter speed and no location permission' : 'Waiting for scooter or GPS speed'}</Text>
      )}
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 14 }}>
        <Ionicons name="battery-half" size={26} color={battery.value == null ? C.textFaint : '#fff'} />
        <Text style={[styles.batt, battery.value == null && { color: C.textFaint, fontSize: 18 }]}>{battery.value != null ? `${battery.value.toFixed(0)}%` : NA}</Text>
      </View>
      {battery.value != null && <DataTag kind="measured" source="Scooter BLE" style={{ alignSelf: 'center' }} />}
    </View>
  );
  const strip = (
    <View style={[styles.strip, landscape && { flex: 1, alignContent: 'center' }]}>
      <Mini label="Battery" value={battery.value != null ? battery.value.toFixed(0) : null} unit="%" kind="measured" source="Scooter BLE" />
      <Mini label="Voltage" value={voltage.value != null ? voltage.value.toFixed(1) : null} unit="V" kind="measured" source="Scooter BLE" />
      <Mini label="Power" value={power.value != null ? power.value.toFixed(0) : null} unit="W" kind={power.calculated ? 'calculated' : 'measured'} source={power.calculated ? 'Calculated' : 'Scooter BLE'} />
      <Mini label="Motor" value={motor.value != null ? u.temp(motor.value).toFixed(0) : null} unit={u.tempLabel} kind="measured" source="Scooter BLE" />
      <Mini label="Controller" value={ctrl.value != null ? u.temp(ctrl.value).toFixed(0) : null} unit={u.tempLabel} kind="measured" source="Scooter BLE" />
      <Mini label="Trip" value={stats.distance.km != null ? u.dist(stats.distance.km).toFixed(2) : null} unit={u.distLabel} kind={stats.distance.kind} source={stats.distance.source} />
      <Mini label="Ride time" value={stats.duration.sec != null ? fmtDuration(stats.duration.sec) : null} kind={stats.duration.kind} source={stats.duration.source} />
    </View>
  );
  return (
    <View style={[styles.page, { width: w, height: h, flexDirection: landscape ? 'row' : 'column', justifyContent: 'center' }]}>
      {speedBlock}
      {strip}
    </View>
  );
});

// ------------------------------------------------------------------ page 2: power + temps
const PowerPage = memo(function PowerPage({ w, h, landscape }: { w: number; h: number; landscape: boolean }) {
  const u = useUnits();
  const power = useScooterNum((s) => s.powerW);
  const motor = useScooterNum((s) => s.motorTempC);
  const ctrl = useScooterNum((s) => s.controllerTempC);
  const size = landscape ? h * 0.26 : w * 0.24;
  return (
    <View style={[styles.page, { width: w, height: h, flexDirection: landscape ? 'row' : 'column' }]}>
      <Big label="Power" value={power.value != null ? power.value.toFixed(0) : null} unit="W" kind={power.calculated ? 'calculated' : 'measured'} source={power.calculated ? 'Calculated' : 'Scooter BLE'} size={size * 1.3} />
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <Big label="Motor temp" value={motor.value != null ? u.temp(motor.value).toFixed(0) : null} unit={u.tempLabel} kind="measured" source="Scooter BLE" size={size * 0.75} />
        <Big label="Controller temp" value={ctrl.value != null ? u.temp(ctrl.value).toFixed(0) : null} unit={u.tempLabel} kind="measured" source="Scooter BLE" size={size * 0.75} />
      </View>
    </View>
  );
});

// ------------------------------------------------------------------ page 3: map
const MapPage = memo(function MapPage({ w, h, visible }: { w: number; h: number; visible: boolean }) {
  const gpsOk = usePhoneGpsOk();
  const perm = gpsOk === true ? 'granted' : gpsOk === false ? 'denied' : 'unknown';
  const locationEnabled = useSettings((s) => s.locationEnabled);
  const active = useActiveRide((s) => s.active);
  const nPoints = useActiveRide((s) => s.points.length);
  const fix = usePhoneGpsFix();
  const map = useRef<MapView>(null);
  const route = useMemo(() => {
    if (!active) return [];
    return useActiveRide
      .getState()
      .points.filter((p) => p.lat != null && p.lon != null)
      .map((p) => ({ latitude: p.lat!, longitude: p.lon! }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, nPoints]);
  // Follow the phone position while the page is visible.
  useEffect(() => {
    if (!visible || !fix) return;
    map.current?.animateCamera({ center: { latitude: fix.lat, longitude: fix.lon }, zoom: 17, altitude: 700 }, { duration: 600 });
  }, [visible, fix]);

  if (!locationEnabled || perm === 'denied') {
    return (
      <View style={[styles.page, { width: w, height: h, alignItems: 'center', justifyContent: 'center' }]}>
        <Ionicons name="location-outline" size={48} color={C.textFaint} />
        <Text style={styles.bigNA}>Map not available</Text>
        <Text style={[styles.hint, { textAlign: 'center', maxWidth: 320 }]}>
          {locationEnabled ? 'Location permission is not granted or location services are off. Allow location for Scooter Hub in system settings to see the map here.' : 'Location is turned off in Settings.'}
        </Text>
      </View>
    );
  }
  return (
    <View style={{ width: w, height: h }}>
      {perm === 'granted' && (
        <MapView
          ref={map}
          style={StyleSheet.absoluteFill}
          userInterfaceStyle="dark"
          showsUserLocation
          followsUserLocation
          showsMyLocationButton={false}
          showsCompass={false}
          toolbarEnabled={false}
          initialRegion={fix ? { latitude: fix.lat, longitude: fix.lon, latitudeDelta: 0.005, longitudeDelta: 0.005 } : undefined}
        >
          {route.length > 1 && <Polyline coordinates={route} strokeColor={C.purple} strokeWidth={6} />}
        </MapView>
      )}
      <View style={styles.mapBadge} pointerEvents="none">
        <Text style={styles.mapBadgeText}>{active ? (route.length > 1 ? 'Recording · route shown' : 'Recording · waiting for GPS') : 'Not recording a ride'}</Text>
        <DataTag kind={fix ? 'measured' : 'unavailable'} source="Phone GPS" compact />
      </View>
    </View>
  );
});

// ------------------------------------------------------------------ page 4: ride stats
const StatsPage = memo(function StatsPage({ w, h, landscape }: { w: number; h: number; landscape: boolean }) {
  const u = useUnits();
  const s = useRideStats();
  const size = landscape ? h * 0.15 : w * 0.13;
  return (
    <View style={[styles.page, { width: w, height: h }]}>
      <Text style={[styles.bigLabel, { textAlign: 'center', marginBottom: 8 }]}>{s.active ? 'This ride' : 'Scooter trip (no ride recording)'}</Text>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <Big label="Distance" value={s.distance.km != null ? u.dist(s.distance.km).toFixed(2) : null} unit={u.distLabel} kind={s.distance.kind} source={s.distance.source} size={size} />
        <Big label="Duration" value={s.duration.sec != null ? fmtDuration(s.duration.sec) : null} kind={s.duration.kind} source={s.duration.source} size={size} />
      </View>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <Big label="Avg speed" value={s.avg.kmh != null ? u.speed(s.avg.kmh).toFixed(1) : null} unit={u.speedLabel} kind={s.avg.kind} source={s.avg.source} size={size} />
        <Big label="Battery used" value={s.batteryUsed != null ? s.batteryUsed.toFixed(0) : null} unit="%" kind="calculated" source="Calculated" size={size} />
      </View>
      {!s.active && <Text style={[styles.hint, { textAlign: 'center' }]}>Battery used needs a recorded ride with scooter battery data.</Text>}
    </View>
  );
});

// ------------------------------------------------------------------ screen
export default function Cockpit() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const keepAwake = useSettings((s) => s.cockpitKeepAwake);
  const setSetting = useSettings((s) => s.set);
  const connected = useLive(connectedSel);
  const [page, setPage] = useState(0);
  const scroll = useRef<ScrollView>(null);
  const landscape = width > height;

  // Keep the screen on only while this screen is mounted and the user wants it.
  useEffect(() => {
    if (!keepAwake) return;
    activateKeepAwakeAsync('cockpit').catch(() => undefined);
    return () => {
      deactivateKeepAwake('cockpit').catch(() => undefined);
    };
  }, [keepAwake]);

  // Phone GPS for the fallback speed and the map, released on exit.
  useEffect(() => acquirePhoneGps(), []);

  // Keep the current page on rotation.
  useEffect(() => {
    scroll.current?.scrollTo({ x: page * width, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const p = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width));
    if (p !== page) setPage(p);
  };

  const topPad = insets.top + 56;
  const bottomPad = insets.bottom + 34;
  const pageH = height - topPad - bottomPad;

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      <View style={[styles.top, { top: insets.top + 6, left: insets.left + 12, right: insets.right + 12 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.iconBtn} accessibilityLabel="Exit cockpit mode">
          <Ionicons name="close" size={28} color="#fff" />
        </Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View style={[styles.dot, { backgroundColor: connected ? C.green : C.textFaint }]} />
          <Text style={styles.topText}>{connected ? 'Scooter connected' : 'No scooter'}</Text>
        </View>
        <Pressable
          onPress={() => setSetting('cockpitKeepAwake', !keepAwake)}
          hitSlop={12}
          style={[styles.iconBtn, keepAwake && { borderColor: C.amber }]}
          accessibilityLabel={keepAwake ? 'Screen stays on. Tap to allow sleep' : 'Keep screen on while in cockpit'}
        >
          <Ionicons name={keepAwake ? 'sunny' : 'sunny-outline'} size={22} color={keepAwake ? C.amber : '#fff'} />
        </Pressable>
      </View>

      <ScrollView
        ref={scroll}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScrollEnd}
        style={{ position: 'absolute', top: topPad, left: 0, right: 0, height: pageH }}
      >
        <SpeedPage w={width} h={pageH} landscape={landscape} />
        <PowerPage w={width} h={pageH} landscape={landscape} />
        <MapPage w={width} h={pageH} visible={page === 2} />
        <StatsPage w={width} h={pageH} landscape={landscape} />
      </ScrollView>

      <View style={[styles.dots, { bottom: insets.bottom + 10 }]}>
        {PAGES.map((p, i) => (
          <Pressable key={p} hitSlop={8} onPress={() => { scroll.current?.scrollTo({ x: i * width, animated: true }); setPage(i); }} accessibilityLabel={`${p} page`}>
            <View style={[styles.pageDot, i === page && styles.pageDotActive]} />
          </Pressable>
        ))}
      </View>
      {keepAwake && <Text style={[styles.awake, { bottom: insets.bottom + 10, right: insets.right + 14 }]}>Screen stays on</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  top: { position: 'absolute', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 2 },
  iconBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  topText: { color: '#bbb', fontSize: 14, fontWeight: '600' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  page: { paddingHorizontal: 18 },
  speed: { color: '#fff', fontWeight: '900', fontVariant: ['tabular-nums'], textAlign: 'center', letterSpacing: -4 },
  speedNA: { color: C.textFaint, fontWeight: '700', textAlign: 'center' },
  unit: { color: '#ddd', fontSize: 24, fontWeight: '700', marginTop: -4, textAlign: 'center' },
  batt: { color: '#fff', fontSize: 40, fontWeight: '800', fontVariant: ['tabular-nums'] },
  hint: { color: '#999', fontSize: 13, marginTop: 8 },
  gpsBadge: { borderWidth: 2, borderColor: C.amber, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 2, marginBottom: 4 },
  gpsBadgeText: { color: C.amber, fontWeight: '900', fontSize: 16, letterSpacing: 2 },
  strip: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 18, gap: 8 },
  mini: { width: 104, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  miniLabel: { color: '#aaa', fontSize: 12, fontWeight: '700', letterSpacing: 0.4 },
  miniValue: { color: '#fff', fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'], marginTop: 2 },
  miniUnit: { color: '#bbb', fontSize: 13, fontWeight: '600' },
  miniNA: { color: C.textFaint, fontSize: 12, marginTop: 7 },
  bigLabel: { color: '#aaa', fontSize: 15, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase' },
  bigValue: { color: '#fff', fontWeight: '900', fontVariant: ['tabular-nums'], textAlign: 'center' },
  bigUnit: { color: '#ddd', fontSize: 20, fontWeight: '700' },
  bigNA: { color: C.textFaint, fontSize: 22, fontWeight: '700', marginTop: 8 },
  mapBadge: { position: 'absolute', left: 12, bottom: 12, backgroundColor: 'rgba(0,0,0,0.75)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  mapBadgeText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  dots: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 12 },
  pageDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.3)' },
  pageDotActive: { backgroundColor: '#fff', width: 22 },
  awake: { position: 'absolute', color: C.amber, fontSize: 11, fontWeight: '700' },
});
