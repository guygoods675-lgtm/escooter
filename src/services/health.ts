import type { ErrorRecord } from '../store/errors';
import type { BatteryDetails, ProtocolCapabilities, ScooterIdentity, TelemetrySnapshot } from '../protocols/types';

/**
 * Scooter health summary built only from what the scooter reports:
 * active error/warning codes (documented meanings), connection state and
 * readings. It never infers that a part is damaged; a category with no data
 * is "unknown", not "normal".
 */
export type HealthStatus = 'normal' | 'warning' | 'critical' | 'unknown';
export type HealthCategory = 'battery' | 'motor' | 'controller' | 'communication' | 'lights' | 'errors' | 'firmware';

export interface HealthItem {
  category: HealthCategory;
  title: string;
  icon: string;
  status: HealthStatus;
  summary: string;
  details: { label: string; value: string }[];
  codes: ErrorRecord[];
}

// Error code → subsystem, from the code descriptions in the ninebot-docs M365ESC / ES2ESC tables.
const CODE_CATEGORY: Record<number, HealthCategory> = {
  1: 'firmware', 2: 'firmware', 3: 'firmware', 4: 'firmware', 5: 'firmware', 6: 'firmware',
  10: 'communication', 21: 'communication', 32: 'communication', 42: 'communication',
  11: 'motor', 12: 'motor', 13: 'motor', 18: 'motor', 28: 'motor', 29: 'motor',
  14: 'controller', 15: 'controller', 24: 'controller', 27: 'controller', 35: 'controller', 40: 'controller',
  19: 'battery', 20: 'battery', 22: 'battery', 23: 'battery', 38: 'battery', 39: 'battery', 41: 'battery',
  43: 'battery', 44: 'battery', 45: 'battery', 46: 'battery',
  49: 'firmware', 50: 'firmware',
};

const RANK: Record<HealthStatus, number> = { unknown: -1, normal: 0, warning: 1, critical: 2 };
export const worst = (a: HealthStatus, b: HealthStatus): HealthStatus => (RANK[b] > RANK[a] ? b : a);
const fromCodes = (codes: ErrorRecord[]): HealthStatus =>
  codes.reduce<HealthStatus>((s, c) => worst(s, c.severity === 'CRITICAL' ? 'critical' : c.severity === 'WARNING' ? 'warning' : 'normal'), 'normal');

export interface HealthInput {
  connected: boolean;
  conn: string;
  rssi: number | null;
  snapshot: TelemetrySnapshot | null;
  battery: BatteryDetails | null;
  identity: ScooterIdentity | null;
  capabilities: ProtocolCapabilities | null;
  activeCodes: ErrorRecord[];
  lowBatteryPercent: number;
  fmtTemp: (c: number) => string;
}

export function computeHealth(h: HealthInput): { overall: HealthStatus; items: HealthItem[] } {
  const s = h.snapshot;
  const errorsKnown = h.connected && !!h.capabilities?.errors;
  const codesFor = (cat: HealthCategory) => h.activeCodes.filter((c) => c.kind === 'error' && CODE_CATEGORY[c.code] === cat);
  const na = 'Not available';
  const t = (r: { value: number } | null | undefined) => (r ? h.fmtTemp(r.value) : na);

  const mk = (category: HealthCategory, title: string, icon: string, base: HealthStatus, okSummary: string, details: HealthItem['details'], extraStatus?: { status: HealthStatus; summary: string }): HealthItem => {
    const codes = codesFor(category);
    let status = codes.length ? worst(base === 'unknown' ? 'normal' : base, fromCodes(codes)) : base;
    let summary = codes.length ? codes.map((c) => `E${c.code} ${c.title}`).join(' · ') : okSummary;
    if (extraStatus && RANK[extraStatus.status] > RANK[status]) {
      status = extraStatus.status;
      summary = extraStatus.summary;
    }
    return { category, title, icon, status, summary, details, codes };
  };

  const pct = s?.batteryPercent?.value ?? h.battery?.percent?.value ?? null;
  const cells = h.battery?.cellVoltages?.value;
  const battery = mk(
    'battery',
    'Battery',
    'battery-half-outline',
    errorsKnown ? 'normal' : 'unknown',
    errorsKnown ? 'No battery error codes reported' : 'Battery error reporting not available',
    [
      { label: 'Charge', value: pct != null ? `${pct}%` : na },
      { label: 'Voltage', value: s?.batteryVoltage ? `${s.batteryVoltage.value.toFixed(2)} V` : na },
      { label: 'Temperature', value: t(s?.batteryTempC) },
      { label: 'Health (BMS reported)', value: h.battery?.healthPercent ? `${h.battery.healthPercent.value}%` : na },
      { label: 'Cell spread', value: cells && cells.length ? `${((Math.max(...cells) - Math.min(...cells)) * 1000).toFixed(0)} mV` : na },
    ],
    pct != null && pct <= h.lowBatteryPercent ? { status: 'warning', summary: `Charge ${pct}% is at or below your alert threshold` } : undefined,
  );
  const motor = mk('motor', 'Motor', 'cog-outline', errorsKnown ? 'normal' : 'unknown', errorsKnown ? 'No motor error codes reported' : 'Motor error reporting not available', [
    { label: 'Temperature', value: t(s?.motorTempC) },
    { label: 'RPM', value: s?.motorRpm ? String(Math.round(s.motorRpm.value)) : na },
    { label: 'Power', value: s?.powerW ? `${Math.round(s.powerW.value)} W` : na },
  ]);
  const controller = mk('controller', 'Controller', 'hardware-chip-outline', errorsKnown ? 'normal' : 'unknown', errorsKnown ? 'No controller error codes reported' : 'Controller error reporting not available', [
    { label: 'Temperature', value: t(s?.controllerTempC) },
    { label: 'Firmware', value: h.identity?.controllerFirmware?.value ?? na },
    { label: 'Current', value: s?.batteryCurrent ? `${s.batteryCurrent.value.toFixed(2)} A` : na },
  ]);
  const commStatus: HealthStatus = h.conn === 'connected' ? 'normal' : h.conn === 'reconnecting' ? 'warning' : 'unknown';
  const communication = mk(
    'communication',
    'Communication',
    'bluetooth-outline',
    commStatus,
    h.conn === 'connected' ? 'Bluetooth link active' : h.conn === 'reconnecting' ? 'Reconnecting to the scooter' : 'Not connected',
    [
      { label: 'Connection', value: h.conn },
      { label: 'Signal', value: h.rssi != null ? `${h.rssi} dBm` : na },
      { label: 'Protocol', value: h.identity?.protocolVersion?.value ?? na },
    ],
    h.connected && h.rssi != null && h.rssi < -85 ? { status: 'warning', summary: `Weak Bluetooth signal (${h.rssi} dBm)` } : undefined,
  );
  const lights = mk('lights', 'Lights', 'bulb-outline', 'unknown', 'The scooter does not report light faults', [
    { label: 'Headlight', value: s?.headlight ? (s.headlight.value ? 'On' : 'Off') : na },
    { label: 'Tail light', value: s?.tailLight ? (s.tailLight.value ? 'On' : 'Off') : na },
  ]);
  const allErr = h.activeCodes;
  const errors: HealthItem = {
    category: 'errors',
    title: 'Errors',
    icon: 'alert-circle-outline',
    status: errorsKnown ? fromCodes(allErr) : 'unknown',
    summary: !errorsKnown ? 'Error reporting not available' : allErr.length ? `${allErr.length} active code${allErr.length > 1 ? 's' : ''}` : 'No active codes',
    details: allErr.map((c) => ({ label: `${c.kind === 'error' ? 'E' : 'W'}${c.code}`, value: c.title })),
    codes: allErr,
  };
  const firmware = mk('firmware', 'Firmware', 'code-working-outline', h.identity?.firmware ? 'normal' : 'unknown', h.identity?.firmware ? 'Versions read, no firmware codes' : 'Firmware versions not available', [
    { label: 'Firmware', value: h.identity?.firmware?.value ?? na },
    { label: 'BMS firmware', value: h.identity?.bmsFirmware?.value ?? h.battery?.firmware?.value ?? na },
    { label: 'BLE firmware', value: h.identity?.bleFirmware?.value ?? na },
  ]);
  const items = [battery, motor, controller, communication, lights, errors, firmware];
  // Without a live connection nothing current is known, whatever stale data is still cached.
  const overall = h.connected ? items.reduce<HealthStatus>((a, i) => worst(a, i.status), 'unknown') : 'unknown';
  return { overall, items };
}
