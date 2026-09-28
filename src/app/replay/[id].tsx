import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Ride, useRides } from '../../store/rides';
import { EmptyState, GlassCard, NeonButton, Note, Segmented } from '../../ui/components/Glass';
import { CursorInfo, RideReadouts, TimelineSlider, cursorAt, useRideTimelineData } from '../../ui/components/RideTimeline';
import { RouteMap } from '../../ui/components/RouteMap';
import { Screen } from '../../ui/components/Screen';
import { C, F, S } from '../../ui/theme';
import { fmtDateTime, fmtDuration } from '../../utils/format';

type Speed = 0.25 | 0.5 | 1 | 2 | 4;
const SPEEDS: { label: string; value: Speed }[] = [
  { label: '0.25×', value: 0.25 },
  { label: '0.5×', value: 0.5 },
  { label: '1×', value: 1 },
  { label: '2×', value: 2 },
  { label: '4×', value: 4 },
];
/** React state is committed at most every 50 ms (≤ 20 fps); the clock itself runs per frame. */
const COMMIT_MS = 50;
const KEEP_AWAKE_TAG = 'ride-replay';

export default function RideReplay() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ride = useRides((s) => s.rides.find((r) => r.id === id));
  if (!ride) return <Screen contentStyle={{ paddingTop: 110 }}><EmptyState icon="alert" title="Ride not found" /></Screen>;
  return <Replay key={ride.id} ride={ride} />;
}

function Replay({ ride }: { ride: Ride }) {
  const data = useRideTimelineData(ride);
  const routes = useMemo(() => [{ id: ride.id, points: ride.points }], [ride.id, ride.points]);
  const [offset, setOffset] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [follow, setFollow] = useState(true);
  const offsetRef = useRef(0);
  const scrubbing = useRef(false);

  // Playback clock: requestAnimationFrame advances the clock, React state updates ≤ 20 fps.
  useEffect(() => {
    if (!playing || data.duration <= 0) return;
    let raf = 0;
    let lastTs: number | null = null;
    let lastCommit = 0;
    const tick = (ts: number) => {
      const dt = lastTs == null ? 0 : ts - lastTs;
      lastTs = ts;
      if (!scrubbing.current) {
        offsetRef.current = Math.min(data.duration, offsetRef.current + dt * speed);
        const done = offsetRef.current >= data.duration;
        if (done || ts - lastCommit >= COMMIT_MS) {
          lastCommit = ts;
          setOffset(offsetRef.current);
        }
        if (done) {
          setPlaying(false);
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, data.duration]);

  // Keep the screen on while replaying.
  useEffect(() => {
    if (!playing) return;
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
    };
  }, [playing]);

  const seek = useCallback((ms: number) => {
    offsetRef.current = ms;
    setOffset(ms); // drag = immediate seek
  }, []);
  const onScrub = useCallback((s: boolean) => {
    scrubbing.current = s;
  }, []);

  const cursor: CursorInfo = useMemo(() => cursorAt(data, offset), [data, offset]);
  const atEnd = offset >= data.duration;
  const hasGps = ride.points.some((p) => p.lat != null && p.lon != null);

  if (ride.points.length < 2 || data.duration <= 0) {
    return (
      <Screen contentStyle={{ paddingTop: 110 }}>
        <EmptyState icon="play-circle-outline" title="Nothing to replay" body="This ride has fewer than two recorded samples." />
      </Screen>
    );
  }

  return (
    <Screen contentStyle={{ paddingTop: 110 }}>
      <Text style={F.label}>Ride #{ride.number} · {fmtDateTime(ride.start)}</Text>
      <View style={{ height: S.sm }} />
      <RouteMap routes={routes} height={280} cursor={cursor.position} followCursor={follow && playing} showMetricPicker={false} />
      {hasGps && !cursor.position && <Note>No GPS fix at this moment, so the marker is hidden.</Note>}

      <GlassCard style={{ marginTop: S.md }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ color: C.text, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{fmtDuration(offset / 1000)}</Text>
          <Text style={{ color: C.textDim, fontVariant: ['tabular-nums'] }}>{fmtDuration(data.duration / 1000)}</Text>
        </View>
        <TimelineSlider duration={data.duration} value={offset} onSeek={seek} onScrubChange={onScrub} label="Replay position" />
        <View style={{ flexDirection: 'row', gap: S.sm, marginTop: S.sm }}>
          <NeonButton
            title={playing ? 'Pause' : atEnd ? 'Play again' : 'Play'}
            icon={playing ? 'pause' : 'play'}
            small
            style={{ flex: 1 }}
            onPress={() => {
              if (!playing && atEnd) seek(0);
              setPlaying((p) => !p);
            }}
          />
          <NeonButton
            title="Restart"
            icon="refresh"
            variant="ghost"
            small
            style={{ flex: 1 }}
            onPress={() => {
              seek(0);
            }}
          />
        </View>
        <Segmented options={SPEEDS} value={speed} onChange={setSpeed} style={{ marginTop: S.sm }} />
        {hasGps && (
          <Segmented
            options={[
              { label: 'Follow marker', value: 'on' },
              { label: 'Free map', value: 'off' },
            ]}
            value={follow ? 'on' : 'off'}
            onChange={(v) => setFollow(v === 'on')}
            style={{ marginTop: S.sm }}
          />
        )}
      </GlassCard>

      <GlassCard>
        <Text style={F.label}>At this moment</Text>
        <View style={{ height: S.sm }} />
        <RideReadouts data={data} cursor={cursor} />
      </GlassCard>
      <Note>
        Replay uses the recorded timestamps, so pauses in the ride also pause the marker. Values are the samples recorded at that moment; the marker is only interpolated between two neighbouring GPS fixes.
      </Note>
    </Screen>
  );
}
