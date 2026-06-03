# Local-Hot-Reload Realignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkboxes (`- [ ]`). TDD for the sync change.

**Goal:** (A) make sync respect `.gitignore` so secrets never cross — making the privacy claim true; (B) remove the off-model Android device bridge; (C) re-center the website on privacy + local hot reload.

**Tech Stack:** TypeScript ESM, vitest, real `rsync` (integration test), Astro. Package `patchwire` (`packages/cli`) + website.

**Source spec:** `docs/superpowers/specs/2026-06-03-local-hotreload-alignment-design.md`

---

## Task 0: Branch + baseline
- [ ] `cd /Users/apple/Documents/Workspace/patchwire && git checkout main && git checkout -b feat/local-hotreload-alignment`
- [ ] `pnpm --filter patchwire test` → green baseline. If red, STOP.

---

## Task 1: Secret-safe sync — respect `.gitignore` (TDD)

**Files:** Modify `packages/cli/src/lib/rsync.ts`; Create `packages/cli/test/lib/rsync.test.ts`

- [ ] **Step 1: Failing test `packages/cli/test/lib/rsync.test.ts`:**
```ts
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRsyncArgs } from '../../src/lib/rsync.ts';

describe('buildRsyncArgs', () => {
  it('honors .gitignore and points at the exclude file; includes ssh transport when given', () => {
    const args = buildRsyncArgs({ cwd: '/p', remoteTarget: 'u@h:/r/', sshArg: 'ssh -i k', excludeFile: '/tmp/ex.txt' });
    expect(args).toContain('--filter=dir-merge,- .gitignore');
    expect(args).toContain('--exclude-from');
    expect(args).toContain('/tmp/ex.txt');
    expect(args).toContain('-e');
    expect(args[args.length - 1]).toBe('u@h:/r/');
  });
  it('omits the ssh transport for a local copy (empty sshArg)', () => {
    const args = buildRsyncArgs({ cwd: '/p', remoteTarget: '/d/', sshArg: '', excludeFile: '/tmp/ex.txt' });
    expect(args).not.toContain('-e');
  });
});

const hasRsync = spawnSync('rsync', ['--version'], { encoding: 'utf8' }).status === 0;

describe.skipIf(!hasRsync)('rsync respects .gitignore (local→local, proves secrets do not cross)', () => {
  it('a gitignored .env / build dir is NOT transferred; tracked code is', () => {
    const root = mkdtempSync(join(tmpdir(), 'pw-rsync-'));
    const src = join(root, 'src');
    const dst = join(root, 'dst');
    mkdirSync(join(src, 'lib'), { recursive: true });
    mkdirSync(join(src, 'build'), { recursive: true });
    mkdirSync(dst, { recursive: true });
    writeFileSync(join(src, '.gitignore'), '.env\nbuild/\n');
    writeFileSync(join(src, '.env'), 'SECRET=shh');
    writeFileSync(join(src, 'build', 'app.bin'), 'x');
    writeFileSync(join(src, 'lib', 'main.dart'), 'void main() {}');

    const excludeFile = join(root, 'exclude.txt');
    writeFileSync(excludeFile, '.git/\n.devbridge/\n');
    const args = buildRsyncArgs({ cwd: src, remoteTarget: dst + '/', sshArg: '', excludeFile });

    const r = spawnSync('rsync', args, { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(existsSync(join(dst, 'lib', 'main.dart'))).toBe(true);   // tracked code crosses
    expect(existsSync(join(dst, '.env'))).toBe(false);              // gitignored secret does NOT
    expect(existsSync(join(dst, 'build', 'app.bin'))).toBe(false);  // gitignored dir does NOT
    rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2:** `pnpm --filter patchwire test rsync.test` → FAIL (`buildRsyncArgs` not exported).

- [ ] **Step 3: Refactor `packages/cli/src/lib/rsync.ts`.** Add this exported pure function (e.g. just above `rsyncPush`):
```ts
export interface RsyncArgsInput {
  cwd: string;
  remoteTarget: string;
  /** ssh transport string, or '' for a local copy (no -e). */
  sshArg: string;
  excludeFile: string;
}

/**
 * Build the rsync argv. Excludes `.git/`, `.devbridge/`, and configured excludes via
 * the exclude file, AND honors each directory's `.gitignore` via a per-dir merge filter
 * — so anything git ignores (`.env`, secrets, build dirs) never crosses the wire.
 */
export function buildRsyncArgs(input: RsyncArgsInput): string[] {
  const args = [
    '-az',
    '--update',
    '--filter=dir-merge,- .gitignore',
    '--exclude-from', input.excludeFile,
  ];
  if (input.sshArg) args.push('-e', input.sshArg);
  args.push(`${input.cwd.replace(/\/?$/, '/')}`, input.remoteTarget);
  return args;
}
```
Then in `rsyncPush`, replace the inline `const args = [ … ];` array literal with:
```ts
    const args = buildRsyncArgs({ cwd, remoteTarget, sshArg, excludeFile });
```
(Leave the surrounding `--update`/`--delete` comment block; it still documents the behavior. `excludeFile`, `remoteTarget`, `sshArg`, `cwd` are already in scope.)

- [ ] **Step 4:** `pnpm --filter patchwire test rsync.test` → PASS (unit + the local→local integration test). If `rsync` isn't installed the integration block is skipped — note that in the report.

- [ ] **Step 5: Commit**
```bash
git add packages/cli/src/lib/rsync.ts packages/cli/test/lib/rsync.test.ts
git commit -m "feat(cli): sync respects .gitignore so secrets never cross the wire"
```

---

## Task 2: Remove the Android device bridge

**Files:** Delete the device-bridge sources/tests/doc; modify `cli.ts`, `docs/release-notes-v0.3.0.md`

- [ ] **Step 1: Delete the files:**
```bash
git rm packages/cli/src/lib/device-bridge.ts \
       packages/cli/src/commands/device.ts \
       packages/cli/test/lib/device-bridge.test.ts \
       packages/cli/test/commands/device.test.ts \
       docs/device-bridge.md
```

- [ ] **Step 2: Remove the wiring from `packages/cli/src/cli.ts`.** Delete the import line:
```ts
import { registerDeviceCommands } from './commands/device.ts';
```
and the call line (just above `program.parseAsync(process.argv)`):
```ts
registerDeviceCommands(program);
```

- [ ] **Step 3: Update `docs/release-notes-v0.3.0.md`.** Remove the device-bridge bullet under "✨ Added" (the `**Android device bridge** …` line) and the "Device bridge is Android-only …" bullet under "Known limitations / roadmap". Leave everything else.

- [ ] **Step 4: Verify it's gone and nothing references it:**
```bash
grep -rnE "device-bridge|registerDeviceCommands|patchwire device" packages/cli/src packages/cli/test 2>/dev/null && echo "REFS REMAIN" || echo "clean ✓"
```
Expected: `clean ✓`.

- [ ] **Step 5:** `pnpm --filter patchwire typecheck` → exit 0; `pnpm --filter patchwire test` → all pass (device tests gone, nothing else broke); `pnpm --filter patchwire build` → exit 0; `node packages/cli/dist/cli.js --help` does NOT list `device`.

- [ ] **Step 6: Commit**
```bash
git add -A
git commit -m "revert(cli): remove Android device bridge (off-model for local hot reload)"
```

---

## Task 3: Re-center the website copy

**Files:** Modify `packages/website/src/pages/index.astro`

- [ ] **Step 1: Replace the hero sub-paragraph.** Replace:
```html
        <p class="hero-sub reveal">
          Run Claude, Codex, Aider &mdash; any coding agent &mdash; on machines
          <strong>you</strong> control. Every change comes back as a reviewable
          git diff. Built for teams, not individual seats.
        </p>
```
with:
```html
        <p class="hero-sub reveal">
          Your coding agent runs on a machine <strong>you</strong> control and only
          ever sees the project you sync &mdash; never your <code>.env</code>, never
          the rest of your laptop. Its edits come back as a git diff applied locally,
          so your Flutter hot reload and debugger keep working exactly as before.
        </p>
```

- [ ] **Step 2: Re-center the stance section.** Replace:
```html
      <h2 class="claim-h reveal">
        Your code shouldn&rsquo;t live on someone else&rsquo;s <em>cloud.</em>
      </h2>
      <p class="claim-sub reveal">
        Most remote AI coding tools clone your repo onto the vendor&rsquo;s
        servers. Patchwire runs the agent on a machine <strong>you</strong>
        control &mdash; your laptop, a homelab, your VPC &mdash; so your codebase
        never lands on someone else&rsquo;s dev platform. It&rsquo;s AI-agnostic,
        so you pick the model (local ones included), and only the diff comes back.
      </p>
```
with:
```html
      <h2 class="claim-h reveal">
        Only the code you share <em>crosses the wire.</em>
      </h2>
      <p class="claim-sub reveal">
        The agent runs on a machine <strong>you</strong> control and only ever sees
        the project you sync. Your <code>.env</code>, your secrets, and everything
        git ignores never leave your laptop &mdash; and the rest of your machine is
        never touched. It&rsquo;s AI-agnostic (pick any model, local included), and
        only the resulting diff comes back.
      </p>
```

- [ ] **Step 3: Replace the proving-ground device-bridge teaser with the local-hot-reload story.** Replace:
```html
      <p class="claim-sub reveal">
        <span class="roadmap-pill">roadmap</span> Android device bridge
        (adb-over-Tailscale) &mdash; run on the shared box, hot-reload to the phone
        in your hand.
      </p>
```
with:
```html
      <p class="claim-sub reveal">
        The agent runs on the remote; its edits land on <em>your</em> laptop. You
        <code>flutter run</code> locally &mdash; full hot reload, full debugger, a real
        device over USB &mdash; exactly as before. The remote does the AI; your machine
        does the running.
      </p>
```

- [ ] **Step 4:** `pnpm --filter patchwire-docs build` → exit 0. Confirm no device-bridge teaser remains:
```bash
grep -niE "device bridge|adb-over-tailscale" packages/website/src/pages/index.astro && echo "TEASER REMAINS" || echo "clean ✓"
```

- [ ] **Step 5: Commit**
```bash
git add packages/website/src/pages/index.astro
git commit -m "feat(website): re-center on privacy + local hot reload; drop device-bridge teaser"
```

---

## Task 4: Full verification
- [ ] `pnpm --filter patchwire typecheck` → exit 0
- [ ] `pnpm --filter patchwire test` → all pass (run twice to confirm determinism; the rsync integration test should pass where rsync exists)
- [ ] `pnpm --filter patchwire build` → exit 0
- [ ] `pnpm --filter patchwire-docs build` → exit 0
- [ ] `node packages/cli/dist/cli.js --help` → no `device` command
- [ ] `grep -rniE "device bridge|registerDeviceCommands|adb-over-tailscale" packages docs | grep -v node_modules | grep -vE "specs/2026-06-03-device-bridge|plans/2026-06-03-device-bridge|specs/2026-06-03-local-hotreload|plans/2026-06-03-local-hotreload"` → only historical spec/plan references (M4's own docs) remain, no live code/site refs.

---

## Self-review (plan author)
- **Spec coverage:** secret-safe sync (pure `buildRsyncArgs` + .gitignore filter + unit + real-rsync integration proving `.env` doesn't cross) → T1; device-bridge removal (files, wiring, release-notes) → T2; website re-center (hero/stance/proving-ground, drop teaser) → T3; verify → T4. Memory file update + the M4 historical spec/plan docs are intentionally left as history (controller updates memory separately).
- **Placeholder scan:** none — exact edits + commands throughout.
- **Type/name consistency:** `buildRsyncArgs`/`RsyncArgsInput` used by `rsyncPush` + test; the `--filter=dir-merge,- .gitignore` string is identical in code, unit test, and integration test.
