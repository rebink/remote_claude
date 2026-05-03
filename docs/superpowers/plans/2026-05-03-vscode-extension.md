# Remote Claude — VS Code Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a VS Code extension that wraps the existing `remote-claude` CLI so users can ask Claude on a remote Mac Mini and review/apply the diff entirely from VS Code.

**Architecture:** Extension `child_process.spawn`s `remote-claude` and consumes a new `--json` JSONL output mode. SSH/rsync/agent-HTTP/git-apply all stay in the CLI. Diff editor uses VS Code's native diff with a custom `TextDocumentContentProvider` that returns "before" content via `git show HEAD:<path>`.

**Tech Stack:** TypeScript, Node.js >= 20, vitest, commander (existing CLI), VS Code extension API >= 1.80, `@vscode/test-electron` for the smoke test, `pnpm` workspaces for the monorepo.

**Spec:** [`docs/superpowers/specs/2026-05-03-vscode-extension-design.md`](../specs/2026-05-03-vscode-extension-design.md)

**Phases:**
- Phase A — CLI JSON mode (Tasks 1–4). Can be released independently.
- Phase B — Extension scaffold (Task 5).
- Phase C — Extension core: client, history, job manager, diff (Tasks 6–9).
- Phase D — Extension UI: tree, status bar, commands, wizard (Tasks 10–13).
- Phase E — Polish & ship: reload restore, smoke test, docs (Tasks 14–16).

---

## Phase A — CLI JSON output mode

These changes are additive. Terminal users see no behavioral difference; the new flag opts in to machine-readable output.

### Task 1: JSON event emitter library

**Files:**
- Create: `src/lib/json-events.ts`
- Test: `test/json-events.test.ts`

The CLI emits a stream of typed JSON events on stdout when `--json` is passed. Centralize the emit/types so every command uses the same shape.

- [ ] **Step 1: Write the failing test**

Create `test/json-events.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { emit, type RcEvent } from '../src/lib/json-events.ts';

describe('json-events', () => {
  it('writes a single JSON line per event', () => {
    const writes: string[] = [];
    const w = (s: string) => { writes.push(s); };
    emit({ type: 'syncing' }, w);
    emit({ type: 'claude-running', elapsedMs: 1234 }, w);
    expect(writes).toEqual([
      '{"type":"syncing"}\n',
      '{"type":"claude-running","elapsedMs":1234}\n',
    ]);
  });

  it('round-trips every event variant', () => {
    const variants: RcEvent[] = [
      { type: 'syncing' },
      { type: 'synced', durationMs: 500 },
      { type: 'claude-running', elapsedMs: 0 },
      { type: 'patch-ready', files: [{ path: 'a.ts', status: 'M', hunks: 2 }], metaPath: '.rc/last.meta.json', stdoutPath: '.rc/last.stdout', durationMs: 1000 },
      { type: 'applied', files: ['a.ts'] },
      { type: 'rejected' },
      { type: 'saved', patchPath: '.rc/last.patch' },
      { type: 'error', code: 'AGENT_UNREACHABLE', message: 'connect ECONNREFUSED' },
    ];
    for (const v of variants) {
      const writes: string[] = [];
      emit(v, (s) => writes.push(s));
      expect(JSON.parse(writes[0]!)).toEqual(v);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run test/json-events.test.ts
```
Expected: FAIL — file does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/json-events.ts`:

```typescript
export type RcEvent =
  | { type: 'syncing' }
  | { type: 'synced'; durationMs: number }
  | { type: 'claude-running'; elapsedMs: number }
  | {
      type: 'patch-ready';
      files: Array<{ path: string; status: 'A' | 'M' | 'D'; hunks: number }>;
      metaPath: string;
      stdoutPath: string;
      durationMs: number;
    }
  | { type: 'applied'; files: string[] }
  | { type: 'rejected' }
  | { type: 'saved'; patchPath: string }
  | { type: 'error'; code: string; message: string };

export function emit(event: RcEvent, write: (chunk: string) => void = (s) => process.stdout.write(s)): void {
  write(JSON.stringify(event) + '\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run test/json-events.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/json-events.ts test/json-events.test.ts
git commit -m "feat(cli): add JSON event emitter library"
```

---

### Task 2: `ask --json` mode + `last.meta.json` sidecar

**Files:**
- Modify: `src/cli.ts:60-71` — add `--json` option
- Modify: `src/commands/ask.ts` — branch to JSON-emitting path
- Modify: `src/lib/patch.ts` — extract a non-interactive `applyPatch` and a `writeMeta` helper
- Test: `test/ask-json.test.ts`

We thread `--json` through the `ask` command. In JSON mode, `ask` does NOT prompt for apply; it stops after writing the patch + meta sidecar and emits `patch-ready`. The extension owns the apply step (Task 3).

- [ ] **Step 1: Write the failing test**

Create `test/ask-json.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import type { RcEvent } from '../src/lib/json-events.ts';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'rc-ask-json-'));
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: workDir });
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: workDir });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: workDir });
  await writeFile(join(workDir, 'a.txt'), 'one\n', 'utf8');
  spawnSync('git', ['add', '.'], { cwd: workDir });
  spawnSync('git', ['commit', '-qm', 'init'], { cwd: workDir });
  await writeFile(join(workDir, 'remote-claude.yml'),
    'project: p\nremote:\n  host: h\n  user: u\n  path: /tmp/p\n  sshPort: 22\n  agentUrl: http://h:7878\n  token: t\nai:\n  command: claude\n  args: []\n  timeoutSec: 10\n', 'utf8');
});
afterEach(async () => { await rm(workDir, { recursive: true, force: true }); });

describe('ask --json', () => {
  it('emits syncing, synced, claude-running, patch-ready and writes meta + stdout sidecars', async () => {
    const { runAskJson } = await import('../src/commands/ask.ts');

    const fakeAgent = {
      ask: vi.fn().mockResolvedValue({
        diff: 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-one\n+two\n',
        files: ['a.txt'],
        durationMs: 42,
        stdout: 'all good',
        stderr: '',
        exitCode: 0,
      }),
    };
    const events: RcEvent[] = [];
    await runAskJson(workDir, 'change one to two', {
      agent: fakeAgent as any,
      sync: vi.fn().mockResolvedValue({ durationMs: 10 }),
      emit: (e) => events.push(e),
    });

    const types = events.map((e) => e.type);
    expect(types).toEqual(['syncing', 'synced', 'claude-running', 'patch-ready']);
    const ready = events.find((e) => e.type === 'patch-ready') as Extract<RcEvent, { type: 'patch-ready' }>;
    expect(ready.files).toEqual([{ path: 'a.txt', status: 'M', hunks: 1 }]);
    expect(ready.metaPath).toMatch(/\.remote-claude\/last\.meta\.json$/);
    expect(ready.stdoutPath).toMatch(/\.remote-claude\/last\.stdout$/);

    const meta = JSON.parse(await readFile(ready.metaPath, 'utf8'));
    expect(meta.prompt).toBe('change one to two');
    expect(meta.files[0].path).toBe('a.txt');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run test/ask-json.test.ts
```
Expected: FAIL — `runAskJson` not exported.

- [ ] **Step 3: Add `--json` option in `src/cli.ts`**

Edit `src/cli.ts:60-71`. Replace the `ask` command block with:

```typescript
program
  .command('ask')
  .description('Sync, then ask remote Claude — preview and apply the resulting diff')
  .argument('<prompt...>', 'instruction for Claude')
  .option('--no-sync', 'skip sync (use last synced state on remote)')
  .option('--save-only', 'save the patch without prompting to apply')
  .option('--json', 'emit JSONL events on stdout (no prompts; meant for tools)')
  .action(async (promptParts: string[], opts: { sync?: boolean; saveOnly?: boolean; json?: boolean }) => {
    const prompt = promptParts.join(' ');
    if (opts.json) {
      const { runAskJson } = await import('./commands/ask.ts');
      await runAskJson(process.cwd(), prompt);
      return;
    }
    await runAsk(process.cwd(), prompt, {
      skipSync: opts.sync === false,
      saveOnly: opts.saveOnly,
    });
  });
```

- [ ] **Step 4: Implement `runAskJson` in `src/commands/ask.ts`**

Append to `src/commands/ask.ts`:

```typescript
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { emit as defaultEmit, type RcEvent } from '../lib/json-events.ts';
import { savePatch, splitDiffByFile } from '../lib/patch.ts';

export interface RunAskJsonDeps {
  agent?: { ask: (req: { prompt: string; project: string }) => Promise<import('../lib/client.ts').AskResponse> };
  sync?: (cfg: import('../lib/config.ts').Config, cwd: string) => Promise<{ durationMs: number }>;
  emit?: (event: RcEvent) => void;
}

export async function runAskJson(cwd: string, prompt: string, deps: RunAskJsonDeps = {}): Promise<void> {
  const emit = deps.emit ?? ((e) => defaultEmit(e));
  try {
    const cfg = await loadConfig(cwd);

    emit({ type: 'syncing' });
    const syncFn = deps.sync ?? rsyncPush;
    const synced = await syncFn(cfg, cwd);
    emit({ type: 'synced', durationMs: synced.durationMs });

    emit({ type: 'claude-running', elapsedMs: 0 });
    const agent = deps.agent ?? new AgentClient(cfg);
    const askStart = Date.now();
    const res = await agent.ask({ prompt, project: cfg.project });
    const askMs = Date.now() - askStart;

    if (!res.diff.trim()) {
      emit({ type: 'patch-ready', files: [], metaPath: '', stdoutPath: '', durationMs: askMs });
      return;
    }

    const patchPath = await savePatch(res.diff, cwd);
    const stdoutPath = join(cwd, '.remote-claude', 'last.stdout');
    await writeFile(stdoutPath, res.stdout, 'utf8');

    const chunks = splitDiffByFile(res.diff);
    const files = chunks.map((c) => ({
      path: c.path,
      status: c.isNew ? ('A' as const) : c.isDeleted ? ('D' as const) : ('M' as const),
      hunks: countHunks(c.text),
    }));

    const metaPath = join(cwd, '.remote-claude', 'last.meta.json');
    const meta = {
      prompt,
      files,
      patchPath,
      stdoutPath,
      ranAt: new Date().toISOString(),
      durationMs: askMs,
      exitCode: res.exitCode,
    };
    await mkdir(join(cwd, '.remote-claude'), { recursive: true });
    await writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');

    emit({ type: 'patch-ready', files, metaPath, stdoutPath, durationMs: askMs });
  } catch (err) {
    emit({ type: 'error', code: classify(err), message: (err as Error).message });
    process.exitCode = 1;
  }
}

function countHunks(chunkText: string): number {
  return (chunkText.match(/^@@ /gm) ?? []).length;
}

function classify(err: unknown): string {
  const msg = (err as Error)?.message ?? '';
  if (msg.includes('ECONNREFUSED')) return 'AGENT_UNREACHABLE';
  if (msg.includes('401')) return 'BAD_TOKEN';
  if (msg.includes('timeout') || msg.includes('aborted')) return 'TIMEOUT';
  return 'UNKNOWN';
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm vitest run test/ask-json.test.ts
```
Expected: PASS.

- [ ] **Step 6: Verify the existing ask test still passes**

```bash
pnpm vitest run
```
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/cli.ts src/commands/ask.ts test/ask-json.test.ts
git commit -m "feat(cli): add ask --json mode with last.meta.json sidecar"
```

---

### Task 3: `apply --files` non-interactive + `--json`

**Files:**
- Modify: `src/cli.ts:73-79` — add `--files` and `--json` options
- Modify: `src/commands/apply.ts` — branch to non-interactive path
- Modify: `src/lib/patch.ts` — export `applyPatchByFiles`
- Test: `test/apply-files.test.ts`

The extension calls `apply --files a,b,c --json` after the user picks files in the sidebar. Non-interactive: no prompts, exit code reflects success/failure, JSON events on stdout.

- [ ] **Step 1: Write the failing test**

Create `test/apply-files.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyPatchByFiles } from '../src/lib/patch.ts';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'rc-apply-files-'));
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: workDir });
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: workDir });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: workDir });
  await writeFile(join(workDir, 'a.txt'), 'one\n', 'utf8');
  await writeFile(join(workDir, 'b.txt'), 'red\n', 'utf8');
  spawnSync('git', ['add', '.'], { cwd: workDir });
  spawnSync('git', ['commit', '-qm', 'init'], { cwd: workDir });
});
afterEach(async () => { await rm(workDir, { recursive: true, force: true }); });

describe('applyPatchByFiles', () => {
  it('applies only selected files from a multi-file patch', async () => {
    const diff = [
      'diff --git a/a.txt b/a.txt',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1 +1 @@',
      '-one',
      '+ONE',
      'diff --git a/b.txt b/b.txt',
      '--- a/b.txt',
      '+++ b/b.txt',
      '@@ -1 +1 @@',
      '-red',
      '+BLUE',
      '',
    ].join('\n');

    const result = await applyPatchByFiles(diff, ['a.txt'], workDir);
    expect(result.applied).toEqual(['a.txt']);
    expect(await readFile(join(workDir, 'a.txt'), 'utf8')).toBe('ONE\n');
    expect(await readFile(join(workDir, 'b.txt'), 'utf8')).toBe('red\n');
  });

  it('returns no-match error when requested file is not in the patch', async () => {
    const diff = 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-one\n+ONE\n';
    await expect(applyPatchByFiles(diff, ['missing.txt'], workDir)).rejects.toThrow(/missing\.txt/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run test/apply-files.test.ts
```
Expected: FAIL — `applyPatchByFiles` not exported.

- [ ] **Step 3: Implement `applyPatchByFiles` in `src/lib/patch.ts`**

Append to `src/lib/patch.ts`:

```typescript
export interface ApplyByFilesResult {
  applied: string[];
}

export async function applyPatchByFiles(diff: string, files: string[], cwd: string): Promise<ApplyByFilesResult> {
  const chunks = splitDiffByFile(diff);
  const requested = new Set(files);
  const matched = chunks.filter((c) => requested.has(c.path));
  const matchedPaths = new Set(matched.map((c) => c.path));
  const missing = files.filter((f) => !matchedPaths.has(f));
  if (missing.length > 0) {
    throw new Error(`Files not present in patch: ${missing.join(', ')}`);
  }
  if (matched.length === 0) return { applied: [] };
  const partial = matched.map((c) => c.text).join('');
  const ok = await gitApplyCheck(partial, cwd);
  if (!ok) throw new Error('Selected files do not apply cleanly (git apply --check failed)');
  await gitApply(partial, cwd);
  return { applied: matched.map((c) => c.path) };
}
```

- [ ] **Step 4: Run unit test**

```bash
pnpm vitest run test/apply-files.test.ts
```
Expected: PASS.

- [ ] **Step 5: Wire into CLI**

Replace the `apply` command in `src/cli.ts:73-79`:

```typescript
program
  .command('apply')
  .description('Apply a previously saved patch (default: .remote-claude/last.patch)')
  .argument('[patch]', 'path to a patch file')
  .option('--files <list>', 'comma-separated subset of files to apply', (v) => v.split(',').map((s) => s.trim()).filter(Boolean))
  .option('--json', 'emit JSONL events on stdout (no prompts)')
  .action(async (patch: string | undefined, opts: { files?: string[]; json?: boolean }) => {
    await runApply(process.cwd(), patch, { files: opts.files, json: opts.json });
  });
```

- [ ] **Step 6: Update `runApply` in `src/commands/apply.ts`**

Replace the file with:

```typescript
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { applyPatchInteractive, applyPatchByFiles } from '../lib/patch.ts';
import { emit, type RcEvent } from '../lib/json-events.ts';
import { log } from '../lib/log.ts';

export interface ApplyOptions {
  files?: string[];
  json?: boolean;
}

export async function runApply(cwd: string, patchPath?: string, opts: ApplyOptions = {}): Promise<void> {
  const target = patchPath ? resolve(cwd, patchPath) : join(cwd, '.remote-claude', 'last.patch');
  if (!existsSync(target)) {
    if (opts.json) emit({ type: 'error', code: 'NO_PATCH', message: `Patch file not found: ${target}` });
    else log.err(`Patch file not found: ${target}`);
    process.exitCode = 1;
    return;
  }
  const diff = await readFile(target, 'utf8');

  if (opts.files && opts.files.length > 0) {
    try {
      const r = await applyPatchByFiles(diff, opts.files, cwd);
      if (opts.json) emit({ type: 'applied', files: r.applied });
      else log.ok(`Applied ${r.applied.length} file(s).`);
      return;
    } catch (err) {
      if (opts.json) emit({ type: 'error', code: 'APPLY_FAILED', message: (err as Error).message });
      else log.err((err as Error).message);
      process.exitCode = 1;
      return;
    }
  }

  if (opts.json) {
    emit({ type: 'error', code: 'NEEDS_FILES', message: '--json apply requires --files' });
    process.exitCode = 1;
    return;
  }

  log.step(`Reviewing patch ${target}`);
  await applyPatchInteractive(diff, cwd);
}
```

- [ ] **Step 7: Run all tests**

```bash
pnpm vitest run
```
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add src/cli.ts src/commands/apply.ts src/lib/patch.ts test/apply-files.test.ts
git commit -m "feat(cli): add apply --files and apply --json"
```

---

### Task 4: `doctor --json` + `setup --non-interactive` flag stability

**Files:**
- Modify: `src/cli.ts` — add `--json` to doctor and verify setup flags are scriptable
- Modify: `src/commands/doctor.ts` — emit events in JSON mode
- Test: `test/doctor-json.test.ts`

`setup` already accepts `--host --user --path --token` etc. We document this combination as "non-interactive" by ensuring it returns successfully without any prompt when all required flags are present. `doctor --json` emits a single event with all checks.

- [ ] **Step 1: Write the failing test**

Create `test/doctor-json.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { runDoctorJson, type DoctorReport } from '../src/commands/doctor.ts';

describe('doctor --json', () => {
  it('returns a structured report with per-check status', async () => {
    const events: any[] = [];
    await runDoctorJson(process.cwd(), { emit: (e) => events.push(e) });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('doctor-report');
    const report = events[0] as DoctorReport;
    expect(Array.isArray(report.checks)).toBe(true);
    expect(report.checks.find((c) => c.name === 'git installed')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run test/doctor-json.test.ts
```
Expected: FAIL — `runDoctorJson` not exported.

- [ ] **Step 3: Refactor `src/commands/doctor.ts` to expose `runDoctorJson`**

Replace the body of the file with:

```typescript
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { loadConfig } from '../lib/config.ts';
import { AgentClient } from '../lib/client.ts';
import { log } from '../lib/log.ts';
import { emit as defaultEmit, type RcEvent } from '../lib/json-events.ts';

interface Check { name: string; pass: boolean; detail?: string; }

export async function runDoctor(cwd: string): Promise<void> {
  const checks = await collectChecks(cwd);
  for (const c of checks) {
    const tag = c.pass ? chalk.green('PASS') : chalk.red('FAIL');
    console.log(`${tag}  ${c.name}${c.detail ? chalk.dim(' — ' + c.detail) : ''}`);
  }
  const failed = checks.filter((c) => !c.pass).length;
  if (failed > 0) { log.err(`${failed} check(s) failed.`); process.exitCode = 1; }
  else log.ok('All checks passed.');
}

export interface DoctorReport {
  type: 'doctor-report';
  checks: Check[];
  ok: boolean;
}

export async function runDoctorJson(cwd: string, deps: { emit?: (e: RcEvent | DoctorReport) => void } = {}): Promise<void> {
  const checks = await collectChecks(cwd);
  const ok = checks.every((c) => c.pass);
  (deps.emit ?? ((e) => defaultEmit(e as any)))({ type: 'doctor-report', checks, ok });
  if (!ok) process.exitCode = 1;
}

async function collectChecks(cwd: string): Promise<Check[]> {
  const checks: Check[] = [];
  checks.push(localBinary('rsync', ['--version']));
  checks.push(localBinary('ssh', ['-V']));
  checks.push(localBinary('git', ['--version']));

  const gitRepo = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, encoding: 'utf8' });
  checks.push({
    name: 'cwd is a git repository',
    pass: gitRepo.status === 0,
    detail: gitRepo.status === 0 ? cwd : 'patches require a local git repo to apply',
  });

  const cfgPath = join(cwd, 'remote-claude.yml');
  const hasCfg = existsSync(cfgPath);
  checks.push({ name: 'remote-claude.yml present', pass: hasCfg, detail: hasCfg ? cfgPath : 'run `remote-claude init`' });
  if (!hasCfg) return checks;

  try {
    const cfg = await loadConfig(cwd);
    checks.push({ name: 'remote-claude.yml valid', pass: true });

    const ssh = spawnSync('ssh', [
      '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5',
      ...(cfg.remote.sshPort ? ['-p', String(cfg.remote.sshPort)] : []),
      `${cfg.remote.user}@${cfg.remote.host}`, 'true',
    ], { encoding: 'utf8' });
    checks.push({
      name: `ssh ${cfg.remote.user}@${cfg.remote.host}`,
      pass: ssh.status === 0,
      detail: ssh.status === 0 ? 'reachable' : (ssh.stderr || 'connection failed').trim(),
    });

    try {
      const h = await new AgentClient(cfg).health();
      checks.push({
        name: `agent ${cfg.remote.agentUrl}/health`,
        pass: h.ok,
        detail: `version=${h.version} claude=${h.claude.found ? h.claude.path : 'NOT FOUND'}`,
      });
    } catch (err) {
      checks.push({ name: 'agent /health', pass: false, detail: (err as Error).message });
    }
  } catch (err) {
    checks.push({ name: 'remote-claude.yml valid', pass: false, detail: (err as Error).message });
  }
  return checks;
}

function localBinary(name: string, args: string[]): Check {
  const r = spawnSync(name, args, { encoding: 'utf8' });
  return {
    name: `${name} installed`,
    pass: r.status === 0 || (r.status !== null && r.stderr.length > 0 && r.error === undefined),
    detail: (r.stdout || r.stderr || '').split('\n')[0]?.trim(),
  };
}
```

- [ ] **Step 4: Wire into CLI**

In `src/cli.ts`, replace the `doctor` command block:

```typescript
program
  .command('doctor')
  .description('Verify local tools, config, ssh reachability, and agent health')
  .option('--json', 'emit a single doctor-report event on stdout')
  .action(async (opts: { json?: boolean }) => {
    if (opts.json) {
      const { runDoctorJson } = await import('./commands/doctor.ts');
      await runDoctorJson(process.cwd());
      return;
    }
    await runDoctor(process.cwd());
  });
```

- [ ] **Step 5: Run tests**

```bash
pnpm vitest run
```
Expected: all PASS.

- [ ] **Step 6: Verify setup --non-interactive works end-to-end**

```bash
pnpm build
node dist/cli.js setup --no-tailscale --host=h.example --user=u --path=/tmp/p --project=p --token=test123 --force --ssh-port=22 --agent-port=7878 < /dev/null
```
Expected: writes `remote-claude.yml` and `~/.remote-claude/env` without prompting. Cleanup: `rm remote-claude.yml`.

- [ ] **Step 7: Commit**

```bash
git add src/cli.ts src/commands/doctor.ts test/doctor-json.test.ts
git commit -m "feat(cli): add doctor --json and confirm setup non-interactive"
```

---

## Phase B — Extension scaffold

### Task 5: Create `extension/` workspace package

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `extension/package.json`, `extension/tsconfig.json`, `extension/.vscodeignore`, `extension/src/extension.ts`

VS Code extension lives in `extension/` as a separate pnpm package. The CLI stays at the repo root unchanged.

- [ ] **Step 1: Create `pnpm-workspace.yaml`**

```bash
test -f pnpm-workspace.yaml && cat pnpm-workspace.yaml || echo "missing"
```

If missing, create `pnpm-workspace.yaml`:

```yaml
packages:
  - '.'
  - 'extension'
```

- [ ] **Step 2: Create `extension/package.json`**

```json
{
  "name": "remote-claude-vscode",
  "displayName": "Remote Claude",
  "description": "Run Claude Code on a remote Mac and review the diff in VS Code.",
  "version": "0.0.1",
  "publisher": "rebink",
  "engines": { "vscode": "^1.80.0" },
  "categories": ["AI", "Other"],
  "main": "./dist/extension.js",
  "activationEvents": ["onStartupFinished"],
  "contributes": {
    "viewsContainers": {
      "activitybar": [{ "id": "remoteClaude", "title": "Remote Claude", "icon": "$(remote)" }]
    },
    "views": {
      "remoteClaude": [
        { "id": "remoteClaude.main", "name": "Remote Claude", "type": "tree" }
      ]
    },
    "commands": [
      { "command": "remoteClaude.ask", "title": "Remote Claude: Ask" },
      { "command": "remoteClaude.cancel", "title": "Remote Claude: Cancel running ask" },
      { "command": "remoteClaude.applySelected", "title": "Remote Claude: Apply selected files" },
      { "command": "remoteClaude.reject", "title": "Remote Claude: Reject pending diff" },
      { "command": "remoteClaude.savePatch", "title": "Remote Claude: Save patch" },
      { "command": "remoteClaude.openSetup", "title": "Remote Claude: Open setup wizard" },
      { "command": "remoteClaude.runDoctor", "title": "Remote Claude: Run doctor" },
      { "command": "remoteClaude.viewOutput", "title": "Remote Claude: View Claude output" },
      { "command": "remoteClaude.openDiff", "title": "Remote Claude: Open diff for file" },
      { "command": "remoteClaude.toggleFileSelection", "title": "Remote Claude: Toggle file in pending sync" }
    ],
    "menus": {
      "view/title": [
        { "command": "remoteClaude.ask",       "when": "view == remoteClaude.main", "group": "navigation" },
        { "command": "remoteClaude.runDoctor", "when": "view == remoteClaude.main", "group": "1_other" }
      ]
    }
  },
  "scripts": {
    "build": "tsup src/extension.ts --external vscode --format cjs --out-dir dist --no-splitting",
    "watch": "pnpm build --watch",
    "test": "vitest run",
    "test:e2e": "tsc -p ./tsconfig.test.json && node out/test/runTest.js",
    "package": "vsce package --no-dependencies"
  },
  "dependencies": {},
  "devDependencies": {
    "@types/node": "^20.14.10",
    "@types/vscode": "^1.80.0",
    "@vscode/test-electron": "^2.4.0",
    "@vscode/vsce": "^2.32.0",
    "tsup": "^8.2.4",
    "typescript": "^5.5.3",
    "vitest": "^2.0.4"
  }
}
```

- [ ] **Step 3: Create `extension/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": ".",
    "types": ["node", "vscode"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 4: Create `extension/.vscodeignore`**

```
.vscode/**
src/**
test/**
out/**
node_modules/**
tsconfig.json
tsconfig.test.json
vitest.config.ts
.gitignore
**/*.map
```

- [ ] **Step 5: Create `extension/src/extension.ts` skeleton**

```typescript
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('remoteClaude.ask', () => {
      vscode.window.showInformationMessage('Remote Claude: Ask (placeholder)');
    }),
  );
}

export function deactivate(): void {}
```

- [ ] **Step 6: Install + build**

```bash
pnpm install
pnpm --filter remote-claude-vscode build
```
Expected: `extension/dist/extension.js` exists.

- [ ] **Step 7: Commit**

```bash
git add pnpm-workspace.yaml extension/
git commit -m "scaffold(ext): create extension/ workspace package"
```

---

## Phase C — Extension core

### Task 6: `CliClient` — spawn + parse JSONL

**Files:**
- Create: `extension/src/CliClient.ts`
- Test: `extension/test/CliClient.test.ts`
- Create: `extension/test/fixtures/fake-cli.sh`
- Create: `extension/vitest.config.ts`

`CliClient` is the only place we touch `child_process`. It spawns `remote-claude`, parses JSONL lines from stdout, emits typed events, and supports cancel via `SIGTERM`.

- [ ] **Step 1: Create `extension/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
```

- [ ] **Step 2: Create the fake CLI fixture**

`extension/test/fixtures/fake-cli.sh`:

```bash
#!/bin/sh
# Replays scripted JSONL events. Used by tests instead of the real `remote-claude`.
set -eu
case "${FAKE_CLI_SCRIPT:-happy}" in
  happy)
    printf '{"type":"syncing"}\n'
    sleep 0.05
    printf '{"type":"synced","durationMs":50}\n'
    printf '{"type":"claude-running","elapsedMs":0}\n'
    sleep 0.05
    printf '{"type":"patch-ready","files":[{"path":"a.txt","status":"M","hunks":1}],"metaPath":"/tmp/m","stdoutPath":"/tmp/o","durationMs":100}\n'
    ;;
  error)
    printf '{"type":"syncing"}\n'
    printf '{"type":"error","code":"AGENT_UNREACHABLE","message":"connect ECONNREFUSED"}\n'
    exit 1
    ;;
  cancel-stall)
    printf '{"type":"syncing"}\n'
    sleep 30
    ;;
  doctor)
    printf '{"type":"doctor-report","ok":true,"checks":[{"name":"git installed","pass":true}]}\n'
    ;;
esac
```

```bash
chmod +x extension/test/fixtures/fake-cli.sh
```

- [ ] **Step 3: Write the failing test**

`extension/test/CliClient.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { CliClient } from '../src/CliClient';

const FAKE = join(__dirname, 'fixtures', 'fake-cli.sh');

function record(client: CliClient): { events: any[]; done: Promise<{ code: number | null }> } {
  const events: any[] = [];
  client.on('event', (e) => events.push(e));
  const done = new Promise<{ code: number | null }>((res) => client.on('exit', (code) => res({ code })));
  return { events, done };
}

describe('CliClient', () => {
  it('streams events from stdout JSONL', async () => {
    const c = new CliClient(FAKE, ['ask', '--json', 'hello'], { env: { FAKE_CLI_SCRIPT: 'happy' } });
    const { events, done } = record(c);
    c.start();
    const { code } = await done;
    expect(code).toBe(0);
    expect(events.map((e) => e.type)).toEqual(['syncing', 'synced', 'claude-running', 'patch-ready']);
  });

  it('emits error event and exits non-zero on script error', async () => {
    const c = new CliClient(FAKE, ['ask', '--json', 'hello'], { env: { FAKE_CLI_SCRIPT: 'error' } });
    const { events, done } = record(c);
    c.start();
    const { code } = await done;
    expect(code).toBe(1);
    expect(events.find((e) => e.type === 'error').code).toBe('AGENT_UNREACHABLE');
  });

  it('cancel() sends SIGTERM and exits', async () => {
    const c = new CliClient(FAKE, ['ask', '--json', 'hello'], { env: { FAKE_CLI_SCRIPT: 'cancel-stall' } });
    const { done } = record(c);
    c.start();
    setTimeout(() => c.cancel(), 100);
    const { code } = await done;
    expect(code === null || code !== 0).toBe(true);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

```bash
pnpm --filter remote-claude-vscode vitest run
```
Expected: FAIL — `CliClient` not implemented.

- [ ] **Step 5: Implement `CliClient`**

`extension/src/CliClient.ts`:

```typescript
import { spawn, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

export interface CliClientOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export class CliClient extends EventEmitter {
  private child: ChildProcess | null = null;
  private buffer = '';

  constructor(private bin: string, private args: string[], private opts: CliClientOptions = {}) {
    super();
  }

  start(): void {
    if (this.child) throw new Error('CliClient already started');
    this.child = spawn(this.bin, this.args, {
      cwd: this.opts.cwd,
      env: { ...process.env, ...this.opts.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child.stdout!.on('data', (b: Buffer) => this.consume(b.toString('utf8')));
    this.child.stderr!.on('data', (b: Buffer) => this.emit('stderr', b.toString('utf8')));
    this.child.on('exit', (code) => {
      if (this.buffer.trim()) this.parseLine(this.buffer.trim());
      this.buffer = '';
      this.emit('exit', code);
    });
    this.child.on('error', (err) => this.emit('error', err));
  }

  cancel(): void {
    if (!this.child) return;
    try { this.child.kill('SIGTERM'); } catch { /* already exited */ }
  }

  private consume(chunk: string): void {
    this.buffer += chunk;
    let idx = this.buffer.indexOf('\n');
    while (idx >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (line) this.parseLine(line);
      idx = this.buffer.indexOf('\n');
    }
  }

  private parseLine(line: string): void {
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed.type === 'string') this.emit('event', parsed);
    } catch { /* ignore non-JSON line */ }
  }
}
```

- [ ] **Step 6: Run tests**

```bash
pnpm --filter remote-claude-vscode vitest run
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add extension/src/CliClient.ts extension/test/ extension/vitest.config.ts
git commit -m "feat(ext): CliClient — spawn + JSONL parser"
```

---

### Task 7: `HistoryStore` — persist past asks

**Files:**
- Create: `extension/src/HistoryStore.ts`
- Test: `extension/test/HistoryStore.test.ts`

Persists completed jobs to `<cwd>/.remote-claude/history/<isoTimestamp>.json`. Loads most recent N (default 20) on startup, sorted desc by `ranAt`.

- [ ] **Step 1: Write the failing test**

`extension/test/HistoryStore.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HistoryStore, type HistoryEntry } from '../src/HistoryStore';

let cwd: string;
beforeEach(async () => { cwd = await mkdtemp(join(tmpdir(), 'rc-hist-')); });
afterEach(async () => { await rm(cwd, { recursive: true, force: true }); });

const entry = (over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id: 'id-1',
  prompt: 'do thing',
  ranAt: new Date().toISOString(),
  status: 'applied',
  files: ['a.txt'],
  durationMs: 100,
  ...over,
});

describe('HistoryStore', () => {
  it('round-trips one entry', async () => {
    const s = new HistoryStore(cwd, 20);
    const e = entry();
    await s.write(e);
    const items = await s.load();
    expect(items).toEqual([e]);
  });

  it('loads most recent first, capped at limit', async () => {
    const s = new HistoryStore(cwd, 2);
    await s.write(entry({ id: '1', ranAt: '2025-01-01T00:00:00Z' }));
    await s.write(entry({ id: '2', ranAt: '2025-01-02T00:00:00Z' }));
    await s.write(entry({ id: '3', ranAt: '2025-01-03T00:00:00Z' }));
    const items = await s.load();
    expect(items.map((i) => i.id)).toEqual(['3', '2']);
  });

  it('skips malformed JSON files instead of throwing', async () => {
    const dir = join(cwd, '.remote-claude', 'history');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'bad.json'), 'not json', 'utf8');
    const s = new HistoryStore(cwd, 20);
    await expect(s.load()).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter remote-claude-vscode vitest run test/HistoryStore.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `HistoryStore`**

`extension/src/HistoryStore.ts`:

```typescript
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface HistoryEntry {
  id: string;
  prompt: string;
  ranAt: string;
  status: 'applied' | 'rejected' | 'failed' | 'saved';
  files: string[];
  durationMs: number;
  error?: string;
}

export class HistoryStore {
  private dir: string;
  constructor(private cwd: string, private limit = 20) {
    this.dir = join(cwd, '.remote-claude', 'history');
  }

  async write(entry: HistoryEntry): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const safeStamp = entry.ranAt.replace(/[:.]/g, '-');
    const file = join(this.dir, `${safeStamp}-${entry.id}.json`);
    await writeFile(file, JSON.stringify(entry, null, 2), 'utf8');
  }

  async load(): Promise<HistoryEntry[]> {
    let names: string[] = [];
    try { names = await readdir(this.dir); } catch { return []; }
    const items: HistoryEntry[] = [];
    for (const n of names) {
      if (!n.endsWith('.json')) continue;
      try {
        const text = await readFile(join(this.dir, n), 'utf8');
        const parsed = JSON.parse(text) as HistoryEntry;
        if (parsed && typeof parsed.id === 'string') items.push(parsed);
      } catch { /* skip malformed */ }
    }
    items.sort((a, b) => b.ranAt.localeCompare(a.ranAt));
    return items.slice(0, this.limit);
  }
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter remote-claude-vscode vitest run
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/src/HistoryStore.ts extension/test/HistoryStore.test.ts
git commit -m "feat(ext): HistoryStore — load/write past asks"
```

---

### Task 8: `JobManager` — state machine

**Files:**
- Create: `extension/src/JobManager.ts`
- Test: `extension/test/JobManager.test.ts`

Owns the one-at-a-time job. State: `idle | running | awaitingSync | applying | applied | rejected | failed`. Wraps `CliClient` and emits `state` change events the UI subscribes to.

- [ ] **Step 1: Write the failing test**

`extension/test/JobManager.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { JobManager, type RcEvent } from '../src/JobManager';

class FakeClient extends EventEmitter {
  start = () => {};
  cancel = () => this.emit('exit', 143);
  feed(e: RcEvent) { this.emit('event', e); }
  finish(code = 0) { this.emit('exit', code); }
}

describe('JobManager', () => {
  it('transitions idle → running → awaitingSync on patch-ready', () => {
    const c = new FakeClient();
    const m = new JobManager(() => c as any, '/cwd');
    const states: string[] = [];
    m.on('state', (s) => states.push(s.kind));
    m.startAsk('do thing');
    expect(m.state.kind).toBe('running');
    c.feed({ type: 'syncing' });
    c.feed({ type: 'synced', durationMs: 50 });
    c.feed({ type: 'claude-running', elapsedMs: 0 });
    c.feed({ type: 'patch-ready', files: [{ path: 'a.txt', status: 'M', hunks: 1 }], metaPath: 'm', stdoutPath: 'o', durationMs: 100 });
    c.finish(0);
    expect(m.state.kind).toBe('awaitingSync');
    if (m.state.kind === 'awaitingSync') {
      expect(m.state.files).toEqual([{ path: 'a.txt', status: 'M', hunks: 1 }]);
    }
    expect(states).toContain('running');
    expect(states).toContain('awaitingSync');
  });

  it('error event during run → failed', () => {
    const c = new FakeClient();
    const m = new JobManager(() => c as any, '/cwd');
    m.startAsk('p');
    c.feed({ type: 'error', code: 'X', message: 'boom' });
    c.finish(1);
    expect(m.state.kind).toBe('failed');
  });

  it('cancel() while running ends in idle', () => {
    const c = new FakeClient();
    const m = new JobManager(() => c as any, '/cwd');
    m.startAsk('p');
    m.cancel();
    expect(m.state.kind).toBe('idle');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter remote-claude-vscode vitest run test/JobManager.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `JobManager`**

`extension/src/JobManager.ts`:

```typescript
import { EventEmitter } from 'node:events';
import { CliClient } from './CliClient';

export type RcEvent =
  | { type: 'syncing' }
  | { type: 'synced'; durationMs: number }
  | { type: 'claude-running'; elapsedMs: number }
  | { type: 'patch-ready'; files: PatchFile[]; metaPath: string; stdoutPath: string; durationMs: number }
  | { type: 'applied'; files: string[] }
  | { type: 'rejected' }
  | { type: 'saved'; patchPath: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'doctor-report'; ok: boolean; checks: Array<{ name: string; pass: boolean; detail?: string }> };

export interface PatchFile { path: string; status: 'A' | 'M' | 'D'; hunks: number; }

export type JobState =
  | { kind: 'idle' }
  | { kind: 'running'; prompt: string; startedAt: number }
  | { kind: 'awaitingSync'; prompt: string; files: PatchFile[]; metaPath: string; stdoutPath: string; finishedAt: number }
  | { kind: 'applying'; prompt: string; files: string[] }
  | { kind: 'applied'; prompt: string; files: string[] }
  | { kind: 'rejected'; prompt: string }
  | { kind: 'failed'; prompt: string; error: string };

export type ClientFactory = (args: string[]) => CliClient;

export class JobManager extends EventEmitter {
  state: JobState = { kind: 'idle' };
  private current: CliClient | null = null;

  constructor(private newClient: ClientFactory, private cwd: string) { super(); }

  private setState(next: JobState) {
    this.state = next;
    this.emit('state', next);
  }

  startAsk(prompt: string): void {
    if (this.state.kind === 'running' || this.state.kind === 'applying') {
      throw new Error('Another job is in progress');
    }
    this.setState({ kind: 'running', prompt, startedAt: Date.now() });
    const client = this.newClient(['ask', '--json', prompt]);
    this.current = client;

    let lastError: string | null = null;
    let ready: Extract<RcEvent, { type: 'patch-ready' }> | null = null;

    client.on('event', (e: RcEvent) => {
      if (e.type === 'error') lastError = `${e.code}: ${e.message}`;
      if (e.type === 'patch-ready') ready = e;
    });
    client.on('exit', (code: number | null) => {
      this.current = null;
      if (lastError) {
        this.setState({ kind: 'failed', prompt, error: lastError });
        return;
      }
      if (this.state.kind !== 'running') return;
      if (code === 0 && ready && ready.files.length > 0) {
        this.setState({
          kind: 'awaitingSync',
          prompt,
          files: ready.files,
          metaPath: ready.metaPath,
          stdoutPath: ready.stdoutPath,
          finishedAt: Date.now(),
        });
      } else if (code === 0) {
        this.setState({ kind: 'rejected', prompt });
      } else {
        this.setState({ kind: 'failed', prompt, error: `CLI exited with code ${code}` });
      }
    });
    client.start();
  }

  applySelected(files: string[]): void {
    if (this.state.kind !== 'awaitingSync') throw new Error('No diff awaiting sync');
    const prompt = this.state.prompt;
    this.setState({ kind: 'applying', prompt, files });

    const client = this.newClient(['apply', '--files', files.join(','), '--json']);
    this.current = client;
    let appliedFiles: string[] = files;
    let err: string | null = null;
    client.on('event', (e: RcEvent) => {
      if (e.type === 'applied') appliedFiles = e.files;
      if (e.type === 'error') err = `${e.code}: ${e.message}`;
    });
    client.on('exit', (code: number | null) => {
      this.current = null;
      if (code === 0 && !err) this.setState({ kind: 'applied', prompt, files: appliedFiles });
      else this.setState({ kind: 'failed', prompt, error: err ?? `apply exited ${code}` });
    });
    client.start();
  }

  reject(): void {
    if (this.state.kind !== 'awaitingSync') return;
    this.setState({ kind: 'rejected', prompt: this.state.prompt });
  }

  cancel(): void {
    if (this.current) this.current.cancel();
    this.current = null;
    this.setState({ kind: 'idle' });
  }

  reset(): void {
    if (this.state.kind !== 'idle') this.setState({ kind: 'idle' });
  }

  restoreAwaitingSync(s: { prompt: string; files: PatchFile[]; metaPath: string; stdoutPath: string; finishedAt: number }) {
    this.setState({ kind: 'awaitingSync', ...s });
  }
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter remote-claude-vscode vitest run
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/src/JobManager.ts extension/test/JobManager.test.ts
git commit -m "feat(ext): JobManager — one-at-a-time job state machine"
```

---

### Task 9: `DiffContentProvider` + `FileDecorationProvider`

**Files:**
- Create: `extension/src/DiffContentProvider.ts`
- Create: `extension/src/FileDecorationProvider.ts`
- Test: `extension/test/DiffContentProvider.test.ts`

Native diff editor uses scheme `remote-claude-before` (HEAD content) and `remote-claude-after` (HEAD + per-file chunk applied via `git apply` in a tempdir).

- [ ] **Step 1: Write the failing test**

`extension/test/DiffContentProvider.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gitShowAtHead, applyChunkToBuffer } from '../src/DiffContentProvider';

let workDir: string;
beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'rc-diff-'));
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: workDir });
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: workDir });
  spawnSync('git', ['config', 'user.name', 't'], { cwd: workDir });
  await writeFile(join(workDir, 'a.txt'), 'one\n', 'utf8');
  spawnSync('git', ['add', '.'], { cwd: workDir });
  spawnSync('git', ['commit', '-qm', 'init'], { cwd: workDir });
});
afterEach(async () => { await rm(workDir, { recursive: true, force: true }); });

describe('DiffContentProvider helpers', () => {
  it('gitShowAtHead returns committed content', async () => {
    const c = await gitShowAtHead('a.txt', workDir);
    expect(c).toBe('one\n');
  });

  it('gitShowAtHead returns empty string for added files', async () => {
    const c = await gitShowAtHead('new.txt', workDir);
    expect(c).toBe('');
  });

  it('applyChunkToBuffer produces patched content', async () => {
    const chunk = 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-one\n+ONE\n';
    const after = await applyChunkToBuffer('one\n', chunk);
    expect(after).toBe('ONE\n');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter remote-claude-vscode vitest run test/DiffContentProvider.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `DiffContentProvider`**

`extension/src/DiffContentProvider.ts`:

```typescript
import * as vscode from 'vscode';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export const SCHEME_BEFORE = 'remote-claude-before';
export const SCHEME_AFTER = 'remote-claude-after';

export interface DiffSource {
  chunks: Map<string, string>; // path -> per-file chunk text
  cwd: string;
}

export class DiffContentProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  onDidChange = this._onDidChange.event;
  private source: DiffSource | null = null;

  setSource(source: DiffSource | null) {
    this.source = source;
    if (source) for (const path of source.chunks.keys()) {
      this._onDidChange.fire(vscode.Uri.parse(`${SCHEME_BEFORE}:${path}`));
      this._onDidChange.fire(vscode.Uri.parse(`${SCHEME_AFTER}:${path}`));
    }
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    if (!this.source) return '';
    const path = uri.path.replace(/^\//, '');
    const before = await gitShowAtHead(path, this.source.cwd);
    if (uri.scheme === SCHEME_BEFORE) return before;
    if (uri.scheme === SCHEME_AFTER) {
      const chunk = this.source.chunks.get(path);
      if (!chunk) return before;
      return applyChunkToBuffer(before, chunk);
    }
    return '';
  }
}

export function gitShowAtHead(path: string, cwd: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn('git', ['show', `HEAD:${path}`], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (b) => (out += b.toString('utf8')));
    child.on('close', (code) => resolve(code === 0 ? out : ''));
    child.on('error', () => resolve(''));
  });
}

/** Apply a single-file diff chunk to a buffer using git in a tempdir. */
export async function applyChunkToBuffer(before: string, chunk: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'rc-diff-'));
  try {
    const m = chunk.match(/^diff --git a\/(.+?) b\/(.+)$/m);
    const path = m ? (m[2] ?? m[1] ?? 'file') : 'file';
    const target = join(dir, path);
    if (dirname(target) !== dir) await mkdir(dirname(target), { recursive: true });
    await writeFile(target, before, 'utf8');
    await runGit(dir, ['init', '-q']);
    await runGit(dir, ['config', 'user.email', 't@t']);
    await runGit(dir, ['config', 'user.name', 't']);
    await runGit(dir, ['add', '.']);
    await runGit(dir, ['commit', '-qm', 'base']);
    await applyDiff(dir, chunk);
    return await readFile(target, 'utf8');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runGit(cwd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = spawn('git', args, { cwd, stdio: 'ignore' });
    c.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`git ${args[0]} exited ${code}`)));
  });
}

function applyDiff(cwd: string, diff: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = spawn('git', ['apply'], { cwd, stdio: ['pipe', 'ignore', 'pipe'] });
    c.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`git apply exited ${code}`)));
    c.stdin.end(diff);
  });
}
```

- [ ] **Step 4: Implement `FileDecorationProvider`**

`extension/src/FileDecorationProvider.ts`:

```typescript
import * as vscode from 'vscode';

export type DecorStatus = 'A' | 'M' | 'D';

export class RcFileDecorationProvider implements vscode.FileDecorationProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri[]>();
  onDidChangeFileDecorations = this._onDidChange.event;
  private byPath = new Map<string, DecorStatus>();

  setDecorations(map: Map<string, DecorStatus>): void {
    this.byPath = map;
    this._onDidChange.fire(Array.from(map.keys()).map((p) => vscode.Uri.parse(`remote-claude-tree:${p}`)));
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== 'remote-claude-tree') return undefined;
    const path = uri.path.replace(/^\//, '');
    const status = this.byPath.get(path);
    if (!status) return undefined;
    const colors: Record<DecorStatus, string> = {
      A: 'gitDecoration.addedResourceForeground',
      M: 'gitDecoration.modifiedResourceForeground',
      D: 'gitDecoration.deletedResourceForeground',
    };
    return { badge: status, color: new vscode.ThemeColor(colors[status]) };
  }
}
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter remote-claude-vscode vitest run
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add extension/src/DiffContentProvider.ts extension/src/FileDecorationProvider.ts extension/test/DiffContentProvider.test.ts
git commit -m "feat(ext): DiffContentProvider + FileDecorationProvider"
```

---

## Phase D — Extension UI

### Task 10: `AskTreeProvider` — sidebar tree

**Files:**
- Create: `extension/src/AskTreeProvider.ts`
- Test: `extension/test/AskTreeProvider.test.ts`

Renders sections: Current (running or awaitingSync) → file tree with checkboxes → History.

- [ ] **Step 1: Write the failing test**

`extension/test/AskTreeProvider.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { AskTreeProvider } from '../src/AskTreeProvider';

const fakeManager = (state: any) => ({ on: () => {}, state });
const fakeHistory = { load: async () => [] };

describe('AskTreeProvider', () => {
  it('idle state shows only the History section', async () => {
    const p = new AskTreeProvider(fakeManager({ kind: 'idle' }) as any, fakeHistory as any, '/cwd');
    const top = await p.getChildren();
    expect(top.map((t: any) => t.label)).toEqual(['History']);
  });

  it('awaitingSync shows file rows with checkbox state', async () => {
    const p = new AskTreeProvider(
      fakeManager({
        kind: 'awaitingSync',
        prompt: 'p',
        files: [{ path: 'a.txt', status: 'M', hunks: 1 }, { path: 'b.txt', status: 'A', hunks: 1 }],
      }) as any,
      fakeHistory as any,
      '/cwd',
    );
    const top = await p.getChildren();
    const pending = top.find((t: any) => (t.label as string).startsWith('Pending Sync'));
    expect(pending).toBeTruthy();
    const files = await p.getChildren(pending as any);
    expect(files.map((f: any) => f.path)).toEqual(['a.txt', 'b.txt']);
    for (const f of files) expect(f.checked).toBe(true);
  });

  it('toggleFile flips selection', async () => {
    const p = new AskTreeProvider(
      fakeManager({
        kind: 'awaitingSync', prompt: 'p',
        files: [{ path: 'a.txt', status: 'M', hunks: 1 }],
      }) as any, fakeHistory as any, '/cwd');
    const top = await p.getChildren();
    await p.getChildren(top.find((t: any) => (t.label as string).startsWith('Pending Sync')) as any);
    expect(await p.selectedFiles()).toEqual(['a.txt']);
    p.toggleFile('a.txt');
    expect(await p.selectedFiles()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter remote-claude-vscode vitest run test/AskTreeProvider.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Implement `AskTreeProvider`**

`extension/src/AskTreeProvider.ts`:

```typescript
import * as vscode from 'vscode';
import type { JobManager, PatchFile } from './JobManager';
import type { HistoryStore, HistoryEntry } from './HistoryStore';

export interface RcTreeItem extends vscode.TreeItem {
  rcKind: 'section' | 'currentRunning' | 'currentAwaiting' | 'fileRow' | 'historyRow';
  path?: string;
  checked?: boolean;
}

export class AskTreeProvider implements vscode.TreeDataProvider<RcTreeItem> {
  private _onDidChange = new vscode.EventEmitter<RcTreeItem | undefined>();
  onDidChangeTreeData = this._onDidChange.event;

  private selection = new Set<string>();

  constructor(
    private manager: JobManager,
    private history: HistoryStore,
    private cwd: string,
  ) {
    manager.on('state', () => { this.refreshSelection(); this._onDidChange.fire(undefined); });
    this.refreshSelection();
  }

  refresh(): void { this._onDidChange.fire(undefined); }

  private refreshSelection(): void {
    const s = this.manager.state;
    if (s.kind === 'awaitingSync') {
      this.selection = new Set(s.files.map((f) => f.path));
    } else this.selection.clear();
  }

  toggleFile(path: string): void {
    if (this.selection.has(path)) this.selection.delete(path); else this.selection.add(path);
    this._onDidChange.fire(undefined);
  }

  async selectedFiles(): Promise<string[]> {
    const s = this.manager.state;
    if (s.kind !== 'awaitingSync') return [];
    return s.files.map((f) => f.path).filter((p) => this.selection.has(p));
  }

  getTreeItem(element: RcTreeItem): vscode.TreeItem { return element; }

  async getChildren(element?: RcTreeItem): Promise<RcTreeItem[]> {
    if (!element) return this.topLevel();
    if (element.rcKind === 'section') {
      if ((element.label as string).startsWith('Pending Sync')) return this.fileRows();
      if (element.label === 'History') return this.historyRows();
      if (element.label === 'Current') return this.currentRows();
    }
    return [];
  }

  private async topLevel(): Promise<RcTreeItem[]> {
    const sections: RcTreeItem[] = [];
    const s = this.manager.state;
    if (s.kind === 'running' || s.kind === 'applying' || s.kind === 'failed') {
      sections.push(this.section('Current', vscode.TreeItemCollapsibleState.Expanded));
    } else if (s.kind === 'awaitingSync') {
      sections.push(this.section(`Pending Sync (${s.files.length})`, vscode.TreeItemCollapsibleState.Expanded));
    }
    sections.push(this.section('History', vscode.TreeItemCollapsibleState.Collapsed));
    return sections;
  }

  private section(label: string, state: vscode.TreeItemCollapsibleState): RcTreeItem {
    return { label, collapsibleState: state, rcKind: 'section' };
  }

  private currentRows(): RcTreeItem[] {
    const s = this.manager.state;
    if (s.kind === 'running') return [{ label: `Running: "${s.prompt}"`, rcKind: 'currentRunning' }];
    if (s.kind === 'applying') return [{ label: `Applying ${s.files.length} file(s)…`, rcKind: 'currentRunning' }];
    if (s.kind === 'failed') return [{ label: `Failed: ${s.error}`, rcKind: 'currentRunning' }];
    return [];
  }

  private fileRows(): RcTreeItem[] {
    const s = this.manager.state;
    if (s.kind !== 'awaitingSync') return [];
    return s.files.map<RcTreeItem>((f: PatchFile) => ({
      label: `${this.selection.has(f.path) ? '☑' : '☐'} ${f.path}`,
      description: `${f.status} · ${f.hunks} hunk${f.hunks === 1 ? '' : 's'}`,
      rcKind: 'fileRow',
      path: f.path,
      checked: this.selection.has(f.path),
      resourceUri: vscode.Uri.parse(`remote-claude-tree:${f.path}`),
      command: { command: 'remoteClaude.openDiff', title: 'Open diff', arguments: [f.path] },
    }));
  }

  private async historyRows(): Promise<RcTreeItem[]> {
    const items = await this.history.load();
    return items.map<RcTreeItem>((h: HistoryEntry) => ({
      label: `${icon(h.status)} ${truncate(h.prompt, 48)}`,
      description: ago(h.ranAt),
      rcKind: 'historyRow',
      tooltip: `${h.status} · ${h.files.length} files · ${h.durationMs}ms`,
    }));
  }
}

function truncate(s: string, n: number): string { return s.length <= n ? s : s.slice(0, n - 1) + '…'; }
function icon(status: HistoryEntry['status']): string {
  return status === 'applied' ? '✓' : status === 'rejected' ? '⊘' : status === 'failed' ? '✗' : '◇';
}
function ago(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const m = Math.round(diff / 60000); if (m < 60) return `${m}m`;
  const h = Math.round(m / 60); if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter remote-claude-vscode vitest run
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/src/AskTreeProvider.ts extension/test/AskTreeProvider.test.ts
git commit -m "feat(ext): AskTreeProvider — sidebar tree"
```

---

### Task 11: `StatusBarController`

**Files:**
- Create: `extension/src/StatusBarController.ts`

- [ ] **Step 1: Implement `StatusBarController`**

`extension/src/StatusBarController.ts`:

```typescript
import * as vscode from 'vscode';
import type { JobManager } from './JobManager';

export class StatusBarController {
  private item: vscode.StatusBarItem;
  private timer: NodeJS.Timeout | null = null;

  constructor(private manager: JobManager) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'workbench.view.extension.remoteClaude';
    manager.on('state', () => this.render());
    this.render();
    this.item.show();
  }

  dispose(): void { this.item.dispose(); if (this.timer) clearInterval(this.timer); }

  private render(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    const s = this.manager.state;
    switch (s.kind) {
      case 'idle':
        this.item.text = '$(remote) Claude: idle';
        this.item.tooltip = 'Click to open Remote Claude';
        break;
      case 'running': {
        const startedAt = s.startedAt;
        const tick = () => {
          const elapsed = Math.floor((Date.now() - startedAt) / 1000);
          this.item.text = `$(sync~spin) Claude: running ${fmt(elapsed)}`;
        };
        tick();
        this.timer = setInterval(tick, 1000);
        this.item.tooltip = 'Click to view progress';
        break;
      }
      case 'awaitingSync':
        this.item.text = `$(check) Claude: ${s.files.length} files pending`;
        this.item.tooltip = 'Click to review diff';
        break;
      case 'applying':
        this.item.text = '$(sync~spin) Claude: applying…';
        break;
      case 'applied':
        this.item.text = '$(check) Claude: applied';
        break;
      case 'rejected':
        this.item.text = '$(remote) Claude: idle';
        break;
      case 'failed':
        this.item.text = `$(error) Claude: ${truncate(s.error, 30)}`;
        break;
    }
  }
}

function fmt(secs: number): string {
  const m = Math.floor(secs / 60).toString();
  const s = (secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
function truncate(s: string, n: number): string { return s.length <= n ? s : s.slice(0, n - 1) + '…'; }
```

- [ ] **Step 2: Build to verify it compiles**

```bash
pnpm --filter remote-claude-vscode build
```
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add extension/src/StatusBarController.ts
git commit -m "feat(ext): StatusBarController"
```

---

### Task 12: Commands + activation logic

**Files:**
- Create: `extension/src/findCli.ts`
- Create: `extension/src/splitDiff.ts`
- Replace: `extension/src/extension.ts`

`activate()` resolves the CLI path, instantiates managers and providers, registers commands, and shows a friendly message if no `remote-claude.yml` is present.

- [ ] **Step 1: Implement `findCli.ts`**

`extension/src/findCli.ts`:

```typescript
import { spawnSync } from 'node:child_process';

export function findCli(): string | null {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(cmd, ['remote-claude'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  return r.stdout.split(/\r?\n/).find(Boolean)?.trim() ?? null;
}
```

- [ ] **Step 2: Implement `splitDiff.ts`**

`extension/src/splitDiff.ts`:

```typescript
export interface FileChunk { path: string; text: string; }
export function splitDiffByFile(diff: string): FileChunk[] {
  if (!diff.trim()) return [];
  const lines = diff.split('\n');
  const chunks: FileChunk[] = [];
  let start = -1;
  const flush = (end: number) => {
    if (start < 0) return;
    const text = lines.slice(start, end).join('\n').replace(/\n*$/, '\n');
    const m = text.match(/^diff --git a\/(.+?) b\/(.+)$/m);
    const path = m ? (m[2] ?? m[1] ?? '') : '';
    chunks.push({ path, text });
  };
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.startsWith('diff --git ')) { flush(i); start = i; }
  }
  flush(lines.length);
  return chunks;
}
```

- [ ] **Step 3: Replace `extension/src/extension.ts`**

```typescript
import * as vscode from 'vscode';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CliClient } from './CliClient';
import { JobManager } from './JobManager';
import { HistoryStore } from './HistoryStore';
import { AskTreeProvider } from './AskTreeProvider';
import { StatusBarController } from './StatusBarController';
import { DiffContentProvider, SCHEME_BEFORE, SCHEME_AFTER } from './DiffContentProvider';
import { RcFileDecorationProvider, type DecorStatus } from './FileDecorationProvider';
import { findCli } from './findCli';
import { splitDiffByFile } from './splitDiff';

export function activate(context: vscode.ExtensionContext): void {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return;
  const cwd = folder.uri.fsPath;

  const cliPath = findCli();
  if (!cliPath) {
    vscode.window.showErrorMessage(
      'remote-claude CLI not found on PATH. Install with: npm i -g remote-claude',
      'Open docs',
    ).then((p) => p && vscode.env.openExternal(vscode.Uri.parse('https://remote-claude.vercel.app/install')));
    return;
  }

  const newClient = (args: string[]) => new CliClient(cliPath, args, { cwd });
  const manager = new JobManager(newClient as any, cwd);
  const history = new HistoryStore(cwd, 20);
  const tree = new AskTreeProvider(manager, history, cwd);
  const statusBar = new StatusBarController(manager);
  const diffProvider = new DiffContentProvider();
  const decorProvider = new RcFileDecorationProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('remoteClaude.main', tree),
    vscode.window.registerFileDecorationProvider(decorProvider),
    vscode.workspace.registerTextDocumentContentProvider(SCHEME_BEFORE, diffProvider),
    vscode.workspace.registerTextDocumentContentProvider(SCHEME_AFTER, diffProvider),
    statusBar,
  );

  manager.on('state', async () => {
    const s = manager.state;
    if (s.kind === 'awaitingSync') {
      const patch = readFileSync(join(cwd, '.remote-claude', 'last.patch'), 'utf8');
      const chunks = new Map<string, string>();
      for (const c of splitDiffByFile(patch)) chunks.set(c.path, c.text);
      diffProvider.setSource({ chunks, cwd });
      const decorMap = new Map<string, DecorStatus>(s.files.map((f) => [f.path, f.status] as const));
      decorProvider.setDecorations(decorMap);
    } else {
      diffProvider.setSource(null);
      decorProvider.setDecorations(new Map());
    }
    if (s.kind === 'applied' || s.kind === 'rejected' || s.kind === 'failed') {
      await history.write({
        id: `${Date.now()}`,
        prompt: (s as any).prompt ?? '',
        ranAt: new Date().toISOString(),
        status: s.kind === 'applied' ? 'applied' : s.kind === 'rejected' ? 'rejected' : 'failed',
        files: s.kind === 'applied' ? s.files : [],
        durationMs: 0,
        error: s.kind === 'failed' ? s.error : undefined,
      });
      tree.refresh();
    }
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('remoteClaude.ask', async () => {
      if (!hasConfig(cwd)) { vscode.commands.executeCommand('remoteClaude.openSetup'); return; }
      const prompt = await vscode.window.showInputBox({
        prompt: 'Ask Claude…',
        placeHolder: 'refactor login_bloc to use freezed',
      });
      if (prompt && prompt.trim()) manager.startAsk(prompt.trim());
    }),
    vscode.commands.registerCommand('remoteClaude.cancel', () => manager.cancel()),
    vscode.commands.registerCommand('remoteClaude.applySelected', async () => {
      const files = await tree.selectedFiles();
      if (files.length === 0) { vscode.window.showWarningMessage('No files selected.'); return; }
      manager.applySelected(files);
    }),
    vscode.commands.registerCommand('remoteClaude.reject', () => manager.reject()),
    vscode.commands.registerCommand('remoteClaude.savePatch', () => {
      vscode.window.showInformationMessage('Patch is saved at .remote-claude/last.patch');
    }),
    vscode.commands.registerCommand('remoteClaude.openSetup', () => {
      // Real wizard arrives in Task 13; until then, drop into a terminal.
      const t = vscode.window.createTerminal('remote-claude setup');
      t.show(); t.sendText('remote-claude setup');
    }),
    vscode.commands.registerCommand('remoteClaude.runDoctor', () => {
      const t = vscode.window.createTerminal('remote-claude doctor');
      t.show(); t.sendText('remote-claude doctor');
    }),
    vscode.commands.registerCommand('remoteClaude.viewOutput', async () => {
      const s = manager.state;
      if (s.kind !== 'awaitingSync') return;
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(s.stdoutPath));
      vscode.window.showTextDocument(doc);
    }),
    vscode.commands.registerCommand('remoteClaude.openDiff', async (path: string) => {
      const before = vscode.Uri.parse(`${SCHEME_BEFORE}:${path}`);
      const after = vscode.Uri.parse(`${SCHEME_AFTER}:${path}`);
      vscode.commands.executeCommand('vscode.diff', before, after, `Remote Claude: ${path}`);
    }),
    vscode.commands.registerCommand('remoteClaude.toggleFileSelection', (path: string) => tree.toggleFile(path)),
  );
}

function hasConfig(cwd: string): boolean {
  return existsSync(join(cwd, 'remote-claude.yml'));
}

export function deactivate(): void {}
```

- [ ] **Step 4: Build**

```bash
pnpm --filter remote-claude-vscode build
```
Expected: build succeeds.

- [ ] **Step 5: Manual sanity check**

```bash
code --extensionDevelopmentPath=$(pwd)/extension
```
Open a workspace with `remote-claude.yml`. Click the Remote Claude activity bar icon. Run command "Remote Claude: Ask" and type a prompt. Confirm the status bar updates.

- [ ] **Step 6: Commit**

```bash
git add extension/src/extension.ts extension/src/findCli.ts extension/src/splitDiff.ts
git commit -m "feat(ext): wire commands, activation, and tree/status providers"
```

---

### Task 13: SetupWizard webview

**Files:**
- Create: `extension/src/SetupWizard.ts`
- Create: `extension/src/setup.html`
- Modify: `extension/src/extension.ts:remoteClaude.openSetup` — replace terminal fallback with webview

The wizard uses safe DOM manipulation only (no `innerHTML`). Status messages and doctor checks are passed as structured JSON between extension host and webview.

- [ ] **Step 1: Create `extension/src/setup.html`**

```html
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Remote Claude — Setup</title>
<style>
  body { font: 13px/1.5 system-ui, sans-serif; padding: 16px; color: var(--vscode-foreground); background: var(--vscode-editor-background); }
  label { display: block; margin: 12px 0 4px; }
  input { width: 100%; padding: 6px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
  .row { display: flex; gap: 8px; margin-top: 16px; }
  button { padding: 6px 14px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 0; cursor: pointer; }
  .warn { background: rgba(226,192,141,.15); border-left: 3px solid #e2c08d; padding: 8px; margin-top: 12px; }
  .status { margin-top: 16px; font-family: ui-monospace, monospace; }
  .check { padding: 2px 0; }
  .pass { color: #73c991; } .fail { color: #f48771; }
</style></head>
<body>
  <h2>Remote Claude — Setup</h2>
  <label>Remote host (Tailscale Magic-DNS, LAN IP, or hostname)</label><input id="host" />
  <label>SSH user</label><input id="user" />
  <label>Remote project path</label><input id="path" />
  <label>Project name (folder name on remote)</label><input id="project" />
  <label>Agent token</label><input id="token" type="password" />
  <div class="warn">SSH public-key authentication is required. Run <code>ssh-copy-id user@host</code> if you haven't already.</div>
  <div class="row">
    <button id="test">Test connection</button>
    <button id="save">Save & finish</button>
  </div>
  <div class="status" id="status"></div>
  <script>
    const vscode = acquireVsCodeApi();
    const $ = (id) => document.getElementById(id);
    function values() {
      return { host: $('host').value, user: $('user').value, path: $('path').value, project: $('project').value, token: $('token').value };
    }
    $('test').onclick = () => vscode.postMessage({ type: 'test', values: values() });
    $('save').onclick = () => vscode.postMessage({ type: 'save', values: values() });

    function setText(text) {
      const root = $('status');
      root.textContent = '';
      const div = document.createElement('div');
      div.textContent = text;
      root.appendChild(div);
    }
    function setChecks(checks) {
      const root = $('status');
      root.textContent = '';
      for (const c of checks) {
        const row = document.createElement('div');
        row.className = 'check';
        const tag = document.createElement('span');
        tag.className = c.pass ? 'pass' : 'fail';
        tag.textContent = c.pass ? 'PASS  ' : 'FAIL  ';
        row.appendChild(tag);
        row.appendChild(document.createTextNode(c.name));
        if (c.detail) row.appendChild(document.createTextNode(' — ' + c.detail));
        root.appendChild(row);
      }
    }
    window.addEventListener('message', (e) => {
      const m = e.data;
      if (m.type === 'status') setText(m.text);
      if (m.type === 'doctor') setChecks(m.checks);
      if (m.type === 'prefill') {
        for (const [k, v] of Object.entries(m.values)) if ($(k)) $(k).value = v;
      }
    });
  </script>
</body></html>
```

- [ ] **Step 2: Implement `SetupWizard.ts`**

`extension/src/SetupWizard.ts`:

```typescript
import * as vscode from 'vscode';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CliClient } from './CliClient';

export function openSetupWizard(context: vscode.ExtensionContext, cliPath: string, cwd: string): void {
  const panel = vscode.window.createWebviewPanel('remoteClaudeSetup', 'Remote Claude — Setup', vscode.ViewColumn.One, { enableScripts: true });
  panel.webview.html = readFileSync(join(context.extensionPath, 'src', 'setup.html'), 'utf8');

  panel.webview.onDidReceiveMessage(async (msg: { type: 'test' | 'save'; values: Record<string, string> }) => {
    const v = msg.values;
    const args = ['setup', '--no-tailscale',
      '--host', v.host, '--user', v.user, '--path', v.path,
      '--project', v.project, '--token', v.token, '--force',
    ];

    panel.webview.postMessage({ type: 'status', text: 'Writing config…' });
    await runSilent(cliPath, args, cwd);

    if (msg.type === 'test') {
      panel.webview.postMessage({ type: 'status', text: 'Running doctor…' });
      const report = await runDoctor(cliPath, cwd);
      if (report) panel.webview.postMessage({ type: 'doctor', checks: report.checks });
      else panel.webview.postMessage({ type: 'status', text: 'Doctor failed to produce output.' });
    } else {
      panel.webview.postMessage({ type: 'status', text: 'Saved. You can now ask Claude from the sidebar.' });
      vscode.window.showInformationMessage('Remote Claude: setup saved.');
      panel.dispose();
    }
  });
}

function runSilent(bin: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve) => {
    const c = new CliClient(bin, args, { cwd });
    c.on('exit', () => resolve());
    c.start();
  });
}

interface DoctorReport { checks: Array<{ name: string; pass: boolean; detail?: string }>; ok: boolean; }

function runDoctor(bin: string, cwd: string): Promise<DoctorReport | null> {
  return new Promise((resolve) => {
    const c = new CliClient(bin, ['doctor', '--json'], { cwd });
    let out: DoctorReport | null = null;
    c.on('event', (e: any) => { if (e.type === 'doctor-report') out = e; });
    c.on('exit', () => resolve(out));
    c.start();
  });
}
```

- [ ] **Step 3: Wire `openSetupWizard` into `extension.ts`**

In `extension/src/extension.ts`, add the import:

```typescript
import { openSetupWizard } from './SetupWizard';
```

Replace the `remoteClaude.openSetup` registration body:

```typescript
vscode.commands.registerCommand('remoteClaude.openSetup', () => {
  openSetupWizard(context, cliPath, cwd);
}),
```

- [ ] **Step 4: Build**

```bash
pnpm --filter remote-claude-vscode build
```
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add extension/src/SetupWizard.ts extension/src/setup.html extension/src/extension.ts
git commit -m "feat(ext): SetupWizard webview"
```

---

## Phase E — Polish & ship

### Task 14: Reload restoration

**Files:**
- Modify: `extension/src/extension.ts` — read `last.meta.json` on activate
- Modify: `src/lib/patch.ts` — write `last.applied` marker after successful apply
- Modify: `test/apply-files.test.ts` — assert marker

After `apply` succeeds, the CLI writes a `.remote-claude/last.applied` file. On activate, the extension restores `awaitingSync` if `last.meta.json` exists and `last.applied` does not.

- [ ] **Step 1: Update `applyPatchByFiles` to write the marker**

In `src/lib/patch.ts`, replace `applyPatchByFiles`:

```typescript
export async function applyPatchByFiles(diff: string, files: string[], cwd: string): Promise<ApplyByFilesResult> {
  const chunks = splitDiffByFile(diff);
  const requested = new Set(files);
  const matched = chunks.filter((c) => requested.has(c.path));
  const matchedPaths = new Set(matched.map((c) => c.path));
  const missing = files.filter((f) => !matchedPaths.has(f));
  if (missing.length > 0) throw new Error(`Files not present in patch: ${missing.join(', ')}`);
  if (matched.length === 0) return { applied: [] };
  const partial = matched.map((c) => c.text).join('');
  const ok = await gitApplyCheck(partial, cwd);
  if (!ok) throw new Error('Selected files do not apply cleanly (git apply --check failed)');
  await gitApply(partial, cwd);
  const applied = matched.map((c) => c.path);
  await mkdir(join(cwd, '.remote-claude'), { recursive: true });
  await writeFile(
    join(cwd, '.remote-claude', 'last.applied'),
    JSON.stringify({ files: applied, at: new Date().toISOString() }, null, 2),
    'utf8',
  );
  return { applied };
}
```

If the `mkdir`/`writeFile`/`join` imports aren't already at the top, add them: `import { writeFile, mkdir } from 'node:fs/promises'; import { join } from 'node:path';` (the file already imports `mkdir` for `savePatch`, so just confirm).

- [ ] **Step 2: Add a CLI test for the marker**

In `test/apply-files.test.ts`, append:

```typescript
it('writes .remote-claude/last.applied marker after success', async () => {
  const diff = 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-one\n+ONE\n';
  await applyPatchByFiles(diff, ['a.txt'], workDir);
  const marker = JSON.parse(await readFile(join(workDir, '.remote-claude', 'last.applied'), 'utf8'));
  expect(marker.files).toEqual(['a.txt']);
});
```

- [ ] **Step 3: Add restoration in extension activate**

In `extension/src/extension.ts`, just after the `manager` is constructed, add:

```typescript
const metaFile = join(cwd, '.remote-claude', 'last.meta.json');
const appliedMarker = join(cwd, '.remote-claude', 'last.applied');
if (existsSync(metaFile) && !existsSync(appliedMarker)) {
  try {
    const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
    manager.restoreAwaitingSync({
      prompt: meta.prompt,
      files: meta.files,
      metaPath: metaFile,
      stdoutPath: meta.stdoutPath,
      finishedAt: Date.parse(meta.ranAt),
    });
  } catch { /* ignore corrupt meta */ }
}
```

Also, when the state becomes `applied`, clean up. Inside the existing `manager.on('state', async ...)` handler, at the end of the `applied/rejected/failed` block:

```typescript
if (s.kind === 'applied') {
  try { (await import('node:fs/promises')).unlink(metaFile).catch(() => {}); } catch {}
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm vitest run
pnpm --filter remote-claude-vscode build
```
Expected: PASS + clean build.

- [ ] **Step 5: Commit**

```bash
git add src/lib/patch.ts test/apply-files.test.ts extension/src/extension.ts
git commit -m "feat: reload restoration via last.meta.json + last.applied marker"
```

---

### Task 15: Extension-host smoke test

**Files:**
- Create: `extension/test/runTest.ts`
- Create: `extension/test/suite/index.ts`
- Create: `extension/test/suite/extension.test.ts`
- Create: `extension/tsconfig.test.json`
- Modify: `extension/package.json` — add mocha + glob devDeps

One smoke test that boots VS Code with the extension and asserts commands are registered.

- [ ] **Step 1: Add devDeps**

In `extension/package.json` `devDependencies`, add:

```json
"mocha": "^10.4.0",
"@types/mocha": "^10.0.6",
"@types/glob": "^8.1.0",
"glob": "^10.4.1"
```

```bash
pnpm install
```

- [ ] **Step 2: Create `extension/tsconfig.test.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "out",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "rootDir": "."
  },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 3: Create test runner**

`extension/test/runTest.ts`:

```typescript
import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
  const extensionTestsPath = path.resolve(__dirname, 'suite/index');
  await runTests({ extensionDevelopmentPath, extensionTestsPath });
}
main().catch((err) => { console.error(err); process.exit(1); });
```

`extension/test/suite/index.ts`:

```typescript
import * as path from 'node:path';
import Mocha from 'mocha';
import { glob } from 'glob';

export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 30000 });
  const root = path.resolve(__dirname);
  const files = await glob('**/*.test.js', { cwd: root });
  for (const f of files) mocha.addFile(path.resolve(root, f));
  await new Promise<void>((res, rej) =>
    mocha.run((failures) => failures > 0 ? rej(new Error(`${failures} failed`)) : res()),
  );
}
```

`extension/test/suite/extension.test.ts`:

```typescript
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Remote Claude extension', () => {
  test('registers commands', async () => {
    const all = await vscode.commands.getCommands(true);
    assert.ok(all.includes('remoteClaude.ask'));
    assert.ok(all.includes('remoteClaude.applySelected'));
    assert.ok(all.includes('remoteClaude.openSetup'));
  });
});
```

- [ ] **Step 4: Run smoke test locally**

```bash
pnpm --filter remote-claude-vscode test:e2e
```
Expected: PASS (downloads VS Code on first run).

- [ ] **Step 5: Commit**

```bash
git add extension/test/runTest.ts extension/test/suite/ extension/tsconfig.test.json extension/package.json
git commit -m "test(ext): extension-host smoke test"
```

---

### Task 16: Docs, CI, packaging, ship

**Files:**
- Modify: `README.md` — add a "VS Code extension" section
- Create: `extension/README.md`, `extension/CHANGELOG.md`
- Modify: `.github/workflows/ci.yml` — add extension build + test

- [ ] **Step 1: Append to root `README.md`**

```markdown
## VS Code extension

A companion extension wraps the CLI with a sidebar UI: ask Claude, watch progress in the status bar, and apply selected files from a checkbox tree.

```bash
cd extension && pnpm build && pnpm package
code --install-extension remote-claude-vscode-*.vsix
```

See [`extension/README.md`](extension/README.md) for details.
```

- [ ] **Step 2: Create `extension/README.md`**

```markdown
# Remote Claude — VS Code extension

Async ask + selective sync, on top of the [`remote-claude`](../README.md) CLI.

## Install

Requires `remote-claude` on `$PATH`. From source:

```
pnpm install
pnpm --filter remote-claude-vscode build
pnpm --filter remote-claude-vscode package
code --install-extension remote-claude-vscode-*.vsix
```

## Use

1. Open a workspace that has `remote-claude.yml`. Run **Remote Claude: Open setup wizard** if it doesn't.
2. Click the Remote Claude activity bar icon.
3. Run **Remote Claude: Ask**, type a prompt.
4. Watch the status bar; when the ask finishes, the sidebar shows a checkbox tree of changed files.
5. Click a file to view its diff. Toggle checkboxes. Click **Apply selected files**.

## Commands

| Command | What it does |
|---|---|
| Remote Claude: Ask | Run an ask asynchronously |
| Remote Claude: Cancel running ask | SIGTERM the spawned CLI |
| Remote Claude: Apply selected files | git apply only the checked files |
| Remote Claude: Reject pending diff | Discard without applying |
| Remote Claude: Save patch | Keep `.remote-claude/last.patch` for later |
| Remote Claude: Open setup wizard | First-run config form |
| Remote Claude: Run doctor | Verify SSH + agent reachability |
| Remote Claude: View Claude output | Open the captured stdout |
```

- [ ] **Step 3: Extend CI**

Read `.github/workflows/ci.yml`. Append to the existing test job's `steps`:

```yaml
      - name: Build extension
        run: pnpm --filter remote-claude-vscode build

      - name: Extension unit tests
        run: pnpm --filter remote-claude-vscode vitest run

      - name: Extension smoke test
        if: runner.os == 'Linux'
        run: |
          sudo apt-get update
          sudo apt-get install -y xvfb
          xvfb-run -a pnpm --filter remote-claude-vscode test:e2e
```

- [ ] **Step 4: Create `extension/CHANGELOG.md`**

```markdown
# Remote Claude — VS Code extension changelog

## 0.0.1 (unreleased)

- Initial release: ask, async progress, sidebar tree, selective apply, setup wizard, reload restoration.
```

- [ ] **Step 5: Final manual checklist**

Run through these manually before tagging the release:

| Scenario | Expected |
|---|---|
| Fresh laptop + Mac Mini; run setup wizard | Test connection passes; yml + env written |
| Ask "add a hello world function" | Status bar progresses; toast on done; sidebar shows files |
| Click each file in pending sync | Native diff editor opens, before/after correct |
| Uncheck 1 file, click Apply | Only checked files modified locally |
| Ask, cancel mid-run | Status bar clears; remote agent receives cancel |
| Pull cable / disable Tailscale mid-run | Failed state with retry hint |
| Reload VS Code with awaitingSync | State restored from `last.meta.json` |
| Apply onto dirty working tree | Clear error, "Save patch" still available |

- [ ] **Step 6: Tag**

```bash
git add README.md extension/README.md extension/CHANGELOG.md .github/workflows/ci.yml
git commit -m "docs: VS Code extension README + CI integration"
git tag -a vsce-v0.0.1 -m "VS Code extension 0.0.1"
```

(Publishing to the marketplace via `vsce publish` is a separate manual step once you have an Azure DevOps PAT.)

---

## Coverage map (spec → tasks)

| Spec section | Implementing task(s) |
|---|---|
| Architecture, repository layout | Tasks 1, 5 |
| `--json` events on `ask`, `doctor`, `apply` | Tasks 1, 2, 3, 4 |
| `apply --files` non-interactive | Task 3 |
| `setup --non-interactive` | Task 4 (verification) — flags already exist |
| `last.meta.json` + `last.stdout` sidecar | Task 2 |
| `last.applied` marker for reload safety | Task 14 |
| `CliClient`, `JobManager`, `HistoryStore` | Tasks 6, 7, 8 |
| `DiffContentProvider`, `FileDecorationProvider` | Task 9 |
| `AskTreeProvider` | Task 10 |
| `StatusBarController` | Task 11 |
| Commands, activation | Task 12 |
| Setup wizard webview | Task 13 |
| Reload restoration | Task 14 |
| Cancellation | Task 6 (CliClient) + Task 8 (JobManager) |
| Error-handling table (9 modes) | Tasks 12, 13, 14 |
| Testing layers 1–4 | Tasks 1–4, 6–10 (units), 15 (smoke) |
| Manual checklist | Task 16 |
