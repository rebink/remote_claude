# Force Refresh Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:executing-plans to implement this plan task-by-task.

**Goal:** Add a destructive "force refresh" that purges the remote project folder and re-seeds it fresh from the local machine, then resumes live sync — exposed as a CLI command and a VSCode extension command.

**Architecture:** Reuse existing primitives. `runInitRemote({overwrite:true})` already does wipe → mkdir → rsync(local→remote) → git_init. The new `runRefresh` orchestrator wraps it: terminate the mutagen session → init-remote-overwrite → recreate the session. The extension owns the typed-confirm UX and shells out to `patchwire refresh --yes --json`.

**Tech Stack:** TypeScript, Node, tsup, vitest; mutagen CLI; existing `bootstrap-snapshot`, `mutagen` lib, `CliClient`/`resolveCli` patterns.

Design: `docs/plans/2026-08-01-force-refresh-design.md`

---

### Task 1: CLI `runRefresh` orchestrator (TDD)

**Files:**
- Create: `packages/cli/src/commands/refresh.ts`
- Test: `packages/cli/test/refresh.test.ts`

**Step 1: Write the failing test**

```ts
// packages/cli/test/refresh.test.ts
import { describe, it, expect, vi } from "vitest";
import { runRefresh, type RefreshDeps } from "../src/commands/refresh.ts";
import type { MutagenTarget } from "../src/lib/mutagen.ts";

const target: MutagenTarget = {
  project: "myproj", host: "mini.local", user: "dev",
  localPath: "/home/dev/myproj", remotePath: "/Users/dev/myproj",
};

function deps(over: Partial<RefreshDeps> = {}): { deps: RefreshDeps; calls: string[]; lines: string[] } {
  const calls: string[] = [];
  const lines: string[] = [];
  const d: RefreshDeps = {
    loadTarget: () => target,
    resolveBin: async () => "mutagen",
    makeRun: () => (args) => { calls.push(`mutagen ${args.join(" ")}`); return { status: 0, stdout: "", stderr: "" }; },
    ensureSsh: () => { calls.push("ensureSsh"); },
    initRemote: async () => { calls.push("initRemote"); return { ok: true, projectName: "myproj", remotePath: target.remotePath }; },
    print: (l) => lines.push(l),
    ...over,
  };
  return { deps: d, calls, lines };
}

describe("runRefresh", () => {
  it("refuses when not confirmed — no terminate, no init", async () => {
    const { deps: d, calls } = deps();
    const res = await runRefresh("/cwd", d, { confirmed: false, json: true });
    expect(res).toEqual({ ok: false, code: "unconfirmed" });
    expect(calls).toEqual([]);
  });

  it("terminates sync, re-seeds, then recreates sync — in order", async () => {
    const { deps: d, calls } = deps();
    const res = await runRefresh("/cwd", d, { confirmed: true, json: true });
    expect(res.ok).toBe(true);
    expect(calls).toEqual([
      "mutagen sync terminate rc-myproj-mini-local-" + calls[0].split("-").pop(), // terminate first
      "initRemote",
      "ensureSsh",
      "mutagen sync create --name rc-myproj-mini-local-" + calls[3].split("-").pop() + " --mode two-way-resolved --symlink-mode posix-raw --ignore-vcs --ignore node_modules --ignore .next --ignore dist --ignore build --ignore .dart_tool --ignore ios/Pods --ignore .DS_Store --ignore .patchwire --ignore .devbridge --default-file-mode 0644 --default-directory-mode 0755 /home/dev/myproj dev@mini.local:/Users/dev/myproj",
    ]);
  });

  it("aborts without recreating sync when init-remote fails", async () => {
    const { deps: d, calls } = deps({ initRemote: async () => { calls.push("initRemote"); return { ok: false, code: "rsync_failed", stderr: "boom" }; } });
    const res = await runRefresh("/cwd", d, { confirmed: true, json: true });
    expect(res).toEqual({ ok: false, code: "rsync_failed" });
    // terminate happened, init happened, but NO ensureSsh / sync create after failure
    expect(calls).toContain("initRemote");
    expect(calls).not.toContain("ensureSsh");
    expect(calls.some((c) => c.includes("sync create"))).toBe(false);
  });
});
```

> Note: the exact ordering assertions above are brittle around the hash suffix. When implementing, prefer asserting sub-strings / call sequence over full-string equality if the hash makes equality awkward — keep the three behaviors: (1) refuse unconfirmed, (2) terminate → init → recreate order, (3) no recreate on init failure.

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @rebink/patchwire test -- refresh`
Expected: FAIL — `runRefresh` not found.

**Step 3: Write minimal implementation**

```ts
// packages/cli/src/commands/refresh.ts
import { sessionName, ensureSession, stopSession, type MutagenRunner, type MutagenTarget } from "../lib/mutagen.ts";
import { runInitRemote, type InitRemoteResult } from "./init-remote.ts";
import { ensureSshConfigStanza } from "../lib/mutagen-ssh.ts";

export interface RefreshDeps {
  loadTarget: (cwd: string) => MutagenTarget;
  resolveBin: () => Promise<string | null>;
  makeRun: (bin: string) => MutagenRunner;
  ensureSsh: (t: { host: string; user: string; sshPort?: number }) => void;
  /** Purge + reseed the remote from local (bootstrap with overwrite). */
  initRemote: (target: MutagenTarget, json: boolean) => Promise<InitRemoteResult>;
  print: (line: string) => void;
}

export interface RefreshOpts { confirmed: boolean; json: boolean }
export interface RefreshResult { ok: boolean; code?: string }

export async function runRefresh(cwd: string, deps: RefreshDeps, opts: RefreshOpts): Promise<RefreshResult> {
  const emit = (obj: unknown) => deps.print(JSON.stringify(obj));

  if (!opts.confirmed) {
    emit({ type: "refresh_aborted", reason: "unconfirmed" });
    return { ok: false, code: "unconfirmed" };
  }

  const t = deps.loadTarget(cwd);
  emit({ type: "refresh_start", project: t.project, remotePath: t.remotePath });

  const bin = await deps.resolveBin();
  const run = deps.makeRun(bin ?? "mutagen");
  const name = sessionName(t.project, t.host, t.localPath);

  // 1. Terminate live sync so mutagen can't fight the wipe or re-propagate deletes.
  stopSession(run, name);
  emit({ type: "refresh_step", step: "terminate_sync", ok: true });

  // 2. Purge + reseed remote from local (wipe -> mkdir -> rsync -> git_init).
  const init = await deps.initRemote(t, opts.json);
  if (!init.ok) {
    // Leave sync stopped: the remote is half-reset; re-syncing would spread it.
    emit({ type: "refresh_done", ok: false, code: init.code, stderr: init.stderr });
    return { ok: false, code: init.code };
  }

  // 3. Recreate the sync session against the fresh remote.
  deps.ensureSsh({ host: t.host, user: t.user, sshPort: t.sshPort });
  ensureSession(run, t);
  emit({ type: "refresh_step", step: "recreate_sync", ok: true });

  emit({ type: "refresh_done", ok: true, remotePath: t.remotePath });
  return { ok: true };
}

/** Production deps — mirrors sync-session realDeps + init-remote wrapper. */
export function realRefreshDeps(loadTarget: (cwd: string) => MutagenTarget): RefreshDeps {
  return {
    loadTarget,
    resolveBin: async () => {
      const { createNodeHostPlatform } = await import("@patchwire/core");
      try { return await createNodeHostPlatform().resolveMutagen(); } catch { return null; }
    },
    makeRun: (bin) => (args) => {
      const { spawnSync } = require("node:child_process");
      const r = spawnSync(bin, args, { encoding: "utf8", timeout: 60000 });
      return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    },
    ensureSsh: (t) => ensureSshConfigStanza({ host: t.host, user: t.user, sshPort: t.sshPort }),
    initRemote: (t, json) => runInitRemote({
      fromLocal: true, project: t.project, host: t.host, user: t.user,
      sshPort: t.sshPort, remotePath: t.remotePath, localPath: t.localPath,
      overwrite: true, json,
    }),
    print: (l) => process.stdout.write(l + "\n"),
  };
}
```

> Implementer: verify the exact shape of `sync-session.ts` `realDeps` (resolveBin / makeRun / ensureSsh) and `ensureSshConfigStanza`'s signature in `mutagen-ssh.ts`; reuse them verbatim rather than re-deriving. Match whatever `realDeps` already does.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @rebink/patchwire test -- refresh`
Expected: PASS (3 tests).

**Step 5: Commit**

```bash
git add packages/cli/src/commands/refresh.ts packages/cli/test/refresh.test.ts
git commit -m "feat(cli): add runRefresh orchestrator (purge + reseed remote)"
```

---

### Task 2: Wire `patchwire refresh` command

**Files:**
- Modify: `packages/cli/src/cli.ts` (near the sync-session command registrations, ~line 355)

**Step 1: Add the command registration**

```ts
program
  .command('refresh')
  .description('Purge the remote folder and re-seed it fresh from this machine (DESTRUCTIVE)')
  .option('--yes', 'skip confirmation — required for non-interactive use', false)
  .option('--json', 'JSON output', true)
  .action(async (opts: { yes?: boolean; json?: boolean }) => {
    const { runRefresh, realRefreshDeps } = await import('./commands/refresh.ts');
    const deps = realRefreshDeps(loadMutagenTarget);
    const confirmed = opts.yes === true; // interactive typed-name prompt = future work
    const res = await runRefresh(process.cwd(), deps, { confirmed, json: opts.json !== false });
    if (!res.ok) process.exitCode = 1;
  });
```

**Step 2: Verify it wires up**

Run: `pnpm --filter @rebink/patchwire build && node packages/cli/dist/cli.js refresh --help`
Expected: help text for `refresh` prints, shows `--yes` and `--json`.

**Step 3: Verify the guard (no --yes = abort, non-destructive)**

Run (in a dir WITHOUT a real remote is fine — guard fires before any SSH): create a throwaway `patchwire.yml` in a temp dir, then `node .../cli.js refresh --json` (no `--yes`).
Expected: prints `{"type":"refresh_aborted","reason":"unconfirmed"}`, exit code 1, NO ssh/rsync attempted.

**Step 4: Commit**

```bash
git add packages/cli/src/cli.ts
git commit -m "feat(cli): register patchwire refresh command"
```

---

### Task 3: Extension `patchwire.forceRefresh` command

**Files:**
- Modify: `packages/extension/src/commands.ts` (add command in `registerCommands`, add a `runForceRefresh` helper + a pure `refreshConfirmed` helper)
- Modify: `packages/extension/package.json` (contribute the command + palette + a view/title button)
- Test: `packages/extension/src/commands.test.ts` (create if absent; otherwise add cases)

**Step 1: Write the failing test (pure confirm-gate helper)**

```ts
// packages/extension/src/commands.test.ts
import { describe, it, expect } from "vitest";
import { refreshConfirmed } from "./commands.ts";

describe("refreshConfirmed", () => {
  it("true only on exact project-name match", () => {
    expect(refreshConfirmed("myproj", "myproj")).toBe(true);
    expect(refreshConfirmed(" myproj ", "myproj")).toBe(false);
    expect(refreshConfirmed("MYPROJ", "myproj")).toBe(false);
    expect(refreshConfirmed(undefined, "myproj")).toBe(false);
    expect(refreshConfirmed("", "myproj")).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter patchwire-vscode test -- commands`
Expected: FAIL — `refreshConfirmed` not exported.

**Step 3: Implement helper + command + streaming**

Add to `packages/extension/src/commands.ts`:

```ts
/** Exact-match confirm gate for the destructive force refresh. */
export function refreshConfirmed(typed: string | undefined, project: string): boolean {
  return typed === project;
}

function runForceRefresh(
  context: vscode.ExtensionContext,
  deps: ExtensionDeps,
  cwd: string,
): Promise<void> {
  const inv = resolveCli(context.extensionUri.fsPath);
  deps.output.show();
  deps.output.appendLine('[refresh] starting force refresh…');
  return new Promise((resolve) => {
    const child = spawn(inv.command, [...inv.baseArgs, 'refresh', '--yes', '--json'], { cwd, env: inv.env });
    let buf = '';
    child.stdout.on('data', (b) => {
      buf += b.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        deps.output.appendLine(`[refresh] ${line.trim()}`);
      }
    });
    child.stderr.on('data', (b) => deps.output.appendLine(`[refresh] ${b.toString().trim()}`));
    child.on('close', (code) => {
      if (code === 0) vscode.window.showInformationMessage('Patchwire: force refresh complete.');
      else vscode.window.showErrorMessage(`Patchwire: force refresh failed (exit ${code ?? 'null'}). See output.`);
      resolve();
    });
    child.on('error', (e) => { deps.output.appendLine(`[refresh] ${e.message}`); resolve(); });
  });
}
```

Register inside `registerCommands` (alongside the other `registerCommand` calls):

```ts
vscode.commands.registerCommand('patchwire.forceRefresh', async () => {
  const ws = vscode.workspace.workspaceFolders?.[0];
  if (!ws) { vscode.window.showErrorMessage('Patchwire: open a workspace folder first.'); return; }
  const project = deps.panel.getProject();
  if (!project) { vscode.window.showErrorMessage('No patchwire.yml found — run Patchwire: Setup first.'); return; }
  const typed = await vscode.window.showInputBox({
    title: 'Force Refresh — destructive',
    prompt: `Deletes the REMOTE copy of "${project}" and re-seeds it from this machine. Remote-only changes are lost. Type "${project}" to confirm.`,
    placeHolder: project,
    ignoreFocusOut: true,
  });
  if (!refreshConfirmed(typed, project)) { vscode.window.showInformationMessage('Force refresh cancelled.'); return; }
  await runForceRefresh(context, deps, ws.uri.fsPath);
}),
```

**Step 4: Contribute the command in `package.json`**

Under `contributes.commands` add:
```json
{ "command": "patchwire.forceRefresh", "title": "Patchwire: Force Refresh Remote", "category": "Patchwire", "icon": "$(refresh)" }
```
If the chat view has a `contributes.menus["view/title"]` block, add a button:
```json
{ "command": "patchwire.forceRefresh", "when": "view == <patchwire-chat-view-id>", "group": "navigation" }
```
(Implementer: look up the actual chat view id already used by other `view/title` entries; reuse it. If no `view/title` menu exists yet, palette-only is fine for MVP.)

**Step 5: Run tests**

Run: `pnpm --filter patchwire-vscode test -- commands`
Expected: PASS.

**Step 6: Commit**

```bash
git add packages/extension/src/commands.ts packages/extension/src/commands.test.ts packages/extension/package.json
git commit -m "feat(extension): add Force Refresh Remote command with typed confirm"
```

---

### Task 4: Full build + verification

**Step 1: Typecheck + tests both packages**

Run:
```bash
pnpm --filter @rebink/patchwire --filter patchwire-vscode typecheck
pnpm --filter @rebink/patchwire test
pnpm --filter patchwire-vscode test
```
Expected: all green.

**Step 2: Build (CLI first, then extension embeds it) + package vsix**

Run:
```bash
pnpm --filter @rebink/patchwire build
pnpm --filter patchwire-vscode build
pnpm --filter patchwire-vscode package
```
Expected: `packages/extension/patchwire-vscode-*.vsix` produced; `bundle is self-contained`.

**Step 3: Confirm the refresh command is in the built artifacts**

Run: `grep -c "patchwire.forceRefresh\|refresh_start" packages/extension/dist/extension.cjs packages/extension/dist/cli/cli.js`
Expected: non-zero in both.

**Step 4: Commit any build metadata (if the vsix/version is tracked; otherwise skip)**

```bash
git add -A && git commit -m "chore: build force-refresh into cli + extension" || echo "nothing to commit"
```

---

## Manual smoke (post-merge, real remote)

1. Install the vsix, open a Patchwire project.
2. Palette → **Patchwire: Force Refresh Remote** → type the project name.
3. Watch the output channel: `terminate_sync` → bootstrap steps (wipe/mkdir/rsync/git_init) → `recreate_sync` → `refresh_done ok:true`.
4. `mutagen sync list` → session recreated; remote folder re-seeded from local.
5. Negative: cancel the input box → "Force refresh cancelled", nothing runs.
