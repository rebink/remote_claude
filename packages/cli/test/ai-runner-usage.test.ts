import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeAiRunner } from '../src/agent/ai-runner.ts';

const SID = '11111111-2222-3333-4444-555555555555';

describe('makeAiRunner — real token capture (M6 step 1)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pw-airunner-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function fakeBin(body: string): string {
    const p = join(dir, 'fake-ai.sh');
    writeFileSync(p, `#!/bin/sh\ncat > /dev/null\n${body}\n`, 'utf8');
    chmodSync(p, 0o755);
    return p;
  }

  it('returns real input/output tokens parsed from claude JSON output', async () => {
    const bin = fakeBin(
      `printf '%s' '{"type":"result","result":"ok","total_cost_usd":0.01,"usage":{"input_tokens":1234,"output_tokens":56}}'`,
    );
    const runner = makeAiRunner({ bin, args: [] });
    const tokens = await runner.run(SID, 'hello', () => {});
    expect(tokens.tokensIn).toBe(1234);
    expect(tokens.tokensOut).toBe(56);
  });

  it('returns {0,0} for plain-text output instead of a character count', async () => {
    // 40 chars of prose — the old code would have returned tokensOut=40.
    const bin = fakeBin(`printf '%s' 'a plain sentence of model output, no json.'`);
    const runner = makeAiRunner({ bin, args: [] });
    const tokens = await runner.run(SID, 'hello', () => {});
    expect(tokens.tokensIn).toBe(0);
    expect(tokens.tokensOut).toBe(0);
  });
});
