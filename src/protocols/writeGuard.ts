/**
 * Developer-mode raw writes are allowed only after explicit confirmation, and
 * never for frames that carry firmware-update, activation, speed-limit or
 * odometer commands of the documented Xiaomi/Ninebot protocols.
 * Command codes: https://github.com/etransport/ninebot-docs/wiki/protocol ("Commands")
 * Speed-limit registers 0x72-0x74: https://github.com/etransport/ninebot-docs/wiki/ES2ESC
 */
const BLOCKED_CMDS: Record<number, string> = {
  0x07: 'firmware update start',
  0x08: 'firmware update write',
  0x09: 'firmware update finish',
  0x0a: 'reboot after update',
  0x18: 'program serial number',
  0x57: 'activation / speed limit',
  0x58: 'factory reset',
  0x59: 'activation without limit',
  0x5a: 'user reset',
  0x5c: 'set odometer',
};
const WRITE_CMDS = new Set([0x02, 0x03]);
const BLOCKED_REGS: Record<number, string> = { 0x72: 'speed limit', 0x73: 'speed limit (normal)', 0x74: 'speed limit (eco)' };

export function checkRawWrite(bytes: Uint8Array): { ok: true } | { ok: false; reason: string } {
  const scan = (cmd: number, arg: number) => {
    if (BLOCKED_CMDS[cmd]) return `Blocked: ${BLOCKED_CMDS[cmd]} command (0x${cmd.toString(16)})`;
    if (WRITE_CMDS.has(cmd) && BLOCKED_REGS[arg]) return `Blocked: write to ${BLOCKED_REGS[arg]} register`;
    return null;
  };
  for (let i = 0; i + 1 < bytes.length; i++) {
    if (bytes[i] === 0x55 && bytes[i + 1] === 0xaa && i + 5 < bytes.length) {
      const r = scan(bytes[i + 4], bytes[i + 5]);
      if (r) return { ok: false, reason: r };
    }
    if (bytes[i] === 0x5a && bytes[i + 1] === 0xa5 && i + 6 < bytes.length) {
      const r = scan(bytes[i + 5], bytes[i + 6]);
      if (r) return { ok: false, reason: r };
    }
  }
  return { ok: true };
}
