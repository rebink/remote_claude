import type { SessionStore } from './session-store.ts';

export interface ChangedFile {
  path: string;
  status: 'A' | 'M' | 'D' | 'R';
  additions: number;
  deletions: number;
}

export type ChatEvent =
  | { type: 'chat_turn_start'; sessionId: string; turnIndex: number }
  | { type: 'chat_text'; chunk: string }
  | { type: 'chat_diff'; patch: string; files: ChangedFile[] }
  | { type: 'chat_done'; tokensIn: number; tokensOut: number; durationMs: number };

export interface ClaudeRunner {
  run(
    claudeSessionId: string,
    prompt: string,
    onText: (chunk: string) => void,
  ): Promise<{ tokensIn: number; tokensOut: number }>;
}

export interface GitOps {
  diffHead(cwd: string): Promise<{ patch: string; files: ChangedFile[] }>;
  cleanResetToHead(cwd: string): Promise<void>;
}

export async function runChatTurn(input: {
  uuid: string;
  prompt: string;
  cwd: string;
  store: SessionStore;
  ai: ClaudeRunner;
  git: GitOps;
  emit: (e: ChatEvent) => void;
}): Promise<void> {
  const start = Date.now();
  const sessionId = await input.store.getOrCreate(input.uuid);
  input.emit({ type: 'chat_turn_start', sessionId, turnIndex: 0 });

  try {
    const tokens = await input.ai.run(sessionId, input.prompt, (chunk) =>
      input.emit({ type: 'chat_text', chunk }),
    );

    const diff = await input.git.diffHead(input.cwd);
    if (diff.files.length > 0) {
      input.emit({ type: 'chat_diff', patch: diff.patch, files: diff.files });
    }

    input.emit({
      type: 'chat_done',
      tokensIn: tokens.tokensIn,
      tokensOut: tokens.tokensOut,
      durationMs: Date.now() - start,
    });
  } finally {
    await input.git.cleanResetToHead(input.cwd);
  }
}
