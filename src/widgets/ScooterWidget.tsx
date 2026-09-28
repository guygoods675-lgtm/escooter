import React from 'react';
import { FlexWidget, TextWidget } from 'react-native-android-widget';
import type { WidgetData } from './widgetData';

const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Android home-screen widget: name, battery, connection, speed, current ride. */
export function ScooterWidget({ data }: { data: WidgetData | null }) {
  const d = data;
  const speed = d?.speedKmh != null ? (d.speedUnit === 'mph' ? d.speedKmh / 1.609344 : d.speedKmh) : null;
  const dist = d?.rideDistanceKm != null ? (d.distanceUnit === 'mi' ? d.rideDistanceKm / 1.609344 : d.rideDistanceKm) : null;
  const connected = !!d?.connected && Date.now() - (d?.updatedAt ?? 0) < 120000;
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      style={{ height: 'match_parent', width: 'match_parent', backgroundColor: '#0C0718', borderRadius: 22, padding: 14, flexDirection: 'column', justifyContent: 'space-between', borderWidth: 1, borderColor: '#A855F755' }}
    >
      <TextWidget text={d?.name ?? 'Scooter Hub'} style={{ fontSize: 15, fontWeight: '800', color: '#F4F1FF' }} maxLines={1} truncate="END" />
      <FlexWidget style={{ flexDirection: 'row', justifyContent: 'space-between', width: 'match_parent' }}>
        <TextWidget text={`🔋 ${d?.battery != null ? `${d.battery}%` : '—'}`} style={{ fontSize: 20, fontWeight: '800', color: '#F4F1FF' }} />
        <TextWidget text={connected ? '🟢 Connected' : '⚪ Offline'} style={{ fontSize: 12, color: connected ? '#34D399' : '#A69FC0' }} />
      </FlexWidget>
      <TextWidget
        text={connected && speed != null ? `${speed.toFixed(0)} ${d?.speedUnit === 'mph' ? 'mph' : 'km/h'}` : 'Speed —'}
        style={{ fontSize: 13, color: '#C084FC', fontWeight: '700' }}
      />
      <TextWidget
        text={d?.rideTimeSec != null ? `Ride ${dist != null ? dist.toFixed(2) : '—'} ${d.distanceUnit === 'mi' ? 'mi' : 'km'} · ${fmtDur(d.rideTimeSec)}` : 'No ride recording'}
        style={{ fontSize: 11, color: '#A69FC0' }}
      />
    </FlexWidget>
  );
}
