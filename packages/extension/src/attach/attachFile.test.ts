import { describe, it, expect, vi } from 'vitest';
import { attachFile, type AttachDeps } from './attachFile.ts';

function deps(over: Partial<AttachDeps> = {}): AttachDeps {
  return {
    runCliJson: vi.fn(async () => ({ remotePath: '~/workspace/app/.patchwire-inbox/shot.png' })),
    flushSync: vi.fn(async () => {}),
    sendToTerminal: vi.fn(() => true),
    copyToClipboard: vi.fn(async () => {}),
    notify: vi.fn(),
    ...over,
  };
}

describe('attachFile', () => {
  it('stages via CLI, flushes sync, and types the remote path into the terminal', async () => {
    const d = deps();
    await attachFile('/Users/me/Desktop/shot.png', d);
    expect(d.runCliJson).toHaveBeenCalledWith(['push', '/Users/me/Desktop/shot.png', '--stage-only', '--json']);
    expect(d.flushSync).toHaveBeenCalledOnce();
    expect(d.sendToTerminal).toHaveBeenCalledWith('~/workspace/app/.patchwire-inbox/shot.png');
    expect(d.copyToClipboard).not.toHaveBeenCalled();
  });

  it('falls back to clipboard when no terminal is open', async () => {
    const d = deps({ sendToTerminal: vi.fn(() => false) });
    await attachFile('/Users/me/Desktop/shot.png', d);
    expect(d.copyToClipboard).toHaveBeenCalledWith('~/workspace/app/.patchwire-inbox/shot.png');
    expect(d.notify).toHaveBeenCalledWith(expect.stringMatching(/copied/i));
  });

  it('uses --clip when invoked for a clipboard image', async () => {
    const d = deps();
    await attachFile(null, d, { clip: true });
    expect(d.runCliJson).toHaveBeenCalledWith(['push', '--clip', '--stage-only', '--json']);
    expect(d.flushSync).toHaveBeenCalledOnce();
  });

  it('does not call the CLI and notifies when no file is selected (no clip)', async () => {
    const d = deps();
    await attachFile(null, d);
    expect(d.runCliJson).not.toHaveBeenCalled();
    expect(d.notify).toHaveBeenCalledWith(expect.stringMatching(/no file selected/i));
  });

  it('surfaces a clear error if staging fails', async () => {
    const d = deps({ runCliJson: vi.fn(async () => { throw new Error('No image in the clipboard'); }) });
    await attachFile(null, d, { clip: true });
    expect(d.notify).toHaveBeenCalledWith(expect.stringMatching(/No image in the clipboard/));
    expect(d.sendToTerminal).not.toHaveBeenCalled();
  });
});
