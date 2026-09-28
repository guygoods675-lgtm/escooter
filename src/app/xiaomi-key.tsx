import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Linking, StyleSheet, Text, TextInput, View } from 'react-native';
import { parseCloudKey } from '../protocols/xiaomiSecure/crypto';
import { getSession, reconnectCurrent } from '../services/ScooterManager';
import { XiaomiCloudLogin, fetchOfficialSpec } from '../services/xiaomiCloud';
import { PropMap, mapFromMiotSpec } from '../protocols/xiaomiSecure/spec';
import { XIAOMI_SCOOTER_PIDS } from '../protocols/xiaomiSecure/XiaomiT2336Protocol';
import { miBeaconProductId } from '../protocols/registry';
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
  const [cloudMsg, setCloudMsg] = useState<string | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const cloud = useRef<XiaomiCloudLogin | null>(null);
  // Model details from the Xiaomi account; a hand-pasted key is for the 4 Pro 2nd Gen.
  const [found, setFound] = useState<{ model: string; name: string; encryptType: 0 | 1; map?: PropMap } | null>(null);

  useEffect(() => () => {
    if (cloud.current) cloud.current.cancelled = true;
  }, []);

  const fromAccount = async () => {
    const c = new XiaomiCloudLogin();
    cloud.current = c;
    setCloudBusy(true);
    try {
      setCloudMsg('Opening the Xiaomi login page…');
      const url = await c.start();
      await Linking.openURL(url);
      setCloudMsg('Log in on the Xiaomi page, then come back here. Waiting…');
      await c.waitForLogin();
      const scooters = await c.findScooters(setCloudMsg);
      const session = getSession();
      const pid = session ? miBeaconProductId(session) : null;
      const connectedModel = pid !== null ? XIAOMI_SCOOTER_PIDS[pid]?.model : undefined;
      const s = scooters.find((x) => x.model === connectedModel) ?? scooters.find((x) => x.model === 'xiaomi.scooter.t2336') ?? scooters[0];
      if (!s) throw new Error('No scooter was found in your Xiaomi account.');
      setCloudMsg(`Found "${s.name}" (${s.model}). Getting its key…`);
      const k = await c.bluetoothKey(s);
      let map: PropMap | undefined;
      if (s.model !== 'xiaomi.scooter.t2336') {
        setCloudMsg(`Loading Xiaomi's official property list for ${s.model}…`);
        map = mapFromMiotSpec((await fetchOfficialSpec(s.model)) as never);
        if (!map.batteryLevel && !map.voltage) throw new Error(`Xiaomi's property list for ${s.model} has no battery values Scooter Hub can read`);
      }
      setFound({ model: s.model, name: s.name, encryptType: k.encryptType, map });
      setKey(k.key);
      setCloudMsg(k.encryptType === 1 ? `Key received for "${s.name}". Now type the scooter PIN and press Save.` : `Key received for "${s.name}". This scooter has no PIN set, so just press Save.`);
    } catch (e) {
      setCloudMsg(`${e instanceof Error ? e.message : String(e)}. You can still paste the key by hand below.`);
    } finally {
      setCloudBusy(false);
      cloud.current = null;
    }
  };

  useEffect(() => {
    hasXiaomiCredentials().then(setSaved).catch(() => setSaved(false));
  }, []);

  const keyOk = parseCloudKey(key) !== null;
  const pinOk = found?.encryptType === 0 || pin.trim().length >= 4;

  const save = async () => {
    setBusy(true);
    try {
      await saveXiaomiCredentials({ cloudKeyHex: key, pin: pin.trim(), model: found?.model ?? 'xiaomi.scooter.t2336', name: found?.name, encryptType: found?.encryptType ?? 1, map: found?.map });
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
        <Text style={styles.h}>Xiaomi scooters with encrypted Bluetooth</Text>
        <Note>
          The Xiaomi 4 Pro (2nd Gen) is supported. Other new Xiaomi scooters (4, 5, 6 series) are experimental: Scooter Hub loads Xiaomi's official property list for your model during setup. These scooters encrypt their Bluetooth. To read it, Scooter Hub logs in the same way the Xiaomi Home app does, using two things only you have: the scooter's Bluetooth key from your Xiaomi account, and the scooter PIN.
        </Note>
        {saved !== null && <Text style={[styles.status, { color: saved ? C.green : C.amber }]}>{saved ? 'A scooter key is saved on this phone.' : 'No scooter key saved yet.'}</Text>}
      </GlassCard>

      <SectionHeader title="Easiest: from your Xiaomi account" icon="cloud-download-outline" />
      <GlassCard>
        <Note>Log in on Xiaomi's own page. Scooter Hub never sees your password. It asks Xiaomi for your scooter's Bluetooth key once and fills it in below. Your login is not stored.</Note>
        <NeonButton title="Get key from my Xiaomi account" icon="log-in-outline" onPress={fromAccount} loading={cloudBusy} style={{ marginTop: S.sm }} />
        {cloudBusy && <NeonButton title="Cancel" small variant="ghost" onPress={() => { if (cloud.current) cloud.current.cancelled = true; }} style={{ marginTop: S.sm }} />}
        {!!cloudMsg && <Text style={styles.cloud}>{cloudMsg}</Text>}
      </GlassCard>

      <SectionHeader title="Scooter key" icon="key-outline" />
      <GlassCard>
        <TextInput
          value={key}
          onChangeText={(t) => {
            setKey(t);
            setFound(null); // a hand-pasted key is treated as a 4 Pro 2nd Gen key
          }}
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
          The button above does this for you. If it does not work, the free open-source tool "xiaomi-scooter-4-pro-2" does the same on a computer: run tokens/get_ltmk.py, log in with your Xiaomi account, and paste the 64-character key it prints into the field above.
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
        <Note>The 4 Pro (2nd Gen) does not report its live speed over Bluetooth, only average and top speed, so live speed on the dashboard comes from your phone's GPS during a ride and is labelled "Phone GPS". Other Xiaomi models show the scooter's own live speed when Xiaomi's property list has one.</Note>
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
  cloud: { color: C.text, marginTop: S.sm, fontSize: 13.5 },
});
