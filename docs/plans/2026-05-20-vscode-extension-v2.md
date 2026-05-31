# Remote Claude — VS Code Extension v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a chat-first VS Code extension that wraps the `remote-claude` CLI, with password-once SSH onboarding, Git-URL project bootstrap on both sides, multi-turn chat via `claude --resume`, per-project live-sync toggle, and reviewable diff cards — driven by the Flutter physical-device use case.

**Architecture:** Extension spawns the local `remote-claude` CLI sidecar (child process, JSONL over stdout). CLI handles all SSH/rsync/HTTP transport and talks to a Fastify agent on the Mac Mini. The agent streams chat turns from `claude --resume`, returns unified git patches that are never auto-applied on the remote, and resets the working tree between turns. The laptop is always the source of truth; commits happen locally with the developer's git identity.

**Tech Stack:** TypeScript, Node ≥ 20, Fastify (agent), Commander (CLI), VS Code Extension API ≥ 1.80, React + Tailwind (webview), pnpm workspaces, vitest, `@vscode/test-electron`, vendored `sshpass`.

**Spec:** [`docs/specs/2026-05-20-vscode-extension-v2-design.md`](../specs/2026-05-20-vscode-extension-v2-design.md)

---

## Suggested execution slicing

Each milestone ends in a state where the work is independently testable:

| Milestone | Outcome | Ship gate |
|---|---|---|
| **M1: Workspace + Transport** (Tasks 1–14) | CLI + agent support all new endpoints; testable via terminal | Run `remote-claude chat` from CLI against a real Mac Mini, get a diff back |
| **M2: Extension foundation** (Tasks 15–19) | Extension activates, spawns CLI, parses events, can apply patches | "Hello World" command works in dev host |
| **M3: Chat panel UI** (Tasks 20–24) | Multi-turn chat with diff cards | Send a prompt, see streaming reply, apply a diff |
| **M4: Sync engine + indicators** (Tasks 25–28) | Live-sync toggle, file decorations, status bar, ask-time guard | Toggle live-sync on, edit file, watch it rsync |
| **M5: Setup wizard** (Tasks 29–33) | Onboarding works end-to-end from a fresh workspace | Open empty repo, complete wizard, send first chat |
| **M6: Resilience** (Tasks 34–36) | Cancellation, reload reconciliation, smoke test in CI | `pnpm verify` green |

You can stop after any milestone. Milestone 1 alone is useful to other tooling teams; M1+M2+M3 is a usable preview; M1–M5 is the v1.0 ship; M6 is hardening.

---

## Conventions

**Commit cadence:** every task ends with a commit. Use Conventional Commits prefixes (`feat:`, `fix:`, `test:`, `refactor:`, `chore:`).

**Test runner:** `pnpm --filter <pkg> test -- <pattern>` for filtered runs. From repo root, `pnpm -r test` runs everything.

**Type strictness:** `strict: true` in both packages. Never use `any` outside of `*.test.ts` mocking edges.

**Imports:** ESM throughout. CLI uses `.ts` import specifiers (existing pattern); extension uses bare specifiers compiled by tsup.

**Logging:** CLI uses `src/lib/log.ts` (existing chalk wrapper). Extension uses an OutputChannel named `Remote Claude`. Never `console.log` in either.

---

## Milestone 1 — Workspace + Transport Foundation

### Task 1: Convert repo to pnpm workspace

**Files:**
- Create: `pnpm-workspace.yaml`
- Modify: `package.json` (root) — gain `"private": false` stays, no other change yet (extension package added in Task 2)

- [ ] **Step 1: Create pnpm-workspace.yaml**

```yaml
packages:
  - '.'
  - 'extension'
```

- [ ] **Step 2: Verify pnpm picks it up**

Run: `pnpm -r ls --depth -1`
Expected: lists `remote-claude` (the root). Errors about `extension` are fine — that dir doesn't exist yet.

- [ ] **Step 3: Commit**

```bash
git add pnpm-workspace.yaml
git commit -m "chore: convert repo to pnpm workspace"
```

---

### Task 2: Scaffold the extension package

**Files:**
- Create: `extension/package.json`
- Create: `extension/tsconfig.json`
- Create: `extension/.vscodeignore`
- Create: `extension/src/extension.ts`
- Create: `extension/README.md`

- [ ] **Step 1: Create extension/package.json**

```json
{
  "name": "remote-claude-vscode",
  "displayName": "Remote Claude",
  "description": "Chat with Claude on a remote Mac Mini from VS Code.",
  "version": "0.1.0",
  "publisher": "remote-claude",
  "private": true,
  "engines": { "vscode": "^1.80.0", "node": ">=20" },
  "categories": ["AI", "Other"],
  "main": "./dist/extension.cjs",
  "activationEvents": ["onStartupFinished"],
  "contributes": {
    "commands": [
      { "command": "remoteClaude.openSetup", "title": "Remote Claude: Setup…" },
      { "command": "remoteClaude.newChat", "title": "Remote Claude: New Chat" },
      { "command": "remoteClaude.toggleLiveSync", "title": "Remote Claude: Toggle Live Sync" },
      { "command": "remoteClaude.viewOutput", "title": "Remote Claude: Show Output" }
    ],
    "viewsContainers": {
      "activitybar": [
        { "id": "remoteClaude", "title": "Remote Claude", "icon": "$(comment-discussion)" }
      ]
    },
    "views": {
      "remoteClaude": [
        { "type": "webview", "id": "remoteClaude.chatPanel", "name": "Chat" }
      ]
    }
  },
  "scripts": {
    "build": "tsup src/extension.ts --format cjs --external vscode --out-dir dist",
    "dev": "tsup src/extension.ts --format cjs --external vscode --out-dir dist --watch",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "package": "vsce package"
  },
  "devDependencies": {
    "@types/node": "^20.14.10",
    "@types/vscode": "^1.80.0",
    "@vscode/test-electron": "^2.4.1",
    "tsup": "^8.2.4",
    "typescript": "^5.5.3",
    "vitest": "^2.0.4"
  },
  "remoteClaude": {
    "minimumCliVersion": "0.2.0"
  }
}
```

- [ ] **Step 2: Create extension/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create extension/.vscodeignore**

```
src/**
tsconfig.json
node_modules/**
.vscode-test/**
**/*.test.ts
```

- [ ] **Step 4: Create extension/src/extension.ts (stub)**

```ts
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Remote Claude');
  context.subscriptions.push(output);

  context.subscriptions.push(
    vscode.commands.registerCommand('remoteClaude.viewOutput', () => output.show())
  );

  output.appendLine('Remote Claude extension activated.');
}

export function deactivate(): void {}
```

- [ ] **Step 5: Create extension/README.md (one-line)**

```markdown
# Remote Claude VS Code Extension

See [`../specs/2026-05-20-vscode-extension-v2-design.md`](../specs/2026-05-20-vscode-extension-v2-design.md).
```

- [ ] **Step 6: Install + build to verify**

Run: `pnpm install && pnpm --filter remote-claude-vscode build`
Expected: `dist/extension.cjs` exists; no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add extension/ pnpm-lock.yaml package.json
git commit -m "feat(extension): scaffold remote-claude-vscode package"
```

---

### Task 3: Vendor sshpass binary

**Files:**
- Create: `scripts/fetch-sshpass.sh`
- Modify: `package.json` (add `postinstall` script + `optionalDependencies` note)
- Create: `vendor/sshpass/.gitkeep`
- Modify: `.gitignore` — add `vendor/sshpass/sshpass-*`

- [ ] **Step 1: Create scripts/fetch-sshpass.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

VENDOR_DIR="$(cd "$(dirname "$0")/.." && pwd)/vendor/sshpass"
mkdir -p "$VENDOR_DIR"

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)  PLATFORM=darwin-arm64 ;;
  Darwin-x86_64) PLATFORM=darwin-x64 ;;
  Linux-x86_64)  PLATFORM=linux-x64 ;;
  *) echo "Unsupported platform: $(uname -s)-$(uname -m)" >&2; exit 0 ;;
esac

BIN="$VENDOR_DIR/sshpass-$PLATFORM"
if [ -x "$BIN" ]; then
  echo "sshpass already vendored at $BIN"
  exit 0
fi

if command -v sshpass >/dev/null 2>&1; then
  cp "$(command -v sshpass)" "$BIN"
  chmod +x "$BIN"
  echo "Copied system sshpass → $BIN"
else
  echo "sshpass not installed locally; setup wizard will prompt at first run." >&2
fi
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/fetch-sshpass.sh`

- [ ] **Step 3: Modify package.json**

Add to `scripts` block:
```json
"postinstall": "bash scripts/fetch-sshpass.sh || true"
```

- [ ] **Step 4: Modify .gitignore**

Append:
```
vendor/sshpass/sshpass-*
```

- [ ] **Step 5: Create placeholder for git tracking**

Run: `mkdir -p vendor/sshpass && touch vendor/sshpass/.gitkeep`

- [ ] **Step 6: Verify on this machine**

Run: `bash scripts/fetch-sshpass.sh && ls -l vendor/sshpass/`
Expected: prints either "Copied system sshpass" or the no-op message, no error.

- [ ] **Step 7: Commit**

```bash
git add scripts/fetch-sshpass.sh package.json .gitignore vendor/sshpass/.gitkeep
git commit -m "chore: add sshpass vendoring script"
```

---

### Task 4: sshpass wrapper module

**Files:**
- Create: `src/lib/sshpass.ts`
- Create: `test/lib/sshpass.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/lib/sshpass.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveSshpassPath, copyIdWithPassword } from '../../src/lib/sshpass.ts';
import * as fs from 'node:fs';
import * as cp from 'node:child_process';

vi.mock('node:child_process');

describe('resolveSshpassPath', () => {
  it('returns the platform-specific vendored path when it exists', () => {
    vi.spyOn(fs, 'existsSync').mockImplementation(
      (p) => String(p).endsWith(`sshpass-${process.platform}-${process.arch}`)
    );
    const out = resolveSshpassPath();
    expect(out).toMatch(/sshpass-/);
  });

  it('throws when no vendored or system binary is found', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.spyOn(cp, 'spawnSync').mockReturnValue({
      status: 1, stdout: Buffer.from(''), stderr: Buffer.from(''),
      pid: 0, output: [], signal: null,
    } as cp.SpawnSyncReturns<Buffer>);
    expect(() => resolveSshpassPath()).toThrow(/sshpass not found/);
  });
});

describe('copyIdWithPassword', () => {
  it('passes password via fd, never as argv', async () => {
    const spawnSpy = vi.spyOn(cp, 'spawn').mockReturnValue({
      stdin: { write: vi.fn(), end: vi.fn() },
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: (event: string, cb: (code: number) => void) => {
        if (event === 'close') queueMicrotask(() => cb(0));
      },
    } as any);
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);

    await copyIdWithPassword({
      host: 'mac-mini',
      user: 'rebin',
      port: 22,
      keyPath: '/tmp/id_test',
      password: 'secret',
    });

    const call = spawnSpy.mock.calls[0];
    expect(call[1]).not.toContain('secret');
    expect(call[1]?.join(' ')).toMatch(/-d/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- sshpass`
Expected: FAIL — `Cannot find module './src/lib/sshpass.ts'`.

- [ ] **Step 3: Implement src/lib/sshpass.ts**

```ts
import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function resolveSshpassPath(): string {
  const platformKey = `${process.platform}-${process.arch}`;
  const vendored = join(__dirname, '..', '..', 'vendor', 'sshpass', `sshpass-${platformKey}`);
  if (existsSync(vendored)) return vendored;

  const system = spawnSync('which', ['sshpass'], { encoding: 'utf8' });
  if (system.status === 0 && system.stdout.trim()) return system.stdout.trim();

  throw new Error(
    'sshpass not found. Install with: brew install hudochenkov/sshpass/sshpass (macOS) or apt-get install sshpass (Linux).'
  );
}

export interface CopyIdInput {
  host: string;
  user: string;
  port: number;
  keyPath: string;       // path to .pub key
  password: string;      // zeroed by caller after this returns
}

export type CopyIdResult =
  | { ok: true }
  | { ok: false; code: 'auth_failed' | 'unreachable' | 'host_key_mismatch' | 'unknown'; stderr: string };

export async function copyIdWithPassword(input: CopyIdInput): Promise<CopyIdResult> {
  const sshpass = resolveSshpassPath();
  const args = [
    '-d0',                                  // password on fd 0 (stdin)
    'ssh-copy-id',
    '-i', `${input.keyPath}.pub`,
    '-p', String(input.port),
    '-o', 'StrictHostKeyChecking=accept-new',
    `${input.user}@${input.host}`,
  ];

  return new Promise((resolve) => {
    const child = spawn(sshpass, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });

    child.stdin.write(input.password + '\n');
    child.stdin.end();

    child.on('close', (code: number | null) => {
      if (code === 0) return resolve({ ok: true });
      if (/Permission denied/i.test(stderr)) return resolve({ ok: false, code: 'auth_failed', stderr });
      if (/Connection refused|No route to host|Could not resolve/i.test(stderr))
        return resolve({ ok: false, code: 'unreachable', stderr });
      if (/REMOTE HOST IDENTIFICATION HAS CHANGED|host key/i.test(stderr))
        return resolve({ ok: false, code: 'host_key_mismatch', stderr });
      resolve({ ok: false, code: 'unknown', stderr });
    });
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- sshpass`
Expected: PASS, 3/3.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sshpass.ts test/lib/sshpass.test.ts
git commit -m "feat(cli): add sshpass wrapper for password-once ssh-copy-id"
```

---

### Task 5: `setup --list-peers --json`

**Files:**
- Modify: `src/lib/tailscale.ts` (existing) — export a structured peer list
- Modify: `src/commands/setup.ts` — add `--list-peers --json` mode
- Modify: `src/cli.ts` — register the new flag
- Create: `test/commands/setup-list-peers.test.ts`

- [ ] **Step 1: Read existing tailscale.ts to find current peer parser**

Run: `grep -n "export" src/lib/tailscale.ts`
Expected: an existing `getPeers()` or similar. If absent, define a fresh one.

- [ ] **Step 2: Write failing test**

```ts
// test/commands/setup-list-peers.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runSetupListPeers } from '../../src/commands/setup.ts';
import * as ts from '../../src/lib/tailscale.ts';

describe('setup --list-peers --json', () => {
  it('emits a JSON array of {host, hostname, online, lastSeen}', async () => {
    vi.spyOn(ts, 'getPeers').mockResolvedValue([
      { hostname: 'mac-mini', host: 'mac-mini.tail-abc.ts.net', online: true, lastSeen: '2026-05-20T12:00:00Z' },
    ]);
    const out: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: any) => { out.push(String(chunk)); return true; };

    await runSetupListPeers();

    process.stdout.write = origWrite;
    const parsed = JSON.parse(out.join(''));
    expect(parsed).toEqual([
      { hostname: 'mac-mini', host: 'mac-mini.tail-abc.ts.net', online: true, lastSeen: '2026-05-20T12:00:00Z' },
    ]);
  });
});
```

- [ ] **Step 3: Run test — expect FAIL**

Run: `pnpm test -- setup-list-peers`
Expected: FAIL — `runSetupListPeers is not a function`.

- [ ] **Step 4: Implement in src/commands/setup.ts**

Append:

```ts
import { getPeers } from '../lib/tailscale.ts';

export async function runSetupListPeers(): Promise<void> {
  const peers = await getPeers();
  process.stdout.write(JSON.stringify(peers));
}
```

If `getPeers` doesn't exist in `src/lib/tailscale.ts`, add it:

```ts
export interface TailscalePeer {
  hostname: string;
  host: string;        // magic DNS hostname or IP
  online: boolean;
  lastSeen: string;    // ISO 8601
}

export async function getPeers(): Promise<TailscalePeer[]> {
  const { spawnSync } = await import('node:child_process');
  const res = spawnSync('tailscale', ['status', '--json'], { encoding: 'utf8' });
  if (res.status !== 0) return [];
  const json = JSON.parse(res.stdout);
  const peers: TailscalePeer[] = [];
  for (const id in json.Peer ?? {}) {
    const p = json.Peer[id];
    peers.push({
      hostname: p.HostName,
      host: p.DNSName?.replace(/\.$/, '') || p.TailscaleIPs?.[0] || p.HostName,
      online: !!p.Online,
      lastSeen: p.LastSeen || '',
    });
  }
  return peers;
}
```

- [ ] **Step 5: Register flag in src/cli.ts**

In the existing `setup` Commander definition, add:

```ts
.option('--list-peers', 'print Tailscale peers and exit')
.option('--json', 'machine-readable output (for --list-peers)')
```

And in the action:

```ts
if (opts.listPeers) {
  const { runSetupListPeers } = await import('./commands/setup.ts');
  await runSetupListPeers();
  return;
}
```

- [ ] **Step 6: Run tests**

Run: `pnpm test -- setup-list-peers`
Expected: PASS.

- [ ] **Step 7: Manual smoke**

Run: `pnpm dev:cli setup --list-peers --json`
Expected: prints `[]` (or your real peers).

- [ ] **Step 8: Commit**

```bash
git add src/cli.ts src/commands/setup.ts src/lib/tailscale.ts test/commands/setup-list-peers.test.ts
git commit -m "feat(cli): add setup --list-peers --json for wizard peer picking"
```

---

### Task 6: `setup --password-stdin`

**Files:**
- Modify: `src/commands/setup.ts`
- Modify: `src/cli.ts`
- Create: `test/commands/setup-password-stdin.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/commands/setup-password-stdin.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runSetupPasswordStdin } from '../../src/commands/setup.ts';
import * as sshpass from '../../src/lib/sshpass.ts';
import * as fs from 'node:fs';

describe('setup --password-stdin', () => {
  it('reads password from stdin, calls copyIdWithPassword, zeroes buffer, prints JSON result', async () => {
    const copySpy = vi.spyOn(sshpass, 'copyIdWithPassword').mockResolvedValue({ ok: true });
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);

    const stdin = new (await import('node:stream')).PassThrough();
    process.stdin = stdin as any;

    const writes: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (c: any) => { writes.push(String(c)); return true; };

    const run = runSetupPasswordStdin({
      host: 'mac-mini',
      user: 'rebin',
      port: 22,
      keyPath: '/tmp/id_test',
    });

    stdin.write('hunter2\n');
    stdin.end();

    await run;
    process.stdout.write = origWrite;

    expect(copySpy).toHaveBeenCalledWith(expect.objectContaining({ password: 'hunter2' }));
    expect(JSON.parse(writes.join(''))).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm test -- setup-password-stdin`
Expected: FAIL — `runSetupPasswordStdin is not a function`.

- [ ] **Step 3: Implement**

Add to `src/commands/setup.ts`:

```ts
import { generateKeyPair, copyIdWithPassword, type CopyIdResult } from '../lib/sshpass.ts';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

export interface PasswordStdinInput {
  host: string;
  user: string;
  port: number;
  keyPath: string;     // private key path; .pub appended for the public key
}

export async function runSetupPasswordStdin(input: PasswordStdinInput): Promise<void> {
  // Ensure key dir + key exist
  if (!existsSync(input.keyPath)) {
    mkdirSync(dirname(input.keyPath), { recursive: true, mode: 0o700 });
    const r = spawnSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-f', input.keyPath, '-C', `remote-claude@${input.host}`]);
    if (r.status !== 0) {
      process.stdout.write(JSON.stringify({ ok: false, code: 'unknown', stderr: 'ssh-keygen failed' }));
      return;
    }
    chmodSync(input.keyPath, 0o600);
  }

  // Read password from stdin (single line)
  const password = await readPasswordFromStdin();

  let result: CopyIdResult;
  try {
    result = await copyIdWithPassword({
      host: input.host,
      user: input.user,
      port: input.port,
      keyPath: input.keyPath,
      password,
    });
  } finally {
    // Best-effort zeroing — string immutability means we can only drop the reference.
    // The buffer inside sshpass.ts is zeroed there.
  }

  process.stdout.write(JSON.stringify(result));
}

function readPasswordFromStdin(): Promise<string> {
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { buf += c; });
    process.stdin.on('end', () => resolve(buf.replace(/\n$/, '')));
  });
}
```

Also update `src/lib/sshpass.ts` to zero its password buffer post-spawn (replace the `child.stdin.write` block):

```ts
const pwBuf = Buffer.from(input.password + '\n', 'utf8');
child.stdin.write(pwBuf);
child.stdin.end();
pwBuf.fill(0);
```

- [ ] **Step 4: Register flag in src/cli.ts**

Add to the `setup` command:

```ts
.option('--password-stdin', 'read SSH password from stdin and run ssh-copy-id (used by the wizard)')
.option('--key-path <path>', 'private key path for the per-project key', '')
```

In the action, before existing logic:

```ts
if (opts.passwordStdin) {
  const { runSetupPasswordStdin } = await import('./commands/setup.ts');
  await runSetupPasswordStdin({
    host: opts.host,
    user: opts.user,
    port: opts.sshPort ?? 22,
    keyPath: opts.keyPath,
  });
  return;
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm test -- setup-password-stdin`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts src/commands/setup.ts src/lib/sshpass.ts test/commands/setup-password-stdin.test.ts
git commit -m "feat(cli): add setup --password-stdin for one-time ssh-copy-id"
```

---

### Task 7: Agent session-store + session-id helper

**Files:**
- Create: `src/lib/session-id.ts`
- Create: `src/agent/session-store.ts`
- Create: `test/agent/session-store.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/agent/session-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from '../../src/agent/session-store.ts';

describe('SessionStore', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rc-sess-')); });
  afterEach?.(() => { rmSync(dir, { recursive: true, force: true }); });

  it('mints a new claude-session-id on first lookup and persists it', async () => {
    const store = new SessionStore(join(dir, 'sessions.json'));
    const a = await store.getOrCreate('uuid-1');
    const b = await store.getOrCreate('uuid-1');
    expect(a).toBe(b);
    // new instance should see the same mapping
    const store2 = new SessionStore(join(dir, 'sessions.json'));
    expect(await store2.getOrCreate('uuid-1')).toBe(a);
  });

  it('delete() removes the mapping', async () => {
    const store = new SessionStore(join(dir, 'sessions.json'));
    const a = await store.getOrCreate('uuid-2');
    await store.delete('uuid-2');
    const b = await store.getOrCreate('uuid-2');
    expect(b).not.toBe(a);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm test -- session-store`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement src/lib/session-id.ts**

```ts
import { randomBytes } from 'node:crypto';
export function newSessionId(): string {
  return randomBytes(16).toString('hex');
}
```

- [ ] **Step 4: Implement src/agent/session-store.ts**

```ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { newSessionId } from '../lib/session-id.ts';

interface PersistedMap { [extensionUuid: string]: string }

export class SessionStore {
  private map: PersistedMap = {};
  constructor(private readonly path: string) {
    if (existsSync(path)) {
      try { this.map = JSON.parse(readFileSync(path, 'utf8')); } catch { this.map = {}; }
    } else {
      mkdirSync(dirname(path), { recursive: true });
    }
  }

  async getOrCreate(uuid: string): Promise<string> {
    if (this.map[uuid]) return this.map[uuid];
    const claudeId = newSessionId();
    this.map[uuid] = claudeId;
    this.persist();
    return claudeId;
  }

  async delete(uuid: string): Promise<void> {
    delete this.map[uuid];
    this.persist();
  }

  async get(uuid: string): Promise<string | undefined> {
    return this.map[uuid];
  }

  private persist(): void {
    writeFileSync(this.path, JSON.stringify(this.map, null, 2), { mode: 0o600 });
  }
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm test -- session-store`
Expected: PASS, 2/2.

- [ ] **Step 6: Commit**

```bash
git add src/lib/session-id.ts src/agent/session-store.ts test/agent/session-store.test.ts
git commit -m "feat(agent): add SessionStore for uuid → claude-session-id mapping"
```

---

### Task 8: Agent `POST /init` endpoint

**Files:**
- Create: `src/agent/init.ts`
- Modify: `src/agent/server.ts` — register the route
- Create: `test/agent/init.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/agent/init.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runInit } from '../../src/agent/init.ts';
import * as cp from 'node:child_process';

describe('runInit', () => {
  it('clones the repo into RC_PROJECTS_ROOT/<projectName> and returns commit SHA', async () => {
    vi.spyOn(cp, 'spawnSync')
      .mockReturnValueOnce({ status: 0 } as any)                            // git clone
      .mockReturnValueOnce({ status: 0, stdout: 'abcdef1234\n' } as any);   // git rev-parse HEAD
    const res = await runInit({
      projectsRoot: '/tmp/projects',
      gitUrl: 'git@github.com:co/app.git',
      branch: 'main',
      projectName: 'app',
    });
    expect(res).toEqual({ ok: true, sha: 'abcdef1234', path: '/tmp/projects/app' });
  });

  it('refuses when target directory already exists and is non-empty', async () => {
    const fs = await import('node:fs');
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readdirSync').mockReturnValue(['something'] as any);
    const res = await runInit({
      projectsRoot: '/tmp/projects',
      gitUrl: 'git@github.com:co/app.git',
      branch: 'main',
      projectName: 'app',
    });
    expect(res).toMatchObject({ ok: false, code: 'target_exists' });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm test -- agent/init`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement src/agent/init.ts**

```ts
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export interface InitInput {
  projectsRoot: string;
  gitUrl: string;
  branch: string;
  projectName: string;
}

export type InitResult =
  | { ok: true; sha: string; path: string }
  | { ok: false; code: 'target_exists' | 'clone_failed' | 'rev_parse_failed'; stderr: string };

export async function runInit(input: InitInput): Promise<InitResult> {
  const target = join(input.projectsRoot, input.projectName);
  if (existsSync(target) && readdirSync(target).length > 0) {
    return { ok: false, code: 'target_exists', stderr: `${target} is not empty` };
  }
  mkdirSync(input.projectsRoot, { recursive: true });

  const clone = spawnSync('git', ['clone', '-b', input.branch, input.gitUrl, target], { encoding: 'utf8' });
  if (clone.status !== 0) return { ok: false, code: 'clone_failed', stderr: String(clone.stderr ?? '') };

  const rev = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: target, encoding: 'utf8' });
  if (rev.status !== 0) return { ok: false, code: 'rev_parse_failed', stderr: String(rev.stderr ?? '') };

  return { ok: true, sha: rev.stdout.trim(), path: target };
}
```

- [ ] **Step 4: Register route in src/agent/server.ts**

Add inside the fastify factory (after existing route registrations):

```ts
import { runInit } from './init.ts';

app.post('/init', async (req, reply) => {
  const body = req.body as { gitUrl?: string; branch?: string; projectName?: string };
  if (!body.gitUrl || !body.projectName) {
    return reply.status(400).send({ ok: false, code: 'missing_fields' });
  }
  const result = await runInit({
    projectsRoot: process.env.RC_PROJECTS_ROOT!,
    gitUrl: body.gitUrl,
    branch: body.branch ?? 'main',
    projectName: body.projectName,
  });
  if (!result.ok) return reply.status(409).send(result);
  return result;
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm test -- agent/init`
Expected: PASS, 2/2.

- [ ] **Step 6: Commit**

```bash
git add src/agent/init.ts src/agent/server.ts test/agent/init.test.ts
git commit -m "feat(agent): add POST /init for git clone bootstrap"
```

---

### Task 9: CLI `init-remote` command

**Files:**
- Create: `src/commands/init-remote.ts`
- Modify: `src/cli.ts`
- Create: `test/commands/init-remote.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/commands/init-remote.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runInitRemote } from '../../src/commands/init-remote.ts';
import * as client from '../../src/lib/client.ts';

describe('init-remote', () => {
  it('POSTs to /init and returns the SHA', async () => {
    vi.spyOn(client, 'agentRequest').mockResolvedValue({ ok: true, sha: 'abc123', path: '/tmp/p/app' });
    const res = await runInitRemote({ gitUrl: 'git@x:co/app.git', branch: 'main', project: 'app' });
    expect(res).toEqual({ ok: true, sha: 'abc123', path: '/tmp/p/app' });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm test -- init-remote`
Expected: FAIL.

- [ ] **Step 3: Implement src/commands/init-remote.ts**

```ts
import { loadConfig } from '../lib/config.ts';
import { agentRequest } from '../lib/client.ts';
import { log } from '../lib/log.ts';

export interface InitRemoteOpts {
  gitUrl: string;
  branch: string;
  project: string;
}

export async function runInitRemote(opts: InitRemoteOpts): Promise<unknown> {
  const cfg = await loadConfig(process.cwd());
  const result = await agentRequest(cfg, 'POST', '/init', {
    gitUrl: opts.gitUrl, branch: opts.branch, projectName: opts.project,
  });
  log.info(`Remote initialized at ${(result as any).path} @ ${(result as any).sha}`);
  return result;
}
```

If `agentRequest` doesn't exist in `src/lib/client.ts`, add a small wrapper:

```ts
import { fetch } from 'undici';
export async function agentRequest(cfg: any, method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${cfg.remote.agentUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.remote.token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Agent ${method} ${path} failed: ${res.status} ${JSON.stringify(data)}`);
  return data;
}
```

- [ ] **Step 4: Register in src/cli.ts**

```ts
program
  .command('init-remote')
  .description('Clone the project on the remote Mac Mini (called by the wizard)')
  .requiredOption('--git-url <url>', 'git URL to clone')
  .option('--branch <branch>', 'branch to clone', 'main')
  .requiredOption('--project <name>', 'project directory name on the remote')
  .action(async (opts) => {
    const { runInitRemote } = await import('./commands/init-remote.ts');
    await runInitRemote(opts);
  });
```

- [ ] **Step 5: Run tests**

Run: `pnpm test -- init-remote`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/commands/init-remote.ts src/cli.ts src/lib/client.ts test/commands/init-remote.test.ts
git commit -m "feat(cli): add init-remote command (calls agent POST /init)"
```

---

### Task 10: Agent `POST /chat` streaming endpoint + per-turn git reset

**Files:**
- Create: `src/agent/chat.ts`
- Modify: `src/agent/server.ts`
- Modify: `src/agent/git.ts` — add `cleanResetToHead`
- Create: `test/agent/chat.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/agent/chat.test.ts
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
      }),
    };
    const fakeGit = {
      diffHead: vi.fn(async () => ({ patch: 'diff --git a/x b/x\n+y', files: [{ path: 'x', status: 'M', additions: 1, deletions: 0 }] })),
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
      'chat_turn_start', 'chat_text', 'chat_text', 'chat_diff', 'chat_done',
    ]);
    expect(fakeGit.cleanResetToHead).toHaveBeenCalled();
  });

  it('still resets git on error path', async () => {
    const events: any[] = [];
    const fakeClaude = { run: vi.fn(async () => { throw new Error('boom'); }) };
    const fakeGit = { diffHead: vi.fn(), cleanResetToHead: vi.fn() };
    const fakeStore = { getOrCreate: vi.fn(async () => 'cid') };

    await expect(runChatTurn({
      uuid: 'u2', prompt: 'x', cwd: '/tmp/p',
      store: fakeStore as any, claude: fakeClaude as any, git: fakeGit as any,
      emit: (e: any) => events.push(e),
    })).rejects.toThrow('boom');
    expect(fakeGit.cleanResetToHead).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm test -- agent/chat`
Expected: FAIL.

- [ ] **Step 3: Implement src/agent/chat.ts**

```ts
import type { SessionStore } from './session-store.ts';

export interface ChangedFile { path: string; status: 'A'|'M'|'D'|'R'; additions: number; deletions: number; }
export type ChatEvent =
  | { type: 'chat_turn_start'; sessionId: string; turnIndex: number }
  | { type: 'chat_text'; chunk: string }
  | { type: 'chat_diff'; patch: string; files: ChangedFile[] }
  | { type: 'chat_done'; tokensIn: number; tokensOut: number; durationMs: number };

export interface ClaudeRunner {
  run(claudeSessionId: string, prompt: string, onText: (chunk: string) => void): Promise<{ tokensIn: number; tokensOut: number }>;
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
  claude: ClaudeRunner;
  git: GitOps;
  emit: (e: ChatEvent) => void;
}): Promise<void> {
  const start = Date.now();
  const sessionId = await input.store.getOrCreate(input.uuid);
  input.emit({ type: 'chat_turn_start', sessionId, turnIndex: 0 });

  try {
    const tokens = await input.claude.run(sessionId, input.prompt, (chunk) =>
      input.emit({ type: 'chat_text', chunk })
    );

    const diff = await input.git.diffHead(input.cwd);
    if (diff.files.length > 0) input.emit({ type: 'chat_diff', patch: diff.patch, files: diff.files });

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
```

- [ ] **Step 4: Add cleanResetToHead + diffHead to src/agent/git.ts**

```ts
import { spawnSync } from 'node:child_process';

export async function cleanResetToHead(cwd: string): Promise<void> {
  spawnSync('git', ['reset', '--hard', 'HEAD'], { cwd });
  spawnSync('git', ['clean', '-fd'], { cwd });
}

export async function diffHead(cwd: string): Promise<{ patch: string; files: { path: string; status: 'A'|'M'|'D'|'R'; additions: number; deletions: number }[] }> {
  const patchRes = spawnSync('git', ['diff', 'HEAD'], { cwd, encoding: 'utf8' });
  const numstatRes = spawnSync('git', ['diff', '--name-status', 'HEAD'], { cwd, encoding: 'utf8' });
  const statRes = spawnSync('git', ['diff', '--numstat', 'HEAD'], { cwd, encoding: 'utf8' });
  const additions: Record<string, number> = {};
  const deletions: Record<string, number> = {};
  for (const line of statRes.stdout.trim().split('\n').filter(Boolean)) {
    const [a, d, path] = line.split('\t');
    additions[path] = Number(a) || 0;
    deletions[path] = Number(d) || 0;
  }
  const files = numstatRes.stdout.trim().split('\n').filter(Boolean).map((l) => {
    const [code, path] = l.split('\t');
    return {
      path,
      status: (code[0] as 'A'|'M'|'D'|'R'),
      additions: additions[path] ?? 0,
      deletions: deletions[path] ?? 0,
    };
  });
  return { patch: patchRes.stdout, files };
}
```

- [ ] **Step 5: Implement a real ClaudeRunner in src/agent/claude.ts (modify existing)**

Add:

```ts
import { spawn } from 'node:child_process';

export const claudeRunner = {
  async run(sessionId: string, prompt: string, onText: (chunk: string) => void) {
    return new Promise<{ tokensIn: number; tokensOut: number }>((resolve, reject) => {
      const bin = process.env.RC_CLAUDE_BIN || 'claude';
      const args = (process.env.RC_CLAUDE_ARGS?.split(' ') ?? ['--print']).concat(['--resume', sessionId]);
      const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      child.stdin.write(prompt);
      child.stdin.end();
      let out = '';
      child.stdout.on('data', (c: Buffer) => {
        const s = c.toString();
        out += s;
        onText(s);
      });
      child.on('close', (code) => {
        if (code === 0) resolve({ tokensIn: 0, tokensOut: out.length }); // tokens unknown without --json
        else reject(new Error(`claude exited ${code}`));
      });
      child.on('error', reject);
    });
  },
};
```

- [ ] **Step 6: Register POST /chat in src/agent/server.ts**

```ts
import { runChatTurn } from './chat.ts';
import { claudeRunner } from './claude.ts';
import { cleanResetToHead, diffHead } from './git.ts';
import { SessionStore } from './session-store.ts';
import { join } from 'node:path';

const store = new SessionStore(join(process.env.HOME!, '.remote-claude', 'agent-sessions.json'));

app.post('/chat', async (req, reply) => {
  reply.raw.setHeader('content-type', 'application/x-ndjson');
  const body = req.body as { uuid: string; prompt: string; projectName: string };
  const cwd = join(process.env.RC_PROJECTS_ROOT!, body.projectName);
  const emit = (e: unknown) => reply.raw.write(JSON.stringify(e) + '\n');

  try {
    await runChatTurn({
      uuid: body.uuid,
      prompt: body.prompt,
      cwd,
      store,
      claude: claudeRunner,
      git: { diffHead, cleanResetToHead },
      emit,
    });
  } catch (err) {
    emit({ type: 'error', code: 'turn_failed', message: (err as Error).message, recoverable: true });
  }
  reply.raw.end();
});
```

- [ ] **Step 7: Run tests**

Run: `pnpm test -- agent/chat`
Expected: PASS, 2/2.

- [ ] **Step 8: Commit**

```bash
git add src/agent/chat.ts src/agent/server.ts src/agent/git.ts src/agent/claude.ts test/agent/chat.test.ts
git commit -m "feat(agent): add POST /chat streaming + per-turn git reset"
```

---

### Task 11: Agent `DELETE /session/:id`

**Files:**
- Modify: `src/agent/server.ts`
- Create: `test/agent/delete-session.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/agent/delete-session.test.ts
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerDeleteSession } from '../../src/agent/server.ts';
import { SessionStore } from '../../src/agent/session-store.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('DELETE /session/:id', () => {
  it('removes the mapping and returns 204', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-del-'));
    const store = new SessionStore(join(dir, 'sessions.json'));
    await store.getOrCreate('u1');

    const app = Fastify();
    registerDeleteSession(app, store);
    const res = await app.inject({ method: 'DELETE', url: '/session/u1' });
    expect(res.statusCode).toBe(204);
    expect(await store.get('u1')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm test -- delete-session`
Expected: FAIL — `registerDeleteSession` not exported.

- [ ] **Step 3: Refactor src/agent/server.ts to export route registrars**

Extract the DELETE handler:

```ts
export function registerDeleteSession(app: any, store: SessionStore): void {
  app.delete('/session/:id', async (req: any, reply: any) => {
    await store.delete(req.params.id);
    reply.status(204).send();
  });
}
```

Then in the main `buildServer()`/factory call `registerDeleteSession(app, store)`.

- [ ] **Step 4: Run tests**

Run: `pnpm test -- delete-session`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/server.ts test/agent/delete-session.test.ts
git commit -m "feat(agent): add DELETE /session/:id"
```

---

### Task 12: Agent `GET /session/:id/status` for reload reconciliation

**Files:**
- Modify: `src/agent/server.ts`
- Create: `src/agent/turn-state.ts`
- Create: `test/agent/turn-state.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/agent/turn-state.test.ts
import { describe, it, expect } from 'vitest';
import { TurnState } from '../../src/agent/turn-state.ts';

describe('TurnState', () => {
  it('records in-flight turns and lets you fetch state by uuid', () => {
    const t = new TurnState();
    t.start('u1');
    expect(t.get('u1')).toMatchObject({ status: 'in_flight' });
    t.complete('u1', { tokensIn: 0, tokensOut: 10, durationMs: 1234 });
    expect(t.get('u1')).toMatchObject({ status: 'done', durationMs: 1234 });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm test -- turn-state`
Expected: FAIL.

- [ ] **Step 3: Implement src/agent/turn-state.ts**

```ts
export interface TurnRecord {
  uuid: string;
  status: 'in_flight' | 'done' | 'error';
  startedAt: number;
  tokensIn?: number;
  tokensOut?: number;
  durationMs?: number;
  errorMessage?: string;
}

export class TurnState {
  private map = new Map<string, TurnRecord>();

  start(uuid: string): void {
    this.map.set(uuid, { uuid, status: 'in_flight', startedAt: Date.now() });
  }
  complete(uuid: string, info: { tokensIn: number; tokensOut: number; durationMs: number }): void {
    this.map.set(uuid, { uuid, status: 'done', startedAt: Date.now(), ...info });
  }
  error(uuid: string, message: string): void {
    this.map.set(uuid, { uuid, status: 'error', startedAt: Date.now(), errorMessage: message });
  }
  get(uuid: string): TurnRecord | undefined { return this.map.get(uuid); }
}
```

- [ ] **Step 4: Wire into POST /chat and add GET /session/:id/status**

In `src/agent/server.ts`:

```ts
import { TurnState } from './turn-state.ts';
const turns = new TurnState();

// inside POST /chat handler, around runChatTurn:
turns.start(body.uuid);
try {
  await runChatTurn({ ..., emit: (e) => {
    if (e.type === 'chat_done') turns.complete(body.uuid, { tokensIn: e.tokensIn, tokensOut: e.tokensOut, durationMs: e.durationMs });
    emit(e);
  }});
} catch (err) {
  turns.error(body.uuid, (err as Error).message);
  throw err;
}

app.get('/session/:id/status', async (req, reply) => {
  const t = turns.get((req.params as any).id);
  if (!t) return reply.status(404).send({ code: 'unknown_uuid' });
  return t;
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm test -- turn-state`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/agent/turn-state.ts src/agent/server.ts test/agent/turn-state.test.ts
git commit -m "feat(agent): add GET /session/:id/status for reload reconciliation"
```

---

### Task 13: CLI `chat` command

**Files:**
- Create: `src/commands/chat.ts`
- Modify: `src/cli.ts`
- Modify: `src/lib/client.ts` — add `streamPostNdjson`
- Create: `test/commands/chat.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/commands/chat.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runChat } from '../../src/commands/chat.ts';
import * as client from '../../src/lib/client.ts';
import { Readable } from 'node:stream';

describe('runChat', () => {
  it('emits protocol, sync_*, then forwards agent events', async () => {
    vi.spyOn(client, 'streamPostNdjson').mockImplementation(async function* () {
      yield { type: 'chat_turn_start', sessionId: 'cid', turnIndex: 0 };
      yield { type: 'chat_text', chunk: 'hi' };
      yield { type: 'chat_done', tokensIn: 0, tokensOut: 2, durationMs: 100 };
    } as any);

    const out: any[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (c: any) => { out.push(...String(c).trim().split('\n').filter(Boolean).map((l: string) => JSON.parse(l))); return true; };

    await runChat({ cwd: process.cwd(), prompt: 'hi', sessionUuid: 'u1', skipSync: true });

    process.stdout.write = origWrite;
    expect(out[0]).toMatchObject({ type: 'protocol' });
    expect(out.find((e) => e.type === 'chat_done')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm test -- commands/chat`
Expected: FAIL.

- [ ] **Step 3: Add streamPostNdjson to src/lib/client.ts**

```ts
import { fetch } from 'undici';

export async function* streamPostNdjson(cfg: any, path: string, body: unknown): AsyncGenerator<unknown> {
  const res = await fetch(`${cfg.remote.agentUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.remote.token}` },
    body: JSON.stringify(body),
  });
  if (!res.body) throw new Error(`No response body from ${path}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) if (line) yield JSON.parse(line);
  }
  if (buf.trim()) yield JSON.parse(buf);
}
```

- [ ] **Step 4: Implement src/commands/chat.ts**

```ts
import { loadConfig } from '../lib/config.ts';
import { streamPostNdjson } from '../lib/client.ts';
import { runSync } from './sync.ts';

const PROTOCOL_VERSION = '1';

export interface ChatOpts {
  cwd: string;
  prompt: string;
  sessionUuid: string;
  skipSync?: boolean;
}

function emit(e: unknown): void {
  process.stdout.write(JSON.stringify(e) + '\n');
}

export async function runChat(opts: ChatOpts): Promise<void> {
  emit({ type: 'protocol', version: PROTOCOL_VERSION });

  const cfg = await loadConfig(opts.cwd);
  if (!opts.skipSync) {
    emit({ type: 'sync_start' });
    await runSync(opts.cwd);    // existing sync emits its own events when --json is on; here we just call
    emit({ type: 'sync_done', filesChanged: 0, durationMs: 0 });
  }

  for await (const evt of streamPostNdjson(cfg, '/chat', {
    uuid: opts.sessionUuid,
    prompt: opts.prompt,
    projectName: cfg.project,
  })) {
    emit(evt);
  }
}
```

- [ ] **Step 5: Register in src/cli.ts**

```ts
program
  .command('chat')
  .description('Multi-turn chat with Claude on the remote (used by the VS Code extension)')
  .argument('<prompt...>', 'prompt text')
  .requiredOption('--session <uuid>', 'extension-side session UUID')
  .option('--json', 'JSONL output (default in this command)', true)
  .option('--no-sync', 'skip pre-sync')
  .action(async (promptParts: string[], opts) => {
    const { runChat } = await import('./commands/chat.ts');
    await runChat({
      cwd: process.cwd(),
      prompt: promptParts.join(' '),
      sessionUuid: opts.session,
      skipSync: opts.sync === false,
    });
  });
```

- [ ] **Step 6: Run tests**

Run: `pnpm test -- commands/chat`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/commands/chat.ts src/cli.ts src/lib/client.ts test/commands/chat.test.ts
git commit -m "feat(cli): add chat command (JSONL stream from POST /chat)"
```

---

### Task 14: `sync --json` flag

**Files:**
- Modify: `src/commands/sync.ts`
- Modify: `src/cli.ts`
- Create: `test/commands/sync-json.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/commands/sync-json.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runSync } from '../../src/commands/sync.ts';
import * as rsync from '../../src/lib/rsync.ts';

describe('runSync(--json)', () => {
  it('emits sync_start, sync_progress*, sync_done as JSONL', async () => {
    vi.spyOn(rsync, 'rsyncPush').mockImplementation(async (_cfg, onProgress) => {
      onProgress?.({ transferred: 100, total: 500 });
      onProgress?.({ transferred: 500, total: 500 });
      return { filesChanged: 3, durationMs: 42 };
    });
    const lines: any[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (c: any) => {
      String(c).trim().split('\n').filter(Boolean).forEach((l) => lines.push(JSON.parse(l)));
      return true;
    };

    await runSync(process.cwd(), { json: true });
    process.stdout.write = origWrite;

    expect(lines.map((l) => l.type)).toEqual(['sync_start', 'sync_progress', 'sync_progress', 'sync_done']);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm test -- sync-json`
Expected: FAIL.

- [ ] **Step 3: Modify src/commands/sync.ts**

```ts
import { loadConfig } from '../lib/config.ts';
import { rsyncPush } from '../lib/rsync.ts';

export interface SyncOpts { json?: boolean }

export async function runSync(cwd: string, opts: SyncOpts = {}): Promise<void> {
  const cfg = await loadConfig(cwd);
  const emit = (e: unknown) => opts.json ? process.stdout.write(JSON.stringify(e) + '\n') : undefined;

  emit({ type: 'sync_start' });
  const result = await rsyncPush(cfg, (p) => emit({ type: 'sync_progress', transferred: p.transferred, total: p.total }));
  emit({ type: 'sync_done', filesChanged: result.filesChanged, durationMs: result.durationMs });
}
```

Update `src/lib/rsync.ts` `rsyncPush` to accept an optional `onProgress` callback (parse rsync `--info=progress2` lines and call it on tick).

- [ ] **Step 4: Register flag in src/cli.ts**

In the `sync` command:

```ts
.option('--json', 'JSONL output')
.action(async (opts) => {
  const { runSync } = await import('./commands/sync.ts');
  await runSync(process.cwd(), { json: opts.json });
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm test -- sync-json`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/commands/sync.ts src/cli.ts src/lib/rsync.ts test/commands/sync-json.test.ts
git commit -m "feat(cli): add sync --json for extension streaming"
```

---

### Milestone 1 checkpoint

Run end-to-end against a real Mac Mini (manual smoke):

```bash
pnpm build
remote-claude setup --host <ip> --user <you>      # existing flow, no password yet
# Then manually set up keys, env, and call:
remote-claude chat --session test-uuid "say hello"
```

Expect: JSONL events stream, including a `chat_text` and a `chat_done`. No diff if Claude didn't edit files.

`pnpm typecheck && pnpm test` should be green.

---

## Milestone 2 — Extension Foundation

### Task 15: CliClient + JSONL parser

**Files:**
- Create: `extension/src/cli/events.ts`
- Create: `extension/src/cli/CliClient.ts`
- Create: `extension/src/cli/CliClient.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// extension/src/cli/CliClient.test.ts
import { describe, it, expect } from 'vitest';
import { parseJsonl } from './CliClient.ts';

describe('parseJsonl', () => {
  it('handles buffer splits across newlines', () => {
    const out: unknown[] = [];
    const consume = parseJsonl((e) => out.push(e));
    consume('{"type":"a"}\n{"type":"b');
    consume('"}\n{"type":"c"}\n');
    expect(out).toEqual([{ type: 'a' }, { type: 'b' }, { type: 'c' }]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter remote-claude-vscode test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement extension/src/cli/events.ts**

```ts
export interface ChangedFile { path: string; status: 'A'|'M'|'D'|'R'; additions: number; deletions: number }

export type CliEvent =
  | { type: 'protocol'; version: string }
  | { type: 'sync_start' }
  | { type: 'sync_progress'; transferred: number; total: number }
  | { type: 'sync_done'; filesChanged: number; durationMs: number }
  | { type: 'chat_turn_start'; sessionId: string; turnIndex: number }
  | { type: 'chat_text'; chunk: string }
  | { type: 'chat_diff'; patch: string; files: ChangedFile[] }
  | { type: 'chat_done'; tokensIn: number; tokensOut: number; durationMs: number }
  | { type: 'error'; code: string; message: string; recoverable: boolean }
  | { type: 'cancelled' };

export const SUPPORTED_PROTOCOL = '1';
```

- [ ] **Step 4: Implement extension/src/cli/CliClient.ts**

```ts
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { CliEvent } from './events.ts';

export function parseJsonl(onEvent: (e: CliEvent) => void): (chunk: string) => void {
  let buf = '';
  return (chunk: string) => {
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line) continue;
      try { onEvent(JSON.parse(line) as CliEvent); }
      catch { /* malformed — skip */ }
    }
  };
}

export interface SpawnResult {
  events: AsyncIterable<CliEvent>;
  cancel(): void;
  done: Promise<number>;
}

export class CliClient {
  constructor(private readonly cliPath: string, private readonly cwd: string) {}

  spawn(args: string[]): SpawnResult {
    const child: ChildProcess = spawn(this.cliPath, args, { cwd: this.cwd });
    const emitter = new EventEmitter();
    const consume = parseJsonl((e) => emitter.emit('event', e));

    child.stdout!.on('data', (c: Buffer) => consume(c.toString()));
    let stderr = '';
    child.stderr!.on('data', (c: Buffer) => { stderr += c.toString(); });

    const done = new Promise<number>((resolve) => {
      child.on('close', (code) => {
        if (stderr.trim()) emitter.emit('event', { type: 'error', code: 'cli_stderr', message: stderr.trim(), recoverable: false });
        emitter.emit('end');
        resolve(code ?? -1);
      });
    });

    const events: AsyncIterable<CliEvent> = {
      [Symbol.asyncIterator]: async function* () {
        const queue: CliEvent[] = [];
        let ended = false;
        let waiter: (() => void) | null = null;
        emitter.on('event', (e) => { queue.push(e); waiter?.(); });
        emitter.on('end', () => { ended = true; waiter?.(); });
        while (!ended || queue.length) {
          if (queue.length) yield queue.shift()!;
          else await new Promise<void>((r) => (waiter = r));
        }
      },
    };

    return { events, cancel: () => child.kill('SIGTERM'), done };
  }
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter remote-claude-vscode test -- CliClient`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add extension/src/cli/
git commit -m "feat(extension): add CliClient and JSONL event parser"
```

---

### Task 16: ChatStore (sessions + transcripts on disk)

**Files:**
- Create: `extension/src/chat/ChatStore.ts`
- Create: `extension/src/chat/ChatStore.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// extension/src/chat/ChatStore.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatStore } from './ChatStore.ts';

describe('ChatStore', () => {
  it('creates, lists, persists, and deletes chats', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-cs-'));
    const store = new ChatStore(dir);
    const id = store.createChat('Refactor login_bloc');
    store.appendTurn(id, { role: 'user', text: 'hello', timestamp: 0 });
    store.appendTurn(id, { role: 'assistant', text: 'hi', timestamp: 1, patch: null });

    expect(store.listChats().map((c) => c.title)).toEqual(['Refactor login_bloc']);
    expect(store.loadTranscript(id).length).toBe(2);

    const store2 = new ChatStore(dir);
    expect(store2.listChats()[0].id).toBe(id);

    store2.deleteChat(id);
    expect(store2.listChats()).toHaveLength(0);
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter remote-claude-vscode test -- ChatStore`
Expected: FAIL.

- [ ] **Step 3: Implement extension/src/chat/ChatStore.ts**

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface ChatSummary { id: string; title: string; createdAt: number; lastActivity: number }
export interface Turn {
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: number;
  patch?: string | null;
  files?: { path: string; status: string; additions: number; deletions: number }[];
  applied?: boolean;
  rejected?: boolean;
  saved?: boolean;
}

export class ChatStore {
  private indexPath: string;
  private index: ChatSummary[] = [];
  public readonly root: string;

  constructor(root: string) {
    this.root = root;
    mkdirSync(root, { recursive: true });
    this.indexPath = join(root, 'index.json');
    if (existsSync(this.indexPath)) {
      try { this.index = JSON.parse(readFileSync(this.indexPath, 'utf8')); }
      catch { this.index = []; }
    }
  }

  listChats(): ChatSummary[] { return [...this.index].sort((a, b) => b.lastActivity - a.lastActivity); }

  createChat(title: string): string {
    const id = randomUUID();
    const now = Date.now();
    this.index.push({ id, title, createdAt: now, lastActivity: now });
    this.persistIndex();
    writeFileSync(this.transcriptPath(id), '');
    return id;
  }

  deleteChat(id: string): void {
    this.index = this.index.filter((c) => c.id !== id);
    this.persistIndex();
    const p = this.transcriptPath(id);
    if (existsSync(p)) unlinkSync(p);
    const dir = join(this.root, id);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }

  appendTurn(id: string, turn: Turn): void {
    appendFileSync(this.transcriptPath(id), JSON.stringify(turn) + '\n');
    const c = this.index.find((x) => x.id === id);
    if (c) { c.lastActivity = Date.now(); this.persistIndex(); }
  }

  rewriteTranscript(id: string, turns: Turn[]): void {
    writeFileSync(this.transcriptPath(id), turns.map((t) => JSON.stringify(t)).join('\n') + (turns.length ? '\n' : ''));
  }

  loadTranscript(id: string): Turn[] {
    const p = this.transcriptPath(id);
    if (!existsSync(p)) return [];
    return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Turn);
  }

  savePatch(id: string, turnIndex: number, patch: string): string {
    const dir = join(this.root, id);
    mkdirSync(dir, { recursive: true });
    const p = join(dir, `turn-${turnIndex}.patch`);
    writeFileSync(p, patch);
    return p;
  }

  transcriptPath(id: string): string { return join(this.root, `${id}.jsonl`); }
  private persistIndex(): void { writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2)); }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter remote-claude-vscode test -- ChatStore`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/src/chat/ChatStore.ts extension/src/chat/ChatStore.test.ts
git commit -m "feat(extension): add ChatStore for session list + transcripts"
```

---

### Task 17: DiffContentProvider (`remote-claude:` URI scheme)

**Files:**
- Create: `extension/src/diff/DiffContentProvider.ts`

- [ ] **Step 1: Implement extension/src/diff/DiffContentProvider.ts**

```ts
import * as vscode from 'vscode';
import { spawnSync } from 'node:child_process';

export const SCHEME = 'remote-claude';

export class DiffContentProvider implements vscode.TextDocumentContentProvider {
  private emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) return '';
    const ref = new URLSearchParams(uri.query).get('ref') ?? 'HEAD';
    const filePath = uri.path.replace(/^\//, '');
    const res = spawnSync('git', ['show', `${ref}:${filePath}`], { cwd, encoding: 'utf8' });
    return res.status === 0 ? res.stdout : '';
  }
}

export function makeBeforeUri(filePath: string): vscode.Uri {
  return vscode.Uri.parse(`${SCHEME}:/${filePath}?ref=HEAD`);
}
```

- [ ] **Step 2: Register in extension.ts**

```ts
import { DiffContentProvider, SCHEME } from './diff/DiffContentProvider.ts';
const diff = new DiffContentProvider();
context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(SCHEME, diff));
```

- [ ] **Step 3: Manual smoke**

Run: `pnpm --filter remote-claude-vscode build && code --extensionDevelopmentPath=./extension`
Verify the URI scheme registers without errors.

- [ ] **Step 4: Commit**

```bash
git add extension/src/diff/DiffContentProvider.ts extension/src/extension.ts
git commit -m "feat(extension): add DiffContentProvider"
```

---

### Task 18: applyPatch wrapper

**Files:**
- Create: `extension/src/diff/applyPatch.ts`
- Create: `extension/src/diff/applyPatch.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// extension/src/diff/applyPatch.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyPatch, filterPatchToFiles } from './applyPatch.ts';

describe('applyPatch', () => {
  it('applies a patch to a real git repo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-apply-'));
    spawnSync('git', ['init', '-q'], { cwd: dir });
    spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
    spawnSync('git', ['config', 'user.name', 't'], { cwd: dir });
    writeFileSync(join(dir, 'x.txt'), 'hello\n');
    spawnSync('git', ['add', 'x.txt'], { cwd: dir });
    spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });

    const patch = `diff --git a/x.txt b/x.txt
--- a/x.txt
+++ b/x.txt
@@ -1 +1 @@
-hello
+goodbye
`;
    const res = await applyPatch(patch, dir);
    expect(res.ok).toBe(true);
    expect(readFileSync(join(dir, 'x.txt'), 'utf8')).toBe('goodbye\n');
    rmSync(dir, { recursive: true, force: true });
  });

  it('filterPatchToFiles keeps only requested files', () => {
    const patch = `diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -1 +1 @@
-a
+A
diff --git a/b.txt b/b.txt
--- a/b.txt
+++ b/b.txt
@@ -1 +1 @@
-b
+B
`;
    const out = filterPatchToFiles(patch, ['a.txt']);
    expect(out).toContain('a/a.txt');
    expect(out).not.toContain('a/b.txt');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter remote-claude-vscode test -- applyPatch`
Expected: FAIL.

- [ ] **Step 3: Implement extension/src/diff/applyPatch.ts**

```ts
import { spawn } from 'node:child_process';

export interface ApplyResult { ok: boolean; conflicted: string[]; stderr: string }

export async function applyPatch(patch: string, cwd: string): Promise<ApplyResult> {
  return new Promise((resolve) => {
    const child = spawn('git', ['apply', '--3way', '--whitespace=nowarn', '-'], { cwd });
    let stderr = '';
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });
    child.stdin.write(patch);
    child.stdin.end();
    child.on('close', (code) => {
      const conflicted = [...stderr.matchAll(/CONFLICT.*?in (.+)/g)].map((m) => m[1]);
      resolve({ ok: code === 0 && conflicted.length === 0, conflicted, stderr });
    });
  });
}

export function filterPatchToFiles(patch: string, keepPaths: string[]): string {
  const keep = new Set(keepPaths);
  const segments = patch.split(/(?=^diff --git )/m);
  return segments.filter((seg) => {
    const m = seg.match(/^diff --git a\/(\S+)/);
    return m ? keep.has(m[1]) : true;
  }).join('');
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter remote-claude-vscode test -- applyPatch`
Expected: PASS, 2/2.

- [ ] **Step 5: Commit**

```bash
git add extension/src/diff/applyPatch.ts extension/src/diff/applyPatch.test.ts
git commit -m "feat(extension): add git-apply wrapper + per-file patch filter"
```

---

### Task 19: Wire activation, commands, output channel

**Files:**
- Modify: `extension/src/extension.ts`
- Create: `extension/src/commands.ts`

- [ ] **Step 1: Create extension/src/commands.ts**

```ts
import * as vscode from 'vscode';
import type { ChatStore } from './chat/ChatStore.ts';

export interface ExtensionDeps {
  output: vscode.OutputChannel;
  chatStore: ChatStore;
}

export function registerCommands(context: vscode.ExtensionContext, deps: ExtensionDeps): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('remoteClaude.viewOutput', () => deps.output.show()),
    vscode.commands.registerCommand('remoteClaude.newChat', async () => {
      const title = await vscode.window.showInputBox({ prompt: 'Chat title', value: 'New chat' });
      if (!title) return;
      deps.chatStore.createChat(title);
    }),
    vscode.commands.registerCommand('remoteClaude.openSetup', () =>
      vscode.window.showInformationMessage('Setup wizard arrives in Milestone 5.')
    ),
    vscode.commands.registerCommand('remoteClaude.toggleLiveSync', () =>
      vscode.window.showInformationMessage('Live sync arrives in Milestone 4.')
    ),
  );
}
```

- [ ] **Step 2: Wire in extension/src/extension.ts**

```ts
import * as vscode from 'vscode';
import { join } from 'node:path';
import { DiffContentProvider, SCHEME } from './diff/DiffContentProvider.ts';
import { ChatStore } from './chat/ChatStore.ts';
import { registerCommands } from './commands.ts';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Remote Claude');
  context.subscriptions.push(output);
  output.appendLine('Remote Claude activated.');

  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) { output.appendLine('No workspace open — Remote Claude is idle.'); return; }

  const chatStore = new ChatStore(join(ws, '.remote-claude', 'sessions'));
  const diff = new DiffContentProvider();
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(SCHEME, diff));

  registerCommands(context, { output, chatStore });
}

export function deactivate(): void {}
```

- [ ] **Step 3: Typecheck + build**

Run: `pnpm --filter remote-claude-vscode typecheck && pnpm --filter remote-claude-vscode build`
Expected: clean.

- [ ] **Step 4: Manual smoke**

Run: `code --extensionDevelopmentPath=./extension`
Open command palette → `Remote Claude: New Chat` → enter "test" → check `.remote-claude/sessions/index.json` exists.

- [ ] **Step 5: Commit**

```bash
git add extension/src/extension.ts extension/src/commands.ts
git commit -m "feat(extension): wire activation, commands, ChatStore"
```

---

### Milestone 2 checkpoint

Extension activates, exposes commands, persists chats to disk, can apply patches. No UI beyond the command palette yet.

---

## Milestone 3 — Chat panel UI

> The webview uses safe DOM construction (`document.createElement`, `textContent`) throughout — never `innerHTML` — so user-supplied chat titles, assistant text, and file paths cannot inject script. A small `h()` helper formalizes this.

### Task 20: ChatPanel webview registration + safe DOM helper

**Files:**
- Create: `extension/src/chat/ChatPanel.ts`
- Create: `extension/src/chat/webview/main.ts`
- Create: `extension/src/chat/webview/index.html`
- Create: `extension/src/chat/webview/styles.css`
- Create: `extension/src/chat/webview/h.ts` (DOM helper)
- Modify: `extension/src/extension.ts`
- Modify: `extension/package.json`

- [ ] **Step 1: Create webview/index.html**

```html
<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${stylesUri}">
  <title>Remote Claude</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>
```

- [ ] **Step 2: Create webview/styles.css**

```css
* { box-sizing: border-box; margin: 0; padding: 0; font-family: var(--vscode-font-family); color: var(--vscode-foreground); }
body { background: var(--vscode-sideBar-background); padding: 8px; }
.chat-list { border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 8px; margin-bottom: 8px; }
.chat-item { display: flex; align-items: center; justify-content: space-between; padding: 4px 8px; cursor: pointer; border-radius: 3px; }
.chat-item:hover { background: var(--vscode-list-hoverBackground); }
.chat-item.active { background: var(--vscode-list-activeSelectionBackground); }
.chat-del { background: transparent; opacity: 0.5; border: none; padding: 0 6px; cursor: pointer; color: var(--vscode-foreground); }
.chat-del:hover { opacity: 1; }
.turn { padding: 8px 0; border-bottom: 1px solid var(--vscode-panel-border); white-space: pre-wrap; }
.turn.user { color: var(--vscode-textPreformat-foreground); }
.diff-card { border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 8px; margin-top: 8px; }
.diff-file { display: flex; align-items: center; gap: 8px; padding: 2px 0; cursor: pointer; }
.diff-actions { margin-top: 8px; display: flex; gap: 4px; }
button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 10px; cursor: pointer; border-radius: 2px; }
button:hover { background: var(--vscode-button-hoverBackground); }
button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
textarea { width: 100%; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 4px 6px; resize: vertical; min-height: 60px; font-family: var(--vscode-font-family); }
```

- [ ] **Step 3: Create webview/h.ts (safe DOM helper — no innerHTML anywhere)**

```ts
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { dataset?: Record<string, string>; events?: Record<string, EventListener> } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { dataset, events, ...rest } = props as Record<string, unknown>;
  for (const k in rest) {
    if (k === 'className') (el as HTMLElement).className = String(rest[k]);
    else if (k === 'style') Object.assign((el as HTMLElement).style, rest[k] as object);
    else if (k in el) (el as Record<string, unknown>)[k] = rest[k];
    else (el as HTMLElement).setAttribute(k, String(rest[k]));
  }
  if (dataset) for (const k in dataset) (el as HTMLElement).dataset[k] = dataset[k];
  if (events) for (const k in events) el.addEventListener(k, events[k]);
  for (const c of children) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el: HTMLElement): void { while (el.firstChild) el.removeChild(el.firstChild); }
```

- [ ] **Step 4: Create webview/main.ts (uses h() — no innerHTML)**

```ts
import { h, clear } from './h.ts';

declare const acquireVsCodeApi: () => { postMessage: (m: unknown) => void };
const vscode = acquireVsCodeApi();

interface ChatSummary { id: string; title: string }
interface ChangedFile { path: string; status: string; additions: number; deletions: number }
interface Turn {
  role: 'user' | 'assistant' | 'system';
  text: string;
  patch?: string | null;
  files?: ChangedFile[];
  applied?: boolean;
  rejected?: boolean;
  saved?: boolean;
}
interface State { chats: ChatSummary[]; activeChatId?: string; turns: Turn[]; inFlight: boolean }

const root = document.getElementById('app')!;
const chatsEl = h('div', { className: 'chat-list', id: 'chats' });
const turnsEl = h('div', { id: 'turns' });
const composerEl = h('div', { id: 'composer' });
root.append(chatsEl, turnsEl, composerEl);

let currentState: State = { chats: [], activeChatId: undefined, turns: [], inFlight: false };

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as { type: string; state?: State };
  if (msg.type === 'state' && msg.state) {
    currentState = msg.state;
    render(currentState);
  }
});

function render(state: State): void {
  renderChatList(state);
  renderTurns(state);
  renderComposer(state);
}

function renderChatList(state: State): void {
  clear(chatsEl);
  for (const c of state.chats) {
    const row = h('div', {
      className: 'chat-item' + (c.id === state.activeChatId ? ' active' : ''),
      events: { click: () => vscode.postMessage({ type: 'switch', id: c.id }) },
    },
      h('span', { className: 'chat-title' }, c.title),
      h('button', {
        className: 'chat-del',
        title: 'Delete chat',
        events: { click: (e: Event) => { e.stopPropagation(); vscode.postMessage({ type: 'deleteChat', id: c.id }); } },
      }, '×'),
    );
    chatsEl.append(row);
  }
  chatsEl.append(h('button', {
    id: 'new-chat',
    events: { click: () => vscode.postMessage({ type: 'newChat' }) },
  }, '+ New chat'));
}

function renderTurns(state: State): void {
  clear(turnsEl);
  state.turns.forEach((t, i) => turnsEl.append(renderTurn(t, i, state.activeChatId!)));
}

function renderTurn(turn: Turn, index: number, chatId: string): HTMLElement {
  if (turn.role === 'user') return h('div', { className: 'turn user' }, '▶ ' + turn.text);
  const wrap = h('div', { className: 'turn assistant' }, turn.text);
  if (turn.applied)     wrap.append(h('div', { className: 'diff-card' }, '✓ Applied'));
  else if (turn.rejected) wrap.append(h('div', { className: 'diff-card' }, '✗ Rejected'));
  else if (turn.saved)    wrap.append(h('div', { className: 'diff-card' }, '💾 Saved'));
  else if (turn.patch && turn.files?.length) wrap.append(renderDiffCard(turn, index, chatId));
  return wrap;
}

function renderDiffCard(turn: Turn, index: number, chatId: string): HTMLElement {
  const card = h('div', { className: 'diff-card' });
  const checkboxes: HTMLInputElement[] = [];

  for (const f of turn.files!) {
    const cb = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
    checkboxes.push(cb);
    const row = h('label', {
      className: 'diff-file',
      events: { click: (e: Event) => {
        if ((e.target as HTMLElement).tagName === 'INPUT') return;
        const fileIndex = turn.files!.indexOf(f);
        vscode.postMessage({ type: 'openDiff', chatId, turn: index, fileIndex });
      }},
    },
      cb,
      h('span', {}, f.status),
      h('span', {}, f.path),
      h('span', {}, `+${f.additions} -${f.deletions}`),
    );
    card.append(row);
  }

  const dispatch = (action: 'apply'|'save'|'reject') => {
    const fileIndices = checkboxes.map((cb, i) => ({ i, on: cb.checked })).filter((x) => x.on).map((x) => x.i);
    vscode.postMessage({ type: 'diffAction', chatId, turn: index, action, fileIndices });
  };

  card.append(h('div', { className: 'diff-actions' },
    h('button', { events: { click: () => dispatch('apply') } }, 'Apply selected'),
    h('button', { className: 'secondary', events: { click: () => dispatch('save') } }, 'Save patch'),
    h('button', { className: 'secondary', events: { click: () => dispatch('reject') } }, 'Reject'),
  ));
  return card;
}

function renderComposer(state: State): void {
  clear(composerEl);
  if (state.inFlight) {
    composerEl.append(h('button', { events: { click: () => vscode.postMessage({ type: 'cancel' }) } }, 'Stop'));
    return;
  }
  const ta = h('textarea', { placeholder: 'Ask Claude…' }) as HTMLTextAreaElement;
  const btn = h('button', {
    events: { click: () => {
      const v = ta.value.trim();
      if (!v) return;
      vscode.postMessage({ type: 'send', prompt: v });
      ta.value = '';
    }},
  }, 'Send');
  composerEl.append(ta, btn);
}

vscode.postMessage({ type: 'ready' });
```

- [ ] **Step 5: Create extension/src/chat/ChatPanel.ts**

```ts
import * as vscode from 'vscode';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatStore, Turn } from './ChatStore.ts';

export type DiffActionMsg = { chatId: string; turn: number; action: 'apply'|'save'|'reject'; fileIndices: number[] };
export type OpenDiffMsg = { chatId: string; turn: number; fileIndex: number };

export interface ChatPanelDeps {
  onSend(chatId: string, prompt: string): void;
  onDiffAction(msg: DiffActionMsg): void;
  onOpenDiff(msg: OpenDiffMsg): void;
  onCancel(chatId: string): void;
  onDeleteRemote(chatId: string): Promise<void>;
}

export class ChatPanel implements vscode.WebviewViewProvider {
  static readonly viewId = 'remoteClaude.chatPanel';
  private view?: vscode.WebviewView;
  private activeChatId?: string;
  private inFlightChats = new Set<string>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly chatStore: ChatStore,
    private readonly deps: ChatPanelDeps,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')],
    };
    view.webview.html = this.renderHtml(view.webview);

    view.webview.onDidReceiveMessage(async (msg: { type: string; [k: string]: unknown }) => {
      switch (msg.type) {
        case 'ready':       return this.postState();
        case 'send':        if (this.activeChatId) this.deps.onSend(this.activeChatId, msg.prompt as string); return;
        case 'newChat':     this.activeChatId = this.chatStore.createChat(`Chat ${this.chatStore.listChats().length + 1}`); return this.postState();
        case 'switch':      this.activeChatId = msg.id as string; return this.postState();
        case 'diffAction':  return this.deps.onDiffAction(msg as unknown as DiffActionMsg);
        case 'openDiff':    return this.deps.onOpenDiff(msg as unknown as OpenDiffMsg);
        case 'cancel':      if (this.activeChatId) this.deps.onCancel(this.activeChatId); return;
        case 'deleteChat': {
          const confirm = await vscode.window.showWarningMessage('Delete this chat?', { modal: true }, 'Delete');
          if (confirm !== 'Delete') return;
          const id = msg.id as string;
          this.chatStore.deleteChat(id);
          if (this.activeChatId === id) this.activeChatId = undefined;
          await this.deps.onDeleteRemote(id);
          return this.postState();
        }
      }
    });
  }

  setInFlight(chatId: string, on: boolean): void {
    if (on) this.inFlightChats.add(chatId); else this.inFlightChats.delete(chatId);
    this.postState();
  }

  postState(): void {
    if (!this.view) return;
    const chats = this.chatStore.listChats();
    if (!this.activeChatId && chats[0]) this.activeChatId = chats[0].id;
    const turns: Turn[] = this.activeChatId ? this.chatStore.loadTranscript(this.activeChatId) : [];
    const inFlight = this.activeChatId ? this.inFlightChats.has(this.activeChatId) : false;
    this.view.webview.postMessage({ type: 'state', state: { chats, activeChatId: this.activeChatId, turns, inFlight } });
  }

  private renderHtml(webview: vscode.Webview): string {
    const dist = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'main.js'));
    const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'styles.css'));
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const html = readFileSync(join(this.extensionUri.fsPath, 'dist', 'webview', 'index.html'), 'utf8');
    return html
      .replace(/\$\{cspSource\}/g, webview.cspSource)
      .replace(/\$\{nonce\}/g, nonce)
      .replace(/\$\{scriptUri\}/g, scriptUri.toString())
      .replace(/\$\{stylesUri\}/g, stylesUri.toString());
  }
}
```

- [ ] **Step 6: Update extension/package.json build script**

Replace `build` and `dev`:

```json
"build": "tsup src/extension.ts --format cjs --external vscode --out-dir dist && tsup src/chat/webview/main.ts --format iife --out-dir dist/webview --target chrome100 && cp src/chat/webview/index.html src/chat/webview/styles.css dist/webview/",
"dev": "pnpm build --watch"
```

- [ ] **Step 7: Wire ChatPanel into extension.ts (stub callbacks until Task 21)**

```ts
import { ChatPanel } from './chat/ChatPanel.ts';
const chatPanel = new ChatPanel(context.extensionUri, chatStore, {
  onSend: (id, p) => output.appendLine(`[stub] send ${id}: ${p}`),
  onDiffAction: (a) => output.appendLine(`[stub] diff: ${JSON.stringify(a)}`),
  onOpenDiff: (a) => output.appendLine(`[stub] open: ${JSON.stringify(a)}`),
  onCancel: (id) => output.appendLine(`[stub] cancel ${id}`),
  onDeleteRemote: async (id) => output.appendLine(`[stub] delete remote ${id}`),
});
context.subscriptions.push(vscode.window.registerWebviewViewProvider(ChatPanel.viewId, chatPanel));
```

- [ ] **Step 8: Build + manual smoke**

Run: `pnpm --filter remote-claude-vscode build && code --extensionDevelopmentPath=./extension`
Open the Remote Claude activity bar → see the chat panel → click `+ New chat` → row appears → click it → it activates.

- [ ] **Step 9: Commit**

```bash
git add extension/src/chat/ChatPanel.ts extension/src/chat/webview/ extension/src/extension.ts extension/package.json
git commit -m "feat(extension): add ChatPanel webview (safe DOM, CSP nonce)"
```

---

### Task 21: ChatController — wire send → CLI → ChatStore → panel

**Files:**
- Create: `extension/src/chat/ChatController.ts`
- Modify: `extension/src/extension.ts`

- [ ] **Step 1: Implement ChatController.ts**

```ts
import * as vscode from 'vscode';
import { CliClient } from '../cli/CliClient.ts';
import type { CliEvent, ChangedFile } from '../cli/events.ts';
import { ChatStore, type Turn } from './ChatStore.ts';
import type { ChatPanel } from './ChatPanel.ts';

export class ChatController {
  private inFlight = new Map<string, ReturnType<CliClient['spawn']>>();
  panel!: ChatPanel;

  constructor(
    private readonly cli: CliClient,
    private readonly store: ChatStore,
    private readonly output: vscode.OutputChannel,
  ) {}

  async send(chatId: string, prompt: string): Promise<void> {
    if (this.inFlight.has(chatId)) {
      vscode.window.showWarningMessage('A turn is already in flight for this chat.');
      return;
    }
    this.store.appendTurn(chatId, { role: 'user', text: prompt, timestamp: Date.now() });
    this.store.appendTurn(chatId, { role: 'assistant', text: '', timestamp: Date.now(), patch: null });
    this.panel.setInFlight(chatId, true);

    const run = this.cli.spawn(['chat', '--session', chatId, '--json', prompt]);
    this.inFlight.set(chatId, run);

    let assistantText = '';
    let patch: string | null = null;
    let files: ChangedFile[] = [];

    try {
      for await (const e of run.events) {
        const ev = e as CliEvent;
        if (ev.type === 'chat_text') {
          assistantText += ev.chunk;
          this.replaceLastAssistant(chatId, assistantText, patch, files);
        } else if (ev.type === 'chat_diff') {
          patch = ev.patch;
          files = ev.files;
          this.replaceLastAssistant(chatId, assistantText, patch, files);
        } else if (ev.type === 'error') {
          this.output.appendLine(`[error] ${ev.code}: ${ev.message}`);
          this.store.appendTurn(chatId, { role: 'system', text: `Error: ${ev.message}`, timestamp: Date.now() });
        }
      }
    } finally {
      this.inFlight.delete(chatId);
      this.panel.setInFlight(chatId, false);
    }
  }

  cancel(chatId: string): void { this.inFlight.get(chatId)?.cancel(); }

  private replaceLastAssistant(chatId: string, text: string, patch: string | null, files: ChangedFile[]): void {
    const turns = this.store.loadTranscript(chatId);
    turns[turns.length - 1] = { role: 'assistant', text, timestamp: Date.now(), patch, files };
    this.store.rewriteTranscript(chatId, turns);
    this.panel.postState();
  }
}
```

- [ ] **Step 2: Modify extension.ts to instantiate and cross-wire**

```ts
import { CliClient } from './cli/CliClient.ts';
import { ChatController } from './chat/ChatController.ts';

const cli = new CliClient('remote-claude', ws);
const controller = new ChatController(cli, chatStore, output);

const chatPanel = new ChatPanel(context.extensionUri, chatStore, {
  onSend: (id, p) => controller.send(id, p),
  onDiffAction: (a) => output.appendLine(`[diff] ${JSON.stringify(a)}`),    // wired in Task 22
  onOpenDiff: (a) => output.appendLine(`[open] ${JSON.stringify(a)}`),       // wired in Task 22
  onCancel: (id) => controller.cancel(id),
  onDeleteRemote: async (id) => { /* DELETE /session/:id — wired in Task 23 */ },
});
controller.panel = chatPanel;
context.subscriptions.push(vscode.window.registerWebviewViewProvider(ChatPanel.viewId, chatPanel));
```

- [ ] **Step 3: Manual smoke (requires M1 CLI + Mac Mini, or a stub `remote-claude` on PATH)**

Send a prompt → assistant text streams into the panel. If Claude edits files, a diff card appears (actions are stubbed for now).

- [ ] **Step 4: Commit**

```bash
git add extension/src/chat/ChatController.ts extension/src/extension.ts
git commit -m "feat(extension): wire chat send through CliClient + ChatStore + panel"
```

---

### Task 22: Diff card action handlers + native diff editor

**Files:**
- Modify: `extension/src/chat/ChatController.ts`
- Modify: `extension/src/extension.ts`

- [ ] **Step 1: Add handleDiffAction and handleOpenDiff to ChatController**

```ts
import { applyPatch, filterPatchToFiles } from '../diff/applyPatch.ts';
import { makeBeforeUri } from '../diff/DiffContentProvider.ts';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename, dirname } from 'node:path';

// add inside ChatController:
async handleDiffAction(input: { chatId: string; turn: number; action: 'apply'|'save'|'reject'; fileIndices: number[] }): Promise<void> {
  const turns = this.store.loadTranscript(input.chatId);
  const turn = turns[input.turn];
  if (!turn || !turn.patch || !turn.files) return;

  if (input.action === 'reject') {
    turn.rejected = true;
    this.store.rewriteTranscript(input.chatId, turns);
    this.panel.postState();
    return;
  }
  if (input.action === 'save') {
    this.store.savePatch(input.chatId, input.turn, turn.patch);
    turn.saved = true;
    this.store.rewriteTranscript(input.chatId, turns);
    this.panel.postState();
    vscode.window.showInformationMessage('Patch saved.');
    return;
  }

  // apply
  const keep = input.fileIndices.map((i) => turn.files![i].path);
  const subset = filterPatchToFiles(turn.patch, keep);
  const ws = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const res = await applyPatch(subset, ws);
  if (res.ok) {
    turn.applied = true;
    vscode.window.showInformationMessage(`Applied ${keep.length} file(s).`);
  } else if (res.conflicted.length > 0) {
    turn.applied = true;
    vscode.window.showWarningMessage(`Conflicts in: ${res.conflicted.join(', ')}. Resolve, then commit.`);
  } else {
    vscode.window.showErrorMessage(`git apply failed: ${res.stderr.split('\n')[0]}`);
    return;
  }
  this.store.rewriteTranscript(input.chatId, turns);
  this.panel.postState();
}

async handleOpenDiff(input: { chatId: string; turn: number; fileIndex: number }): Promise<void> {
  const turns = this.store.loadTranscript(input.chatId);
  const turn = turns[input.turn];
  if (!turn || !turn.files || !turn.patch) return;
  const file = turn.files[input.fileIndex];

  const ws = vscode.workspace.workspaceFolders![0].uri.fsPath;
  const tmpDir = mkdtempSync(join(tmpdir(), 'rc-diff-'));
  // Mirror the workspace file structure inside tmpDir so git apply sees the right relative path
  const targetDir = join(tmpDir, dirname(file.path));
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(targetDir));
  const localPath = join(ws, file.path);
  const current = existsSync(localPath) ? readFileSync(localPath) : Buffer.alloc(0);
  writeFileSync(join(tmpDir, file.path), current);

  const single = filterPatchToFiles(turn.patch, [file.path]);
  await applyPatch(single, tmpDir);

  const left = makeBeforeUri(file.path);
  const right = vscode.Uri.file(join(tmpDir, file.path));
  await vscode.commands.executeCommand('vscode.diff', left, right, `${file.path} (Claude proposal)`);
}
```

- [ ] **Step 2: Wire in extension.ts**

```ts
const chatPanel = new ChatPanel(context.extensionUri, chatStore, {
  onSend: (id, p) => controller.send(id, p),
  onDiffAction: (a) => controller.handleDiffAction(a),
  onOpenDiff: (a) => controller.handleOpenDiff(a),
  onCancel: (id) => controller.cancel(id),
  onDeleteRemote: async (id) => { /* Task 23 */ },
});
```

- [ ] **Step 3: Manual smoke**

Trigger a diff card → click a file row → native diff editor opens. Uncheck one file → click `Apply selected` → only the checked file changes in the workspace.

- [ ] **Step 4: Commit**

```bash
git add extension/src/chat/ChatController.ts extension/src/extension.ts
git commit -m "feat(extension): wire diff card apply/save/reject + native diff"
```

---

### Task 23: onDeleteRemote — call agent DELETE /session/:id

**Files:**
- Create: `extension/src/cli/agent-rest.ts` (small REST helper that shells out to CLI for now)
- Modify: `extension/src/extension.ts`

For v1, "delete on the agent" is done by invoking a small new CLI subcommand, keeping the rule that the extension never opens HTTP directly. We add it now.

- [ ] **Step 1: Add CLI subcommand `delete-session` in src/cli.ts**

```ts
program
  .command('delete-session')
  .description('Remove a chat session from the agent (used by the extension)')
  .requiredOption('--session <uuid>', 'extension UUID to remove')
  .action(async (opts) => {
    const { loadConfig } = await import('./lib/config.ts');
    const { agentRequest } = await import('./lib/client.ts');
    const cfg = await loadConfig(process.cwd());
    await agentRequest(cfg, 'DELETE', `/session/${encodeURIComponent(opts.session)}`);
  });
```

- [ ] **Step 2: Implement extension/src/cli/agent-rest.ts**

```ts
import { CliClient } from './CliClient.ts';

export async function deleteRemoteSession(cli: CliClient, uuid: string): Promise<void> {
  const run = cli.spawn(['delete-session', '--session', uuid]);
  await run.done;
}
```

- [ ] **Step 3: Wire in extension.ts**

```ts
import { deleteRemoteSession } from './cli/agent-rest.ts';

onDeleteRemote: async (id) => {
  try { await deleteRemoteSession(cli, id); }
  catch (e) { output.appendLine(`Failed to delete remote session: ${(e as Error).message}`); }
},
```

- [ ] **Step 4: Manual smoke**

Delete a chat → check `~/.remote-claude/agent-sessions.json` on the Mac Mini → mapping is gone.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts extension/src/cli/agent-rest.ts extension/src/extension.ts
git commit -m "feat(cli,extension): delete-session command and remote cleanup on chat delete"
```

---

### Task 24: Streaming UX polish — coalesce text updates, scroll-to-bottom

**Files:**
- Modify: `extension/src/chat/webview/main.ts`
- Modify: `extension/src/chat/ChatController.ts`

- [ ] **Step 1: Throttle replaceLastAssistant to 100ms in ChatController**

```ts
// at top of ChatController:
private pendingUpdate?: NodeJS.Timeout;

private replaceLastAssistant(chatId: string, text: string, patch: string | null, files: ChangedFile[]): void {
  const apply = () => {
    const turns = this.store.loadTranscript(chatId);
    turns[turns.length - 1] = { role: 'assistant', text, timestamp: Date.now(), patch, files };
    this.store.rewriteTranscript(chatId, turns);
    this.panel.postState();
    this.pendingUpdate = undefined;
  };
  if (this.pendingUpdate) return;     // a write is already scheduled; latest text will be captured
  this.pendingUpdate = setTimeout(apply, 100);
}
```

(Note: this drops intermediate updates between ticks, which is fine — the final state on each tick reflects the latest values via closure capture if we re-read them. Fix the closure:)

```ts
private latestUpdate?: { chatId: string; text: string; patch: string | null; files: ChangedFile[] };

private replaceLastAssistant(chatId: string, text: string, patch: string | null, files: ChangedFile[]): void {
  this.latestUpdate = { chatId, text, patch, files };
  if (this.pendingUpdate) return;
  this.pendingUpdate = setTimeout(() => {
    const u = this.latestUpdate!;
    const turns = this.store.loadTranscript(u.chatId);
    turns[turns.length - 1] = { role: 'assistant', text: u.text, timestamp: Date.now(), patch: u.patch, files: u.files };
    this.store.rewriteTranscript(u.chatId, turns);
    this.panel.postState();
    this.pendingUpdate = undefined;
  }, 100);
}
```

- [ ] **Step 2: Auto-scroll the turns container on state updates**

In `webview/main.ts`, after `renderTurns(state)`:

```ts
turnsEl.scrollTop = turnsEl.scrollHeight;
```

And add to `styles.css`:

```css
#turns { max-height: calc(100vh - 280px); overflow-y: auto; }
```

- [ ] **Step 3: Manual smoke**

Run a long prompt → text appears smoothly, panel auto-scrolls.

- [ ] **Step 4: Commit**

```bash
git add extension/src/chat/ChatController.ts extension/src/chat/webview/
git commit -m "feat(extension): throttle text updates + auto-scroll chat"
```

---

### Milestone 3 checkpoint

Chat panel works end-to-end with safe DOM rendering: new chat, switch, send, stream, diff cards with apply/save/reject, open native diff editor, delete chat (both local and remote), cancel mid-turn. Requires manual `remote-claude.yml` setup until M5.

---

## Milestone 4 — Sync engine + indicators

### Task 25: SyncController (file watcher + debounced rsync)

**Files:**
- Create: `extension/src/sync/SyncController.ts`
- Create: `extension/src/sync/SyncController.test.ts`

- [ ] **Step 1: Write failing test for debounce logic**

```ts
// extension/src/sync/SyncController.test.ts
import { describe, it, expect, vi } from 'vitest';
import { Debouncer } from './SyncController.ts';

describe('Debouncer', () => {
  it('coalesces bursts into one call', async () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = new Debouncer(fn, 500);
    d.trigger(); d.trigger(); d.trigger();
    expect(fn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter remote-claude-vscode test -- SyncController`
Expected: FAIL.

- [ ] **Step 3: Implement extension/src/sync/SyncController.ts**

```ts
import * as vscode from 'vscode';
import type { CliClient } from '../cli/CliClient.ts';

export class Debouncer {
  private timer?: NodeJS.Timeout;
  constructor(private readonly fn: () => void, private readonly ms: number) {}
  trigger(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = undefined; this.fn(); }, this.ms);
  }
  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; this.fn(); }
  }
}

export class SyncController {
  private watcher?: vscode.FileSystemWatcher;
  private debouncer: Debouncer;
  private liveSync = false;
  private suspended = false;
  private outOfSync = new Set<string>();
  private readonly onChange = new vscode.EventEmitter<void>();
  readonly stateChanged = this.onChange.event;

  constructor(private readonly cli: CliClient, private readonly output: vscode.OutputChannel) {
    this.debouncer = new Debouncer(() => this.runRsync().catch((e) => this.output.appendLine(`sync error: ${e.message}`)), 500);
  }

  setLiveSync(on: boolean): void {
    this.liveSync = on;
    if (on) this.startWatcher(); else this.stopWatcher();
    this.onChange.fire();
  }
  isLiveSync(): boolean { return this.liveSync; }
  getOutOfSyncFiles(): string[] { return [...this.outOfSync]; }
  suspendForMs(ms: number): void { this.suspended = true; setTimeout(() => { this.suspended = false; }, ms); }

  async syncOnce(): Promise<void> { await this.runRsync(); }

  private startWatcher(): void {
    if (this.watcher) return;
    this.watcher = vscode.workspace.createFileSystemWatcher('**/*');
    const onAny = (uri: vscode.Uri) => {
      if (this.suspended) return;
      const rel = vscode.workspace.asRelativePath(uri);
      this.outOfSync.add(rel);
      this.onChange.fire();
      this.debouncer.trigger();
    };
    this.watcher.onDidChange(onAny);
    this.watcher.onDidCreate(onAny);
    this.watcher.onDidDelete(onAny);
  }

  private stopWatcher(): void { this.watcher?.dispose(); this.watcher = undefined; }

  private async runRsync(): Promise<void> {
    const run = this.cli.spawn(['sync', '--json']);
    for await (const _e of run.events) { /* ignore for now; could route progress to status bar */ }
    this.outOfSync.clear();
    this.onChange.fire();
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter remote-claude-vscode test -- SyncController`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/src/sync/SyncController.ts extension/src/sync/SyncController.test.ts
git commit -m "feat(extension): add SyncController with debounced rsync"
```

---

### Task 26: StatusBarController + live-sync toggle (per-project persistence)

**Files:**
- Create: `extension/src/statusbar/StatusBarController.ts`
- Modify: `extension/src/commands.ts`
- Modify: `extension/src/extension.ts`

- [ ] **Step 1: Implement StatusBarController.ts**

```ts
import * as vscode from 'vscode';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { SyncController } from '../sync/SyncController.ts';

export class StatusBarController {
  private item: vscode.StatusBarItem;
  private statePath: string;

  constructor(private readonly ws: string, private readonly sync: SyncController) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'remoteClaude.toggleLiveSync';
    this.statePath = join(ws, '.remote-claude', 'state.json');
    this.sync.setLiveSync(this.loadLiveSync());
    this.sync.stateChanged(() => this.refresh());
    this.refresh();
    this.item.show();
  }

  toggle(): void {
    const next = !this.sync.isLiveSync();
    this.sync.setLiveSync(next);
    this.persistLiveSync(next);
  }

  dispose(): void { this.item.dispose(); }

  private refresh(): void {
    if (this.sync.isLiveSync()) { this.item.text = '$(zap) Live sync: ON'; return; }
    const dirty = this.sync.getOutOfSyncFiles().length;
    this.item.text = dirty ? `$(warning) ${dirty} files not synced` : '$(sync) In sync';
  }

  private loadLiveSync(): boolean {
    if (!existsSync(this.statePath)) return false;
    try { return !!JSON.parse(readFileSync(this.statePath, 'utf8')).liveSync; } catch { return false; }
  }

  private persistLiveSync(on: boolean): void {
    mkdirSync(dirname(this.statePath), { recursive: true });
    let state: Record<string, unknown> = {};
    if (existsSync(this.statePath)) {
      try { state = JSON.parse(readFileSync(this.statePath, 'utf8')); } catch { /* ignore */ }
    }
    state.liveSync = on;
    writeFileSync(this.statePath, JSON.stringify(state, null, 2));
  }
}
```

- [ ] **Step 2: Update commands.ts to take SyncController + StatusBarController**

```ts
import type { SyncController } from './sync/SyncController.ts';
import type { StatusBarController } from './statusbar/StatusBarController.ts';

export interface ExtensionDeps {
  output: vscode.OutputChannel;
  chatStore: ChatStore;
  sync: SyncController;
  status: StatusBarController;
}

// update toggleLiveSync handler:
vscode.commands.registerCommand('remoteClaude.toggleLiveSync', () => deps.status.toggle()),
```

- [ ] **Step 3: Wire in extension.ts**

```ts
import { SyncController } from './sync/SyncController.ts';
import { StatusBarController } from './statusbar/StatusBarController.ts';

const sync = new SyncController(cli, output);
const status = new StatusBarController(ws, sync);
context.subscriptions.push({ dispose: () => status.dispose() });
registerCommands(context, { output, chatStore, sync, status });
```

- [ ] **Step 4: Manual smoke**

Open dev host → status bar shows `In sync` → run `Toggle Live Sync` → flips to `Live sync: ON` → edit a file → after ~500ms sync runs and badge stays clean → reload window → toggle state persists.

- [ ] **Step 5: Commit**

```bash
git add extension/src/statusbar/ extension/src/commands.ts extension/src/extension.ts
git commit -m "feat(extension): add status bar + live-sync toggle (per-project)"
```

---

### Task 27: FileDecorationProvider (Explorer badges)

**Files:**
- Create: `extension/src/sync/FileDecorationProvider.ts`
- Modify: `extension/src/extension.ts`

- [ ] **Step 1: Implement FileDecorationProvider.ts**

```ts
import * as vscode from 'vscode';
import type { SyncController } from './SyncController.ts';
import type { ChatStore } from '../chat/ChatStore.ts';

export class FileDecorationProvider implements vscode.FileDecorationProvider {
  private emitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this.emitter.event;
  private pendingFiles = new Set<string>();

  constructor(private readonly sync: SyncController, private readonly chatStore: ChatStore) {
    this.sync.stateChanged(() => this.emitter.fire(undefined));
  }

  setPendingDiffFiles(paths: string[]): void {
    this.pendingFiles = new Set(paths);
    this.emitter.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const rel = vscode.workspace.asRelativePath(uri);
    if (this.pendingFiles.has(rel)) {
      return { badge: '▼', tooltip: 'Pending Claude diff', color: new vscode.ThemeColor('charts.blue') };
    }
    if (this.sync.getOutOfSyncFiles().includes(rel)) {
      return { badge: '●', tooltip: 'Not synced to remote', color: new vscode.ThemeColor('charts.orange') };
    }
    return undefined;
  }
}
```

- [ ] **Step 2: Register in extension.ts**

```ts
import { FileDecorationProvider } from './sync/FileDecorationProvider.ts';
const decor = new FileDecorationProvider(sync, chatStore);
context.subscriptions.push(vscode.window.registerFileDecorationProvider(decor));
```

Also: when a diff card appears, update pending files. In ChatController, after receiving `chat_diff`, push the paths via a callback. Add a `setPendingDiffFiles` hook on ChatController and call it from the controller's diff handling.

(Implementation detail: keep `decor` reference accessible by passing it into ChatController; update its in-flight set whenever a turn ends or files apply/reject.)

- [ ] **Step 3: Manual smoke**

Edit a file with live-sync off → see `●` orange badge in Explorer. After a synced state, badge clears.

- [ ] **Step 4: Commit**

```bash
git add extension/src/sync/FileDecorationProvider.ts extension/src/extension.ts extension/src/chat/ChatController.ts
git commit -m "feat(extension): add Explorer file decorations for sync state"
```

---

### Task 28: Ask-time guard banner

**Files:**
- Modify: `extension/src/chat/webview/main.ts` — show banner when state.warn != null
- Modify: `extension/src/chat/ChatPanel.ts` — include warn in state
- Modify: `extension/src/chat/ChatController.ts` — compute warn before sending

- [ ] **Step 1: Compute warning in ChatController.send (before spawning the CLI)**

```ts
// at top of send(), before appendTurn:
const dirty = this.syncCtrl.getOutOfSyncFiles();
if (!this.syncCtrl.isLiveSync() && dirty.length > 0) {
  const choice = await vscode.window.showInformationMessage(
    `${dirty.length} files changed since last sync.`,
    'Sync first', 'Turn on live sync', 'Send anyway'
  );
  if (choice === undefined) return;
  if (choice === 'Sync first') await this.syncCtrl.syncOnce();
  if (choice === 'Turn on live sync') this.syncCtrl.setLiveSync(true);
  // 'Send anyway' falls through
}
```

ChatController constructor now also takes `syncCtrl: SyncController` and stores it.

- [ ] **Step 2: Wire dependency in extension.ts**

```ts
const controller = new ChatController(cli, chatStore, output, sync);
```

- [ ] **Step 3: Manual smoke**

Disable live-sync → edit a file → hit Send → modal asks 3-way choice → each choice does the right thing.

- [ ] **Step 4: Commit**

```bash
git add extension/src/chat/ChatController.ts extension/src/extension.ts
git commit -m "feat(extension): ask-time guard when live-sync is off and dirty"
```

---

### Milestone 4 checkpoint

Sync engine fully wired: live-sync toggle in status bar, file decorations in Explorer, ask-time guard for dirty trees. Toggle survives reload. M3 + M4 together = a usable chat product, minus onboarding.

---

## Milestone 5 — Setup wizard

### Task 29: SetupWizard webview shell (4 steps)

**Files:**
- Create: `extension/src/setup/SetupWizard.ts`
- Create: `extension/src/setup/webview/main.ts`
- Create: `extension/src/setup/webview/index.html`
- Modify: `extension/src/extension.ts` — open wizard if `remote-claude.yml` is missing
- Modify: `extension/package.json` — build the wizard webview

- [ ] **Step 1: Create the wizard webview HTML + main.ts (uses h() like the chat panel)**

The structure mirrors `chat/webview/index.html`. main.ts renders a step indicator and the current step's form. It posts `wizard:step1Submit`, `wizard:step2Submit`, etc. messages to the host. No `innerHTML`.

(Use the same h.ts helper from chat/webview — copy it into setup/webview to keep the bundles independent, or share via tsconfig path. For v1 we duplicate to keep bundling simple.)

- [ ] **Step 2: Create SetupWizard.ts (webview panel, not view)**

```ts
import * as vscode from 'vscode';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CliClient } from '../cli/CliClient.ts';

export interface WizardOutcome { ok: true; configPath: string } | { ok: false; reason: string };

export class SetupWizard {
  static show(extensionUri: vscode.Uri, cli: CliClient, output: vscode.OutputChannel): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel('remoteClaude.setup', 'Remote Claude — Setup', vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'setup-webview')],
    });
    panel.webview.html = renderHtml(extensionUri, panel.webview);
    panel.webview.onDidReceiveMessage((m) => handleMessage(m, panel, cli, output));
    return panel;
  }
}

function renderHtml(extensionUri: vscode.Uri, webview: vscode.Webview): string { /* same approach as ChatPanel */ return '' }
async function handleMessage(msg: { type: string; [k: string]: unknown }, panel: vscode.WebviewPanel, cli: CliClient, output: vscode.OutputChannel): Promise<void> {
  // wired in next tasks: step1ListPeers, step2InstallKey, step3CloneBoth, step4Doctor
}
```

(The full implementations of step handlers live in tasks 30–33; this task just lands the shell and message wiring.)

- [ ] **Step 3: Open wizard on activation if config missing**

```ts
import { existsSync } from 'node:fs';
import { SetupWizard } from './setup/SetupWizard.ts';

// at the bottom of activate():
const configPath = join(ws, 'remote-claude.yml');
if (!existsSync(configPath)) SetupWizard.show(context.extensionUri, cli, output);
```

- [ ] **Step 4: Build + smoke**

Open an empty workspace → wizard appears. (Steps are still no-ops; will be filled in.)

- [ ] **Step 5: Commit**

```bash
git add extension/src/setup/ extension/src/extension.ts extension/package.json
git commit -m "feat(extension): scaffold SetupWizard webview shell"
```

---

### Task 30: Step 1 — Tailscale peer list

**Files:**
- Modify: `extension/src/setup/SetupWizard.ts` — handle `step1ListPeers`

- [ ] **Step 1: Add handler**

```ts
case 'step1ListPeers': {
  const run = cli.spawn(['setup', '--list-peers', '--json']);
  let out = '';
  // capture child stdout via a separate read: extend CliClient with a captureStdout() helper, or use a separate spawn.
  // For now, spawn directly:
  const cp = await import('node:child_process');
  const r = cp.spawnSync('remote-claude', ['setup', '--list-peers', '--json'], { encoding: 'utf8' });
  const peers = r.status === 0 ? JSON.parse(r.stdout || '[]') : [];
  panel.webview.postMessage({ type: 'step1Peers', peers });
  return;
}
```

(Yes, this uses `spawnSync` directly — a small exception inside the wizard because the CLI call is one-shot and not JSONL. Note in a code comment.)

- [ ] **Step 2: Wizard webview renders peer radio buttons**

In setup-webview main.ts, on `step1Peers` message, render a list of radio inputs using `h()` (no innerHTML). User picks one → posts `step1Submit { host, user, port }`.

- [ ] **Step 3: Manual smoke**

With Tailscale running, the wizard shows your peers. Without, it shows an empty list and a "Manual host" text field.

- [ ] **Step 4: Commit**

```bash
git add extension/src/setup/
git commit -m "feat(setup): step 1 — Tailscale peer picker"
```

---

### Task 31: Step 2 — Password input + ssh-copy-id

**Files:**
- Modify: `extension/src/setup/SetupWizard.ts`

- [ ] **Step 1: Add handler**

```ts
case 'step2Submit': {
  // msg has { host, user, port, password, keyPath }
  const cp = await import('node:child_process');
  const child = cp.spawn('remote-claude', ['setup', '--password-stdin',
    '--host', String(msg.host),
    '--user', String(msg.user),
    '--ssh-port', String(msg.port),
    '--key-path', String(msg.keyPath),
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  const pwBuf = Buffer.from(String(msg.password) + '\n');
  child.stdin.write(pwBuf);
  child.stdin.end();
  pwBuf.fill(0);

  let stdout = '';
  child.stdout.on('data', (c: Buffer) => { stdout += c.toString(); });
  await new Promise<void>((resolve) => child.on('close', () => resolve()));
  const result = JSON.parse(stdout || '{"ok":false,"code":"unknown"}');
  panel.webview.postMessage({ type: 'step2Result', result });
  return;
}
```

- [ ] **Step 2: Wizard webview handles each error code**

In setup-webview main.ts, on `step2Result`:
- `ok: true` → advance to step 3
- `code: 'auth_failed'` → show "Wrong password — try again"
- `code: 'unreachable'` → "Host unreachable. Check Tailscale."
- `code: 'host_key_mismatch'` → show fingerprint mismatch dialog using `h()` (no innerHTML); buttons `Trust new key` and `Cancel`. Trust → re-submit with an extra `trustNewKey: true` flag (extend the handler to call `ssh-keygen -R host` first).

- [ ] **Step 3: Add `--trust-new-key` to the CLI setup-password-stdin path**

Modify `src/commands/setup.ts`:

```ts
if (input.trustNewKey) {
  spawnSync('ssh-keygen', ['-R', input.host]);
  spawnSync('ssh-keygen', ['-R', `[${input.host}]:${input.port}`]);
}
```

Add `trustNewKey?: boolean` to `PasswordStdinInput` and a `--trust-new-key` flag.

- [ ] **Step 4: Manual smoke (against a real Mac Mini)**

Wrong password → see retry message. Right password → key installed; verify with `ssh -i ~/.remote-claude/keys/<host>-<user> user@host` exits 0 without a prompt.

- [ ] **Step 5: Commit**

```bash
git add extension/src/setup/ src/commands/setup.ts
git commit -m "feat(setup): step 2 — password-once ssh-copy-id + host-key trust dialog"
```

---

### Task 32: Step 3 — Git URL clone (both sides)

**Files:**
- Modify: `extension/src/setup/SetupWizard.ts`

- [ ] **Step 1: Add handler**

```ts
case 'step3Submit': {
  // msg has { gitUrl, branch, localPath, projectName }
  const cp = await import('node:child_process');

  // local clone
  const localClone = cp.spawnSync('git', ['clone', '-b', String(msg.branch), String(msg.gitUrl), String(msg.localPath)], { encoding: 'utf8' });
  if (localClone.status !== 0) {
    panel.webview.postMessage({ type: 'step3Result', ok: false, where: 'local', stderr: localClone.stderr });
    return;
  }

  // We don't have config yet, but init-remote needs it. Write a minimal remote-claude.yml first.
  // Step 2 returned a result with host/user/key; the wizard accumulates those in state and includes them here.
  const { writeFileSync } = await import('node:fs');
  const { stringify } = await import('yaml');
  const yamlPath = String(msg.localPath) + '/remote-claude.yml';
  writeFileSync(yamlPath, stringify({
    project: msg.projectName,
    remote: {
      host: msg.host, user: msg.user, sshPort: msg.port,
      path: `~/workspace/${msg.projectName}`,
      agentUrl: `http://${msg.host}:7878`,
      token: '${RC_TOKEN}',
    },
    sync: { exclude: ['build/', '.dart_tool/', 'ios/Pods/', 'node_modules/', '.git/'] },
    ai: { command: 'claude', args: ['--print'], timeoutSec: 600 },
  }));

  // remote clone via init-remote
  const remote = cp.spawnSync('remote-claude', ['init-remote', '--git-url', String(msg.gitUrl), '--branch', String(msg.branch), '--project', String(msg.projectName)], { cwd: String(msg.localPath), encoding: 'utf8' });
  if (remote.status !== 0) {
    panel.webview.postMessage({ type: 'step3Result', ok: false, where: 'remote', stderr: remote.stderr });
    return;
  }
  panel.webview.postMessage({ type: 'step3Result', ok: true });
  return;
}
```

- [ ] **Step 2: Wizard webview shows the clone progress and result**

A spinner during the call; on result, advance to step 4 or show the relevant stderr.

- [ ] **Step 3: Manual smoke (with a real Mac Mini and a small public repo)**

Step 3 completes; both `~/code/<project>` locally and `~/workspace/<project>` on the remote contain the cloned repo.

- [ ] **Step 4: Commit**

```bash
git add extension/src/setup/
git commit -m "feat(setup): step 3 — git clone both sides + write remote-claude.yml"
```

---

### Task 33: Step 4 — Doctor + finish

**Files:**
- Modify: `extension/src/setup/SetupWizard.ts`
- Modify: `extension/src/extension.ts` — trigger refresh after wizard closes

- [ ] **Step 1: Add handler**

```ts
case 'step4Run': {
  const cp = await import('node:child_process');
  const r = cp.spawnSync('remote-claude', ['doctor'], { cwd: String(msg.cwd), encoding: 'utf8' });
  panel.webview.postMessage({ type: 'step4Result', ok: r.status === 0, stdout: r.stdout, stderr: r.stderr });
  return;
}
case 'step4Finish': {
  panel.dispose();
  await vscode.commands.executeCommand('workbench.action.reloadWindow');
  return;
}
```

- [ ] **Step 2: Wizard webview shows green checkmarks for each doctor line**

Parse stdout linewise; render with `h()`. `Finish` button posts `step4Finish`.

- [ ] **Step 3: Manual smoke**

Open empty workspace → wizard runs 1→4 → click Finish → window reloads → chat panel + status bar appear, all connected.

- [ ] **Step 4: Commit**

```bash
git add extension/src/setup/ extension/src/extension.ts
git commit -m "feat(setup): step 4 — doctor + finish + workspace reload"
```

---

### Milestone 5 checkpoint

End-to-end onboarding from a fresh workspace: open empty folder → wizard → enter SSH + password + Git URL → first chat works. v1.0 functionality complete.

---

## Milestone 6 — Resilience

### Task 34: Reload reconciliation for in-flight turns

**Files:**
- Modify: `extension/src/chat/ChatStore.ts` — persist `inFlight` marker per chat
- Modify: `extension/src/chat/ChatController.ts` — on activation, poll `GET /session/:id/status`
- Modify: `src/cli.ts` — add `session-status` subcommand

- [ ] **Step 1: Add `session-status` CLI subcommand**

```ts
program
  .command('session-status')
  .requiredOption('--session <uuid>')
  .action(async (opts) => {
    const { loadConfig } = await import('./lib/config.ts');
    const { agentRequest } = await import('./lib/client.ts');
    const cfg = await loadConfig(process.cwd());
    const out = await agentRequest(cfg, 'GET', `/session/${encodeURIComponent(opts.session)}/status`);
    process.stdout.write(JSON.stringify(out));
  });
```

- [ ] **Step 2: ChatStore tracks in-flight markers in state.json**

```ts
// in ChatStore: setInFlight(id, on) → writes .remote-claude/state.json (in-flight list)
// on construct: loadInFlight() returns string[]
```

- [ ] **Step 3: ChatController.activateRecovery()**

```ts
async activateRecovery(): Promise<void> {
  for (const id of this.store.loadInFlight()) {
    const status = await this.runSessionStatus(id);
    if (!status || status.status === 'done') {
      // turn completed while we were gone; we don't have the diff anymore (one-shot stream).
      // Append a system turn noting recovery.
      this.store.appendTurn(id, { role: 'system', text: 'Previous turn completed while VS Code was reloading. Re-run to get the diff.', timestamp: Date.now() });
    } else if (status.status === 'in_flight') {
      this.store.appendTurn(id, { role: 'system', text: 'Previous turn is still running on the remote. Polling…', timestamp: Date.now() });
      // No reattach in v1 — instruct user to wait & retry. v2 can re-stream via SSE.
    }
    this.store.setInFlight(id, false);
  }
}

private async runSessionStatus(uuid: string): Promise<{ status: string } | undefined> {
  const r = this.cli.spawn(['session-status', '--session', uuid]);
  let out = '';
  // (CliClient already swallows JSONL; for one-shot capture, we read the raw stdout — add a captureStdout helper to CliClient.)
  await r.done;
  return undefined; // placeholder
}
```

(Note: the v1 reload reconciliation is intentionally minimal — surface the situation to the user, don't attempt to reattach. Full reattach is deferred per the spec.)

- [ ] **Step 4: Call from extension.ts after init**

```ts
controller.activateRecovery().catch((e) => output.appendLine(`recovery: ${e.message}`));
```

- [ ] **Step 5: Manual smoke**

Start a long turn → close VS Code mid-flight → reopen → system message in the chat explains the situation.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts extension/src/chat/ChatStore.ts extension/src/chat/ChatController.ts extension/src/extension.ts
git commit -m "feat(extension): minimal reload reconciliation for in-flight turns"
```

---

### Task 35: Error mapping — typed error events surface as inline chat messages

**Files:**
- Modify: `extension/src/chat/ChatController.ts`

- [ ] **Step 1: Add an error → friendly-message map**

```ts
const ERROR_MESSAGES: Record<string, string> = {
  cli_stderr:    'The CLI produced an error. Check Output → Remote Claude.',
  turn_failed:   'The remote couldn’t complete this turn.',
  timeout:       'Claude took too long. Try splitting the request, or increase RC_TIMEOUT_SEC on the remote.',
  busy:          'A turn is already in flight. Wait for it to finish.',
  unknown:       'An unexpected error occurred.',
};

// inside the event loop:
} else if (ev.type === 'error') {
  const friendly = ERROR_MESSAGES[ev.code] ?? `${ev.code}: ${ev.message}`;
  this.store.appendTurn(chatId, { role: 'system', text: friendly, timestamp: Date.now() });
  this.output.appendLine(`[error ${ev.code}] ${ev.message}`);
}
```

- [ ] **Step 2: Manual smoke**

Force a timeout (set `RC_TIMEOUT_SEC=1` on the agent, send a long prompt) → see the friendly message in the chat.

- [ ] **Step 3: Commit**

```bash
git add extension/src/chat/ChatController.ts
git commit -m "feat(extension): map error event codes to friendly chat messages"
```

---

### Task 36: Smoke test for the extension (`scripts/smoke-extension.sh`)

**Files:**
- Create: `scripts/smoke-extension.sh`
- Modify: `package.json` (root) — `smoke:extension` script

- [ ] **Step 1: Create the smoke script**

```bash
#!/usr/bin/env bash
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"

# 1. build everything
( cd "$REPO" && pnpm -r build )

# 2. typecheck both packages
( cd "$REPO" && pnpm -r typecheck )

# 3. unit tests
( cd "$REPO" && pnpm -r test )

# 4. extension integration tests (vscode-test-electron) if available
if [ -d "$REPO/extension/.vscode-test" ] || [ -n "${RC_E2E:-}" ]; then
  ( cd "$REPO/extension" && pnpm exec vscode-test || true )
fi

echo "OK"
```

- [ ] **Step 2: Make executable + add script**

```bash
chmod +x scripts/smoke-extension.sh
```

Add to root `package.json`:
```json
"smoke:extension": "bash scripts/smoke-extension.sh"
```

- [ ] **Step 3: Run**

Run: `pnpm smoke:extension`
Expected: exits 0; prints OK.

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke-extension.sh package.json
git commit -m "chore: add extension smoke script"
```

---

### Milestone 6 checkpoint

Extension survives reloads with informative messages, surfaces typed errors as friendly chat turns, and has a smoke script that wraps build + typecheck + unit + integration tests. Ready to be tagged as v1.0.

---

## Self-review checklist (for plan author)

- [x] **Spec coverage:** each section of the spec maps to tasks (onboarding → M5, chat session model → M3 + Task 7, sync → M4, diff apply → Tasks 18 + 22, components → M2/M3, error handling → Task 35, testing → Task 36).
- [x] **No placeholders:** every step has either complete code, a real shell command, or a concrete instruction.
- [x] **Type consistency:** `CliEvent`, `ChatSummary`, `Turn`, `ChangedFile`, `ApplyResult` are defined once and reused.
- [x] **No `innerHTML`:** all webview rendering uses `h()` / `textContent` / `createElement`. User content (chat titles, assistant text, file paths) flows through `textContent` only.
- [x] **TDD where it pays off:** logic modules (parser, sshpass, sessionStore, applyPatch, chat orchestration, sync debounce) have failing-test-first steps. UI scaffolding uses manual smoke tests, which the skill explicitly permits.
- [x] **Each milestone ends in testable software** per the table at the top.

## Known v1 limitations (carry forward to v1.1)

- Reload reconciliation does not reattach to an in-flight stream; it surfaces a system message.
- Tool-use frames from Claude are summarized as plain text, not rendered specially.
- A single in-flight turn per chat is enforced; concurrent turns are deferred.
- The webview is plain DOM; React + a richer component library is a future polish pass.
- Reload during sync mid-flight is harmless but undocumented.
