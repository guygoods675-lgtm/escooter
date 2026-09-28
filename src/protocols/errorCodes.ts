import type { ErrorCodeInfo, ErrorSeverity } from './types';

/**
 * Error code meanings come from the etransport/ninebot-docs wiki:
 *   M365 ESC: https://github.com/etransport/ninebot-docs/wiki/M365ESC  ("Error codes")
 *   Ninebot ES2 ESC: https://github.com/etransport/ninebot-docs/wiki/ES2ESC ("Error codes")
 * The code description is from that source. The severity category and the
 * "possible causes" list are Scooter Hub's own general guidance, not
 * manufacturer statements, and the UI labels them that way.
 */

type Entry = [title: string, severity: ErrorSeverity, causes: string[]];

const COMMS = ['Loose or damaged connector/cable', 'Water ingress in the connector', 'Temporary communication failure'];

const M365: Record<number, Entry> = {
  10: ['No communication with BLE board', 'WARNING', ['Dashboard (BLE board) cable loose or damaged', ...COMMS.slice(1)]],
  11: ['Motor phase A current out of range', 'CRITICAL', ['Motor phase wiring or connector issue', 'Controller or motor fault']],
  12: ['Motor phase B current out of range', 'CRITICAL', ['Motor phase wiring or connector issue', 'Controller or motor fault']],
  13: ['Motor phase C current out of range', 'CRITICAL', ['Motor phase wiring or connector issue', 'Controller or motor fault']],
  14: ['Throttle handle position out of range', 'WARNING', ['Throttle held during power-on', 'Throttle sensor or cable issue']],
  15: ['Brake handle position out of range', 'WARNING', ['Brake lever held during power-on', 'Brake sensor or cable issue']],
  18: ['Motor Hall sensors stuck at 0/1', 'CRITICAL', ['Hall sensor wiring or connector issue', 'Hall sensor fault']],
  21: ['No communication with BMS', 'CRITICAL', COMMS],
  22: ['BMS config invalid', 'CRITICAL', ['BMS configuration/firmware problem']],
  23: ['BMS not activated (has default S/N)', 'WARNING', ['Battery pack not activated for this scooter']],
  24: ['Supply voltage out of range', 'CRITICAL', ['Battery voltage outside the controller range']],
  27: ['ESC config invalid', 'CRITICAL', ['Controller configuration/firmware problem']],
  28: ['Motor overvoltage in idle', 'CRITICAL', ['Reported by the controller; see a service centre']],
  29: ['Motor voltage out of range', 'CRITICAL', ['Reported by the controller; see a service centre']],
  35: ['ESC not activated (has default S/N)', 'WARNING', ['Controller not activated']],
  39: ['Battery overheat', 'CRITICAL', ['Battery temperature reported too high by the scooter']],
  40: ['ESC overheat', 'CRITICAL', ['Controller temperature reported too high by the scooter']],
};

const ES2: Record<number, Entry> = {
  10: M365[10],
  11: M365[11],
  12: M365[12],
  13: M365[13],
  14: M365[14],
  15: M365[15],
  18: M365[18],
  19: ['Internal battery voltage out of range', 'CRITICAL', ['Internal battery voltage outside controller range']],
  20: ['External battery voltage out of range', 'CRITICAL', ['External battery voltage outside controller range']],
  21: ['No communication with internal BMS', 'CRITICAL', COMMS],
  22: ['Internal BMS config invalid', 'CRITICAL', ['BMS configuration/firmware problem']],
  23: ['Internal BMS not activated (has default S/N)', 'WARNING', ['Battery pack not activated for this scooter']],
  24: M365[24],
  27: M365[27],
  32: ['No communication with IoT device', 'INFO', COMMS],
  35: M365[35],
  38: ['Charging overcurrent', 'CRITICAL', ['Charger or charging circuit problem']],
  39: ['Internal battery overheat', 'CRITICAL', ['Battery temperature reported too high by the scooter']],
  41: ['External battery overheat', 'CRITICAL', ['External battery temperature reported too high']],
  42: ['No communication with external BMS', 'WARNING', COMMS],
  43: ['External BMS config invalid', 'CRITICAL', ['External BMS configuration/firmware problem']],
  44: ['External BMS not activated (has default S/N)', 'WARNING', ['External battery not activated']],
  45: ['Internal BMS deep cell discharge', 'CRITICAL', ['A cell was deeply discharged']],
  46: ['External BMS deep cell discharge', 'CRITICAL', ['A cell was deeply discharged']],
  49: ['Internal BMS firmware version mismatch', 'WARNING', ['BMS and controller firmware versions do not match']],
  50: ['External BMS firmware version mismatch', 'WARNING', ['BMS and controller firmware versions do not match']],
};

const SRC_M365 = 'etransport/ninebot-docs wiki: M365ESC error codes';
const SRC_ES2 = 'etransport/ninebot-docs wiki: ES2ESC error codes';

export const M365_ERROR_TABLE = M365;
export const ES2_ERROR_TABLE = ES2;

function build(table: Record<number, Entry>, source: string, code: number, kind: 'error' | 'warning'): ErrorCodeInfo {
  const e = table[code];
  if (!e || kind === 'warning') {
    return {
      code,
      title: kind === 'warning' ? `Warning code ${code}` : `Error code ${code}`,
      causes: [],
      severity: kind === 'warning' ? 'INFO' : 'WARNING',
      source: kind === 'warning' ? 'Warning code meanings are not publicly documented' : 'Code not listed in the public documentation',
    };
  }
  return { code, title: e[0], severity: e[1], causes: e[2], source };
}

export const describeM365Error = (code: number, kind: 'error' | 'warning') => build(M365, SRC_M365, code, kind);
export const describeES2Error = (code: number, kind: 'error' | 'warning') => build(ES2, SRC_ES2, code, kind);

export const genericError = (code: number, kind: 'error' | 'warning'): ErrorCodeInfo => ({
  code,
  title: `${kind === 'error' ? 'Error' : 'Warning'} ${code}`,
  causes: [],
  severity: 'WARNING',
  source: 'No documented meaning for this scooter',
});
