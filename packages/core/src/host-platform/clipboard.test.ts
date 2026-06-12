import { describe, it, expect } from 'vitest';
import { clipboardImageCommands } from './clipboard.ts';

describe('clipboardImageCommands', () => {
  it('darwin: pngpaste then osascript', () => {
    const c = clipboardImageCommands('darwin', '/tmp/x.png');
    expect(c.map((x) => x.cmd)).toEqual(['pngpaste', 'osascript']);
    expect(c[0]!.args).toEqual(['/tmp/x.png']);
  });
  it('win32: powershell', () => {
    const c = clipboardImageCommands('win32', 'C:\\x.png');
    expect(c).toHaveLength(1);
    expect(c[0]!.cmd).toBe('powershell');
  });
  it('linux: wl-paste then xclip, both writing to stdout', () => {
    const c = clipboardImageCommands('linux', '/tmp/x.png');
    expect(c.map((x) => x.cmd)).toEqual(['wl-paste', 'xclip']);
    expect(c.every((x) => x.writesToStdout)).toBe(true);
  });
});

describe('clipboardImageCommands — injection hardening', () => {
  it('escapes a double-quote in the darwin osascript path', () => {
    const c = clipboardImageCommands('darwin', '/tmp/a"b.png');
    const script = c[1]!.args[1]!;
    expect(script).toContain('POSIX file "/tmp/a\\"b.png"');
  });
  it('escapes a single-quote in the win32 powershell path', () => {
    const c = clipboardImageCommands('win32', "C:\\a'b.png");
    expect(c[0]!.args[2]).toContain("'C:\\a''b.png'");
  });
  it('rejects a path containing a newline', () => {
    expect(() => clipboardImageCommands('darwin', '/tmp/x\n.png')).toThrow(/newline/i);
  });
});
