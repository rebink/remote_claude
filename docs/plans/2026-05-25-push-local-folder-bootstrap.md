# Push-Local-Folder Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the v2 wizard's git-URL bootstrap with a push-local-folder bootstrap that keeps the Mac Mini fully isolated from git remotes.

**Architecture:** A new CLI flow (`remote-claude init-remote --from-local`) opens an SSH connection using the per-project key, runs `mkdir + rsync + git init + sandbox identity + initial commit` on the Mini, and verifies no git remote is configured. The wizard Step 3 swaps its git-URL form for a two-field "local folder + project name" form and spawns the new CLI with `--json` to render NDJSON progress live. The agent's `POST /init` route, `runInit`, and `InitBody` are deleted entirely.

**Tech Stack:** TypeScript (ESM), tsup, vitest, Fastify (agent), VS Code Extension API + plain DOM webview, child_process.spawn for ssh/rsync. No new runtime dependencies.

**Spec:** [`docs/specs/2026-05-25-push-local-folder-bootstrap-design.md`](../specs/2026-05-25-push-local-folder-bootstrap-design.md)

---

## Suggested execution slicing

| Milestone | Outcome | Ship gate |
|---|---|---|
| **M1: CLI infra (Tasks 1–3)** | ssh-runner + bootstrap-snapshot modules with isolated unit tests | `pnpm -r test` green for the new test files |
| **M2: CLI command + agent cleanup (Tasks 4–7)** | `remote-claude init-remote --from-local` works end-to-end via stubs; agent `/init` deleted; doctor adds safety check | `pnpm -r test` green; CLI `--help` shows new flags |
| **M3: Wizard rewrite (Tasks 8–10)** | Extension Step 3 uses the new flow; webview has 2-field form with live progress | Manual smoke: open wizard, complete Step 3 against a real Mini |
| **M4: Verification (Tasks 11–12)** | Opt-in localhost e2e test; full smoke green | `bash scripts/smoke-extension.sh` green; manual smoke checklist passes |

Each milestone ends in independently testable software. You can stop after M2 to ship a CLI-only path; M3 adds the wizard; M4 is hardening.

---

## Conventions

**Commit cadence:** every task ends with a commit. Conventional Commits prefixes (`feat:`, `fix:`, `test:`, `refactor:`, `chore:`).

**Test runner:** root `pnpm test`; extension `pnpm --filter remote-claude-vscode test`. From repo root, `pnpm -r test` runs everything.

**Type strictness:** `strict: true` in both packages. Never `any` outside `*.test.ts` mocking edges.

**Imports:** ESM throughout. CLI uses `.ts` import specifiers (`from './foo.ts'`); extension uses bare specifiers compiled by tsup.

**Logging:** CLI uses `src/lib/log.ts` (existing chalk wrapper). Extension uses the `Remote Claude` OutputChannel. Never `console.log`.

**Project-name validation:** `^[a-zA-Z0-9._-]+$` — same regex `setup --project` already uses. Reject names matching `^\.+$` (e.g., `.`, `..`) even though they pass the char class.

**Shell injection defense:** every value that flows into an `ssh "<command>"` payload MUST first be validated against the project-name regex OR run through `quoteForShell` from `src/lib/ssh-runner.ts`. Never interpolate raw user input.

---

## Milestone 1 — CLI infra

### Task 1: `ssh-runner` module

**Files:**
- Create: `src/lib/ssh-runner.ts`
- Create: `test/lib/ssh-runner.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/lib/ssh-runner.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { quoteForShell, buildSshArgv, runSsh } from '../../src/lib/ssh-runner.ts';

describe('quoteForShell', () => {
  it('wraps a simple value in single quotes', () => {
    expect(quoteForShell('hello')).toBe("'hello'");
  });

  it('escapes single quotes inside the value', () => {
    expect(quoteForShell("it's")).toBe(`'it'\\''s'`);
  });

  it('rejects newlines (no legitimate use case for ssh payloads)', () => {
    expect(() => quoteForShell('a\nb')).toThrow(/newline/);
  });
});

describe('buildSshArgv', () => {
  it('composes -i, -p, -o flags and the remote command', () => {
    const argv = buildSshArgv({
      host: 'mini.tail.ts.net',
      user: 'admin',
      port: 22,
      keyPath: '/k/key',
      command: 'echo hi',
    });
    expect(argv).toEqual([
      '-i', '/k/key',
      '-p', '22',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'BatchMode=yes',
      'admin@mini.tail.ts.net',
      'echo hi',
    ]);
  });

  it('omits -p when port is 22 only via default; explicit 22 still appears', () => {
    const argv = buildSshArgv({
      host: 'h', user: 'u', port: 22, keyPath: '/k', command: 'ls',
    });
    expect(argv).toContain('-p');
    expect(argv).toContain('22');
  });
});

describe('runSsh', () => {
  it('returns code/stdout/stderr from the injected adapter', async () => {
    const captured: { cmd?: string; args?: string[] } = {};
    const adapter = async (cmd: string, args: string[]) => {
      captured.cmd = cmd;
      captured.args = args;
      return { code: 0, stdout: 'ok\n', stderr: '' };
    };
    const result = await runSsh(
      { host: 'h', user: 'u', port: 22, keyPath: '/k', command: 'ls' },
      adapter,
    );
    expect(captured.cmd).toBe('ssh');
    expect(captured.args?.at(-1)).toBe('ls');
    expect(result).toEqual({ code: 0, stdout: 'ok\n', stderr: '' });
  });

  it('propagates non-zero exits without throwing', async () => {
    const adapter = async () => ({ code: 5, stdout: '', stderr: 'boom' });
    const r = await runSsh(
      { host: 'h', user: 'u', port: 22, keyPath: '/k', command: 'false' },
      adapter,
    );
    expect(r).toEqual({ code: 5, stdout: '', stderr: 'boom' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test test/lib/ssh-runner.test.ts`
Expected: FAIL — `Cannot find module '../../src/lib/ssh-runner.ts'`.

- [ ] **Step 3: Implement `ssh-runner.ts`**

Create `src/lib/ssh-runner.ts`:

```ts
import { spawn } from 'node:child_process';

export interface SshOpts {
  host: string;
  user: string;
  port: number;
  keyPath: string;
  command: string;
}

export interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type SpawnAdapter = (cmd: string, args: string[]) => Promise<SpawnResult>;

/** Single-quote a value for safe interpolation into a remote shell. Rejects newlines. */
export function quoteForShell(value: string): string {
  if (value.includes('\n')) {
    throw new Error('quoteForShell: newline in value not allowed');
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildSshArgv(opts: SshOpts): string[] {
  return [
    '-i', opts.keyPath,
    '-p', String(opts.port),
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'BatchMode=yes',
    `${opts.user}@${opts.host}`,
    opts.command,
  ];
}

const defaultAdapter: SpawnAdapter = (cmd, args) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => { stdout += c.toString(); });
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });
    child.on('error', (err) => {
      resolve({ code: null, stdout, stderr: stderr + `\nspawn error: ${err.message}` });
    });
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });

export async function runSsh(opts: SshOpts, adapter: SpawnAdapter = defaultAdapter): Promise<SpawnResult> {
  return adapter('ssh', buildSshArgv(opts));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test test/lib/ssh-runner.test.ts`
Expected: PASS — 7 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ssh-runner.ts test/lib/ssh-runner.test.ts
git commit -m "feat(cli): add ssh-runner module with shell-quoting and injectable spawner"
```

---

### Task 2: `bootstrap-snapshot` module

**Files:**
- Create: `src/lib/bootstrap-snapshot.ts`
- Create: `test/lib/bootstrap-snapshot.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/lib/bootstrap-snapshot.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  bootstrapSnapshot,
  type BootstrapDeps,
  type BootstrapEvent,
} from '../../src/lib/bootstrap-snapshot.ts';

function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  return (async () => {
    const out: T[] = [];
    for await (const e of events) out.push(e);
    return out;
  })();
}

function happyDeps(overrides: Partial<BootstrapDeps> = {}): BootstrapDeps {
  return {
    runSsh: async () => ({ code: 0, stdout: '', stderr: '' }),
    runRsync: async function* () {
      yield { type: 'progress', stage: 'rsync', files: 1, bytes: 100, pct: 100, current: 'a' };
      return { code: 0, stderr: '' };
    },
    existsKey: () => true,
    ...overrides,
  };
}

describe('bootstrapSnapshot', () => {
  it('emits probe → rsync → git_init → done on the happy path', async () => {
    const events = await collect(
      bootstrapSnapshot(
        { host: 'h', user: 'u', port: 22, keyPath: '/k', project: 'app', localPath: '/tmp/x' },
        happyDeps({
          runSsh: async (_, cmd) => {
            if (cmd.includes('test -d')) return { code: 1, stdout: '', stderr: '' }; // does not exist
            return { code: 0, stdout: '', stderr: '' };
          },
        }),
      ),
    );
    const names = events.filter((e) => e.type === 'step').map((e) => `${e.name}:${e.status}`);
    expect(names).toContain('probe:ok');
    expect(names).toContain('rsync:ok');
    expect(names).toContain('git_init:ok');
    expect(names).toContain('safety:ok');
    const done = events.find((e) => e.type === 'done') as Extract<BootstrapEvent, { type: 'done' }>;
    expect(done.ok).toBe(true);
  });

  it('aborts with target_exists when probe finds the dir and no override flag set', async () => {
    const events = await collect(
      bootstrapSnapshot(
        { host: 'h', user: 'u', port: 22, keyPath: '/k', project: 'app', localPath: '/tmp/x' },
        happyDeps({ runSsh: async (_, cmd) =>
          cmd.includes('test -d') ? { code: 0, stdout: '', stderr: '' } : { code: 0, stdout: '', stderr: '' }
        }),
      ),
    );
    const failed = events.find((e) => e.type === 'step' && e.status === 'fail');
    expect(failed).toMatchObject({ name: 'probe', code: 'target_exists' });
    const done = events.find((e) => e.type === 'done') as Extract<BootstrapEvent, { type: 'done' }>;
    expect(done.ok).toBe(false);
  });

  it('runs rm -rf first when --overwrite is set', async () => {
    const commandsSeen: string[] = [];
    await collect(
      bootstrapSnapshot(
        { host: 'h', user: 'u', port: 22, keyPath: '/k', project: 'app', localPath: '/tmp/x', overwrite: true },
        happyDeps({
          runSsh: async (_, cmd) => {
            commandsSeen.push(cmd);
            if (cmd.includes('test -d')) return { code: 0, stdout: '', stderr: '' }; // exists
            return { code: 0, stdout: '', stderr: '' };
          },
        }),
      ),
    );
    const wipeIdx = commandsSeen.findIndex((c) => c.startsWith('rm -rf'));
    const mkdirIdx = commandsSeen.findIndex((c) => c.startsWith('mkdir -p'));
    expect(wipeIdx).toBeGreaterThanOrEqual(0);
    expect(mkdirIdx).toBeGreaterThan(wipeIdx);
  });

  it('skips mkdir and rsync when --use-existing is set', async () => {
    let rsyncCalled = false;
    const commandsSeen: string[] = [];
    await collect(
      bootstrapSnapshot(
        { host: 'h', user: 'u', port: 22, keyPath: '/k', project: 'app', localPath: '/tmp/x', useExisting: true },
        happyDeps({
          runSsh: async (_, cmd) => {
            commandsSeen.push(cmd);
            if (cmd.includes('test -d')) return { code: 0, stdout: '', stderr: '' }; // exists
            return { code: 0, stdout: '', stderr: '' };
          },
          runRsync: async function* () { rsyncCalled = true; return { code: 0, stderr: '' }; },
        }),
      ),
    );
    expect(rsyncCalled).toBe(false);
    expect(commandsSeen.some((c) => c.startsWith('mkdir -p'))).toBe(false);
  });

  it('fails with missing_key when key file is absent', async () => {
    const events = await collect(
      bootstrapSnapshot(
        { host: 'h', user: 'u', port: 22, keyPath: '/missing', project: 'app', localPath: '/tmp/x' },
        happyDeps({ existsKey: () => false }),
      ),
    );
    const failed = events.find((e) => e.type === 'step' && e.status === 'fail');
    expect(failed).toMatchObject({ name: 'key', code: 'missing_key' });
  });

  it('fails with unsafe_state if git remote -v returns non-empty', async () => {
    const events = await collect(
      bootstrapSnapshot(
        { host: 'h', user: 'u', port: 22, keyPath: '/k', project: 'app', localPath: '/tmp/x' },
        happyDeps({
          runSsh: async (_, cmd) => {
            if (cmd.includes('test -d')) return { code: 1, stdout: '', stderr: '' };
            if (cmd.includes('git remote -v')) return { code: 0, stdout: 'origin\thttps://x\t(fetch)\n', stderr: '' };
            return { code: 0, stdout: '', stderr: '' };
          },
        }),
      ),
    );
    const failed = events.find((e) => e.type === 'step' && e.status === 'fail');
    expect(failed).toMatchObject({ name: 'safety', code: 'unsafe_state' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test test/lib/bootstrap-snapshot.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `bootstrap-snapshot.ts`**

Create `src/lib/bootstrap-snapshot.ts`:

```ts
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { quoteForShell, runSsh, type SshOpts, type SpawnAdapter } from './ssh-runner.ts';

export interface BootstrapOpts {
  host: string;
  user: string;
  port: number;
  keyPath: string;
  project: string;
  localPath: string;
  overwrite?: boolean;
  useExisting?: boolean;
}

export type BootstrapEvent =
  | { type: 'step'; name: StepName; status: 'start' }
  | { type: 'step'; name: StepName; status: 'ok'; durationMs?: number }
  | { type: 'step'; name: StepName; status: 'fail'; code: FailureCode; stderr?: string; exit?: number | null }
  | { type: 'progress'; stage: 'rsync'; files: number; bytes: number; pct: number; current?: string }
  | { type: 'done'; ok: boolean; projectName?: string; remotePath?: string };

export type StepName = 'key' | 'probe' | 'wipe' | 'mkdir' | 'rsync' | 'git_init' | 'safety';

export type FailureCode =
  | 'missing_key'
  | 'target_exists'
  | 'wipe_failed'
  | 'mkdir_failed'
  | 'rsync_failed'
  | 'git_init_failed'
  | 'unsafe_state'
  | 'ssh_unreachable'
  | 'ssh_auth_failed';

export interface RsyncProgress {
  type: 'progress';
  stage: 'rsync';
  files: number;
  bytes: number;
  pct: number;
  current?: string;
}

export type RsyncRunner = (args: {
  src: string;
  dest: string;
  port: number;
  keyPath: string;
}) => AsyncGenerator<RsyncProgress, { code: number | null; stderr: string }, void>;

export interface BootstrapDeps {
  runSsh: (opts: Omit<SshOpts, 'command'>, command: string) => Promise<{ code: number | null; stdout: string; stderr: string }>;
  runRsync: RsyncRunner;
  existsKey: (path: string) => boolean;
}

const REMOTE_BASE = '~/workspace';
const SANDBOX_EMAIL = 'remote-claude@local';
const SANDBOX_NAME = 'Remote Claude (sandbox)';

export const gitInitScript = (project: string): string => {
  const remote = `${REMOTE_BASE}/${project}`;
  return [
    `cd ${quoteForShell(remote)}`,
    `git init -q`,
    `git config --local user.email ${quoteForShell(SANDBOX_EMAIL)}`,
    `git config --local user.name ${quoteForShell(SANDBOX_NAME)}`,
    `git add -A`,
    `git -c commit.gpgsign=false commit -q --allow-empty -m 'snapshot from laptop'`,
  ].join(' && ');
};

function classifySshError(stderr: string): FailureCode | null {
  if (/Connection refused|No route to host|Connection timed out|ssh: connect to host/i.test(stderr)) {
    return 'ssh_unreachable';
  }
  if (/Permission denied \(publickey\)/i.test(stderr)) return 'ssh_auth_failed';
  return null;
}

export async function* bootstrapSnapshot(
  opts: BootstrapOpts,
  deps: BootstrapDeps,
): AsyncGenerator<BootstrapEvent, void, void> {
  const sshBase = {
    host: opts.host,
    user: opts.user,
    port: opts.port,
    keyPath: opts.keyPath,
  } satisfies Omit<SshOpts, 'command'>;
  const remotePath = `${REMOTE_BASE}/${opts.project}`;
  const quotedRemote = quoteForShell(remotePath);

  // Step 1: key file present
  yield { type: 'step', name: 'key', status: 'start' };
  if (!deps.existsKey(opts.keyPath)) {
    yield { type: 'step', name: 'key', status: 'fail', code: 'missing_key' };
    yield { type: 'done', ok: false };
    return;
  }
  yield { type: 'step', name: 'key', status: 'ok' };

  // Step 2: probe remote dir
  yield { type: 'step', name: 'probe', status: 'start' };
  const probe = await deps.runSsh(sshBase, `test -d ${quotedRemote}`);
  if (probe.code === null) {
    const cls = classifySshError(probe.stderr) ?? 'ssh_unreachable';
    yield { type: 'step', name: 'probe', status: 'fail', code: cls, stderr: probe.stderr };
    yield { type: 'done', ok: false };
    return;
  }
  const exists = probe.code === 0;
  if (exists && !opts.overwrite && !opts.useExisting) {
    yield {
      type: 'step',
      name: 'probe',
      status: 'fail',
      code: 'target_exists',
      stderr: `${remotePath} already exists on the remote`,
    };
    yield { type: 'done', ok: false };
    return;
  }
  yield { type: 'step', name: 'probe', status: 'ok' };

  // Step 3 (optional): wipe
  if (exists && opts.overwrite) {
    yield { type: 'step', name: 'wipe', status: 'start' };
    const wipe = await deps.runSsh(sshBase, `rm -rf ${quotedRemote}`);
    if (wipe.code !== 0) {
      yield { type: 'step', name: 'wipe', status: 'fail', code: 'wipe_failed', stderr: wipe.stderr, exit: wipe.code };
      yield { type: 'done', ok: false };
      return;
    }
    yield { type: 'step', name: 'wipe', status: 'ok' };
  }

  // Step 4 + 5: mkdir + rsync (skipped under --use-existing)
  if (!opts.useExisting) {
    yield { type: 'step', name: 'mkdir', status: 'start' };
    const mk = await deps.runSsh(sshBase, `mkdir -p ${quotedRemote}`);
    if (mk.code !== 0) {
      yield { type: 'step', name: 'mkdir', status: 'fail', code: 'mkdir_failed', stderr: mk.stderr, exit: mk.code };
      yield { type: 'done', ok: false };
      return;
    }
    yield { type: 'step', name: 'mkdir', status: 'ok' };

    yield { type: 'step', name: 'rsync', status: 'start' };
    const rsyncIter = deps.runRsync({
      src: opts.localPath.replace(/\/?$/, '/'),
      dest: `${opts.user}@${opts.host}:${remotePath}/`,
      port: opts.port,
      keyPath: opts.keyPath,
    });
    let rsyncResult: { code: number | null; stderr: string } = { code: 0, stderr: '' };
    while (true) {
      const next = await rsyncIter.next();
      if (next.done) {
        rsyncResult = next.value as { code: number | null; stderr: string };
        break;
      }
      yield next.value;
    }
    if (rsyncResult.code !== 0) {
      yield {
        type: 'step',
        name: 'rsync',
        status: 'fail',
        code: 'rsync_failed',
        stderr: rsyncResult.stderr,
        exit: rsyncResult.code,
      };
      yield { type: 'done', ok: false };
      return;
    }
    yield { type: 'step', name: 'rsync', status: 'ok' };
  }

  // Step 6: git init + sandbox identity + initial commit (idempotent)
  yield { type: 'step', name: 'git_init', status: 'start' };
  const gi = await deps.runSsh(sshBase, gitInitScript(opts.project));
  if (gi.code !== 0) {
    yield {
      type: 'step',
      name: 'git_init',
      status: 'fail',
      code: 'git_init_failed',
      stderr: gi.stderr,
      exit: gi.code,
    };
    yield { type: 'done', ok: false };
    return;
  }
  yield { type: 'step', name: 'git_init', status: 'ok' };

  // Step 7: safety check
  yield { type: 'step', name: 'safety', status: 'start' };
  const safety = await deps.runSsh(sshBase, `cd ${quotedRemote} && git remote -v`);
  if (safety.code !== 0) {
    yield {
      type: 'step',
      name: 'safety',
      status: 'fail',
      code: 'unsafe_state',
      stderr: safety.stderr,
      exit: safety.code,
    };
    yield { type: 'done', ok: false };
    return;
  }
  if (safety.stdout.trim() !== '') {
    yield {
      type: 'step',
      name: 'safety',
      status: 'fail',
      code: 'unsafe_state',
      stderr: safety.stdout,
    };
    yield { type: 'done', ok: false };
    return;
  }
  yield { type: 'step', name: 'safety', status: 'ok' };

  yield { type: 'done', ok: true, projectName: opts.project, remotePath };
}

// ---- Default real-world adapter for runRsync, exported for the CLI wiring ----

export const defaultRsync: RsyncRunner = async function* ({ src, dest, port, keyPath }) {
  const args = [
    '-a',
    '--delete',
    '--filter=:- .gitignore',
    '--info=progress2,stats1',
    '-e',
    `ssh -i ${keyPath} -p ${port} -o StrictHostKeyChecking=accept-new -o BatchMode=yes`,
    src,
    dest,
  ];
  const child = spawn('rsync', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  let currentFile: string | undefined;
  const events: RsyncProgress[] = [];

  child.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });

  child.stdout.on('data', (c: Buffer) => {
    for (const line of c.toString().split(/\r|\n/)) {
      // Progress line: "  1,234,567  78%   12.34MB/s    0:00:23 (xfr#42, to-chk=12/345)"
      const m = line.match(/^\s*([\d,]+)\s+(\d+)%/);
      if (m) {
        events.push({
          type: 'progress',
          stage: 'rsync',
          bytes: Number(m[1].replace(/,/g, '')),
          pct: Number(m[2]),
          files: events.length ? events[events.length - 1].files : 0,
          current: currentFile,
        });
        continue;
      }
      // File line: a plain relative path (no whitespace prefix, no "<" or ">").
      if (line && !line.startsWith(' ') && !line.includes('to-chk=') && /\S/.test(line)) {
        currentFile = line.trim();
      }
    }
  });

  const exitP = new Promise<{ code: number | null; stderr: string }>((resolve) => {
    child.on('error', (err) => resolve({ code: null, stderr: stderr + `\nspawn error: ${err.message}` }));
    child.on('close', (code) => resolve({ code, stderr }));
  });

  // Drain queued events while waiting for exit.
  const drain = async function* (): AsyncGenerator<RsyncProgress, void, void> {
    while (true) {
      if (events.length > 0) {
        const e = events.shift()!;
        yield e;
        continue;
      }
      const settled = await Promise.race([
        new Promise<'next'>((r) => setTimeout(() => r('next'), 100)),
        exitP.then(() => 'done' as const),
      ]);
      if (settled === 'done') break;
    }
  };
  for await (const e of drain()) yield e;
  // Flush any trailing events that landed after exit.
  while (events.length > 0) yield events.shift()!;
  return await exitP;
};

// Convenience for `runSsh` callers in this module that don't need to assemble argv themselves.
export const defaultRunSsh = (opts: SshOpts, command: string) =>
  runSsh({ ...opts, command });

// Allow callers to override the spawn adapter for tests of the default rsync runner (not used here).
export type _DepInjection = { adapter?: SpawnAdapter };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test test/lib/bootstrap-snapshot.test.ts`
Expected: PASS — 6 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bootstrap-snapshot.ts test/lib/bootstrap-snapshot.test.ts
git commit -m "feat(cli): add bootstrap-snapshot orchestrator with NDJSON event stream"
```

---

### Task 3: git-sandbox-identity test (validates the literal init shell snippet)

**Files:**
- Create: `test/lib/git-sandbox-identity.test.ts`

This test runs the actual shell snippet from `bootstrap-snapshot.gitInitScript()` against a temp directory using a real `bash -c` invocation. It guarantees the snippet produces a repo with no remotes and the sandbox identity baked into the local config.

- [ ] **Step 1: Write the test**

Create `test/lib/git-sandbox-identity.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { gitInitScript } from '../../src/lib/bootstrap-snapshot.ts';

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'sandbox-id-'));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function runScriptIn(project: string): void {
  // gitInitScript hard-codes ~/workspace/<project>. We translate ~/workspace to workDir for the test
  // by overriding HOME so ~ expands into workDir/home and pre-creating workDir/home/workspace/<project>.
  const home = join(workDir, 'home');
  const projectDir = join(home, 'workspace', project);
  execFileSync('mkdir', ['-p', projectDir]);
  const script = gitInitScript(project);
  execFileSync('bash', ['-c', script], { env: { ...process.env, HOME: home } });
}

describe('git sandbox identity init script', () => {
  it('produces a repo with no remotes configured', () => {
    runScriptIn('demo');
    const remotes = execFileSync(
      'git',
      ['-C', join(workDir, 'home/workspace/demo'), 'remote', '-v'],
    ).toString();
    expect(remotes.trim()).toBe('');
  });

  it('sets local-only user.email and user.name without touching global config', () => {
    const beforeGlobalEmail = (() => {
      try {
        return execFileSync('git', ['config', '--global', '--get', 'user.email']).toString().trim();
      } catch {
        return '';
      }
    })();
    runScriptIn('demo');
    const localEmail = execFileSync(
      'git',
      ['-C', join(workDir, 'home/workspace/demo'), 'config', '--local', '--get', 'user.email'],
    ).toString().trim();
    expect(localEmail).toBe('remote-claude@local');
    const localName = execFileSync(
      'git',
      ['-C', join(workDir, 'home/workspace/demo'), 'config', '--local', '--get', 'user.name'],
    ).toString().trim();
    expect(localName).toBe('Remote Claude (sandbox)');
    // Global must be unchanged
    const afterGlobalEmail = (() => {
      try {
        return execFileSync('git', ['config', '--global', '--get', 'user.email']).toString().trim();
      } catch {
        return '';
      }
    })();
    expect(afterGlobalEmail).toBe(beforeGlobalEmail);
  });

  it('initial commit succeeds on an empty directory (--allow-empty path)', () => {
    runScriptIn('empty');
    const log = execFileSync(
      'git',
      ['-C', join(workDir, 'home/workspace/empty'), 'log', '--oneline'],
    ).toString().trim();
    expect(log).toMatch(/snapshot from laptop/);
  });

  it('initial commit stages all files on a populated directory', async () => {
    const project = 'populated';
    const home = join(workDir, 'home');
    const projectDir = join(home, 'workspace', project);
    execFileSync('mkdir', ['-p', projectDir]);
    await writeFile(join(projectDir, 'a.txt'), 'hello\n');
    await writeFile(join(projectDir, 'b.txt'), 'world\n');
    execFileSync('bash', ['-c', gitInitScript(project)], { env: { ...process.env, HOME: home } });
    const ls = execFileSync(
      'git',
      ['-C', projectDir, 'ls-tree', '--name-only', 'HEAD'],
    ).toString().split('\n').filter(Boolean).sort();
    expect(ls).toEqual(['a.txt', 'b.txt']);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm test test/lib/git-sandbox-identity.test.ts`
Expected: PASS — 4 tests, 0 failures.

If the test environment has no global git identity at all and `commit` fails, the local-config setup is doing its job; the test's first commit should still succeed because we set local identity *before* `git add` + `commit`. If this fails on CI, that points to an actual implementation bug — investigate before continuing.

- [ ] **Step 3: Commit**

```bash
git add test/lib/git-sandbox-identity.test.ts
git commit -m "test(cli): verify git sandbox identity init script (no remotes, local-only config)"
```

---

### Milestone 1 checkpoint

Run: `pnpm test`
Expected: all tests pass — at minimum the 17 new ones above plus all existing tests (no regressions).

If green: M1 done. The CLI infra layer (ssh-runner + bootstrap-snapshot + git-init guarantee) is independently tested and ready to be wired into a CLI command.

---

## Milestone 2 — CLI command + agent cleanup

### Task 4: rewrite `init-remote.ts` to use `bootstrapSnapshot`

**Files:**
- Modify: `src/commands/init-remote.ts` (full rewrite — 28 lines → ~100 lines)
- Modify: `test/commands/init-remote.test.ts` (full rewrite)

- [ ] **Step 1: Write the failing tests**

Replace the contents of `test/commands/init-remote.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { runInitRemote, type InitRemoteOpts } from '../../src/commands/init-remote.ts';
import type { BootstrapDeps } from '../../src/lib/bootstrap-snapshot.ts';

function baseOpts(): InitRemoteOpts {
  return {
    fromLocal: true,
    project: 'demo',
    host: 'mini',
    user: 'admin',
    sshPort: 22,
    keyPath: '/tmp/test-key',
    localPath: '/tmp/local',
    json: false,
  };
}

function happyDeps(overrides: Partial<BootstrapDeps> = {}): BootstrapDeps {
  return {
    existsKey: () => true,
    runSsh: async () => ({ code: 0, stdout: '', stderr: '' }),
    runRsync: async function* () { return { code: 0, stderr: '' }; },
    ...overrides,
  };
}

describe('runInitRemote (--from-local)', () => {
  it('rejects an unsafe project name', async () => {
    const result = await runInitRemote({ ...baseOpts(), project: '../etc' }, happyDeps());
    expect(result).toMatchObject({ ok: false, code: 'invalid_project_name' });
  });

  it('rejects single-dot or dot-dot project names', async () => {
    const r1 = await runInitRemote({ ...baseOpts(), project: '.' }, happyDeps());
    const r2 = await runInitRemote({ ...baseOpts(), project: '..' }, happyDeps());
    expect(r1).toMatchObject({ ok: false, code: 'invalid_project_name' });
    expect(r2).toMatchObject({ ok: false, code: 'invalid_project_name' });
  });

  it('reports missing_key without making any SSH call', async () => {
    let sshCalled = false;
    const deps = happyDeps({
      existsKey: () => false,
      runSsh: async () => {
        sshCalled = true;
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    const r = await runInitRemote(baseOpts(), deps);
    expect(r).toMatchObject({ ok: false, code: 'missing_key' });
    expect(sshCalled).toBe(false);
  });

  it('returns ok:true on the happy path', async () => {
    const deps = happyDeps({
      runSsh: async (_, cmd) =>
        cmd.includes('test -d') ? { code: 1, stdout: '', stderr: '' } : { code: 0, stdout: '', stderr: '' },
    });
    const r = await runInitRemote(baseOpts(), deps);
    expect(r).toEqual({
      ok: true,
      projectName: 'demo',
      remotePath: '~/workspace/demo',
    });
  });

  it('returns target_exists when remote dir present without --overwrite or --use-existing', async () => {
    const deps = happyDeps({
      runSsh: async () => ({ code: 0, stdout: '', stderr: '' }), // probe finds it
    });
    const r = await runInitRemote(baseOpts(), deps);
    expect(r).toMatchObject({ ok: false, code: 'target_exists' });
  });

  it('returns unsafe_state when git remote -v is non-empty', async () => {
    const deps = happyDeps({
      runSsh: async (_, cmd) => {
        if (cmd.includes('test -d')) return { code: 1, stdout: '', stderr: '' };
        if (cmd.includes('git remote -v')) return { code: 0, stdout: 'origin\thttps://x\t(fetch)\n', stderr: '' };
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    const r = await runInitRemote(baseOpts(), deps);
    expect(r).toMatchObject({ ok: false, code: 'unsafe_state' });
  });

  it('emits NDJSON events to stdout under --json', async () => {
    const lines: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      const deps = happyDeps({
        runSsh: async (_, cmd) =>
          cmd.includes('test -d') ? { code: 1, stdout: '', stderr: '' } : { code: 0, stdout: '', stderr: '' },
      });
      await runInitRemote({ ...baseOpts(), json: true }, deps);
    } finally {
      process.stdout.write = origWrite;
    }
    const joined = lines.join('');
    const events = joined.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const names = events.filter((e: { type: string }) => e.type === 'step').map((e: { name: string }) => e.name);
    expect(names).toContain('probe');
    expect(names).toContain('rsync');
    expect(names).toContain('git_init');
    expect(names).toContain('safety');
    const done = events.find((e: { type: string }) => e.type === 'done');
    expect(done).toEqual({ type: 'done', ok: true, projectName: 'demo', remotePath: '~/workspace/demo' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test test/commands/init-remote.test.ts`
Expected: FAIL — the old `runInitRemote` signature doesn't accept `fromLocal`, has `gitUrl` instead, etc.

- [ ] **Step 3: Rewrite `src/commands/init-remote.ts`**

Replace the contents of `src/commands/init-remote.ts` with:

```ts
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  bootstrapSnapshot,
  defaultRsync,
  type BootstrapDeps,
  type BootstrapEvent,
} from '../lib/bootstrap-snapshot.ts';
import { runSsh, type SshOpts } from '../lib/ssh-runner.ts';
import * as config from '../lib/config.ts';
import { log } from '../lib/log.ts';

export interface InitRemoteOpts {
  fromLocal: true;
  project: string;
  host?: string;
  user?: string;
  sshPort?: number;
  keyPath?: string;
  localPath?: string;
  overwrite?: boolean;
  useExisting?: boolean;
  json?: boolean;
}

export type InitRemoteResult =
  | { ok: true; projectName: string; remotePath: string }
  | {
      ok: false;
      code:
        | 'invalid_project_name'
        | 'missing_config'
        | 'missing_key'
        | 'target_exists'
        | 'wipe_failed'
        | 'mkdir_failed'
        | 'rsync_failed'
        | 'git_init_failed'
        | 'unsafe_state'
        | 'ssh_unreachable'
        | 'ssh_auth_failed';
      stderr?: string;
    };

const PROJECT_NAME_RE = /^[a-zA-Z0-9._-]+$/;

function validateProjectName(name: string): boolean {
  if (!PROJECT_NAME_RE.test(name)) return false;
  if (/^\.+$/.test(name)) return false; // reject ".", "..", "..."
  return true;
}

function defaultDeps(): BootstrapDeps {
  return {
    existsKey: (p: string) => existsSync(p),
    runSsh: (opts: Omit<SshOpts, 'command'>, command: string) => runSsh({ ...opts, command }),
    runRsync: defaultRsync,
  };
}

export async function runInitRemote(
  opts: InitRemoteOpts,
  deps: BootstrapDeps = defaultDeps(),
): Promise<InitRemoteResult> {
  if (!validateProjectName(opts.project)) {
    return { ok: false, code: 'invalid_project_name' };
  }

  // Resolve host/user from remote-claude.yml unless overridden.
  let host = opts.host;
  let user = opts.user;
  let port = opts.sshPort ?? 22;
  if (!host || !user) {
    try {
      const cfg = await config.loadConfig(process.cwd());
      host = host ?? cfg.remote.host;
      user = user ?? cfg.remote.user;
      port = opts.sshPort ?? cfg.remote.sshPort ?? 22;
    } catch (err) {
      return { ok: false, code: 'missing_config', stderr: (err as Error).message };
    }
  }

  const keyPath = opts.keyPath ?? join(homedir(), '.remote-claude', 'keys', `${host}-${user}`);
  const localPath = opts.localPath ?? process.cwd();

  const events: BootstrapEvent[] = [];
  let lastFailure: Extract<BootstrapEvent, { type: 'step'; status: 'fail' }> | undefined;
  let doneOk = false;
  let remotePath: string | undefined;

  for await (const e of bootstrapSnapshot(
    { host, user, port, keyPath, project: opts.project, localPath, overwrite: opts.overwrite, useExisting: opts.useExisting },
    deps,
  )) {
    events.push(e);
    if (opts.json) {
      process.stdout.write(JSON.stringify(e) + '\n');
    } else {
      if (e.type === 'step' && e.status === 'start') log.info(`→ ${e.name}`);
      if (e.type === 'step' && e.status === 'ok') log.ok(`  ${e.name}`);
      if (e.type === 'step' && e.status === 'fail') log.err(`  ${e.name}: ${e.code}${e.stderr ? ` — ${e.stderr.slice(0, 200)}` : ''}`);
      if (e.type === 'progress') log.info(`  rsync ${e.pct}% ${e.current ?? ''}`);
    }
    if (e.type === 'step' && e.status === 'fail') lastFailure = e;
    if (e.type === 'done') {
      doneOk = e.ok;
      remotePath = e.remotePath;
    }
  }

  if (doneOk && remotePath) {
    return { ok: true, projectName: opts.project, remotePath };
  }
  return { ok: false, code: lastFailure?.code ?? 'rsync_failed', stderr: lastFailure?.stderr };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test test/commands/init-remote.test.ts`
Expected: PASS — 7 tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/commands/init-remote.ts test/commands/init-remote.test.ts
git commit -m "feat(cli): rewrite init-remote to push local folder via bootstrapSnapshot"
```

---

### Task 5: wire `init-remote` CLI argv

**Files:**
- Modify: `src/cli.ts` (replace the existing `init-remote` command definition)

- [ ] **Step 1: Update the `init-remote` command in `src/cli.ts`**

Find the existing block (currently around lines 74–84) starting with `.command('init-remote')`. Replace it with:

```ts
program
  .command('init-remote')
  .description('Bootstrap a project on the remote Mac Mini by pushing the local working directory')
  .requiredOption('--from-local', 'push the current working directory (the only supported mode)')
  .requiredOption('--project <name>', 'project directory name on the remote ([a-zA-Z0-9._-]+)')
  .option('--host <host>', 'override host from remote-claude.yml')
  .option('--user <user>', 'override user from remote-claude.yml')
  .option('--ssh-port <n>', 'override SSH port', (v) => Number(v))
  .option('--key-path <path>', 'per-project SSH key (default: ~/.remote-claude/keys/<host>-<user>)')
  .option('--overwrite', 'if ~/workspace/<project> exists on the remote, rm -rf it first', false)
  .option('--use-existing', 'if ~/workspace/<project> exists, skip mkdir + rsync (config-only bootstrap)', false)
  .option('--json', 'machine-readable progress stream (used by the extension wizard)', false)
  .action(async (opts: {
    fromLocal: boolean;
    project: string;
    host?: string;
    user?: string;
    sshPort?: number;
    keyPath?: string;
    overwrite?: boolean;
    useExisting?: boolean;
    json?: boolean;
  }) => {
    const { runInitRemote } = await import('./commands/init-remote.ts');
    const r = await runInitRemote({
      fromLocal: true,
      project: opts.project,
      host: opts.host,
      user: opts.user,
      sshPort: opts.sshPort,
      keyPath: opts.keyPath,
      overwrite: opts.overwrite,
      useExisting: opts.useExisting,
      json: opts.json,
    });
    if (!r.ok) {
      const exitMap: Record<string, number> = {
        invalid_project_name: 2,
        missing_config: 3,
        missing_key: 3,
        target_exists: 4,
        wipe_failed: 5,
        mkdir_failed: 5,
        rsync_failed: 5,
        ssh_unreachable: 5,
        ssh_auth_failed: 5,
        git_init_failed: 5,
        unsafe_state: 6,
      };
      process.exit(exitMap[r.code] ?? 1);
    }
  });
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: zero TypeScript errors. If there are unused-import warnings, remove them.

- [ ] **Step 3: Smoke the CLI help**

Run: `pnpm build && node dist/cli.js init-remote --help`
Expected: help output lists `--from-local`, `--project`, `--host`, `--user`, `--ssh-port`, `--key-path`, `--overwrite`, `--use-existing`, `--json`. No `--git-url` or `--branch`.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): wire init-remote --from-local with --overwrite/--use-existing/--json"
```

---

### Task 6: add safety check to `doctor`

**Files:**
- Modify: `src/commands/doctor.ts`

The doctor command already verifies local tools, config, and agent health. Add a new check: *Remote project has no git remotes configured.* If `git remote -v` on the Mini returns anything, doctor flags it red.

- [ ] **Step 1: Read the existing doctor command structure**

Inspect `src/commands/doctor.ts` to find where remote agent checks are made. The new check should run AFTER the agent health check (it depends on SSH connectivity which the agent check implicitly validates).

- [ ] **Step 2: Add the safety check**

Append this check inside `runDoctor` (after the existing remote-agent check). Match the existing style (`log.ok` / `log.err` / `log.warn` plus a returned `passed/failed` count if doctor tracks one — adapt to the existing structure):

```ts
// Safety: remote project has no git remotes configured.
try {
  const { runSsh } = await import('../lib/ssh-runner.ts');
  const keyPath = join(homedir(), '.remote-claude', 'keys', `${cfg.remote.host}-${cfg.remote.user}`);
  const remotePath = `~/workspace/${cfg.project}`;
  const r = await runSsh({
    host: cfg.remote.host,
    user: cfg.remote.user,
    port: cfg.remote.sshPort ?? 22,
    keyPath,
    command: `cd ${remotePath} && git remote -v`,
  });
  if (r.code !== 0) {
    log.warn(`Could not verify remote git state (ssh exit ${r.code}). Skipping safety check.`);
  } else if (r.stdout.trim() !== '') {
    log.err(`Safety check FAILED — remote project has git remotes configured:`);
    log.err(r.stdout.trim());
    log.err(`Remove with: ssh ${cfg.remote.user}@${cfg.remote.host} "cd ${remotePath} && git remote remove <name>"`);
  } else {
    log.ok('Remote project has no git remotes (sandbox safety guarantee intact)');
  }
} catch (err) {
  log.warn(`Safety check skipped: ${(err as Error).message}`);
}
```

If `doctor.ts` doesn't already import `homedir`/`join`, add the imports at the top:

```ts
import { homedir } from 'node:os';
import { join } from 'node:path';
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors.

- [ ] **Step 4: Verify by re-running doctor manually (optional, requires a real Mini)**

If you have an existing dev setup, run: `node dist/cli.js doctor`
Expected: appended line saying either "Remote project has no git remotes (sandbox safety guarantee intact)" or a red error if it does have remotes.

If you don't have a real Mini, skip this step — the assertion is exercised in the unit tests for `bootstrapSnapshot` Task 2.

- [ ] **Step 5: Commit**

```bash
git add src/commands/doctor.ts
git commit -m "feat(cli): doctor verifies remote project has no git remotes (safety check)"
```

---

### Task 7: delete agent `POST /init` and supporting code

**Files:**
- Delete: `src/agent/init.ts`
- Delete: `test/agent/init.test.ts`
- Modify: `src/agent/server.ts` (remove import, `InitBody` schema, `POST /init` route handler)

- [ ] **Step 1: Delete the files**

```bash
git rm src/agent/init.ts test/agent/init.test.ts
```

- [ ] **Step 2: Edit `src/agent/server.ts`**

Open `src/agent/server.ts` and remove:

1. The `import { runInit } from './init.ts';` line near the top.
2. The `InitBody = z.object({ ... });` schema declaration (the spec confirms it's around line 37; the actual line number may have drifted).
3. The entire `app.post('/init', async (req, reply) => { ... });` block (the spec confirms it's around lines 183–200).

After the edits, ensure the file still typechecks (no orphan imports of `z` or `runInit`). Keep `z` imported if other schemas use it.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors. If `z` is now unused elsewhere, remove its import too.

- [ ] **Step 4: Run all agent tests to confirm nothing else relied on `/init`**

Run: `pnpm test test/agent/`
Expected: all remaining tests pass (chat, session-store, turn-state, git, delete-session — `/init` test is gone).

- [ ] **Step 5: Commit**

```bash
git add src/agent/server.ts
git commit -m "refactor(agent): remove POST /init (snapshot bootstrap is laptop-side only)"
```

---

### Milestone 2 checkpoint

Run: `pnpm test && pnpm typecheck && pnpm build`
Expected: all tests pass, no type errors, build succeeds.

Manual smoke (only if you have a real Mini):

```bash
# In a temp project dir on the laptop, after Setup steps 1-2:
node dist/cli.js init-remote --from-local --project demo
# Then on the Mini:
ssh user@mini "cd ~/workspace/demo && git remote -v && git log --oneline"
# Expected: git remote -v empty; git log shows one commit "snapshot from laptop"
```

---

## Milestone 3 — Wizard rewrite

### Task 8: rewrite SetupWizard `step3Submit` handler

**Files:**
- Modify: `extension/src/setup/SetupWizard.ts` (replace the `case 'step3Submit'` block, ~150 lines)

- [ ] **Step 1: Locate the existing handler**

Open `extension/src/setup/SetupWizard.ts`. Find the `case 'step3Submit':` block (currently around line 167 onward). The block:

- Validates `gitUrl`, `branch`, `projectName`, `localPath`.
- Runs `git clone` locally.
- Generates/reads an agent token.
- Writes `remote-claude.yml`.
- Spawns `remote-claude init-remote --git-url ... --project ...`.

It needs to be replaced wholesale.

- [ ] **Step 2: Replace the handler body**

Replace the entire `case 'step3Submit':` block with:

```ts
case 'step3Submit': {
  const localPath = msg.localPath as string;
  const projectName = msg.projectName as string;
  const overwrite = !!msg.overwrite;
  const useExisting = !!msg.useExisting;
  const { host, user, sshPort = 22 } = this.state;

  if (!localPath || !projectName || !host || !user) {
    this.state = { ...this.state, error: 'Local folder and project name are required' };
    return this.postState();
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(projectName) || /^\.+$/.test(projectName)) {
    this.state = {
      ...this.state,
      error: 'Project name must match [a-zA-Z0-9._-]+ and cannot be "." or ".."',
    };
    return this.postState();
  }

  this.state = { ...this.state, busy: true, error: undefined, projectName, localPath };
  this.postState();

  const cp = await import('node:child_process');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const os = await import('node:os');
  const crypto = await import('node:crypto');
  const { stringify } = await import('yaml');

  const expandedLocalPath = localPath.startsWith('~')
    ? path.join(os.homedir(), localPath.slice(1))
    : localPath;

  // 1. Ensure local folder exists
  if (!fs.existsSync(expandedLocalPath) || !fs.statSync(expandedLocalPath).isDirectory()) {
    this.state = { ...this.state, busy: false, error: `Local folder does not exist: ${expandedLocalPath}` };
    return this.postState();
  }

  // 2. Generate or reuse the agent token
  const envPath = path.join(os.homedir(), '.remote-claude', 'env');
  let token: string;
  if (fs.existsSync(envPath)) {
    const envText = fs.readFileSync(envPath, 'utf8');
    const match = envText.match(/^RC_TOKEN=(.+)$/m);
    token = match ? match[1] : crypto.randomBytes(32).toString('hex');
  } else {
    token = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(path.dirname(envPath), { recursive: true });
    fs.writeFileSync(envPath, `RC_TOKEN=${token}\n`, { mode: 0o600 });
    this.output.appendLine(
      `Generated agent token at ${envPath} (mode 0600). ` +
        `Set RC_AGENT_TOKEN=${token} on the Mac Mini's launchd agent for it to take effect.`,
    );
  }

  // 3. Write remote-claude.yml in the local folder
  const yamlPath = path.join(expandedLocalPath, 'remote-claude.yml');
  try {
    fs.writeFileSync(
      yamlPath,
      stringify({
        project: projectName,
        remote: {
          host,
          user,
          sshPort,
          path: `~/workspace/${projectName}`,
          agentUrl: `http://${host}:7878`,
          token: '${RC_TOKEN}',
        },
        sync: { exclude: ['build/', '.dart_tool/', 'ios/Pods/', 'node_modules/', '.git/'] },
        ai: { command: 'claude', args: ['--print'], timeoutSec: 600 },
      }),
    );
  } catch (err) {
    this.state = { ...this.state, busy: false };
    this.panel?.webview.postMessage({
      type: 'step3Result',
      result: { ok: false, where: 'local', stderr: `Failed to write remote-claude.yml: ${(err as Error).message}` },
    });
    return this.postState();
  }

  // 4. Spawn `remote-claude init-remote --from-local --json` and stream NDJSON
  this.output.appendLine(`Pushing ${expandedLocalPath} → ~/workspace/${projectName}…`);
  const args = ['init-remote', '--from-local', '--project', projectName, '--host', host, '--user', user, '--ssh-port', String(sshPort), '--json'];
  if (overwrite) args.push('--overwrite');
  if (useExisting) args.push('--use-existing');

  const child = cp.spawn('remote-claude', args, { cwd: expandedLocalPath, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdoutBuf = '';
  let stderrBuf = '';
  let lastFailure: { code?: string; stderr?: string; name?: string } | undefined;
  let doneOk = false;

  child.stdout.on('data', (c: Buffer) => {
    stdoutBuf += c.toString();
    let nl: number;
    while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
      const line = stdoutBuf.slice(0, nl).trim();
      stdoutBuf = stdoutBuf.slice(nl + 1);
      if (!line) continue;
      try {
        const evt = JSON.parse(line) as { type: string; [k: string]: unknown };
        this.output.appendLine(`[init-remote] ${line}`);
        // Forward progress + step events to the webview
        this.panel?.webview.postMessage({ type: 'step3Event', event: evt });
        if (evt.type === 'step' && evt.status === 'fail') {
          lastFailure = { code: evt.code as string, stderr: evt.stderr as string, name: evt.name as string };
        }
        if (evt.type === 'done') doneOk = evt.ok === true;
      } catch {
        this.output.appendLine(`[init-remote] (non-JSON) ${line}`);
      }
    }
  });
  child.stderr.on('data', (c: Buffer) => {
    stderrBuf += c.toString();
    this.output.appendLine(`[init-remote stderr] ${c.toString()}`);
  });

  const exit: number | null = await new Promise((resolve) => {
    let settled = false;
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      this.output.appendLine(`Failed to spawn remote-claude: ${err.message}. Is it on PATH?`);
      resolve(null);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      resolve(code);
    });
  });

  this.state = { ...this.state, busy: false };

  if (doneOk && exit === 0) {
    this.panel?.webview.postMessage({ type: 'step3Result', result: { ok: true } });
    this.state = { ...this.state, step: 4 };
    return this.postState();
  }

  // Handle target_exists with a modal asking overwrite / use-existing / cancel
  if (lastFailure?.code === 'target_exists') {
    const choice = await vscode.window.showWarningMessage(
      `~/workspace/${projectName} already exists on the Mac Mini.`,
      { modal: true },
      'Overwrite (rm -rf + re-push)',
      'Use existing (skip rsync)',
    );
    if (choice === 'Overwrite (rm -rf + re-push)') {
      return this.handleMessage({ ...msg, overwrite: true });
    }
    if (choice === 'Use existing (skip rsync)') {
      return this.handleMessage({ ...msg, useExisting: true });
    }
    // Cancel: leave wizard on Step 3
    this.panel?.webview.postMessage({
      type: 'step3Result',
      result: { ok: false, where: 'remote', stderr: 'Cancelled: target exists on remote.' },
    });
    return this.postState();
  }

  this.panel?.webview.postMessage({
    type: 'step3Result',
    result: {
      ok: false,
      where: 'remote',
      stderr: (lastFailure?.stderr ?? stderrBuf ?? `init-remote exited with code ${exit}`).slice(0, 500),
    },
  });
  this.postState();
  return;
}
```

The file already imports `vscode` at the top. The recursive `handleMessage` call works because the method's parameter type is `{ type: string; [k: string]: unknown }` and the spread preserves both fields.

- [ ] **Step 3: Typecheck the extension**

Run: `pnpm --filter remote-claude-vscode typecheck`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add extension/src/setup/SetupWizard.ts
git commit -m "feat(extension): wizard Step 3 spawns init-remote --from-local --json + parses NDJSON"
```

---

### Task 9: rewrite webview Step 3 form

**Files:**
- Modify: `extension/src/setup/webview/main.ts` (replace the Step 3 form rendering section)

The current webview renders three inputs: git URL, project name, local path. Replace with two: local folder (pre-filled with workspace path passed in from the extension), project name (pre-filled with basename).

- [ ] **Step 1: Locate the Step 3 render block**

In `extension/src/setup/webview/main.ts`, find the function/block that renders Step 3 (around lines 250–310). Look for `gitUrlInput`, `gitUrlValue`, `projectNameInput`, `localPathInput`.

- [ ] **Step 2: Replace Step 3 rendering**

Replace the Step 3 form section. The new form:

```ts
// ---- Step 3 ----
function renderStep3(container: HTMLElement, state: WizardState): void {
  let localPathValue = state.localPath ?? state.workspaceFolder ?? '';
  let projectNameValue = state.projectName ?? (localPathValue ? basename(localPathValue) : '');
  let progressLine = '';

  const localPathInput = h('input', { type: 'text', value: localPathValue }) as HTMLInputElement;
  const projectNameInput = h('input', { type: 'text', value: projectNameValue }) as HTMLInputElement;
  const submitBtn = h('button', { className: 'primary' }, 'Push & continue →');
  const progressEl = h('div', { className: 'progress' }, '');

  localPathInput.addEventListener('input', () => {
    localPathValue = localPathInput.value;
    if (!projectNameInput.dataset.userEdited) {
      const b = basename(localPathValue);
      projectNameInput.value = b;
      projectNameValue = b;
    }
  });
  projectNameInput.addEventListener('input', () => {
    projectNameInput.dataset.userEdited = '1';
    projectNameValue = projectNameInput.value;
  });

  container.append(
    h('h2', {}, 'Step 3 — Push your project to the Mac Mini'),
    h('div', { className: 'form-row' },
      h('label', {}, 'Local folder'),
      localPathInput,
      h('p', { className: 'hint' }, 'Defaults to your current VS Code workspace folder.'),
    ),
    h('div', { className: 'form-row' },
      h('label', {}, 'Project name (folder on the Mac Mini)'),
      projectNameInput,
      h('p', { className: 'hint' }, `Will be created at ~/workspace/<name>`),
    ),
    h('p', { className: 'warn-banner' },
      'The Mac Mini copy stays isolated from git — no remotes, no pushes, no leaked identity. ' +
      'You commit only on the laptop with your own git identity.',
    ),
    progressEl,
  );

  if (state.error) {
    container.append(h('p', { className: 'error' }, state.error));
  }
  if (step3Result && !step3Result.ok) {
    container.append(
      h('div', { className: 'error-block' },
        h('p', {}, 'Push failed:'),
        h('pre', { className: 'note', style: { whiteSpace: 'pre-wrap' } as unknown as CSSStyleDeclaration }, step3Result.stderr ?? ''),
      ),
    );
  }

  container.append(
    h('div', { className: 'actions' },
      h('button', { onclick: () => vscode.postMessage({ type: 'back', to: 2 }) }, 'Back'),
      submitBtn,
    ),
  );

  submitBtn.addEventListener('click', () => {
    if (!localPathValue || !projectNameValue) return;
    step3Result = undefined;
    progressEl.textContent = 'Starting…';
    vscode.postMessage({
      type: 'step3Submit',
      localPath: localPathValue,
      projectName: projectNameValue,
    });
  });
}

function basename(p: string): string {
  const norm = p.replace(/\/+$/, '');
  const i = norm.lastIndexOf('/');
  return i === -1 ? norm : norm.slice(i + 1);
}
```

And update the message handler at the top to forward `step3Event` payloads to a live progress line:

Add (next to the existing `step3Result` message handler):

```ts
} else if (msg.type === 'step3Event' && msg.event) {
  const evt = msg.event as { type: string; [k: string]: unknown };
  const progressEl = document.querySelector('.progress') as HTMLElement | null;
  if (!progressEl) return;
  if (evt.type === 'step' && evt.status === 'start') {
    progressEl.textContent = `→ ${evt.name}…`;
  } else if (evt.type === 'progress' && evt.stage === 'rsync') {
    const pct = evt.pct as number;
    const cur = (evt.current as string | undefined) ?? '';
    const files = evt.files as number;
    progressEl.textContent = `Pushing files… ${files} files (rsync ${pct}% — ${cur})`;
  } else if (evt.type === 'step' && evt.status === 'ok') {
    progressEl.textContent = `✓ ${evt.name}`;
  } else if (evt.type === 'step' && evt.status === 'fail') {
    progressEl.textContent = `✗ ${evt.name}: ${(evt.code as string) ?? 'failed'}`;
  }
}
```

Also update the `WizardState` type at the top of the file to add `workspaceFolder?: string;`, `localPath?: string;`, `projectName?: string;` if not already present.

In `extension/src/setup/SetupWizard.ts`, when constructing the initial state passed to the webview, set:

```ts
const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
this.state = { ...this.state, workspaceFolder: wsFolder };
```

(Place this just before the initial `postState()`.)

- [ ] **Step 3: Typecheck and build the extension**

Run: `pnpm --filter remote-claude-vscode typecheck && pnpm --filter remote-claude-vscode build`
Expected: zero errors; `dist/setup-webview/main.js` rebuilt.

- [ ] **Step 4: Commit**

```bash
git add extension/src/setup/webview/main.ts extension/src/setup/SetupWizard.ts
git commit -m "feat(extension): Step 3 form switches to local-folder + project-name fields with live progress"
```

---

### Task 10: SetupWizard test

**Files:**
- Create: `extension/src/setup/SetupWizard.test.ts`

- [ ] **Step 1: Write the tests**

The extension uses a vscode-stub already (`extension/src/test/vscode-stub.ts`). The wizard's `handleMessage` is the unit under test; we stub `child_process.spawn` to produce a canned NDJSON stream.

Create `extension/src/setup/SetupWizard.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

// Stub vscode module before importing the wizard.
vi.mock('vscode', () => import('../test/vscode-stub.ts'));

// Capture spawn calls.
const spawnCalls: { cmd: string; args: string[]; opts: unknown }[] = [];
let stubChild: EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };

function makeChild(stdoutLines: string[], exitCode: number) {
  const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  setImmediate(() => {
    for (const line of stdoutLines) child.stdout.emit('data', Buffer.from(line + '\n'));
    child.emit('close', exitCode);
  });
  return child;
}

vi.mock('node:child_process', () => ({
  spawn: vi.fn((cmd: string, args: string[], opts: unknown) => {
    spawnCalls.push({ cmd, args, opts });
    return stubChild;
  }),
}));

beforeEach(() => {
  spawnCalls.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('SetupWizard step3Submit', () => {
  it('spawns remote-claude init-remote --from-local --json with parsed inputs', async () => {
    stubChild = makeChild(
      [
        JSON.stringify({ type: 'step', name: 'probe', status: 'start' }),
        JSON.stringify({ type: 'step', name: 'probe', status: 'ok' }),
        JSON.stringify({ type: 'step', name: 'rsync', status: 'ok' }),
        JSON.stringify({ type: 'step', name: 'git_init', status: 'ok' }),
        JSON.stringify({ type: 'step', name: 'safety', status: 'ok' }),
        JSON.stringify({ type: 'done', ok: true, projectName: 'demo', remotePath: '~/workspace/demo' }),
      ],
      0,
    );

    const { SetupWizard } = await import('./SetupWizard.ts');
    const output = { appendLine: vi.fn() } as unknown as import('vscode').OutputChannel;
    const wizard = new SetupWizard({} as never, output);
    // Prime state with completed Steps 1-2.
    (wizard as unknown as { state: Record<string, unknown> }).state = {
      step: 3,
      host: 'mini',
      user: 'admin',
      sshPort: 22,
      busy: false,
    };

    await (wizard as unknown as { handleMessage: (m: Record<string, unknown>) => Promise<void> }).handleMessage({
      type: 'step3Submit',
      localPath: '/tmp/proj',
      projectName: 'demo',
    });

    const call = spawnCalls.find((c) => c.cmd === 'remote-claude');
    expect(call).toBeDefined();
    expect(call!.args).toContain('init-remote');
    expect(call!.args).toContain('--from-local');
    expect(call!.args).toContain('--project');
    expect(call!.args).toContain('demo');
    expect(call!.args).toContain('--json');
  });

  it('rejects an invalid project name before spawning', async () => {
    stubChild = makeChild([], 0);
    const { SetupWizard } = await import('./SetupWizard.ts');
    const output = { appendLine: vi.fn() } as unknown as import('vscode').OutputChannel;
    const wizard = new SetupWizard({} as never, output);
    (wizard as unknown as { state: Record<string, unknown> }).state = {
      step: 3, host: 'mini', user: 'admin', sshPort: 22, busy: false,
    };
    await (wizard as unknown as { handleMessage: (m: Record<string, unknown>) => Promise<void> }).handleMessage({
      type: 'step3Submit',
      localPath: '/tmp/proj',
      projectName: '..',
    });
    expect(spawnCalls.length).toBe(0);
    expect(
      ((wizard as unknown as { state: { error?: string } }).state.error ?? '').toLowerCase(),
    ).toMatch(/project name|invalid/);
  });

  it('parses NDJSON progress and forwards step3Event to the webview', async () => {
    stubChild = makeChild(
      [
        JSON.stringify({ type: 'progress', stage: 'rsync', files: 100, bytes: 1024, pct: 50, current: 'a.txt' }),
        JSON.stringify({ type: 'done', ok: true, projectName: 'demo', remotePath: '~/workspace/demo' }),
      ],
      0,
    );
    const posted: unknown[] = [];
    const { SetupWizard } = await import('./SetupWizard.ts');
    const output = { appendLine: vi.fn() } as unknown as import('vscode').OutputChannel;
    const wizard = new SetupWizard({} as never, output);
    (wizard as unknown as { state: Record<string, unknown> }).state = {
      step: 3, host: 'mini', user: 'admin', sshPort: 22, busy: false,
    };
    (wizard as unknown as { panel?: { webview: { postMessage: (m: unknown) => void } } }).panel = {
      webview: { postMessage: (m: unknown) => posted.push(m) },
    };
    await (wizard as unknown as { handleMessage: (m: Record<string, unknown>) => Promise<void> }).handleMessage({
      type: 'step3Submit',
      localPath: '/tmp/proj',
      projectName: 'demo',
    });
    const progressMsg = posted.find(
      (m) => typeof m === 'object' && m !== null && (m as { type?: string }).type === 'step3Event' &&
        ((m as { event?: { type?: string } }).event?.type === 'progress'),
    );
    expect(progressMsg).toBeDefined();
  });

  it('surfaces target_exists with a modal and re-spawns on Overwrite', async () => {
    let firstCall = true;
    stubChild = makeChild(
      [
        JSON.stringify({ type: 'step', name: 'probe', status: 'fail', code: 'target_exists' }),
        JSON.stringify({ type: 'done', ok: false }),
      ],
      4,
    );

    // After the modal, the next spawn returns happy events.
    const stubChildHappy = makeChild(
      [
        JSON.stringify({ type: 'step', name: 'safety', status: 'ok' }),
        JSON.stringify({ type: 'done', ok: true, projectName: 'demo', remotePath: '~/workspace/demo' }),
      ],
      0,
    );

    const cp = await import('node:child_process');
    (cp.spawn as unknown as { mockImplementation: (fn: (cmd: string, args: string[], opts: unknown) => unknown) => void }).mockImplementation(
      (cmd: string, args: string[], opts: unknown) => {
        spawnCalls.push({ cmd, args, opts });
        if (firstCall) { firstCall = false; return stubChild; }
        return stubChildHappy;
      },
    );

    const vscode = await import('vscode');
    (vscode.window.showWarningMessage as unknown as { mockResolvedValue: (v: unknown) => void }) =
      vi.fn().mockResolvedValue('Overwrite (rm -rf + re-push)') as never;

    const { SetupWizard } = await import('./SetupWizard.ts');
    const output = { appendLine: vi.fn() } as unknown as import('vscode').OutputChannel;
    const wizard = new SetupWizard({} as never, output);
    (wizard as unknown as { state: Record<string, unknown> }).state = {
      step: 3, host: 'mini', user: 'admin', sshPort: 22, busy: false,
    };

    await (wizard as unknown as { handleMessage: (m: Record<string, unknown>) => Promise<void> }).handleMessage({
      type: 'step3Submit',
      localPath: '/tmp/proj',
      projectName: 'demo',
    });

    expect(spawnCalls.length).toBeGreaterThanOrEqual(2);
    expect(spawnCalls[1].args).toContain('--overwrite');
  });
});
```

- [ ] **Step 2: Verify `extension/src/test/vscode-stub.ts` exposes `window.showWarningMessage`**

Open the stub. If `showWarningMessage` isn't exported, add a stub:

```ts
window: {
  // ...existing entries...
  showWarningMessage: async (..._args: unknown[]) => undefined,
  // ...
},
```

The test overrides it via `vi.fn().mockResolvedValue(...)`, but it must exist on the stub or the override target is `undefined`.

- [ ] **Step 3: Run the tests**

Run: `pnpm --filter remote-claude-vscode test`
Expected: all extension tests pass (existing 12 + new 4 = 16).

- [ ] **Step 4: Commit**

```bash
git add extension/src/setup/SetupWizard.test.ts extension/src/test/vscode-stub.ts
git commit -m "test(extension): SetupWizard step3 spawns CLI, parses NDJSON, modal on target_exists"
```

---

### Milestone 3 checkpoint

Run: `pnpm -r test && pnpm -r typecheck && pnpm -r build`
Expected: all tests pass; build succeeds in both packages.

Manual smoke (requires a real Mini):

1. Reload VS Code window.
2. Open command palette → **Remote Claude: Setup…**
3. Walk through Steps 1, 2 normally.
4. On Step 3: the form has **two** fields (Local folder, Project name), pre-filled. Click *Push & continue*.
5. The progress line ticks through `probe → rsync (with %) → git_init → safety` and then advances to Step 4.
6. On Step 4 (doctor): the new "Remote project has no git remotes" check passes (green).

---

## Milestone 4 — Verification

### Task 11: opt-in localhost e2e test

**Files:**
- Create: `test/integration/bootstrap.e2e.test.ts`

This test runs the real CLI against `ssh user@127.0.0.1`. Skipped unless `RC_E2E=1`.

- [ ] **Step 1: Write the test**

Create `test/integration/bootstrap.e2e.test.ts`:

```ts
/**
 * End-to-end bootstrap test against localhost.
 *
 * REQUIRES:
 *   - `ssh user@127.0.0.1` works without a password prompt (pubkey installed in
 *     ~/.ssh/authorized_keys for the test user).
 *   - `RC_E2E=1` set in env.
 *   - Test user is the one running the test (or override with E2E_USER).
 *
 * Run:
 *   RC_E2E=1 pnpm test test/integration/bootstrap.e2e.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir, userInfo, homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { runInitRemote } from '../../src/commands/init-remote.ts';

const ENABLED = process.env.RC_E2E === '1';
const E2E_USER = process.env.E2E_USER ?? userInfo().username;

let projectDir: string;
let homeRemote: string;
let projectName: string;

beforeAll(async () => {
  if (!ENABLED) return;
  projectDir = await mkdtemp(join(tmpdir(), 'e2e-proj-'));
  await writeFile(join(projectDir, 'README.md'), '# test\n');
  await writeFile(join(projectDir, 'src.ts'), 'export const x = 1;\n');

  // The CLI hard-codes ~/workspace/<project>; we let it use the real $HOME.
  homeRemote = homedir();
  projectName = `e2e-${Date.now()}`;
});

afterAll(async () => {
  if (!ENABLED) return;
  await rm(projectDir, { recursive: true, force: true });
  await rm(join(homeRemote, 'workspace', projectName), { recursive: true, force: true });
});

describe.skipIf(!ENABLED)('bootstrap e2e (localhost)', () => {
  it('bootstraps a populated project and leaves no git remotes', async () => {
    // The CLI needs a key at ~/.remote-claude/keys/127.0.0.1-<user> for default path resolution.
    // We point it at ~/.ssh/id_rsa or id_ed25519 via --key-path instead.
    const keyPath = process.env.E2E_KEY_PATH ?? join(homedir(), '.ssh', 'id_rsa');
    const r = await runInitRemote({
      fromLocal: true,
      project: projectName,
      host: '127.0.0.1',
      user: E2E_USER,
      sshPort: 22,
      keyPath,
      localPath: projectDir,
    });
    expect(r).toMatchObject({ ok: true, projectName, remotePath: `~/workspace/${projectName}` });

    const remoteProj = join(homeRemote, 'workspace', projectName);
    const remotes = execFileSync('git', ['-C', remoteProj, 'remote', '-v']).toString().trim();
    expect(remotes).toBe('');

    const log = execFileSync('git', ['-C', remoteProj, 'log', '--oneline']).toString().trim();
    expect(log).toMatch(/snapshot from laptop/);

    const author = execFileSync(
      'git',
      ['-C', remoteProj, 'log', '-1', '--format=%ae %an'],
    ).toString().trim();
    expect(author).toBe('remote-claude@local Remote Claude (sandbox)');
  });
});
```

- [ ] **Step 2: Verify it skips cleanly without `RC_E2E=1`**

Run: `pnpm test test/integration/bootstrap.e2e.test.ts`
Expected: 1 test skipped, 0 failures.

- [ ] **Step 3: (Optional) run with E2E=1 if you can**

If you have `ssh localhost` working pubkey-only, run:

```bash
RC_E2E=1 pnpm test test/integration/bootstrap.e2e.test.ts
```

Expected: 1 test passes, asserts on remotes/log/author all green.

- [ ] **Step 4: Commit**

```bash
git add test/integration/bootstrap.e2e.test.ts
git commit -m "test: opt-in localhost e2e for bootstrap snapshot (gated on RC_E2E=1)"
```

---

### Task 12: smoke + manual smoke checklist

**Files:**
- (no code changes)

- [ ] **Step 1: Run the full smoke script**

Run: `bash scripts/smoke-extension.sh`
Expected: builds succeed for both packages, typecheck green, all tests pass (existing + the new ones above).

- [ ] **Step 2: Manual smoke checklist (requires a real Mini)**

1. Fresh laptop, fresh Mini. Run wizard end-to-end. Step 3 finishes in <60s for a 50 MB project; <10s for an empty repo.
2. From a turn: `git diff HEAD` produces a patch on the Mini after Claude edits files (proves the snapshot commit gave the agent something to diff against).
3. After bootstrap, `ssh user@mini "cd ~/workspace/<project> && git remote -v"` → empty.
4. After bootstrap, `ssh user@mini "cd ~/workspace/<project> && git log -1 --format='%ae %an'"` → `remote-claude@local Remote Claude (sandbox)`.

- [ ] **Step 3: (Optional) tag the milestone commit**

```bash
git tag -a v1.1.0-snapshot-bootstrap -m "Push-local-folder bootstrap (replaces git-URL flow)"
```

---

### Milestone 4 checkpoint

`bash scripts/smoke-extension.sh` green, manual smoke checklist passes. Implementation complete.

---

## Self-review checklist

- [x] **Spec coverage:** each section of the spec maps to tasks:
  - Goals + non-goals → addressed in M1 (zero remotes by construction), M2 (delete /init), M3 (wizard rewrite).
  - Locked decisions 1–7 → Task 4 (decision 1), Task 7 (decision 2), Task 2's `gitInitScript` (decision 3), bootstrap-snapshot's safety step (decision 4), defaultRsync (decision 5), Task 8's modal (decision 6), Task 5 + Task 8 (decision 7).
  - Architecture diagram → Tasks 1, 2, 4, 7, 8, 9 collectively implement the three changed components.
  - Wizard UX → Task 9.
  - CLI surface → Tasks 4, 5.
  - Error handling matrix → bootstrap-snapshot's classifySshError, init-remote's exit map, SetupWizard's modal handling.
  - Testing → Tasks 1, 2, 3, 4, 10, 11.
- [x] **No placeholders:** every step has either complete code, a real shell command, or a concrete instruction. No "TBD" / "implement later".
- [x] **Type consistency:** `BootstrapEvent`, `BootstrapOpts`, `BootstrapDeps`, `InitRemoteOpts`, `InitRemoteResult` defined once and reused.
- [x] **No `innerHTML` in new code:** webview Step 3 uses `h()` / `textContent` only (per the v2 design's safe-DOM rule).
- [x] **TDD where it pays off:** logic modules (ssh-runner, bootstrap-snapshot, git-sandbox-identity, init-remote command) have failing-test-first steps. Wizard handler has a behavioral test in Task 10.
- [x] **Each milestone ends in testable software** per the table at the top.

## Known v1 limitations (carry forward to v1.1)

- Bootstrap is single-laptop-per-project. Two laptops pushing to the same project name will clobber each other.
- No mid-rsync resumability across CLI invocations.
- The snapshot commit is the literal first commit on the Mini; re-bootstrap with `--overwrite` wipes and recreates git history on the Mini (acceptable — history on the Mini is never meant to leave the sandbox).
- Rsync progress parsing is regex-based on `--info=progress2` and may not show updates for very small projects (the percentage line only appears once total size is known).
