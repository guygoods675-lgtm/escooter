import { getRandomBytes } from 'expo-crypto';
import { NativeModules, Platform } from 'react-native';
import { devLog } from '../store/devlog';
import { XIAOMI_SERVERS, apiUrl, decryptResponse, encParams, makeNonce, parseStartJson, signedNonce, toQuery } from './xiaomiCloudCore';

/**
 * Downloads the owner's scooter Bluetooth key from their Xiaomi account, the same
 * way the MIT tools do (token_extractor.py QrCodeXiaomiCloudConnector + get_ltmk.py
 * in github.com/mehesbalazs/xiaomi-scooter-4-pro-2):
 *   1. GET account.xiaomi.com/longPolling/loginUrl -> a Xiaomi login link + a long-poll URL
 *   2. the owner logs in on Xiaomi's own page in the browser (Scooter Hub never sees the password)
 *   3. the long-poll URL returns userId / ssecurity / location; GET location -> serviceToken cookie
 *   4. signed + RC4-encrypted API calls: homes -> devices -> /share/askbluetoothkey for the scooter
 * Everything stays in memory; only the resulting key is saved (by the caller, in the keystore).
 */

export interface CloudScooter {
  name: string;
  did: string;
  model: string;
  server: string;
}

const randomLetters = (n: number, from: number, span: number) =>
  Array.from(getRandomBytes(n), (b) => String.fromCharCode(from + (b % span))).join('');
const AGENT = `${randomLetters(18, 97, 26)}-${randomLetters(13, 65, 5)} APP/com.xiaomi.mihome APPV/10.5.201`;

export class XiaomiCloudLogin {
  private userId = '';
  private ssecurity = '';
  private serviceToken = '';
  private lp = '';
  private timeoutSec = 300;
  cancelled = false;

  /** Step 1: returns the Xiaomi login link to open in the browser. */
  async start(): Promise<string> {
    const q = [
      ['_qrsize', '480'],
      ['qs', '%3Fsid%3Dxiaomiio%26_json%3Dtrue'],
      ['callback', 'https://sts.api.io.mi.com/sts'],
      ['_hasLogo', 'false'],
      ['sid', 'xiaomiio'],
      ['serviceParam', ''],
      ['_locale', 'en_GB'],
      ['_dc', String(Date.now())],
    ] as [string, string][];
    const res = await fetch(`https://account.xiaomi.com/longPolling/loginUrl?${toQuery(q)}`);
    if (!res.ok) throw new Error(`Xiaomi login is not reachable (HTTP ${res.status})`);
    const j = parseStartJson(await res.text());
    if (!j.loginUrl || !j.lp) throw new Error('Xiaomi did not return a login link');
    this.lp = j.lp;
    this.timeoutSec = Number(j.timeout) || 300;
    return j.loginUrl as string;
  }

  /** Step 2+3: waits until the owner finished logging in, then fetches the service token. */
  async waitForLogin(): Promise<void> {
    const deadline = Date.now() + this.timeoutSec * 1000;
    let data: { userId?: unknown; ssecurity?: string; location?: string } | null = null;
    while (!data && Date.now() < deadline && !this.cancelled) {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 15000);
      try {
        const res = await fetch(this.lp, { signal: ctl.signal });
        if (res.ok) data = parseStartJson(await res.text());
        else await new Promise((r) => setTimeout(r, 1500));
      } catch {
        /* long-poll timeout: ask again */
      } finally {
        clearTimeout(t);
      }
    }
    if (this.cancelled) throw new Error('Cancelled');
    if (!data?.ssecurity || !data.location) throw new Error('The Xiaomi login was not finished in time');
    this.userId = String(data.userId);
    this.ssecurity = data.ssecurity;
    const res = await fetch(data.location, { headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    const cookie = res.headers.get('set-cookie') ?? '';
    const m = /serviceToken=([^;,\s]+)/.exec(cookie);
    if (!m) throw new Error('Logged in, but Xiaomi did not hand over a service token. Use the manual key instead.');
    this.serviceToken = m[1];
    // Stale Xiaomi cookies in the app's cookie jar would replace the Cookie header below.
    await new Promise<void>((resolve) => {
      const net = NativeModules.Networking as { clearCookies?: (cb: () => void) => void } | undefined;
      if (Platform.OS === 'android' && net?.clearCookies) net.clearCookies(() => resolve());
      else resolve();
    });
  }

  private async call(server: string, path: string, data: string): Promise<any> {
    const url = `${apiUrl(server)}${path}`;
    const nonce = makeNonce(getRandomBytes(8), Date.now());
    const sn = signedNonce(this.ssecurity, nonce);
    const fields = encParams(url, 'POST', sn, nonce, [['data', data]], this.ssecurity);
    const cookies = [
      ['userId', this.userId],
      ['yetAnotherServiceToken', this.serviceToken],
      ['serviceToken', this.serviceToken],
      ['locale', 'en_GB'],
      ['timezone', 'GMT+02:00'],
      ['is_daylight', '1'],
      ['dst_offset', '3600000'],
      ['channel', 'MI_APP_STORE'],
    ].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(`${url}?${toQuery(fields)}`, {
      method: 'POST',
      headers: {
        'Accept-Encoding': 'identity',
        'User-Agent': AGENT,
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-xiaomi-protocal-flag-cli': 'PROTOCAL-HTTP2',
        'MIOT-ENCRYPT-ALGORITHM': 'ENCRYPT-RC4',
        Cookie: cookies,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return JSON.parse(decryptResponse(this.ssecurity, nonce, await res.text()));
  }

  /** Step 4a: finds scooters in all homes (own and shared) on every Xiaomi region. */
  async findScooters(onProgress?: (msg: string) => void): Promise<CloudScooter[]> {
    const out: CloudScooter[] = [];
    for (const server of XIAOMI_SERVERS) {
      if (this.cancelled) break;
      onProgress?.(`Looking for your scooter (region ${server})…`);
      try {
        const homes: { id: string; owner: string }[] = [];
        const h = await this.call(server, '/v2/homeroom/gethome', '{"fg": true, "fetch_share": true, "fetch_share_dev": true, "limit": 300, "app_ver": 7}');
        for (const x of h?.result?.homelist ?? []) homes.push({ id: String(x.id), owner: this.userId });
        const c = await this.call(server, '/v2/user/get_device_cnt', '{ "fetch_own": true, "fetch_share": true}').catch(() => null);
        for (const x of c?.result?.share?.share_family ?? []) homes.push({ id: String(x.home_id), owner: String(x.home_owner) });
        for (const home of homes) {
          const d = await this.call(server, '/v2/home/home_device_list', `{"home_owner": ${home.owner},"home_id": ${home.id}, "limit": 200, "get_split_device": true, "support_smart_home": true}`);
          for (const dev of d?.result?.device_info ?? []) {
            if (typeof dev?.model === 'string' && /scooter/i.test(dev.model) && !out.some((o) => o.did === String(dev.did))) {
              out.push({ name: String(dev.name ?? dev.model), did: String(dev.did), model: dev.model, server });
            }
          }
        }
      } catch (e) {
        devLog('info', `Xiaomi cloud ${server}: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (out.length) break; // a scooter lives in one region
    }
    return out;
  }

  /** Step 4b: the scooter's Bluetooth key (64 hex chars) and whether it is PIN-protected (encrypt_type 1). */
  async bluetoothKey(s: CloudScooter): Promise<{ key: string; encryptType: 0 | 1 }> {
    const r = await this.call(s.server, '/share/askbluetoothkey', `{"type":"own","did":"${s.did}","keyid":0}`);
    const key = r?.result?.key;
    if (r?.code !== 0 || typeof key !== 'string') throw new Error(`Xiaomi did not return a key (code ${r?.code ?? '?'})`);
    const enc = Number(r.result.encrypt_type ?? 0);
    if (enc !== 0 && enc !== 1) throw new Error(`Unknown key type ${enc}`);
    return { key, encryptType: enc as 0 | 1 };
  }
}

/**
 * Xiaomi's official, public MIoT spec for a device model (miot-spec.org): the list of
 * services and properties (siid/piid, names, formats, value lists) the device exposes.
 */
export async function fetchOfficialSpec(model: string): Promise<unknown> {
  const res = await fetch('https://miot-spec.org/miot-spec-v2/instances?status=all');
  if (!res.ok) throw new Error(`Xiaomi spec list not reachable (HTTP ${res.status})`);
  const all = (await res.json()) as { instances?: { model: string; version: number; type: string; status?: string }[] };
  const mine = (all.instances ?? []).filter((i) => i.model === model).sort((a, b) => (b.status === 'released' ? 1 : 0) - (a.status === 'released' ? 1 : 0) || b.version - a.version);
  if (!mine.length) throw new Error(`Xiaomi publishes no property list for ${model}`);
  const r = await fetch(`https://miot-spec.org/miot-spec-v2/instance?type=${encodeURIComponent(mine[0].type)}`);
  if (!r.ok) throw new Error(`Xiaomi spec for ${model} not reachable (HTTP ${r.status})`);
  return r.json();
}
