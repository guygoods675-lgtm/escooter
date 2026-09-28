import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { ACHIEVEMENTS, achievementInputs } from '../services/stats';
import { useAchievements } from '../store/achievements';
import { useMaintenance } from '../store/maintenance';
import { useRides } from '../store/rides';
import { GlassCard, Grid, IconName, Note } from '../ui/components/Glass';
import { FadeIn } from '../ui/components/Motion';
import { Screen } from '../ui/components/Screen';
import { C, F, R, S, rgba } from '../ui/theme';
import { fmtDate } from '../utils/format';

export default function AchievementsScreen() {
  const rides = useRides((s) => s.rides);
  const items = useMaintenance((s) => s.items);
  const unlocked = useAchievements((s) => s.unlocked);
  const inputs = useMemo(() => achievementInputs(rides, items), [rides, items]);
  const rows = useMemo(
    () =>
      ACHIEVEMENTS.map((a) => {
        const p = a.progress(inputs);
        const at = unlocked[a.id] ?? null;
        return { a, p, at, done: at != null || p.value >= p.target };
      }),
    [inputs, unlocked],
  );
  const count = rows.filter((r) => r.done).length;

  return (
    <Screen contentStyle={{ paddingTop: 110 }}>
      <GlassCard accent={C.borderStrong} style={{ alignItems: 'center' }}>
        <Text style={F.label}>Unlocked</Text>
        <Text style={{ color: C.text, fontSize: 40, fontWeight: '900', marginTop: 4 }}>
          {count}
          <Text style={{ color: C.textDim, fontSize: 20, fontWeight: '700' }}> / {ACHIEVEMENTS.length}</Text>
        </Text>
        <View style={{ height: 6, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: R.pill, marginTop: S.md, overflow: 'hidden' }}>
          <View style={{ width: `${(count / ACHIEVEMENTS.length) * 100}%`, height: '100%', backgroundColor: C.purple }} />
        </View>
      </GlassCard>

      <Grid cols={2}>
        {rows.map(({ a, p, at, done }, i) => {
          const frac = Math.max(0, Math.min(1, p.target > 0 ? p.value / p.target : 0));
          const color = done ? C.purpleLight : C.textFaint;
          const shownValue = Number.isInteger(p.value) ? String(p.value) : p.value.toFixed(1);
          return (
            <FadeIn key={a.id} index={i}>
              <View
                style={{
                  borderRadius: R.md,
                  borderWidth: 1,
                  borderColor: done ? C.borderStrong : 'rgba(255,255,255,0.06)',
                  backgroundColor: done ? rgba(C.purple, 0.1) : 'rgba(255,255,255,0.025)',
                  padding: S.md,
                  minHeight: 150,
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: done ? rgba(C.purple, 0.22) : 'rgba(255,255,255,0.05)' }}>
                    <Ionicons name={a.icon as IconName} size={22} color={color} />
                  </View>
                  <Ionicons name={done ? 'checkmark-circle' : 'lock-closed'} size={16} color={done ? C.green : C.textFaint} />
                </View>
                <Text style={{ color: done ? C.text : C.textDim, fontWeight: '800', fontSize: 14.5, marginTop: S.sm }} numberOfLines={2}>{a.title}</Text>
                <Text style={{ color: C.textFaint, fontSize: 11.5, marginTop: 2, lineHeight: 15 }} numberOfLines={2}>{a.description}</Text>
                <View style={{ flex: 1 }} />
                <View style={{ height: 5, backgroundColor: 'rgba(255,255,255,0.07)', borderRadius: R.pill, marginTop: S.sm, overflow: 'hidden' }}>
                  <View style={{ width: `${(done ? 1 : frac) * 100}%`, height: '100%', backgroundColor: done ? C.green : C.purple }} />
                </View>
                <Text style={{ color: C.textFaint, fontSize: 10.5, marginTop: 4 }}>
                  {at != null ? `Unlocked ${fmtDate(at)}` : done ? 'Completed' : `${shownValue} / ${p.target.toLocaleString()}`}
                </Text>
              </View>
            </FadeIn>
          );
        })}
      </Grid>
      <Note>Achievements count distance, rides, riding time, efficiency, ride consistency and maintenance you log. None of them reward speed.</Note>
    </Screen>
  );
}
