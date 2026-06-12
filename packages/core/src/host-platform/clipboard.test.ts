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
