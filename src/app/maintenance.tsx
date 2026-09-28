import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useActiveScooter, useGarage } from '../store/garage';
import { useLive } from '../store/live';
import { scheduleMaintenanceReminders } from '../services/Notifier';
import { MaintStatus, MaintenanceItem, maintenanceStatus, useMaintenance } from '../store/maintenance';
import { Badge, EmptyState, GlassCard, IconName, KeyValue, NeonButton, Note, Segmented } from '../ui/components/Glass';
import { Screen } from '../ui/components/Screen';
import { C, S } from '../ui/theme';
import { fmtDate } from '../utils/format';

const STATUS: Record<MaintStatus, { label: string; color: string }> = {
  due: { label: 'DUE', color: C.red },
  'due-soon': { label: 'DUE SOON', color: C.amber },
  completed: { label: 'COMPLETED', color: C.green },
  'not-scheduled': { label: 'COMPLETED', color: C.green },
  scheduled: { label: 'SCHEDULED', color: C.cyan },
  never: { label: 'NOT LOGGED', color: C.textDim },
};

/** Re-sync OS reminders after any maintenance edit (runs after the store update). */
const resync = () => setTimeout(() => scheduleMaintenanceReminders().catch(() => undefined), 0);

/** Local date "YYYY-MM-DD" → timestamp at 09:00 local time; null when invalid. */
function parseDay(v: string): number | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 9, 0, 0, 0);
  return Number.isNaN(d.getTime()) || d.getMonth() !== Number(m[2]) - 1 ? null : d.getTime();
}
const toDay = (t: number | null | undefined) => {
  if (!t) return '';
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const label = { color: C.textDim, fontSize: 12, fontWeight: '700', marginTop: S.lg } as const;

const ms = StyleSheet.create({
  input: { color: C.text, borderWidth: 1, get borderColor() { return C.border; }, borderRadius: 12, paddingHorizontal: 12, height: 42, marginTop: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, get borderColor() { return C.border; } },
});
const input = ms.input;
const chip = ms.chip;

export default function MaintenanceScreen() {
  const scooter = useActiveScooter();
  const scooters = useGarage((s) => s.scooters);
  const setActive = useGarage((s) => s.setActive);
  const all = useMaintenance((s) => s.items);
  const ensure = useMaintenance((s) => s.ensureDefaults);
  const addItem = useMaintenance((s) => s.addItem);
  const liveOdo = useLive((s) => (s.scooterId === scooter?.id ? s.snapshot?.odometerKm?.value ?? null : null));
  const odo = liveOdo ?? scooter?.lastOdometerKm ?? null;
  const [filter, setFilter] = useState<'all' | 'due' | 'due-soon' | 'completed'>('all');
  const [newName, setNewName] = useState('');

  useEffect(() => {
    if (scooter) ensure(scooter.id);
  }, [scooter, ensure]);

  if (!scooter) {
    return (
      <Screen contentStyle={{ paddingTop: 110 }}>
        <EmptyState icon="construct-outline" title="No scooter selected" body="Connect a scooter or add a profile first.">
          {scooters.map((s) => <NeonButton key={s.id} small variant="ghost" title={s.nickname} onPress={() => setActive(s.id)} style={{ marginTop: 8 }} />)}
        </EmptyState>
      </Screen>
    );
  }
  const items = all.filter((i) => i.scooterId === scooter.id).map((i) => ({ i, st: maintenanceStatus(i, odo) }));
  const counts = { due: items.filter((x) => x.st.status === 'due').length, soon: items.filter((x) => x.st.status === 'due-soon').length, done: items.filter((x) => x.st.status === 'completed' || x.st.status === 'not-scheduled').length };
  const shown = items.filter((x) => filter === 'all' || x.st.status === filter || (filter === 'completed' && x.st.status === 'not-scheduled'));

  return (
    <Screen contentStyle={{ paddingTop: 110 }}>
      <Text style={{ color: C.textDim, marginBottom: S.sm }}>{scooter.nickname}{odo != null ? ` · ${odo.toFixed(0)} km` : ''}</Text>
      <View style={{ flexDirection: 'row', gap: S.sm, marginBottom: S.md }}>
        {[['Due', counts.due, C.red], ['Due soon', counts.soon, C.amber], ['Completed', counts.done, C.green]].map(([l, n, c]) => (
          <GlassCard key={l as string} style={{ flex: 1, marginBottom: 0 }}>
            <Text style={{ color: c as string, fontSize: 28, fontWeight: '900', textAlign: 'center' }}>{n as number}</Text>
            <Text style={{ color: C.textDim, fontSize: 11, fontWeight: '700', textAlign: 'center' }}>{l as string}</Text>
          </GlassCard>
        ))}
      </View>
      <Segmented options={[{ label: 'All', value: 'all' }, { label: 'Due', value: 'due' }, { label: 'Soon', value: 'due-soon' }, { label: 'Done', value: 'completed' }]} value={filter} onChange={setFilter} style={{ marginBottom: S.md }} />
      {shown.map(({ i, st }) => <ItemCard key={i.id} item={i} status={st.status} nextDate={st.nextDate} nextKm={st.nextKm} odo={odo} />)}
      <GlassCard>
        <Text style={{ color: C.text, fontWeight: '700' }}>Add custom item</Text>
        <TextInput value={newName} onChangeText={setNewName} placeholder="e.g. Fender bolts" placeholderTextColor={C.textFaint} style={input} />
        <NeonButton small title="Add" icon="add" style={{ marginTop: S.md }} disabled={!newName.trim()} onPress={() => { addItem(scooter.id, newName.trim(), null, null); setNewName(''); resync(); }} />
      </GlassCard>
      <Note>Reminder intervals are yours to set. Scooter Hub doesn't invent service intervals; check your scooter's manual for the manufacturer's schedule.</Note>
    </Screen>
  );
}

function ItemCard({ item, status, nextDate, nextKm, odo }: { item: MaintenanceItem; status: MaintStatus; nextDate: number | null; nextKm: number | null; odo: number | null }) {
  const update = useMaintenance((s) => s.updateItem);
  const logEvent = useMaintenance((s) => s.logEvent);
  const removeItem = useMaintenance((s) => s.removeItem);
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState('');
  const [days, setDays] = useState(item.intervalDays ? String(item.intervalDays) : '');
  const [km, setKm] = useState(item.intervalKm ? String(item.intervalKm) : '');
  const [next, setNext] = useState(toDay(item.nextDate));
  const [itemNotes, setItemNotes] = useState(item.notes ?? '');
  useEffect(() => setNext(toDay(item.nextDate)), [item.nextDate]);
  const s = STATUS[status];
  const last = item.history[0];
  const setNextDate = (t: number | null) => {
    update(item.id, { nextDate: t });
    setNext(toDay(t));
    resync();
  };
  const plus = (daysAhead: number) => {
    const d = new Date();
    d.setHours(9, 0, 0, 0);
    d.setDate(d.getDate() + daysAhead);
    setNextDate(d.getTime());
  };
  return (
    <GlassCard accent={status === 'due' ? C.red : status === 'due-soon' ? C.amber : undefined}>
      <Pressable onPress={() => setOpen((o) => !o)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Ionicons name={item.icon as IconName} size={22} color={s.color} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.text, fontWeight: '700', fontSize: 15 }}>{item.name}</Text>
          <Text style={{ color: C.textDim, fontSize: 12.5 }}>
            {last ? `Last ${fmtDate(last.date)}` : 'Never logged'}
            {nextDate ? ` · next ${fmtDate(nextDate)}` : ''}
            {nextKm ? ` · at ${nextKm.toFixed(0)} km` : ''}
          </Text>
          {!!item.notes && !open && <Text style={{ color: C.textFaint, fontSize: 12, marginTop: 2 }} numberOfLines={1}>{item.notes}</Text>}
        </View>
        <Badge text={s.label} color={s.color} />
      </Pressable>
      {open && (
        <View style={{ marginTop: S.md }}>
          <KeyValue label="Last done" value={fmtDate(last?.date)} note={last?.odometerKm != null ? `${last.odometerKm.toFixed(0)} km` : undefined} />
          <KeyValue label="Next due" value={nextDate ? fmtDate(nextDate) : nextKm ? `at ${nextKm.toFixed(0)} km` : 'Not set'} note={item.nextDate ? 'your custom date' : item.intervalDays ? `every ${item.intervalDays} days` : undefined} />
          <Text style={[label, { marginTop: S.sm }]}>LOG COMPLETED</Text>
          <TextInput value={date} onChangeText={setDate} placeholder="Date YYYY-MM-DD (blank = today)" placeholderTextColor={C.textFaint} style={input} />
          <TextInput value={notes} onChangeText={setNotes} placeholder="Notes" placeholderTextColor={C.textFaint} style={input} />
          <NeonButton
            small
            title="Mark completed"
            icon="checkmark"
            style={{ marginTop: S.sm }}
            onPress={() => {
              const d = date ? parseDay(date) ?? Date.parse(date) : Date.now();
              if (Number.isNaN(d)) return Alert.alert('Invalid date', 'Use the format YYYY-MM-DD.');
              logEvent(item.id, { date: d, odometerKm: odo, notes: notes.trim() });
              setNotes('');
              setDate('');
              resync();
            }}
          />
          <Text style={label}>NEXT DATE (CUSTOM REMINDER)</Text>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <TextInput value={next} onChangeText={setNext} placeholder="YYYY-MM-DD" placeholderTextColor={C.textFaint} style={[input, { flex: 1 }]} />
            <NeonButton
              small
              variant="ghost"
              title="Set"
              style={{ marginTop: 8 }}
              onPress={() => {
                if (!next.trim()) return setNextDate(null);
                const t = parseDay(next);
                if (t == null) return Alert.alert('Invalid date', 'Use the format YYYY-MM-DD.');
                setNextDate(t);
              }}
            />
          </View>
          <View style={{ flexDirection: 'row', gap: 6, marginTop: S.sm, flexWrap: 'wrap' }}>
            {([['+1 week', 7], ['+1 month', 30], ['+3 months', 91]] as const).map(([l, d]) => (
              <Pressable key={l} onPress={() => plus(d)} style={chip}>
                <Text style={{ color: C.purpleLight, fontWeight: '700', fontSize: 12 }}>{l}</Text>
              </Pressable>
            ))}
            {item.nextDate != null && (
              <Pressable onPress={() => setNextDate(null)} style={chip}>
                <Text style={{ color: C.textDim, fontWeight: '700', fontSize: 12 }}>Clear</Text>
              </Pressable>
            )}
          </View>
          <Note>A custom date overrides the day interval and is scheduled as a reminder when maintenance notifications are on.</Note>
          <Text style={label}>REMINDER INTERVAL</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput value={days} onChangeText={setDays} placeholder="Days" keyboardType="number-pad" placeholderTextColor={C.textFaint} style={[input, { flex: 1 }]} />
            <TextInput value={km} onChangeText={setKm} placeholder="km" keyboardType="number-pad" placeholderTextColor={C.textFaint} style={[input, { flex: 1 }]} />
          </View>
          <NeonButton small variant="ghost" title="Save interval" style={{ marginTop: S.sm }} onPress={() => { update(item.id, { intervalDays: parseInt(days, 10) || null, intervalKm: parseInt(km, 10) || null }); resync(); }} />
          <Text style={label}>NOTES</Text>
          <TextInput value={itemNotes} onChangeText={setItemNotes} placeholder="e.g. tire size, pressure you use, part numbers" placeholderTextColor={C.textFaint} multiline style={[input, { height: undefined, minHeight: 64, paddingVertical: 10, textAlignVertical: 'top' }]} />
          <NeonButton small variant="ghost" title="Save notes" disabled={itemNotes === (item.notes ?? '')} style={{ marginTop: S.sm }} onPress={() => { update(item.id, { notes: itemNotes.trim() }); resync(); }} />
          {item.history.length > 0 && (
            <>
              <Text style={label}>HISTORY</Text>
              {item.history.slice(0, 6).map((h) => (
                <KeyValue key={h.id} label={fmtDate(h.date)} value={h.notes || '—'} note={h.odometerKm != null ? `${h.odometerKm.toFixed(0)} km` : undefined} />
              ))}
            </>
          )}
          {item.custom && <NeonButton small variant="danger" title="Remove item" style={{ marginTop: S.md }} onPress={() => { removeItem(item.id); resync(); }} />}
        </View>
      )}
    </GlassCard>
  );
}
