import { Ionicons } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SCOOTER_MODELS, modelById } from '../data/scooterDatabase';
import { ScooterProfile, useGarage } from '../store/garage';
import { useLive } from '../store/live';
import { useMaintenance } from '../store/maintenance';
import { useRides } from '../store/rides';
import { Badge, Divider, EmptyState, GlassCard, IconName, ListRow, NeonButton, SectionHeader } from '../ui/components/Glass';
import { Screen } from '../ui/components/Screen';
import { C, R, S, rgba } from '../ui/theme';
import { NA, useUnits } from '../utils/format';

const ICONS: IconName[] = ['bicycle', 'flash', 'rocket', 'speedometer', 'leaf', 'flame', 'star', 'planet'];

/** Copies a picked photo into the app's document directory so it survives cache clears. */
async function pickPhoto(p: ScooterProfile, update: (id: string, patch: Partial<ScooterProfile>) => void) {
  try {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.7 });
    if (res.canceled || !res.assets?.[0]) return;
    const src = new File(res.assets[0].uri);
    const dest = new File(Paths.document, `scooter-${p.id}-${Date.now()}${src.extension || '.jpg'}`);
    await src.copy(dest);
    removePhotoFile(p.imageUri);
    update(p.id, { imageUri: dest.uri });
  } catch (e) {
    Alert.alert('Photo not saved', e instanceof Error ? e.message : String(e));
  }
}

function removePhotoFile(uri: string | null | undefined) {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    /* already gone */
  }
}

export function ScooterAvatar({ p, size = 44 }: { p: ScooterProfile; size?: number }) {
  if (p.imageUri) return <Image source={{ uri: p.imageUri }} style={{ width: size, height: size, borderRadius: size / 3.2 }} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 3.2, backgroundColor: rgba(C.purple, 0.14), alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={(p.icon as IconName) || 'bicycle'} size={size * 0.5} color={C.purpleLight} />
    </View>
  );
}

export default function GarageScreen() {
  const scooters = useGarage((s) => s.scooters);
  const create = useGarage((s) => s.create);
  const connectedId = useLive((s) => (s.conn === 'connected' ? s.scooterId : null));
  const liveOdo = useLive((s) => (s.conn === 'connected' ? s.snapshot?.odometerKm?.value ?? null : null));
  const allRides = useRides((s) => s.rides);
  const ensure = useMaintenance((s) => s.ensureDefaults);
  const u = useUnits();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [model, setModel] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  // Adds any newly introduced default maintenance items to existing scooters (existing items untouched).
  const ids = useMemo(() => scooters.map((s) => s.id).join(','), [scooters]);
  useEffect(() => {
    ids.split(',').filter(Boolean).forEach((id) => ensure(id));
  }, [ids, ensure]);

  const rideKm = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of allRides) if (r.scooterId) m[r.scooterId] = (m[r.scooterId] ?? 0) + r.distanceKm;
    return m;
  }, [allRides]);

  return (
    <Screen contentStyle={{ paddingTop: 110 }}>
      {scooters.length === 0 && !adding && <EmptyState icon="bicycle-outline" title="No scooters yet" body="Profiles are created automatically when you connect, or add one manually." />}
      {scooters.map((s) => {
        const m = modelById(s.modelId);
        const odo = connectedId === s.id && liveOdo != null ? liveOdo : s.lastOdometerKm;
        const km = odo != null ? { v: odo, src: connectedId === s.id && liveOdo != null ? 'odometer (live)' : 'odometer' } : rideKm[s.id] != null ? { v: rideKm[s.id], src: 'from recorded rides' } : null;
        const sub = m ? `${m.manufacturer} ${m.model}` : s.identity?.model?.value ? `${s.identity.manufacturer?.value ?? ''} ${s.identity.model.value}` : 'Model not set';
        return (
          <GlassCard key={s.id} accent={connectedId === s.id ? C.green : undefined}>
            <Pressable onPress={() => router.push({ pathname: '/scooter/[id]', params: { id: s.id } })} style={({ pressed }) => [styles.row, { opacity: pressed ? 0.75 : 1 }]}>
              <ScooterAvatar p={s} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{s.nickname}</Text>
                <Text style={styles.sub} numberOfLines={1}>{sub}</Text>
                <Text style={styles.km}>
                  {km ? `${u.dist(km.v).toFixed(1)} ${u.distLabel}` : NA}
                  <Text style={styles.kmSrc}>{km ? `  ${km.src}` : '  no odometer or rides yet'}</Text>
                </Text>
              </View>
              {connectedId === s.id && <Badge text="LIVE" color={C.green} />}
              <Ionicons name="create-outline" size={20} color={editing === s.id ? C.purpleLight : C.textDim} onPress={() => setEditing(editing === s.id ? null : s.id)} />
            </Pressable>
            {editing === s.id && <EditScooter p={s} onDone={() => setEditing(null)} />}
          </GlassCard>
        );
      })}
      {adding ? (
        <GlassCard>
          <TextInput value={name} onChangeText={setName} placeholder="Name, e.g. MY ZT3 PRO" placeholderTextColor={C.textFaint} style={styles.input} />
          <SectionHeader title="Model (optional)" />
          {SCOOTER_MODELS.map((m, i) => (
            <View key={m.id}>
              {i > 0 && <Divider />}
              <ListRow title={`${m.manufacturer} ${m.model}`} onPress={() => setModel(m.id)} right={model === m.id ? <Text style={{ color: C.green }}>✓</Text> : undefined} />
            </View>
          ))}
          <NeonButton
            title="Create profile"
            icon="add"
            style={{ marginTop: S.md }}
            disabled={!name.trim()}
            onPress={() => {
              const p = create(name.trim(), model);
              ensure(p.id);
              setAdding(false);
              setName('');
              setModel(null);
            }}
          />
        </GlassCard>
      ) : (
        <NeonButton title="Add scooter profile" icon="add" variant="ghost" onPress={() => setAdding(true)} style={{ marginTop: S.md }} />
      )}
    </Screen>
  );
}

function EditScooter({ p, onDone }: { p: ScooterProfile; onDone: () => void }) {
  const update = useGarage((s) => s.update);
  const [name, setName] = useState(p.nickname);
  return (
    <View style={{ marginTop: S.md }}>
      <Divider />
      <Text style={styles.label}>NAME</Text>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <TextInput value={name} onChangeText={setName} placeholder="Scooter name" placeholderTextColor={C.textFaint} style={[styles.input, { flex: 1 }]} />
        <NeonButton small title="Save" disabled={!name.trim() || name.trim() === p.nickname} onPress={() => update(p.id, { nickname: name.trim() })} />
      </View>
      <Text style={styles.label}>ICON</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {ICONS.map((ic) => {
          const on = !p.imageUri && (p.icon ?? 'bicycle') === ic;
          return (
            <Pressable
              key={ic}
              onPress={() => {
                if (p.imageUri) removePhotoFile(p.imageUri);
                update(p.id, { icon: ic, imageUri: null });
              }}
              style={[styles.iconChip, on && { borderColor: C.purple, backgroundColor: rgba(C.purple, 0.2) }]}
            >
              <Ionicons name={ic} size={20} color={on ? C.purpleLight : C.textDim} />
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.label}>PHOTO</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <NeonButton small variant="ghost" icon="image-outline" title={p.imageUri ? 'Change photo' : 'Choose photo'} onPress={() => pickPhoto(p, update)} style={{ flex: 1 }} />
        {!!p.imageUri && (
          <NeonButton
            small
            variant="danger"
            icon="trash-outline"
            title="Remove"
            onPress={() => {
              removePhotoFile(p.imageUri);
              update(p.id, { imageUri: null });
            }}
          />
        )}
      </View>
      <NeonButton small title="Done" onPress={onDone} style={{ marginTop: S.md }} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: S.md },
  name: { color: C.text, fontSize: 16, fontWeight: '800' },
  sub: { color: C.textDim, fontSize: 12.5, marginTop: 1 },
  km: { color: C.text, fontSize: 13.5, fontWeight: '700', marginTop: 4, fontVariant: ['tabular-nums'] },
  kmSrc: { color: C.textFaint, fontSize: 11, fontWeight: '500' },
  label: { color: C.textDim, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginTop: S.md, marginBottom: 6 },
  input: { color: C.text, borderWidth: 1, get borderColor() { return C.border; }, borderRadius: 12, paddingHorizontal: 12, height: 44 },
  iconChip: { width: 44, height: 44, borderRadius: R.sm, borderWidth: 1, get borderColor() { return C.border; }, alignItems: 'center', justifyContent: 'center' },
});
