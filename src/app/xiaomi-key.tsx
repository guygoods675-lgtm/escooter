import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Linking, StyleSheet, Text, TextInput, View } from 'react-native';
import { parseCloudKey } from '../protocols/xiaomiSecure/crypto';
import { reconnectCurrent } from '../services/ScooterManager';
import { useLive } from '../store/live';
import { clearXiaomiCredentials, hasXiaomiCredentials, saveXiaomiCredentials } from '../store/xiaomiKey';
import { GlassCard, NeonButton, Note, SectionHeader } from '../ui/components/Glass';
import { Screen } from '../ui/components/Screen';
import { C, S } from '../ui/theme';

const REF = 'https://github.com/mehesbalazs/xiaomi-scooter-4-pro-2';
const KEY_GUIDE = `${REF}/blob/main/docs/getting-the-key.md`;

/** Scooter key + PIN for the Xiaomi Electric Scooter 4 Pro (2nd Gen). */
export default function XiaomiKeyScreen() {
  const [key, setKey] = useState('');
  const [pin, setPin] = useState('');
  const [saved, setSaved] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const deviceId = useLive((s) => s.deviceId);

  useEffect(() => {
    hasXiaomiCredentials().then(setSaved).catch(() => setSaved(false));
  }, []);

  const keyOk = parseCloudKey(key) !== null;
  const pinOk = pin.trim().length >= 4;

  const save = async () => {
    setBusy(true);
    try {
      await saveXiaomiCredentials({ cloudKeyHex: key, pin: pin.trim() });
      setKey('');
      setPin('');
      setSaved(true);
      router.back();
      if (deviceId) reconnectCurrent();
    } catch (e) {
      Alert.alert('Could not save', String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = () =>
    Alert.alert('Remove scooter key?', 'Scooter Hub will not be able to read your Xiaomi 4 Pro 2nd Gen until you add it again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => clearXiaomiCredentials().then(() => setSaved(false)) },
    ]);

  return (
    <Screen contentStyle={{ paddingTop: 70 }}>
      <GlassCard>
        <Text style={styles.h}>Xiaomi Electric Scooter 4 Pro (2nd Gen)</Text>
        <Note>
          This scooter encrypts its Bluetooth. To read it, Scooter Hub logs in the same way the Xiaomi Home app does, using two things only you have: the scooter's Bluetooth key from your Xiaomi account, and the scooter PIN.
        </Note>
        {saved !== null && <Text style={[styles.status, { color: saved ? C.green : C.amber }]}>{saved ? 'A scooter key is saved on this phone.' : 'No scooter key saved yet.'}</Text>}
      </GlassCard>

      <SectionHeader title="Scooter key" icon="key-outline" />
      <GlassCard>
        <TextInput
          value={key}
          onChangeText={setKey}
          placeholder="64 characters, 0-9 and a-f"
          placeholderTextColor={C.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          style={[styles.input, { minHeight: 70 }]}
        />
        {!!key && !keyOk && <Text style={styles.err}>The key must be exactly 64 hex characters (0-9, a-f).</Text>}
        <Text style={[styles.label, { marginTop: S.md }]}>Scooter PIN</Text>
        <TextInput value={pin} onChangeText={setPin} placeholder="PIN from the Xiaomi Home app" placeholderTextColor={C.textFaint} secureTextEntry keyboardType="number-pad" style={styles.input} />
        <NeonButton title={deviceId ? 'Save and reconnect' : 'Save'} icon="checkmark" onPress={save} disabled={!keyOk || !pinOk} loading={busy} style={{ marginTop: S.md }} />
        {saved && <NeonButton title="Remove saved key" small variant="danger" icon="trash-outline" onPress={remove} style={{ marginTop: S.sm }} />}
      </GlassCard>

      <SectionHeader title="How to get the key" icon="help-circle-outline" />
      <GlassCard>
        <Note>
          The key is stored in your Xiaomi account (Xiaomi calls it the Bluetooth key). The free open-source tool "xiaomi-scooter-4-pro-2" downloads it once: on a computer, run tokens/get_ltmk.py, log in with your Xiaomi account, and copy the 64-character key it prints into the field above.
        </Note>
        <NeonButton title="Open the step-by-step guide" small variant="ghost" icon="open-outline" onPress={() => Linking.openURL(KEY_GUIDE)} style={{ marginTop: S.sm }} />
        <Note>If the scooter suddenly rejects the login although the PIN is right, Xiaomi changed the key. Get it again and save it here.</Note>
      </GlassCard>

      <SectionHeader title="Good to know" icon="shield-checkmark-outline" />
      <GlassCard>
        <Note>Your Xiaomi Home pairing is not changed. Scooter Hub only logs in with the existing key; it does not pair the scooter again.</Note>
        <Note>Close the Xiaomi Home app before connecting. The scooter talks to only one phone at a time.</Note>
        <Note>Read-only: Scooter Hub only reads values. It never locks, unlocks or changes settings on this scooter.</Note>
        <Note>Keep the key and PIN private. Together they let someone nearby log in to your scooter. They are stored encrypted on this phone only and are never exported.</Note>
        <Note>This scooter does not report its live speed over Bluetooth, only average and top speed. Live speed on the dashboard comes from your phone's GPS during a ride.</Note>
        <Text style={styles.src} onPress={() => Linking.openURL(REF)}>Protocol source: github.com/mehesbalazs/xiaomi-scooter-4-pro-2 (MIT)</Text>
      </GlassCard>
    </Screen>
  );
}

const styles = StyleSheet.create({
  h: { color: C.text, fontSize: 17, fontWeight: '800', marginBottom: 6 },
  status: { marginTop: 8, fontWeight: '700' },
  label: { color: C.textDim, fontSize: 13, marginBottom: 6 },
  input: { color: C.text, borderWidth: 1, get borderColor() { return C.border; }, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, fontFamily: undefined },
  err: { color: C.red, marginTop: 6, fontSize: 12.5 },
  src: { color: C.textFaint, fontSize: 12, marginTop: S.sm },
});
