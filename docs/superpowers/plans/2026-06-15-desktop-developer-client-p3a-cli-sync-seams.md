# Desktop Developer Client — Phase 3a (CLI mutagen sync-session seams) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `patchwire` CLI commands to drive a continuous mutagen sync session (start / status / watch / pause / resume / flush / stop), porting the proven logic from the VS Code extension's `MutagenController` into a shared, testable CLI library — so the desktop client (P3b) can supervise sync without reimplementing mutagen.

**Architecture:** A new pure-where-possible `packages/cli/src/lib/mutagen.ts` library encapsulates session-name derivation, the exact `mutagen sync` command argument arrays, status parsing, and conflict extraction — all driven through an **injectable command runner** so unit tests need no real mutagen binary. New flat CLI commands (`sync-start`, `sync-status`, `sync-watch`, `sync-pause`, `sync-resume`, `sync-flush`, `sync-stop`, matching the existing `host-check`/`host-logs` naming convention) wrap the library and emit JSON. The mutagen binary is resolved via the existing `@patchwire/core` `resolveMutagen()`. The remote endpoint + ignores come from `loadConfig(cwd)` (so commands run in the project directory). The existing one-shot `sync` (rsync push) command is untouched.

**Tech Stack:** Node CLI (commander), `@patchwire/core` (HostPlatform `resolveMutagen`), mutagen binary, Vitest (CLI harness in `packages/cli/test/`).

**Spec:** `docs/superpowers/specs/2026-06-15-desktop-developer-client-design.md` (P3 sync). **Context:** continuous two-way sync is mutagen; today it lives only in `packages/extension/src/sync/MutagenController.ts`. P3a ports that into the CLI. P3b (separate plan) builds the desktop supervision UI on these seams.

**Source to port (read it):** `packages/extension/src/sync/MutagenController.ts`. The mutagen-command logic is pure/portable; only `vscode.EventEmitter`/`OutputChannel` are VS Code-coupled and must be replaced (callback/logger). Do NOT modify the extension in P3a.

**Working dir:** `packages/cli`. Tests: `pnpm --filter @rebink/patchwire test` (test files live in `packages/cli/test/**`).

**Status JSON contract (consumed by P3b desktop):** every command prints (with `--json`) a single line, except `sync-watch` which streams status lines:
- status line: `{"type":"sync_status","kind":"<kind>","conflicts":["path",...]}` where `kind` ∈ `not_installed|no_session|connecting|watching|syncing|conflict|paused|error`. `conflicts` present (possibly `[]`).
- action result line (start/pause/resume/flush/stop): `{"type":"sync_action","action":"<name>","ok":true}` or `{"type":"error","message":"..."}`.

---

## File Structure
- Create: `packages/cli/src/lib/mutagen.ts` — session lib (pure helpers + runner-based ops).
- Test: `packages/cli/test/mutagen.test.ts`.
- Create: `packages/cli/src/lib/mutagen-ssh.ts` — `ensureSshConfigStanza` port (fs-based).
- Test: `packages/cli/test/mutagen-ssh.test.ts`.
- Create: `packages/cli/src/commands/sync-session.ts` — command handlers (`runSyncStart`, `runSyncStatus`, `runSyncWatch`, `runSyncPause`, `runSyncResume`, `runSyncFlush`, `runSyncStop`).
- Test: `packages/cli/test/sync-session.test.ts`.
- Modify: `packages/cli/src/cli.ts` — register the 7 flat commands.

---

### Task 1: Mutagen pure helpers + types (TDD)

**Files:**
- Create: `packages/cli/src/lib/mutagen.ts`
- Test: `packages/cli/test/mutagen.test.ts`

> Port verbatim from `MutagenController.ts`: session-name derivation (lines ~86–92), the `sync create` arg array (lines ~194–205) incl. `IGNORE_PATTERNS` (lines ~32–45) and `mergeIgnores`, the status template parse (lines ~283–315), and `extractConflictPaths` (lines ~342–361). Keep them PURE (no spawn) in this task; the runner-based ops come in Task 3.

- [ ] **Step 1: Write the failing test `packages/cli/test/mutagen.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import {
  sessionName,
  buildCreateArgs,
  parseStatusLine,
  extractConflictPaths,
  type MutagenTarget,
} from "../src/lib/mutagen.ts";

const target: MutagenTarget = {
  project: "api-server",
  host: "studio-mini",
  user: "rebin",
  localPath: "/home/rebin/code/api-server",
  remotePath: "/remote/api-server",
  ignore: ["build/"],
};

describe("sessionName", () => {
  it("derives rc-<project>-<host> sanitized", () => {
    expect(sessionName("api-server", "studio-mini")).toBe("rc-api-server-studio-mini");
  });
  it("lowercases, replaces non [a-z0-9-], collapses + trims dashes", () => {
    expect(sessionName("My_App!", "Host.Local")).toBe("rc-my-app-host-local");
  });
});

describe("buildCreateArgs", () => {
  it("builds the two-way-resolved create args with beta endpoint and ignores", () => {
    const args = buildCreateArgs("rc-api-server-studio-mini", target);
    expect(args.slice(0, 6)).toEqual([
      "sync", "create", "--name", "rc-api-server-studio-mini", "--mode", "two-way-resolved",
    ]);
    expect(args).toContain("--symlink-mode");
    expect(args).toContain("posix-raw");
    expect(args).toContain("--ignore-vcs");
    // baseline + project ignore each prefixed by --ignore
    expect(args).toContain("node_modules");
    expect(args).toContain("build/");
    // endpoints last: localPath then user@host:remotePath
    expect(args.at(-2)).toBe("/home/rebin/code/api-server");
    expect(args.at(-1)).toBe("rebin@studio-mini:/remote/api-server");
  });
});

describe("parseStatusLine", () => {
  it("paused beats everything", () => {
    expect(parseStatusLine("Watching|true|0").kind).toBe("paused");
  });
  it("conflict count > 0 → conflict", () => {
    expect(parseStatusLine("Watching|false|2").kind).toBe("conflict");
  });
  it("watching / ready / empty → watching", () => {
    expect(parseStatusLine("Watching|false|0").kind).toBe("watching");
    expect(parseStatusLine("Ready|false|0").kind).toBe("watching");
    expect(parseStatusLine("|false|0").kind).toBe("watching");
  });
  it("connect → connecting", () => {
    expect(parseStatusLine("Connecting...|false|0").kind).toBe("connecting");
  });
  it("scanning/staging/reconciling → syncing", () => {
    expect(parseStatusLine("Scanning|false|0").kind).toBe("syncing");
    expect(parseStatusLine("Staging files...|false|0").kind).toBe("syncing");
    expect(parseStatusLine("Reconciling|false|0").kind).toBe("syncing");
  });
});

describe("extractConflictPaths", () => {
  it("pulls paths from a Conflicts: section", () => {
    const longOut = [
      "Name: rc-x",
      "Status: Watching",
      "Conflicts:",
      "  α (src/upload.ts)",
      "  β (src/upload.ts)",
      "",
      "Other: stuff",
    ].join("\n");
    expect(extractConflictPaths(longOut)).toContain("src/upload.ts");
  });
  it("returns [] when no conflicts section", () => {
    expect(extractConflictPaths("Name: x\nStatus: Watching\n")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @rebink/patchwire test mutagen.test.ts`
Expected: FAIL — `../src/lib/mutagen.ts` not found.

- [ ] **Step 3: Write `packages/cli/src/lib/mutagen.ts`**

Port the exact logic from `MutagenController.ts`. Implement:
```ts
export type MutagenStatus =
  | { kind: "not_installed" }
  | { kind: "no_session" }
  | { kind: "connecting" }
  | { kind: "watching" }
  | { kind: "syncing"; transferring?: number }
  | { kind: "conflict"; files: string[] }
  | { kind: "paused" }
  | { kind: "error"; message: string };

export interface MutagenTarget {
  project: string;
  host: string;
  user: string;
  sshPort?: number;
  localPath: string;
  remotePath: string;
  ignore?: string[];
}

// Baseline ignores — port IGNORE_PATTERNS verbatim from MutagenController.ts
const IGNORE_PATTERNS = [
  "node_modules", ".next", "dist", "build", ".dart_tool",
  "ios/Pods", ".DS_Store", ".patchwire", ".devbridge",
];

function mergeIgnores(base: string[], extra: string[]): string[] {
  return [...base, ...extra.filter((p) => !base.includes(p))];
}

export function sessionName(project: string, host: string): string {
  const raw = `rc-${project}-${host}`.toLowerCase();
  return raw.replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
}

export function buildCreateArgs(name: string, target: MutagenTarget): string[] {
  const beta = `${target.user}@${target.host}:${target.remotePath}`;
  return [
    "sync", "create",
    "--name", name,
    "--mode", "two-way-resolved",
    "--symlink-mode", "posix-raw",
    "--ignore-vcs",
    ...mergeIgnores(IGNORE_PATTERNS, target.ignore ?? []).flatMap((p) => ["--ignore", p]),
    "--default-file-mode", "0644",
    "--default-directory-mode", "0755",
    target.localPath,
    beta,
  ];
}

// Parse one line of `mutagen sync list --template "{{ range . }}{{ .Status }}|{{ .Paused }}|{{ len .Conflicts }}{{ end }}"`
export function parseStatusLine(out: string): MutagenStatus {
  const parts = out.trim().split("|");
  const statusWord = parts[0] ?? "";
  const paused = (parts[1] ?? "").toLowerCase() === "true";
  const conflictCount = Number(parts[2] ?? "0");
  if (paused) return { kind: "paused" };
  if (conflictCount > 0) return { kind: "conflict", files: [] };
  const s = statusWord.toLowerCase();
  if (s.includes("watching") || s.includes("ready") || s === "") return { kind: "watching" };
  if (s.includes("connect")) return { kind: "connecting" };
  return { kind: "syncing" };
}

export function extractConflictPaths(longOut: string): string[] {
  const lines = longOut.split("\n");
  const out: string[] = [];
  let inConflicts = false;
  for (const line of lines) {
    if (/^Conflicts:/i.test(line.trim())) { inConflicts = true; continue; }
    if (inConflicts) {
      if (!line.trim()) { inConflicts = false; continue; }
      const m = line.match(/(?:α|β)\s*\(([^)]+)\)/) || line.match(/^\s*[α|β]?\s*"?([^"\s][^"\n]+)"?\s*$/);
      if (m && m[1]) out.push(m[1]);
    }
  }
  return out;
}

export const MUTAGEN_STATUS_TEMPLATE =
  "{{ range . }}{{ .Status }}|{{ .Paused }}|{{ len .Conflicts }}{{ end }}";
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @rebink/patchwire test mutagen.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/mutagen.ts packages/cli/test/mutagen.test.ts
git commit -m "feat(cli): mutagen session pure helpers (port from extension MutagenController)"
```

---

### Task 2: SSH config stanza port (TDD)

**Files:**
- Create: `packages/cli/src/lib/mutagen-ssh.ts`
- Test: `packages/cli/test/mutagen-ssh.test.ts`

> Port `ensureSshConfigStanza` (MutagenController.ts ~103–145). Mutagen's beta endpoint (`user@host:path`) connects over SSH using a managed `~/.ssh/config` stanza pointing at the per-project key `~/.patchwire/keys/<host>-<user>`. Make the home dir injectable so tests use a temp dir.

- [ ] **Step 1: Write the failing test `packages/cli/test/mutagen-ssh.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSshConfigStanza } from "../src/lib/mutagen-ssh.ts";

describe("ensureSshConfigStanza", () => {
  let home: string;
  beforeEach(async () => { home = await mkdtemp(join(tmpdir(), "pw-ssh-")); });
  afterEach(async () => { await rm(home, { recursive: true, force: true }); });

  it("writes a managed stanza when the key exists", async () => {
    await mkdir(join(home, ".patchwire", "keys"), { recursive: true });
    await writeFile(join(home, ".patchwire", "keys", "studio-mini-rebin"), "KEY", "utf8");
    ensureSshConfigStanza({ host: "studio-mini", user: "rebin" }, home);
    const cfg = await readFile(join(home, ".ssh", "config"), "utf8");
    expect(cfg).toContain("# === Patchwire managed: studio-mini ===");
    expect(cfg).toContain("Host studio-mini");
    expect(cfg).toContain("User rebin");
    expect(cfg).toContain(join(home, ".patchwire", "keys", "studio-mini-rebin"));
    expect(cfg).toContain("IdentitiesOnly yes");
  });

  it("does nothing when the key is missing", async () => {
    ensureSshConfigStanza({ host: "studio-mini", user: "rebin" }, home);
    // No key → no config written (or empty). Reading should reject or be empty.
    let wrote = true;
    try { await readFile(join(home, ".ssh", "config"), "utf8"); } catch { wrote = false; }
    expect(wrote).toBe(false);
  });

  it("replaces an existing managed stanza instead of duplicating", async () => {
    await mkdir(join(home, ".patchwire", "keys"), { recursive: true });
    await writeFile(join(home, ".patchwire", "keys", "studio-mini-rebin"), "KEY", "utf8");
    ensureSshConfigStanza({ host: "studio-mini", user: "rebin" }, home);
    ensureSshConfigStanza({ host: "studio-mini", user: "rebin" }, home);
    const cfg = await readFile(join(home, ".ssh", "config"), "utf8");
    const count = (cfg.match(/# === Patchwire managed: studio-mini ===/g) ?? []).length;
    expect(count).toBe(1);
  });

  it("includes a Port line only when sshPort is set and not 22", async () => {
    await mkdir(join(home, ".patchwire", "keys"), { recursive: true });
    await writeFile(join(home, ".patchwire", "keys", "studio-mini-rebin"), "KEY", "utf8");
    ensureSshConfigStanza({ host: "studio-mini", user: "rebin", sshPort: 2222 }, home);
    const cfg = await readFile(join(home, ".ssh", "config"), "utf8");
    expect(cfg).toContain("Port 2222");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @rebink/patchwire test mutagen-ssh.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `packages/cli/src/lib/mutagen-ssh.ts`**

Port `ensureSshConfigStanza` with an injectable home dir (default `os.homedir()`):
```ts
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";

export interface SshStanzaTarget {
  host: string;
  user: string;
  sshPort?: number;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function ensureSshConfigStanza(target: SshStanzaTarget, home: string = homedir()): void {
  const sshDir = join(home, ".ssh");
  const cfgPath = join(sshDir, "config");
  const keyPath = join(home, ".patchwire", "keys", `${target.host}-${target.user}`);
  if (!existsSync(keyPath)) return;

  mkdirSync(sshDir, { recursive: true });
  chmodSync(sshDir, 0o700);

  const marker = `# === Patchwire managed: ${target.host} ===`;
  const endMarker = `# === Patchwire managed: ${target.host} end ===`;
  const block = [
    marker,
    `Host ${target.host}`,
    `  HostName ${target.host}`,
    `  User ${target.user}`,
    `  IdentityFile ${keyPath}`,
    `  IdentitiesOnly yes`,
    `  IdentityAgent none`,
    `  StrictHostKeyChecking accept-new`,
    ...(target.sshPort && target.sshPort !== 22 ? [`  Port ${target.sshPort}`] : []),
    endMarker,
    "",
  ].join("\n");

  let existing = "";
  try { existing = readFileSync(cfgPath, "utf8"); } catch { /* none */ }
  const stanzaRe = new RegExp(`\\n*${escapeRegex(marker)}[\\s\\S]*?${escapeRegex(endMarker)}\\n?`, "g");
  const cleaned = existing.replace(stanzaRe, "");
  const next = `${block}\n${cleaned.replace(/^\n+/, "")}`;
  writeFileSync(cfgPath, next, "utf8");
  chmodSync(cfgPath, 0o600);
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @rebink/patchwire test mutagen-ssh.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/mutagen-ssh.ts packages/cli/test/mutagen-ssh.test.ts
git commit -m "feat(cli): port ssh-config stanza management for mutagen beta endpoint"
```

---

### Task 3: Runner-based session ops (TDD)

**Files:**
- Modify: `packages/cli/src/lib/mutagen.ts`
- Modify: `packages/cli/test/mutagen.test.ts`

> Add runner-based operations on top of the pure helpers. A `MutagenRunner` is `(args: string[]) => { status: number; stdout: string; stderr: string }` — injected so tests feed canned output and assert the args. In production it wraps `spawnSync(mutagenBin, args, ...)`.

- [ ] **Step 1: Add failing tests to `packages/cli/test/mutagen.test.ts`**

```ts
import { ensureSession, getStatus, pauseSession, resumeSession, flushSession, stopSession } from "../src/lib/mutagen.ts";

function fakeRunner(responses: Record<string, { status?: number; stdout?: string; stderr?: string }>) {
  const calls: string[][] = [];
  const run = (args: string[]) => {
    calls.push(args);
    // key by the mutagen subcommand (args[1]) for simplicity
    const key = args[1];
    const r = responses[key] ?? {};
    return { status: r.status ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
  return { run, calls };
}

describe("getStatus", () => {
  it("returns no_session when list exits non-zero", () => {
    const { run } = fakeRunner({ list: { status: 1 } });
    expect(getStatus(run, "rc-x").kind).toBe("no_session");
  });
  it("parses a watching status", () => {
    const { run } = fakeRunner({ list: { status: 0, stdout: "Watching|false|0" } });
    expect(getStatus(run, "rc-x").kind).toBe("watching");
  });
  it("on conflict, fetches --long and fills files", () => {
    const longOut = "Conflicts:\n  α (a.ts)\n\n";
    let n = 0;
    const run = (args: string[]) => {
      // first list = template (conflict count 1), second list = --long
      if (args.includes("--long")) return { status: 0, stdout: longOut, stderr: "" };
      n++;
      return { status: 0, stdout: "Watching|false|1", stderr: "" };
    };
    const s = getStatus(run, "rc-x");
    expect(s.kind).toBe("conflict");
    if (s.kind === "conflict") expect(s.files).toContain("a.ts");
  });
});

describe("ensureSession", () => {
  it("creates the session when it does not exist", () => {
    // existence check (template Name) returns empty → create
    const calls: string[][] = [];
    const run = (args: string[]) => {
      calls.push(args);
      if (args.includes("create")) return { status: 0, stdout: "", stderr: "" };
      return { status: 0, stdout: "", stderr: "" }; // list returns empty name
    };
    ensureSession(run, { project: "api", host: "h", user: "u", localPath: "/l", remotePath: "/r" });
    expect(calls.some((a) => a.includes("create"))).toBe(true);
  });
});

describe("pause/resume/flush/stop", () => {
  it("issue the right mutagen subcommands", () => {
    const { run, calls } = fakeRunner({});
    pauseSession(run, "rc-x"); resumeSession(run, "rc-x"); flushSession(run, "rc-x"); stopSession(run, "rc-x");
    expect(calls).toEqual([
      ["sync", "pause", "rc-x"],
      ["sync", "resume", "rc-x"],
      ["sync", "flush", "rc-x"],
      ["sync", "terminate", "rc-x"],
    ]);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @rebink/patchwire test mutagen.test.ts`
Expected: FAIL — new exports not found.

- [ ] **Step 3: Add runner-based ops to `packages/cli/src/lib/mutagen.ts`**

```ts
export interface RunResult { status: number; stdout: string; stderr: string }
export type MutagenRunner = (args: string[]) => RunResult;

export function getStatus(run: MutagenRunner, name: string): MutagenStatus {
  const r = run(["sync", "list", name, "--template", MUTAGEN_STATUS_TEMPLATE]);
  if (r.status !== 0) return { kind: "no_session" };
  const status = parseStatusLine(r.stdout);
  if (status.kind === "conflict") {
    const long = run(["sync", "list", name, "--long"]);
    return { kind: "conflict", files: extractConflictPaths(long.stdout || "").slice(0, 10) };
  }
  return status;
}

export function ensureSession(run: MutagenRunner, target: MutagenTarget): void {
  const name = sessionName(target.project, target.host);
  const exists = run(["sync", "list", name, "--template", "{{ range . }}{{ .Name }}{{ end }}"]);
  if (exists.status === 0 && exists.stdout.trim() !== "") return; // already exists
  run(buildCreateArgs(name, target));
}

export function pauseSession(run: MutagenRunner, name: string): void { run(["sync", "pause", name]); }
export function resumeSession(run: MutagenRunner, name: string): void { run(["sync", "resume", name]); }
export function flushSession(run: MutagenRunner, name: string): void { run(["sync", "flush", name]); }
export function stopSession(run: MutagenRunner, name: string): void { run(["sync", "terminate", name]); }
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @rebink/patchwire test mutagen.test.ts`
Expected: PASS (Task 1 + Task 3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/mutagen.ts packages/cli/test/mutagen.test.ts
git commit -m "feat(cli): runner-based mutagen session ops (status/ensure/pause/resume/flush/stop)"
```

---

### Task 4: Command handlers wiring resolver + config + runner (TDD)

**Files:**
- Create: `packages/cli/src/commands/sync-session.ts`
- Test: `packages/cli/test/sync-session.test.ts`

> The handlers build a `MutagenTarget` from `loadConfig(cwd)` + the project basename, resolve the mutagen binary via `@patchwire/core`, build a real `spawnSync` runner, ensure the SSH stanza, then call the lib ops. For TDD, the handlers accept an injectable `deps` object (`{ run, resolveBin, loadConfig, ensureSsh, print, now }`) so tests pass a fake runner/config and capture printed JSON. Read how the existing `host-check`/`sync` commands obtain config (`loadConfig`) and how `@patchwire/core` exposes the mutagen target fields (host/user/remotePath/ignore) — reuse those exact sources.

- [ ] **Step 1: Write the failing test `packages/cli/test/sync-session.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import {
  runSyncStatus, runSyncStart, runSyncPause, runSyncResume, runSyncFlush, runSyncStop,
  type SyncDeps,
} from "../src/commands/sync-session.ts";

const target = { project: "api", host: "h", user: "u", localPath: "/l", remotePath: "/r", ignore: [] as string[] };

function deps(over: Partial<SyncDeps> = {}): { deps: SyncDeps; lines: string[]; calls: string[][] } {
  const lines: string[] = [];
  const calls: string[][] = [];
  const d: SyncDeps = {
    loadTarget: () => target,
    resolveBin: async () => "mutagen",
    ensureSsh: () => {},
    run: (args) => { calls.push(args); return { status: 0, stdout: "Watching|false|0", stderr: "" }; },
    print: (l) => lines.push(l),
    ...over,
  };
  return { deps: d, lines, calls };
}

describe("runSyncStatus", () => {
  it("prints a sync_status JSON line", async () => {
    const { deps: d, lines } = deps();
    await runSyncStatus("/cwd", d);
    expect(JSON.parse(lines.at(-1)!)).toEqual({ type: "sync_status", kind: "watching", conflicts: [] });
  });
  it("emits not_installed when the binary cannot be resolved", async () => {
    const { deps: d, lines } = deps({ resolveBin: async () => null });
    await runSyncStatus("/cwd", d);
    expect(JSON.parse(lines.at(-1)!)).toEqual({ type: "sync_status", kind: "not_installed", conflicts: [] });
  });
});

describe("runSyncStart", () => {
  it("ensures ssh + session and prints a sync_action ok line", async () => {
    let sshCalled = false;
    const { deps: d, lines, calls } = deps({ ensureSsh: () => { sshCalled = true; } });
    await runSyncStart("/cwd", d);
    expect(sshCalled).toBe(true);
    expect(JSON.parse(lines.at(-1)!)).toEqual({ type: "sync_action", action: "start", ok: true });
  });
});

describe("pause/resume/flush/stop handlers", () => {
  it("each prints its sync_action line", async () => {
    for (const [fn, action] of [
      [runSyncPause, "pause"], [runSyncResume, "resume"], [runSyncFlush, "flush"], [runSyncStop, "stop"],
    ] as const) {
      const { deps: d, lines } = deps();
      await fn("/cwd", d);
      expect(JSON.parse(lines.at(-1)!)).toEqual({ type: "sync_action", action, ok: true });
    }
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @rebink/patchwire test sync-session.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `packages/cli/src/commands/sync-session.ts`**

```ts
import { spawnSync } from "node:child_process";
import {
  sessionName, ensureSession, getStatus, pauseSession, resumeSession, flushSession, stopSession,
  type MutagenTarget, type MutagenRunner, type MutagenStatus,
} from "../lib/mutagen.ts";
import { ensureSshConfigStanza } from "../lib/mutagen-ssh.ts";

export interface SyncDeps {
  loadTarget: (cwd: string) => MutagenTarget;
  resolveBin: () => Promise<string | null>;
  ensureSsh: (t: { host: string; user: string; sshPort?: number }) => void;
  run: MutagenRunner;            // bound to the resolved binary in production
  print: (line: string) => void;
}

function emitStatus(print: (l: string) => void, status: MutagenStatus): void {
  const conflicts = status.kind === "conflict" ? status.files : [];
  print(JSON.stringify({ type: "sync_status", kind: status.kind, conflicts }));
}

// Production deps factory (used by cli.ts). Builds the target from config + a spawnSync runner.
export async function realDeps(loadTargetFromConfig: (cwd: string) => MutagenTarget): Promise<Omit<SyncDeps, "run"> & { makeRun: (bin: string) => MutagenRunner }> {
  const { createNodeHostPlatform } = await import("@patchwire/core");
  return {
    loadTarget: loadTargetFromConfig,
    resolveBin: async () => {
      try { return await createNodeHostPlatform().resolveMutagen(); } catch { return null; }
    },
    ensureSsh: (t) => ensureSshConfigStanza(t),
    print: (l) => console.log(l),
    makeRun: (bin) => (args) => {
      const r = spawnSync(bin, args, { encoding: "utf8", timeout: 60000 });
      return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
  };
}

export async function runSyncStatus(cwd: string, deps: SyncDeps): Promise<void> {
  const bin = await deps.resolveBin();
  if (!bin) { emitStatus(deps.print, { kind: "not_installed" }); return; }
  const t = deps.loadTarget(cwd);
  emitStatus(deps.print, getStatus(deps.run, sessionName(t.project, t.host)));
}

export async function runSyncStart(cwd: string, deps: SyncDeps): Promise<void> {
  const bin = await deps.resolveBin();
  if (!bin) { emitStatus(deps.print, { kind: "not_installed" }); return; }
  const t = deps.loadTarget(cwd);
  deps.ensureSsh({ host: t.host, user: t.user, sshPort: t.sshPort });
  ensureSession(deps.run, t);
  deps.print(JSON.stringify({ type: "sync_action", action: "start", ok: true }));
}

function actionRunner(action: "pause" | "resume" | "flush" | "stop", op: (run: MutagenRunner, name: string) => void) {
  return async (cwd: string, deps: SyncDeps): Promise<void> => {
    const bin = await deps.resolveBin();
    if (!bin) { emitStatus(deps.print, { kind: "not_installed" }); return; }
    const t = deps.loadTarget(cwd);
    op(deps.run, sessionName(t.project, t.host));
    deps.print(JSON.stringify({ type: "sync_action", action, ok: true }));
  };
}

export const runSyncPause = actionRunner("pause", pauseSession);
export const runSyncResume = actionRunner("resume", resumeSession);
export const runSyncFlush = actionRunner("flush", flushSession);
export const runSyncStop = actionRunner("stop", stopSession);
```

(If `@patchwire/core` does not export `createNodeHostPlatform` under that name, read `packages/core` and use the real export. If building the `MutagenTarget` from `loadConfig` needs specific field names, read `packages/cli/src/lib/config.ts` and the existing `sync`/`host-check` commands to get host/user/remotePath/localPath/ignore from the loaded config + cwd basename, and write that `loadTargetFromConfig` mapping in cli.ts Task 6.)

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @rebink/patchwire test sync-session.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/sync-session.ts packages/cli/test/sync-session.test.ts
git commit -m "feat(cli): sync-session command handlers (status/start/pause/resume/flush/stop)"
```

---

### Task 5: `runSyncWatch` streaming handler (TDD)

**Files:**
- Modify: `packages/cli/src/commands/sync-session.ts`
- Modify: `packages/cli/test/sync-session.test.ts`

> `sync-watch` ensures the session then polls status every interval and prints a `sync_status` line each tick until the process is killed (the desktop supervises it and kills to stop). For TDD, inject the poll interval + a `shouldContinue` predicate (or a max-ticks count) so the test runs a bounded number of polls without a real timer.

- [ ] **Step 1: Add a failing test to `packages/cli/test/sync-session.test.ts`**

```ts
import { runSyncWatch } from "../src/commands/sync-session.ts";

describe("runSyncWatch", () => {
  it("ensures the session then emits one status line per tick for the bounded run", async () => {
    const lines: string[] = [];
    let calls = 0;
    const d = {
      loadTarget: () => target,
      resolveBin: async () => "mutagen",
      ensureSsh: () => {},
      run: (args: string[]) => {
        if (args.includes("create") || args.includes("--name") && args.includes("{{ range . }}{{ .Name }}{{ end }}")) {
          return { status: 0, stdout: "rc-api-h", stderr: "" }; // session exists
        }
        return { status: 0, stdout: "Watching|false|0", stderr: "" };
      },
      print: (l: string) => lines.push(l),
    };
    // bounded: 3 ticks, zero delay
    await runSyncWatch("/cwd", d as any, { intervalMs: 0, maxTicks: 3 });
    const statusLines = lines.filter((l) => l.includes("sync_status"));
    expect(statusLines).toHaveLength(3);
    expect(JSON.parse(statusLines[0]).kind).toBe("watching");
  });

  it("emits not_installed once and stops when the binary is missing", async () => {
    const lines: string[] = [];
    const d = { loadTarget: () => target, resolveBin: async () => null, ensureSsh: () => {}, run: () => ({ status: 0, stdout: "", stderr: "" }), print: (l: string) => lines.push(l) };
    await runSyncWatch("/cwd", d as any, { intervalMs: 0, maxTicks: 3 });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).kind).toBe("not_installed");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @rebink/patchwire test sync-session.test.ts`
Expected: FAIL — `runSyncWatch` not exported.

- [ ] **Step 3: Add `runSyncWatch` to `packages/cli/src/commands/sync-session.ts`**

```ts
export interface WatchOpts { intervalMs?: number; maxTicks?: number }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runSyncWatch(cwd: string, deps: SyncDeps, opts: WatchOpts = {}): Promise<void> {
  const bin = await deps.resolveBin();
  if (!bin) { emitStatus(deps.print, { kind: "not_installed" }); return; }
  const t = deps.loadTarget(cwd);
  deps.ensureSsh({ host: t.host, user: t.user, sshPort: t.sshPort });
  ensureSession(deps.run, t);
  const name = sessionName(t.project, t.host);
  const interval = opts.intervalMs ?? 2000;
  let tick = 0;
  // Unbounded in production (maxTicks undefined → loop until process killed).
  while (opts.maxTicks === undefined || tick < opts.maxTicks) {
    emitStatus(deps.print, getStatus(deps.run, name));
    tick++;
    if (opts.maxTicks !== undefined && tick >= opts.maxTicks) break;
    if (interval > 0) await sleep(interval);
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @rebink/patchwire test sync-session.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/sync-session.ts packages/cli/test/sync-session.test.ts
git commit -m "feat(cli): sync-watch streaming status handler"
```

---

### Task 6: Register the 7 CLI commands

**Files:**
- Modify: `packages/cli/src/cli.ts`

> Wire flat commands matching the existing `host-check`/`host-logs` style. Each builds production deps and a runner bound to the resolved binary. The `loadTargetFromConfig(cwd)` mapping builds a `MutagenTarget` from `loadConfig(cwd)` — read `packages/cli/src/lib/config.ts` and the existing `sync` command for the exact config field names (remote host/user/path; project = basename(cwd) or a config field; ignore = `config.sync.exclude`).

- [ ] **Step 1: Add a `loadTargetFromConfig` helper + register commands in `cli.ts`**

After reading config.ts, add a mapping (adapt field names to the real config shape):
```ts
function loadMutagenTarget(cwd: string): MutagenTarget {
  const cfg = loadConfig(cwd);                 // existing loader
  return {
    project: basename(cwd),
    host: cfg.remote.host,                      // adapt to real config shape
    user: cfg.remote.user,
    sshPort: cfg.remote.sshPort,
    localPath: cwd,
    remotePath: cfg.remote.path,                // adapt
    ignore: cfg.sync?.exclude ?? [],
  };
}
```
Register each command (example for two; repeat the pattern for all seven). Each constructs deps, binds the runner to the resolved bin, and calls the handler:
```ts
program
  .command("sync-start")
  .description("Start/ensure a continuous mutagen sync session for this project")
  .option("--json", "JSON output", true)
  .action(async () => {
    const { runSyncStart, realDeps } = await import("./commands/sync-session.ts");
    const base = await realDeps(loadMutagenTarget);
    const bin = await base.resolveBin();
    await runSyncStart(process.cwd(), { ...base, run: base.makeRun(bin ?? "mutagen") });
  });

program
  .command("sync-watch")
  .description("Stream sync status (NDJSON) until killed")
  .option("--json", "JSON output", true)
  .action(async () => {
    const { runSyncWatch, realDeps } = await import("./commands/sync-session.ts");
    const base = await realDeps(loadMutagenTarget);
    const bin = await base.resolveBin();
    await runSyncWatch(process.cwd(), { ...base, run: base.makeRun(bin ?? "mutagen") });
  });
```
Add `sync-status`, `sync-pause`, `sync-resume`, `sync-flush`, `sync-stop` the same way, calling `runSyncStatus`/`runSyncPause`/`runSyncResume`/`runSyncFlush`/`runSyncStop`. Add the needed imports (`basename`, `loadConfig`, `MutagenTarget` type).

- [ ] **Step 2: Verify the CLI parses and the commands are listed**

Run: `pnpm --filter @rebink/patchwire build` (if the package builds) then `node packages/cli/dist/cli.js --help` and confirm `sync-start`/`sync-watch`/`sync-status`/`sync-pause`/`sync-resume`/`sync-flush`/`sync-stop` appear. (If a typecheck step exists, run `pnpm --filter @rebink/patchwire typecheck`.)
Expected: commands listed; no type errors.

- [ ] **Step 3: Run the full CLI suite**

Run: `pnpm --filter @rebink/patchwire test`
Expected: all green (existing + new mutagen/sync-session tests).

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/cli.ts
git commit -m "feat(cli): register sync-start/status/watch/pause/resume/flush/stop commands"
```

---

## Self-Review

**Spec coverage (P3a portions):**
- A CLI-drivable continuous mutagen session (the missing seam) → Tasks 1–6. ✓
- Status (watching/syncing/conflict/paused/connecting/no_session/not_installed) → Tasks 1, 3, 4. ✓
- Streaming status for live pills → Task 5 (`sync-watch`). ✓
- Pause/resume/flush/stop → Tasks 3, 4. ✓
- Conflict file surfacing → Tasks 1, 3 (`extractConflictPaths`, `getStatus`). ✓
- Reuses the proven extension logic (ported, not reinvented) + the `@patchwire/core` mutagen resolver → Tasks 1, 2, 4. ✓
- Architecture-consistent (desktop will drive these via the sidecar in P3b) → all. ✓
- Out of scope for P3a: the desktop UI (pills, pause/resume buttons, conflict display) → P3b. The existing one-shot `sync` (rsync) is untouched.

**Placeholder scan:** No TBD/TODO. Tasks 4 and 6 intentionally instruct reading `config.ts`/`@patchwire/core` to resolve real config field names and the resolver export — interfaces, JSON shapes, and tests are fully specified; only the concrete config field accessors are resolved by reading (that file's shape isn't quoted here). The pure helpers (Tasks 1–3) are complete code ported verbatim from the known `MutagenController` source.

**Type consistency:** `MutagenTarget`, `MutagenStatus`, `MutagenRunner`, `RunResult` defined once in `mutagen.ts` and reused by `sync-session.ts`. `SyncDeps` defined once in `sync-session.ts`, used by all handlers + tests. Status JSON shape `{type:'sync_status',kind,conflicts}` is identical across `emitStatus`, the tests, and the documented P3b contract. Command handler names (`runSyncStart`/`Status`/`Watch`/`Pause`/`Resume`/`Flush`/`Stop`) match between the module, tests, and cli.ts registration.

## Follow-on
- **P3b** (separate plan): desktop Rust `start_sync_watch` (stream `sync-watch --json` with `current_dir`) + one-shot `sync_pause`/`sync_resume`/`sync_flush`/`sync_stop`/`sync_start`; sync-status types + parser + store; status pill on the Projects landing (replace the hardcoded `healthy={true}` / `lastStatus`); pause/resume + conflict surfacing in the Workspace header. Clean up `.patchwire/desktop.patch` after apply (carried from P2 review).
- Future: refactor the extension's `MutagenController` to import this shared CLI lib (eliminates the duplicated mutagen logic). Out of scope now (YAGNI); the port keeps them behaviorally identical in the meantime.
- Coordination note: if both the extension and the desktop target the same project, they derive the same session name (`rc-<project>-<host>`) and share one mutagen session — pause/resume/status are consistent. Simultaneous use is an edge case (they're alternative clients).
