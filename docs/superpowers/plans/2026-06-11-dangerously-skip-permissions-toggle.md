# Dangerously-Skip-Permissions Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `patchwire.dangerouslySkipPermissions` VS Code setting that launches the session-terminal `claude` with `--dangerously-skip-permissions` and shows a red warning banner when active.

**Architecture:** Extract the remote-command assembly in `sessionTerminal.ts` into a pure, exported helper `buildRemoteCommand(target, skipPermissions)` that returns the SSH remote command string. The helper is unit-tested directly (no `vscode` mock needed). `openSessionTerminal` reads the boolean setting via `vscode.workspace.getConfiguration` and passes it to the helper. A new boolean property is added to the extension's `contributes.configuration`.

**Tech Stack:** TypeScript, VS Code Extension API, Vitest.

---

## File Structure

- `packages/extension/src/session/sessionTerminal.ts` — add exported pure helper `buildRemoteCommand`; refactor `openSessionTerminal` to read the setting and call it.
- `packages/extension/src/session/sessionTerminal.test.ts` — **new** Vitest unit test for `buildRemoteCommand` (both setting states).
- `packages/extension/package.json` — new `patchwire.dangerouslySkipPermissions` configuration property.

All work lives in `packages/extension`. Run commands from that directory.

---

### Task 1: Extract and test the `buildRemoteCommand` helper

**Files:**
- Modify: `packages/extension/src/session/sessionTerminal.ts`
- Test: `packages/extension/src/session/sessionTerminal.test.ts` (create)

This task extracts the inline `remoteCmd` assembly (currently `sessionTerminal.ts:66-70`) into a pure exported function and drives it with tests. No `vscode` is touched by the helper, so the test needs no mock.

- [ ] **Step 1: Write the failing test**

Create `packages/extension/src/session/sessionTerminal.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildRemoteCommand, type SessionTarget } from './sessionTerminal.ts';

const target: SessionTarget = {
  project: 'myapp',
  host: 'mini.local',
  user: 'alice',
  remotePath: '~/workspace/alice/myapp',
};

describe('buildRemoteCommand', () => {
  it('launches plain claude when skipPermissions is false', () => {
    const cmd = buildRemoteCommand(target, false);
    expect(cmd).toContain('cd ~/workspace/alice/myapp');
    expect(cmd).toContain(`exec zsh -lic 'claude'`);
    expect(cmd).not.toContain('--dangerously-skip-permissions');
    expect(cmd).not.toContain('permissions bypassed');
  });

  it('adds the flag and a warning banner when skipPermissions is true', () => {
    const cmd = buildRemoteCommand(target, true);
    expect(cmd).toContain(`exec zsh -lic 'claude --dangerously-skip-permissions'`);
    expect(cmd).toContain('permissions bypassed (--dangerously-skip-permissions)');
    // warning banner comes before the exec line
    expect(cmd.indexOf('permissions bypassed')).toBeLessThan(
      cmd.indexOf('exec zsh'),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter ./packages/extension test -- sessionTerminal`
Expected: FAIL — `buildRemoteCommand` is not exported / not defined.

- [ ] **Step 3: Implement the helper**

In `packages/extension/src/session/sessionTerminal.ts`, add this exported function above `openSessionTerminal` (after the `findExistingSessionTerminal` function):

```ts
/**
 * Build the remote command run over SSH: cd into the project, print the
 * Patchwire banner (plus a red warning when permission checks are bypassed),
 * then exec a login+interactive zsh running `claude`.
 *
 * `claudeCmd` is single-quoted so the remote shell passes the whole
 * `claude --dangerously-skip-permissions` string as ONE argument to zsh's
 * `-c`. Unquoted, the remote shell would split on whitespace and bind the flag
 * to zsh instead of claude, silently dropping it. The flag is a fixed literal
 * (not user input), so the quoting adds no injection surface.
 *
 * Note: leave ${remotePath} UNQUOTED so a leading ~ expands. Project name is
 * regex-validated upstream (^[a-zA-Z0-9._-]+$) so no shell metachars sneak in.
 */
export function buildRemoteCommand(target: SessionTarget, skipPermissions: boolean): string {
  const claudeCmd = skipPermissions ? 'claude --dangerously-skip-permissions' : 'claude';
  const parts = [
    `cd ${target.remotePath}`,
    `printf '\\033[36m── Patchwire · %s:%s\\033[0m\\n' "$(hostname)" "$(pwd)"`,
  ];
  if (skipPermissions) {
    parts.push(
      `printf '\\033[31m⚠ permissions bypassed (--dangerously-skip-permissions)\\033[0m\\n'`,
    );
  }
  parts.push(`exec zsh -lic '${claudeCmd}'`);
  return parts.join(' && ');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter ./packages/extension test -- sessionTerminal`
Expected: PASS (2 passing).

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/session/sessionTerminal.ts packages/extension/src/session/sessionTerminal.test.ts
git commit -m "feat(extension): add buildRemoteCommand helper with skip-permissions support"
```

---

### Task 2: Wire `openSessionTerminal` to read the setting and use the helper

**Files:**
- Modify: `packages/extension/src/session/sessionTerminal.ts:66-71` (the inline `remoteCmd` block)

Replace the inline command assembly with a config read + call to `buildRemoteCommand`. This removes the now-duplicated inline logic (DRY).

- [ ] **Step 1: Replace the inline remoteCmd block**

In `openSessionTerminal`, delete the existing block:

```ts
  const remoteCmd = [
    `cd ${target.remotePath}`,
    `printf '\\033[36m── Patchwire · %s:%s\\033[0m\\n' "$(hostname)" "$(pwd)"`,
    `exec zsh -lic claude`,
  ].join(' && ');
  sshArgs.push(remoteCmd);
```

and replace it with:

```ts
  // Read at launch time so a changed setting takes effect on the next session
  // open (no window reload needed). `?? false` keeps the safe off state when
  // the setting is unset or the wrong type.
  const skipPermissions = vscode.workspace
    .getConfiguration('patchwire')
    .get<boolean>('dangerouslySkipPermissions') ?? false;
  sshArgs.push(buildRemoteCommand(target, skipPermissions));
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter ./packages/extension typecheck`
Expected: PASS (no type errors).

- [ ] **Step 3: Run the full extension test suite**

Run: `pnpm --filter ./packages/extension test`
Expected: PASS — all existing tests plus the two new `buildRemoteCommand` tests.

- [ ] **Step 4: Commit**

```bash
git add packages/extension/src/session/sessionTerminal.ts
git commit -m "feat(extension): honor dangerouslySkipPermissions setting at session launch"
```

---

### Task 3: Add the configuration property to package.json

**Files:**
- Modify: `packages/extension/package.json:88-97` (the `contributes.configuration.properties` block)

- [ ] **Step 1: Add the new property**

In `packages/extension/package.json`, inside `contributes.configuration.properties`, add the property after the existing `patchwire.cliPath` entry (add a comma after the `cliPath` closing brace):

```jsonc
"patchwire.dangerouslySkipPermissions": {
  "type": "boolean",
  "default": false,
  "markdownDescription": "⚠️ Launch Claude with `--dangerously-skip-permissions`, bypassing ALL of Claude's tool-permission prompts in the session terminal. Only enable on machines/projects you fully trust."
}
```

- [ ] **Step 2: Validate the JSON parses**

Run: `node -e "require('./packages/extension/package.json'); console.log('ok')"`
Expected: prints `ok` (no JSON syntax error).

- [ ] **Step 3: Confirm the property is registered**

Run: `node -e "const p=require('./packages/extension/package.json'); console.log(Object.keys(p.contributes.configuration.properties))"`
Expected: array includes both `patchwire.cliPath` and `patchwire.dangerouslySkipPermissions`.

- [ ] **Step 4: Commit**

```bash
git add packages/extension/package.json
git commit -m "feat(extension): contribute patchwire.dangerouslySkipPermissions setting"
```

---

### Task 4: Manual verification (no code change)

**Files:** none.

- [ ] **Step 1: Build the extension**

Run: `pnpm --filter ./packages/extension build`
Expected: build succeeds (tsup + bundle-cli + check-bundle pass).

- [ ] **Step 2: Verify behavior manually**

Document for the reviewer (no automated step):
- With the setting OFF (default), opening a Patchwire session runs `exec zsh -lic 'claude'` and shows only the cyan banner.
- With `patchwire.dangerouslySkipPermissions` set to `true` in Settings, opening a NEW session terminal runs `claude --dangerously-skip-permissions` and prints the red `⚠ permissions bypassed` line under the cyan banner.
- A reused (already-open) session terminal does NOT retro-apply the change — the user must close it and open a new session. This is expected (the setting is read at launch).

---

## Self-Review

**Spec coverage:**
- Setting definition (spec §1) → Task 3. ✅
- Conditional launch command + quoting (spec §2) → Task 1 (helper) + Task 2 (wiring). ✅
- Red warning banner (spec §3) → Task 1 helper, asserted in test. ✅
- Default `false` / safe fallback (spec error handling) → Task 2 `?? false`; Task 3 `"default": false`. ✅
- Reused-terminal edge case (spec error handling) → documented in Task 4 manual verification. ✅
- Testing via extracted pure helper (spec §Testing) → Task 1. ✅

**Placeholder scan:** No TBD/TODO; every code step shows complete code and exact commands. ✅

**Type consistency:** `buildRemoteCommand(target: SessionTarget, skipPermissions: boolean): string` defined in Task 1 and called identically in Task 2. `SessionTarget` is the existing exported interface in `sessionTerminal.ts`. Setting key `patchwire.dangerouslySkipPermissions` matches across Task 2 (read) and Task 3 (declare). ✅

**OFF-case quoting note:** the OFF path becomes `exec zsh -lic 'claude'` (quoted), changed from the original unquoted `exec zsh -lic claude`. Functionally identical to zsh; quoting both branches keeps the helper uniform and the assertion exact.
