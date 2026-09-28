// Pure helpers for BLE LAB: byte previews and capture export (JSON / CSV).
// No React Native imports so they can be unit tested with node.
import type { GattServiceInfo } from '../../ble/BluetoothManager';
import type { CapturePacket, PacketDir } from '../../store/devlog';

export const asciiPreview = (bytes: ArrayLike<number>) => {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i] >= 32 && bytes[i] < 127 ? String.fromCharCode(bytes[i]) : '.';
  return s;
};
export const decimalPreview = (bytes: ArrayLike<number>) => Array.from(bytes).join(' ');

export const dirGroup = (d: PacketDir): 'rx' | 'tx' | 'event' => (d === 'read' || d === 'notify' ? 'rx' : d === 'event' ? 'event' : 'tx');

export const charProperties = (c: GattServiceInfo['characteristics'][number]) =>
  [
    c.readable && 'read',
    c.writableWithResponse && 'write',
    c.writableWithoutResponse && 'writeWithoutResponse',
    c.notifiable && 'notify',
    c.indicatable && 'indicate',
  ].filter(Boolean) as string[];

export interface CaptureExportInput {
  exportedAt: number;
  app: string;
  device: {
    name: string | null;
    id: string | null;
    protocol: string | null;
    rssiDbm: number | null;
    mtu: number | null;
    manufacturerDataHex: string | null;
    companyId: string | null;
    companyName: string | null;
  };
  capture: { startedAt: number | null; stoppedAt: number | null; capacity: number; droppedOldest: number };
  services: GattServiceInfo[];
  packets: CapturePacket[];
  nameOf: (uuid: string) => string | null;
}

const iso = (t: number | null) => (t == null ? null : new Date(t).toISOString());

export function buildCaptureJson(x: CaptureExportInput): string {
  const doc = {
    format: 'scooterhub-ble-capture',
    version: 1,
    exportedAt: iso(x.exportedAt),
    app: x.app,
    note: 'Raw GATT traffic as seen by the phone. Values are undecoded bytes; nothing here is interpreted.',
    device: x.device,
    capture: { ...x.capture, startedAt: iso(x.capture.startedAt), stoppedAt: iso(x.capture.stoppedAt), packetCount: x.packets.length },
    services: x.services.map((s) => ({
      uuid: s.uuid,
      name: x.nameOf(s.uuid),
      characteristics: s.characteristics.map((c) => ({ uuid: c.uuid, name: x.nameOf(c.uuid), properties: charProperties(c) })),
    })),
    packets: x.packets.map((p) => ({
      ts: p.t,
      dir: p.dir,
      group: dirGroup(p.dir),
      service: p.service,
      char: p.char,
      len: p.len,
      hex: p.hex,
      ...(p.note ? { note: p.note } : {}),
    })),
  };
  return JSON.stringify(doc, null, 1);
}

const csvCell = (v: string | number | null | undefined) => {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function buildCaptureCsv(packets: CapturePacket[], nameOf: (uuid: string) => string | null): string {
  const rows = ['ts_ms,iso_time,dir,group,service_uuid,char_uuid,char_name,len,hex,note'];
  for (const p of packets)
    rows.push(
      [p.t, new Date(p.t).toISOString(), p.dir, dirGroup(p.dir), p.service, p.char, p.char ? nameOf(p.char) : null, p.len, p.hex, p.note].map(csvCell).join(','),
    );
  return rows.join('\n') + '\n';
}
