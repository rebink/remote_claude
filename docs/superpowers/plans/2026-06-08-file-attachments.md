# Local File Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let developers attach any local file (incl. images for vision) to the remote `claude` — from the CLI (`patchwire push`) for the interactive-SSH workflow, and from the VS Code extension via a one-click "📎 Attach" that types the remote path into the live `claude` terminal.

**Architecture:** A gitignored `.patchwire-inbox/` at the project root is a shared staging area. The CLI `push` command (the single staging implementation) copies a file there and rsyncs it to the remote inbox. The extension spawns `patchwire push --stage-only --json` (Mutagen carries the bytes), flushes sync, then `terminal.sendText(remotePath)`. `git add -A` skips the gitignored inbox so attachments never enter a returned diff.

**Tech Stack:** TypeScript, Node, vitest, commander (CLI), tsup, VS Code extension API, rsync/ssh (existing `lib/rsync.ts` + `lib/ssh-runner.ts`), Mutagen (existing `MutagenController`).

**Branch:** `feat/file-attachments` (already created off `main` @ 0.3.4). Spec: `docs/superpowers/specs/2026-06-08-file-attachments-design.md`.

---

## File structure

- **Create** `packages/cli/src/lib/attachments.ts` — pure inbox helpers: `INBOX_DIR`, `MAX_ATTACHMENT_BYTES`, `ensureInbox`, `sanitizeName`, `stageAttachment`, `remoteAttachmentPath`, `pruneInbox`.
- **Create** `packages/cli/test/attachments.test.ts` — unit tests for the above.
- **Create** `packages/cli/src/commands/push.ts` — `runPush(cwd, files, opts)`: stage + (rsync unless `--stage-only`) + print/JSON; `--clip`, `--clean`.
- **Create** `packages/cli/test/push.test.ts` — unit tests for argv/decision logic (no network).
- **Modify** `packages/cli/src/cli.ts` — register the `push` command.
- **Create** `packages/extension/src/attach/attachFile.ts` — `attachFile(localPath, deps)`: spawn CLI → flush → sendText/clipboard.
- **Create** `packages/extension/src/attach/attachFile.test.ts` — unit tests with stubs.
- **Modify** `packages/extension/src/commands.ts` — register `patchwire.attachFile` + `patchwire.attachClipboardImage`.
- **Modify** `packages/extension/src/chat/webview/main.ts` — add the "📎 Attach file" button (`postMessage({type:'attachFile'})`).
- **Modify** `packages/extension/src/chat/ChatPanel.ts` — handle `attachFile` message → run the command.
- **Modify** `packages/extension/package.json` — declare the two commands under `contributes.commands`.

---

## Task 1: Shared inbox helpers (`attachments.ts`)

**Files:**
- Create: `packages/cli/src/lib/attachments.ts`
- Test: `packages/cli/test/attachments.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/cli/test/attachments.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  INBOX_DIR, MAX_ATTACHMENT_BYTES,
  ensureInbox, sanitizeName, stageAttachment, remoteAttachmentPath, pruneInbox,
} from '../src/lib/attachments.ts';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pw-attach-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('ensureInbox', () => {
  it('creates the inbox dir and adds a single gitignore line, idempotently', () => {
    ensureInbox(dir);
    ensureInbox(dir); // twice → still one line
    expect(existsSync(join(dir, INBOX_DIR))).toBe(true);
    const gi = readFileSync(join(dir, '.gitignore'), 'utf8');
    expect(gi.match(new RegExp(`^${INBOX_DIR}/`, 'gm'))?.length).toBe(1);
  });
});

describe('sanitizeName', () => {
  it('strips path separators and keeps a safe basename', () => {
    expect(sanitizeName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeName('a b/c?.png')).toBe('c_.png');
  });
});

describe('stageAttachment', () => {
  it('copies into the inbox and returns the project-relative path', () => {
    const src = join(dir, 'shot.png');
    writeFileSync(src, 'PNGDATA');
    const rel = stageAttachment(src, dir);
    expect(rel).toBe(`${INBOX_DIR}/shot.png`);
    expect(readFileSync(join(dir, rel), 'utf8')).toBe('PNGDATA');
  });

  it('suffixes on collision instead of overwriting', () => {
    const src = join(dir, 'shot.png');
    writeFileSync(src, 'A');
    stageAttachment(src, dir);
    writeFileSync(src, 'B');
    const rel2 = stageAttachment(src, dir);
    expect(rel2).toBe(`${INBOX_DIR}/shot-2.png`);
    expect(readFileSync(join(dir, `${INBOX_DIR}/shot.png`), 'utf8')).toBe('A');
  });

  it('rejects files over the size cap', () => {
    const src = join(dir, 'big.bin');
    writeFileSync(src, Buffer.alloc(MAX_ATTACHMENT_BYTES + 1));
    expect(() => stageAttachment(src, dir)).toThrow(/too large/i);
  });

  it('throws a clear error when the source is missing', () => {
    expect(() => stageAttachment(join(dir, 'nope.txt'), dir)).toThrow(/not found|no such/i);
  });
});

describe('remoteAttachmentPath', () => {
  it('posix-joins the remote project path with the staged relative path', () => {
    expect(remoteAttachmentPath('~/workspace/myapp', `${INBOX_DIR}/shot.png`))
      .toBe(`~/workspace/myapp/${INBOX_DIR}/shot.png`);
    expect(remoteAttachmentPath('/srv/app/', `${INBOX_DIR}/a.txt`))
      .toBe(`/srv/app/${INBOX_DIR}/a.txt`);
  });
});

describe('pruneInbox', () => {
  it('removes all files in the inbox but keeps the dir', () => {
    const src = join(dir, 'x.txt'); writeFileSync(src, 'x');
    stageAttachment(src, dir);
    pruneInbox(dir);
    expect(existsSync(join(dir, INBOX_DIR))).toBe(true);
    expect(readdirSync(join(dir, INBOX_DIR))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @rebink/patchwire test attachments`
Expected: FAIL — `ensureInbox is not a function` (module doesn't exist yet).

- [ ] **Step 3: Implement `attachments.ts`**

```ts
// packages/cli/src/lib/attachments.ts
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, statSync, readdirSync, rmSync,
} from 'node:fs';
import { basename, join } from 'node:path';

export const INBOX_DIR = '.patchwire-inbox';
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Create the inbox dir and ensure `.patchwire-inbox/` is gitignored. Idempotent. */
export function ensureInbox(projectDir: string): void {
  mkdirSync(join(projectDir, INBOX_DIR), { recursive: true });
  const giPath = join(projectDir, '.gitignore');
  const line = `${INBOX_DIR}/`;
  const existing = existsSync(giPath) ? readFileSync(giPath, 'utf8') : '';
  if (!existing.split(/\r?\n/).some((l) => l.trim() === line)) {
    writeFileSync(giPath, (existing && !existing.endsWith('\n') ? existing + '\n' : existing) + line + '\n');
  }
}

/** Strip path separators / unsafe chars down to a safe basename. */
export function sanitizeName(name: string): string {
  return basename(name).replace(/[^A-Za-z0-9._-]/g, '_');
}

/** Copy `localPath` into the inbox (collision-safe). Returns the project-relative path. */
export function stageAttachment(localPath: string, projectDir: string): string {
  if (!existsSync(localPath)) throw new Error(`Attachment not found: ${localPath}`);
  if (statSync(localPath).size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Attachment too large (> ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB): ${localPath}`);
  }
  ensureInbox(projectDir);
  const safe = sanitizeName(localPath);
  const dot = safe.lastIndexOf('.');
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : '';
  let name = safe;
  for (let n = 2; existsSync(join(projectDir, INBOX_DIR, name)); n++) name = `${stem}-${n}${ext}`;
  copyFileSync(localPath, join(projectDir, INBOX_DIR, name));
  return `${INBOX_DIR}/${name}`;
}

/** posix-join the remote project path with a staged relative path. */
export function remoteAttachmentPath(remoteProjectPath: string, relPath: string): string {
  return `${remoteProjectPath.replace(/\/+$/, '')}/${relPath}`;
}

/** Empty the inbox (keep the dir). */
export function pruneInbox(projectDir: string): void {
  const inbox = join(projectDir, INBOX_DIR);
  if (!existsSync(inbox)) return;
  for (const f of readdirSync(inbox)) rmSync(join(inbox, f), { recursive: true, force: true });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @rebink/patchwire test attachments`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/attachments.ts packages/cli/test/attachments.test.ts
git commit -m "feat(cli): shared .patchwire-inbox attachment helpers"
```

---

## Task 2: `patchwire push` command

**Files:**
- Create: `packages/cli/src/commands/push.ts`
- Test: `packages/cli/test/push.test.ts`
- Modify: `packages/cli/src/cli.ts`

**Context:** Mirror the SSH/key/remote-target construction used by `rsyncPush` in `packages/cli/src/lib/rsync.ts` (key at `~/.patchwire/keys/<host>-<user>`, `-i key`, `-p sshPort`, target `user@host:path`). Use the existing `runSsh` (`packages/cli/src/lib/ssh-runner.ts`) to `mkdir -p` the remote inbox before rsyncing. `loadConfig` is in `packages/cli/src/lib/config.ts`. `log` is in `packages/cli/src/lib/log.ts`.

- [ ] **Step 1: Write the failing test for the pure transfer-plan builder**

We isolate the testable decision/argv logic into a pure helper so it needs no network.

```ts
// packages/cli/test/push.test.ts
import { describe, it, expect } from 'vitest';
import { buildPushPlan } from '../src/commands/push.ts';

const cfg = {
  project: 'myapp',
  remote: { host: 'mini', user: 'admin', path: '~/workspace/myapp', agentUrl: 'http://mini:7878', token: 't', sshPort: 2222 },
  sync: { exclude: [], secretScan: 'off' as const },
  ai: { command: 'claude', args: ['--print'], timeoutSec: 600 },
};

describe('buildPushPlan', () => {
  it('returns the remote inbox path and the ssh + rsync argv for a staged file', () => {
    const plan = buildPushPlan(cfg, '.patchwire-inbox/shot.png', '/home/me/.patchwire/keys/mini-admin');
    expect(plan.remotePath).toBe('~/workspace/myapp/.patchwire-inbox/shot.png');
    expect(plan.sshArg).toContain('-i /home/me/.patchwire/keys/mini-admin');
    expect(plan.sshArg).toContain('-p 2222');
    expect(plan.mkdirTarget).toBe('~/workspace/myapp/.patchwire-inbox');
    // rsync argv carries the -e ssh arg, the local staged file, and the remote inbox dir target
    expect(plan.rsyncArgs).toContain('-e');
    expect(plan.rsyncArgs.some((a) => a.endsWith('.patchwire-inbox/shot.png'))).toBe(true);
    expect(plan.rsyncArgs[plan.rsyncArgs.length - 1]).toBe('admin@mini:~/workspace/myapp/.patchwire-inbox/');
  });

  it('omits -p when sshPort is unset', () => {
    const c2 = { ...cfg, remote: { ...cfg.remote, sshPort: undefined } };
    const plan = buildPushPlan(c2, '.patchwire-inbox/a.txt', '/k');
    expect(plan.sshArg).not.toContain('-p ');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @rebink/patchwire test push`
Expected: FAIL — `buildPushPlan is not a function`.

- [ ] **Step 3: Implement `push.ts`**

```ts
// packages/cli/src/commands/push.ts
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { loadConfig, type Config } from '../lib/config.ts';
import { stageAttachment, remoteAttachmentPath, pruneInbox, INBOX_DIR } from '../lib/attachments.ts';
import { runSsh } from '../lib/ssh-runner.ts';
import { log } from '../lib/log.ts';

export interface PushPlan {
  remotePath: string;
  sshArg: string;
  mkdirTarget: string;
  rsyncArgs: string[];
}

/** Pure: build the remote path + ssh/rsync argv for a single staged file. */
export function buildPushPlan(cfg: Config, relPath: string, keyPath: string): PushPlan {
  const remotePath = remoteAttachmentPath(cfg.remote.path, relPath);
  const mkdirTarget = remoteAttachmentPath(cfg.remote.path, INBOX_DIR);
  const sshParts = ['ssh', '-i', keyPath];
  if (cfg.remote.sshPort) sshParts.push('-p', String(cfg.remote.sshPort));
  const sshArg = sshParts.join(' ');
  const localStaged = relPath; // resolved against cwd by the caller
  const rsyncArgs = [
    '-az', '-e', sshArg, localStaged,
    `${cfg.remote.user}@${cfg.remote.host}:${remoteAttachmentPath(cfg.remote.path, INBOX_DIR)}/`,
  ];
  return { remotePath, sshArg, mkdirTarget, rsyncArgs };
}

export interface PushOpts { stageOnly?: boolean; json?: boolean; clip?: boolean; clean?: boolean }

function clipboardImageToTemp(): string {
  const out = join(tmpdir(), `pw-clip-${process.pid}.png`);
  // Prefer pngpaste; fall back to osascript clipboard export.
  if (spawnSync('pngpaste', [out]).status === 0 && existsSync(out)) return out;
  const script = `set p to (POSIX file "${out}")
set d to the clipboard as «class PNGf»
set f to open for access p with write permission
write d to f
close access f`;
  const r = spawnSync('osascript', ['-e', script]);
  if (r.status !== 0 || !existsSync(out)) throw new Error('No image in the clipboard (need a copied screenshot).');
  return out;
}

export async function runPush(cwd: string, files: string[], opts: PushOpts = {}): Promise<void> {
  const cfg = await loadConfig(cwd);

  if (opts.clean) {
    pruneInbox(cwd);
    if (!opts.stageOnly) {
      const keyPath = join(homedir(), '.patchwire', 'keys', `${cfg.remote.host}-${cfg.remote.user}`);
      await runSsh({ host: cfg.remote.host, user: cfg.remote.user, port: cfg.remote.sshPort ?? 22, keyPath,
        command: `rm -rf ${remoteAttachmentPath(cfg.remote.path, INBOX_DIR)}` });
    }
    if (!opts.json) log.ok('Cleared attachments inbox.');
    return;
  }

  const sources = opts.clip ? [clipboardImageToTemp()] : files;
  if (sources.length === 0) { log.err('No file to push. Pass a path or --clip.'); process.exitCode = 1; return; }

  const keyPath = join(homedir(), '.patchwire', 'keys', `${cfg.remote.host}-${cfg.remote.user}`);
  const results: string[] = [];
  for (const src of sources) {
    const rel = stageAttachment(resolve(cwd, src), cwd);
    const plan = buildPushPlan(cfg, rel, keyPath);
    if (!opts.stageOnly) {
      await runSsh({ host: cfg.remote.host, user: cfg.remote.user, port: cfg.remote.sshPort ?? 22, keyPath,
        command: `mkdir -p ${plan.mkdirTarget}` });
      await new Promise<void>((res, rej) => {
        const child = spawn('rsync', [plan.rsyncArgs[0]!, ...plan.rsyncArgs.slice(1, -2), join(cwd, rel), plan.rsyncArgs[plan.rsyncArgs.length - 1]!], { stdio: 'inherit' });
        child.on('error', rej);
        child.on('close', (c) => (c === 0 ? res() : rej(new Error(`rsync exited ${c}`))));
      });
    }
    results.push(plan.remotePath);
  }

  if (opts.json) { process.stdout.write(JSON.stringify({ remotePath: results[0], remotePaths: results }) + '\n'); return; }
  for (const r of results) log.ok(`Attachment ready on remote: ${r}`);
  log.dim('Paste that path into your claude session.');
}
```

> Note: the rsync invocation passes the absolute local staged path (`join(cwd, rel)`); `buildPushPlan.rsyncArgs` is the testable shape (relative `localStaged`), and `runPush` substitutes the absolute path when spawning. Keep `buildPushPlan` pure (no fs) so the test stays network-free.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @rebink/patchwire test push`
Expected: PASS.

- [ ] **Step 5: Register the command in `cli.ts`**

Add near the other commands in `packages/cli/src/cli.ts` (after the `apply` command), and import `runPush`:

```ts
import { runPush } from './commands/push.ts';
// ...
program
  .command('push')
  .description('Copy a local file to the remote so the SSH claude session can read it')
  .argument('[files...]', 'local file path(s) to push')
  .option('--stage-only', 'stage into .patchwire-inbox/ but skip rsync (transfer handled externally, e.g. Mutagen)')
  .option('--json', 'emit {"remotePath":…} as JSON')
  .option('--clip', 'push the current clipboard image (screenshot)')
  .option('--clean', 'clear the local (and remote) attachments inbox')
  .action(async (files: string[], opts: { stageOnly?: boolean; json?: boolean; clip?: boolean; clean?: boolean }) => {
    await runPush(process.cwd(), files ?? [], {
      stageOnly: opts.stageOnly, json: opts.json, clip: opts.clip, clean: opts.clean,
    });
  });
```

- [ ] **Step 6: Typecheck + full suite**

Run: `pnpm --filter @rebink/patchwire typecheck && pnpm --filter @rebink/patchwire test`
Expected: typecheck clean; suite passes (no regression).

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/commands/push.ts packages/cli/test/push.test.ts packages/cli/src/cli.ts
git commit -m "feat(cli): patchwire push — copy a local file to the remote inbox (+ --clip/--clean/--stage-only/--json)"
```

---

## Task 3: Extension `attachFile` host logic

**Files:**
- Create: `packages/extension/src/attach/attachFile.ts`
- Test: `packages/extension/src/attach/attachFile.test.ts`

**Context:** Follow the existing `resolveCli` pattern (`packages/extension/src/cli/resolveCli.ts`) to build the CLI invocation, and inject dependencies so the test can stub the CLI spawn, the Mutagen flush, and the vscode terminal/clipboard. The existing `vscode` stub lives at `packages/extension/src/test/vscode-stub.ts`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/extension/src/attach/attachFile.test.ts
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
  });

  it('surfaces a clear error if staging fails', async () => {
    const d = deps({ runCliJson: vi.fn(async () => { throw new Error('No image in the clipboard'); }) });
    await attachFile(null, d, { clip: true });
    expect(d.notify).toHaveBeenCalledWith(expect.stringMatching(/No image in the clipboard/));
    expect(d.sendToTerminal).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter patchwire-vscode test attachFile`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `attachFile.ts`**

```ts
// packages/extension/src/attach/attachFile.ts
export interface AttachDeps {
  /** Spawn the bundled CLI with args; resolve its parsed JSON stdout. */
  runCliJson: (args: string[]) => Promise<{ remotePath: string }>;
  /** Force a Mutagen sync flush so the staged file reaches the remote. */
  flushSync: () => Promise<void>;
  /** Type text into the active claude session terminal. Returns false if none is open. */
  sendToTerminal: (text: string) => boolean;
  /** Copy text to the clipboard (fallback when no terminal). */
  copyToClipboard: (text: string) => Promise<void>;
  /** Show a message to the developer. */
  notify: (message: string) => void;
}

/**
 * Stage a local file (or clipboard image) for the remote claude session:
 * CLI stages into .patchwire-inbox/ → flush sync → type the remote path into the
 * REPL (or copy it to the clipboard if no session terminal is open).
 */
export async function attachFile(
  localPath: string | null,
  deps: AttachDeps,
  opts: { clip?: boolean } = {},
): Promise<void> {
  try {
    const args = opts.clip
      ? ['push', '--clip', '--stage-only', '--json']
      : ['push', localPath!, '--stage-only', '--json'];
    const { remotePath } = await deps.runCliJson(args);
    await deps.flushSync();
    if (deps.sendToTerminal(remotePath)) return;
    await deps.copyToClipboard(remotePath);
    deps.notify(`Attachment synced — remote path copied to clipboard: ${remotePath}`);
  } catch (err) {
    deps.notify(`Attach failed: ${(err as Error).message}`);
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter patchwire-vscode test attachFile`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/attach/attachFile.ts packages/extension/src/attach/attachFile.test.ts
git commit -m "feat(extension): attachFile host logic (stage via CLI → flush → sendText/clipboard)"
```

---

## Task 4: Wire the extension commands + webview button

**Files:**
- Modify: `packages/extension/src/commands.ts`
- Modify: `packages/extension/src/chat/ChatPanel.ts`
- Modify: `packages/extension/src/chat/webview/main.ts`
- Modify: `packages/extension/package.json`

**Context:** This task is integration glue (no new pure logic), so it's verified by typecheck + build + manual smoke. Use `vscode.window.showOpenDialog` for the picker, `vscode.window.activeTerminal`/`findExistingSessionTerminal` for the terminal, `vscode.env.clipboard.writeText` for clipboard, and `resolveCli(extensionUri.fsPath)` to spawn the CLI (parse JSON from stdout).

- [ ] **Step 1: Build the `AttachDeps` from vscode + register `patchwire.attachFile`/`patchwire.attachClipboardImage` in `commands.ts`**

```ts
// packages/extension/src/commands.ts — add inside the registration function
import { attachFile, type AttachDeps } from './attach/attachFile.ts';
import { resolveCli } from './cli/resolveCli.ts';
import { findExistingSessionTerminal } from './session/sessionTerminal.ts';
import { spawn } from 'node:child_process';
// ...
function makeAttachDeps(context: vscode.ExtensionContext, cwd: string, project: string): AttachDeps {
  const inv = resolveCli(context.extensionUri.fsPath);
  return {
    runCliJson: (args) => new Promise((res, rej) => {
      const child = spawn(inv.command, [...inv.baseArgs, ...args], { cwd, env: inv.env });
      let out = ''; let err = '';
      child.stdout.on('data', (b) => (out += b.toString()));
      child.stderr.on('data', (b) => (err += b.toString()));
      child.on('error', rej);
      child.on('close', (c) => {
        if (c !== 0) return rej(new Error(err.trim() || `patchwire push exited ${c}`));
        try { res(JSON.parse(out.trim().split('\n').pop() || '{}')); }
        catch { rej(new Error(`Unexpected CLI output: ${out.trim()}`)); }
      });
    }),
    flushSync: async () => { await vscode.commands.executeCommand('patchwire.flushSync'); },
    sendToTerminal: (text) => {
      const term = findExistingSessionTerminal(project) ?? vscode.window.activeTerminal;
      if (!term) return false;
      term.show(); term.sendText(text, false); return true;
    },
    copyToClipboard: (text) => Promise.resolve(vscode.env.clipboard.writeText(text)),
    notify: (m) => vscode.window.showInformationMessage(m),
  };
}

context.subscriptions.push(
  vscode.commands.registerCommand('patchwire.attachFile', async () => {
    const ws = vscode.workspace.workspaceFolders?.[0]; if (!ws) return;
    const project = /* read patchwire.yml project, reuse existing loader */ ws.name;
    const picked = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Attach to claude' });
    if (!picked?.[0]) return;
    await attachFile(picked[0].fsPath, makeAttachDeps(context, ws.uri.fsPath, project));
  }),
  vscode.commands.registerCommand('patchwire.attachClipboardImage', async () => {
    const ws = vscode.workspace.workspaceFolders?.[0]; if (!ws) return;
    const project = ws.name;
    await attachFile(null, makeAttachDeps(context, ws.uri.fsPath, project), { clip: true });
  }),
);
```

> If `patchwire.flushSync` isn't already a registered command, route the flush through the `ChatPanel` instance instead (it owns the `MutagenController`): expose a `ChatPanel.flush()` and call it here. Check `extension.ts` for how `ChatPanel` is constructed and reuse that reference.

- [ ] **Step 2: Declare the commands in `package.json`**

```jsonc
// packages/extension/package.json → contributes.commands [], add:
{ "command": "patchwire.attachFile", "title": "Patchwire: Attach file to claude session", "category": "Patchwire" },
{ "command": "patchwire.attachClipboardImage", "title": "Patchwire: Attach clipboard image to claude session", "category": "Patchwire" }
```

- [ ] **Step 3: Add the "📎 Attach file" button to the webview**

In `packages/extension/src/chat/webview/main.ts`, where the session controls render (near the `openSession` button), add:

```ts
h('button', {
  className: 'attach',
  events: { click: () => vscode.postMessage({ type: 'attachFile' }) },
}, '📎 Attach file'),
```

And in `packages/extension/src/chat/ChatPanel.ts`, extend the `onDidReceiveMessage` switch:

```ts
case 'attachFile': return vscode.commands.executeCommand('patchwire.attachFile');
```

- [ ] **Step 4: Typecheck + build the extension (re-bundles CLI)**

Run: `pnpm --filter patchwire-vscode typecheck && pnpm --filter patchwire-vscode build`
Expected: typecheck clean; `bundled cli.js → dist/cli/cli.js`.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/commands.ts packages/extension/src/chat/ChatPanel.ts packages/extension/src/chat/webview/main.ts packages/extension/package.json
git commit -m "feat(extension): 📎 Attach file/clipboard image → stage + flush + type remote path into session"
```

---

## Task 5: Cleanup-on-session-start + docs

**Files:**
- Modify: `packages/extension/src/chat/ChatPanel.ts` (or wherever a session is opened — `openSession` handler)
- Modify: `packages/cli/src/commands/push.ts` (already has `--clean`)
- Modify: docs (website) — follow-up PR, not in this branch

- [ ] **Step 1: Prune the inbox when a session terminal is opened**

In the `ChatPanel.handleOpenSession()` path (before/after `openSessionTerminal`), call the CLI once to prune so old attachments don't accumulate:

```ts
// fire-and-forget; never block opening the session
try { this.deps /* spawn */; await runCliPrune(); } catch { /* non-fatal */ }
```

Implement `runCliPrune` as a thin spawn of `patchwire push --clean --stage-only --json` in the workspace (stage-only so it only clears the *local* inbox; Mutagen propagates the deletion). Keep it best-effort and non-blocking.

- [ ] **Step 2: Typecheck + build**

Run: `pnpm --filter patchwire-vscode typecheck && pnpm --filter patchwire-vscode build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/extension/src/chat/ChatPanel.ts
git commit -m "feat(extension): prune attachment inbox when a session opens"
```

- [ ] **Step 4: Lockstep version bump (do at release time, not now)**

When ready to release: bump `packages/cli/package.json`, `packages/cli/src/version.ts`, `packages/cli/test/version.test.ts`, `packages/extension/package.json`, and add a CHANGELOG entry. (Coordinate with the in-flight 0.3.5 egress release — this feature lands in the version after whatever ships next.)

---

## Manual verification (on the Mac Mini — cannot be automated here)
- `patchwire push ~/Desktop/shot.png` prints a remote path; `claude` over SSH can read it.
- `patchwire push --clip` after copying a screenshot pushes the image; `claude` reads it for **vision**.
- Extension: open a session, click **📎 Attach file**, pick an image → the remote `.patchwire-inbox/…` path types into the `claude` terminal → send → claude sees the image.
- Confirm `.patchwire-inbox/` is gitignored and a subsequent `patchwire ask` diff does **not** include it.

---

## Self-review notes
- **Spec coverage:** ensureInbox/gitignore (T1), sanitize/collision/size-cap (T1), remoteAttachmentPath (T1), pruneInbox (T1+T5), CLI push + `--stage-only`/`--json`/`--clip`/`--clean` (T2), extension attach via CLI spawn + flush + sendText + clipboard fallback (T3+T4), webview button + commands (T4), cleanup-on-session-start (T5). All spec requirements mapped.
- **Type consistency:** `AttachDeps` fields (`runCliJson`, `flushSync`, `sendToTerminal`, `copyToClipboard`, `notify`) are identical in T3 and T4; `buildPushPlan`/`PushPlan` fields match between T2 test and impl; `INBOX_DIR`/`remoteAttachmentPath` reused everywhere.
- **No placeholders:** every code step shows complete code; the only deferred item is the release version bump (T5 step 4), intentionally timed with the release.
