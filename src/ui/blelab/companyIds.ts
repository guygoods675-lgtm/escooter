/**
 * A deliberately small subset of Bluetooth SIG company identifiers
 * (Assigned Numbers, "Company Identifiers":
 * https://www.bluetooth.com/specifications/assigned-numbers/).
 * Only long-standing, well-known entries are listed; anything else is shown
 * as the raw ID with "Unknown". Note that many scooters put non-standard
 * bytes in the manufacturer-data field, so a match is only what the device
 * advertises, not proof of who made it.
 */
const COMPANY_IDS: Record<number, string> = {
  0x0000: 'Ericsson',
  0x0002: 'Intel',
  0x0006: 'Microsoft',
  0x000d: 'Texas Instruments',
  0x000f: 'Broadcom',
  0x004c: 'Apple',
  0x0059: 'Nordic Semiconductor',
  0x0075: 'Samsung Electronics',
  0x00e0: 'Google',
};

export interface CompanyInfo {
  /** Company ID from the first two bytes of the manufacturer data (little-endian), or null if too short / absent. */
  id: number | null;
  /** "0x004C" style label, or null. */
  idHex: string | null;
  /** Name from the table above, or null if not in the table. */
  name: string | null;
}

export const companyIdHex = (id: number) => `0x${id.toString(16).toUpperCase().padStart(4, '0')}`;

/** Parses advertised manufacturer data (hex string) into its Bluetooth SIG company ID. */
export function parseCompany(manufacturerDataHex: string | null | undefined): CompanyInfo {
  const clean = (manufacturerDataHex ?? '').replace(/[^0-9a-f]/gi, '');
  if (clean.length < 4) return { id: null, idHex: null, name: null };
  const lo = parseInt(clean.slice(0, 2), 16);
  const hi = parseInt(clean.slice(2, 4), 16);
  const id = lo | (hi << 8);
  return { id, idHex: companyIdHex(id), name: COMPANY_IDS[id] ?? null };
}
