import { describe, it, expect, vi } from 'vitest';
import { runChatTurn } from '../../src/agent/chat.ts';

describe('runChatTurn', () => {
  it('emits text → diff → done events and resets git after', async () => {
    const events: any[] = [];
    const emit = (e: any) => events.push(e);

    const fakeClaude = {
      run: vi.fn(async (_id: string, _prompt: string, onText: (c: string) => void) => {
        onText('hello ');
        onText('world');
        return { tokensIn: 0, tokensOut: 11 };
      }),
    };
    const fakeGit = {
      diffHead: vi.fn(async () => ({
        patch: 'diff --git a/x b/x\n+y',
        files: [{ path: 'x', status: 'M' as const, additions: 1, deletions: 0 }],
      })),
      cleanResetToHead: vi.fn(async () => {}),
    };
    const fakeStore = { getOrCreate: vi.fn(async () => 'claude-id-1') };

    await runChatTurn({
      uuid: 'u1',
      prompt: 'do thing',
      cwd: '/tmp/p',
      store: fakeStore as any,
      claude: fakeClaude as any,
      git: fakeGit as any,
      emit,
    });

    expect(events.map((e) => e.type)).toEqual([
      'chat_turn_start',
      'chat_text',
      'chat_text',
      'chat_diff',
      'chat_done',
    ]);
    expect(fakeGit.cleanResetToHead).toHaveBeenCalled();
  });

  it('still resets git on error path', async () => {
    const events: any[] = [];
    const fakeClaude = {
      run: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    const fakeGit = { diffHead: vi.fn(), cleanResetToHead: vi.fn() };
    const fakeStore = { getOrCreate: vi.fn(async () => 'cid') };

    await expect(
      runChatTurn({
        uuid: 'u2',
        prompt: 'x',
        cwd: '/tmp/p',
        store: fakeStore as any,
        claude: fakeClaude as any,
        git: fakeGit as any,
        emit: (e: any) => events.push(e),
      }),
    ).rejects.toThrow('boom');
    expect(fakeGit.cleanResetToHead).toHaveBeenCalled();
  });
});
