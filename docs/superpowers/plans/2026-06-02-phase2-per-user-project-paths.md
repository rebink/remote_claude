# Phase 2: Per-user project paths — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move from a flat `PROJECTS_ROOT/<project>/` layout to a per-user namespace `PROJECTS_ROOT/<user>/<project>/`, with one-shot agent-side migration for v0.1 installs and laptop-side `PW_USER` env wiring through `patchwire setup`.

**Architecture:** The agent's path resolution gains a `req.username` segment between `projectsRoot` and the body's `project` field. On boot, when the users.json migration creates a `default` user, a paired project-migration step moves any top-level git-repo directories in `PROJECTS_ROOT/` into `PROJECTS_ROOT/default/`. On the laptop, `patchwire setup` writes a `PW_USER=<name>` line into `~/.patchwire/env` and bakes `${PW_USER}` into the YAML's `remote.path`, so existing env-interpolation handles the rest.

**Tech Stack:** TypeScript, Node 20+, Fastify 4, Commander 12, Zod 3, Vitest 2, node:fs.

**Spec reference:** `docs/superpowers/specs/2026-06-01-multi-developer-agent-design.md` (sections 4.1, 5.2, 6.1, 10 — phase 2 line).

**Out of scope for this phase** (later plans):
- Concurrency / queue / semaphores — phase 3
- Audit log JSONL — phase 4
- SSE protocol on `/ask` — phase 5
- Admin panel — phase 6

---

## File Structure

**New files:**
- `packages/cli/src/agent/migrate-projects.ts` — `migrateProjectsToDefault({projectsRoot})` helper
- `packages/cli/test/agent/migrate-projects.test.ts` — unit tests for the helper
- `packages/cli/test/integration/per-user-paths.e2e.test.ts` — end-to-end test: two users with same project name don't collide

**Modified files:**
- `packages/cli/src/agent/server.ts` — `/ask` and `/chat` resolve `PROJECTS_ROOT/<req.username>/<project>` with a path-escape guard
- `packages/cli/src/agent.ts` — when `migrateIfNeeded` returns `migrated: true`, call `migrateProjectsToDefault` and log
- `packages/cli/src/commands/setup.ts` — adds a `--username <name>` flag (default: `os.userInfo().username`), writes `PW_USER=<name>` to `~/.patchwire/env`, bakes `${PW_USER}` into the YAML path
- `packages/cli/test/agent.test.ts` — fixtures move from `PROJECTS_ROOT/sample/` to `PROJECTS_ROOT/tester/sample/` to match the new resolution
- `packages/website/src/content/docs/configuration.md` — note `PW_USER` env + path format
- `packages/website/src/content/docs/agent.md` — note per-user directory layout
- `packages/website/src/content/docs/quickstart.md` — update setup walkthrough

---

## Task 1: Project migration helper (`src/agent/migrate-projects.ts`)

**Files:**
- Create: `packages/cli/src/agent/migrate-projects.ts`
- Test: `packages/cli/test/agent/migrate-projects.test.ts`

The helper walks `PROJECTS_ROOT/` and moves any direct child that:
- is a directory,
- has a name matching `[a-zA-Z0-9_.-]+` (the existing project name regex), and
- contains a `.git` directory (i.e., looks like a git repo)

into `PROJECTS_ROOT/default/<name>/`. Directories already inside `PROJECTS_ROOT/default/` (or any other sibling user dir) are not touched. Idempotent: re-running on a migrated tree is a no-op.

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/test/agent/migrate-projects.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateProjectsToDefault } from '../../src/agent/migrate-projects.ts';

describe('migrateProjectsToDefault', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'pw-mproj-')); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function makeGitProject(parent: string, name: string): string {
    const dir = join(parent, name);
    mkdirSync(join(dir, '.git'), { recursive: true });
    writeFileSync(join(dir, 'a.txt'), 'one\n');
    return dir;
  }

  it('moves a top-level git project into default/', () => {
    makeGitProject(root, 'myapp');
    const result = migrateProjectsToDefault({ projectsRoot: root });
    expect(result.moved).toEqual(['myapp']);
    expect(existsSync(join(root, 'default', 'myapp', '.git'))).toBe(true);
    expect(existsSync(join(root, 'myapp'))).toBe(false);
  });

  it('moves multiple top-level projects', () => {
    makeGitProject(root, 'app-a');
    makeGitProject(root, 'app-b');
    const result = migrateProjectsToDefault({ projectsRoot: root });
    expect(result.moved.sort()).toEqual(['app-a', 'app-b']);
    expect(existsSync(join(root, 'default', 'app-a', '.git'))).toBe(true);
    expect(existsSync(join(root, 'default', 'app-b', '.git'))).toBe(true);
  });

  it('skips dirs without a .git child', () => {
    mkdirSync(join(root, 'just-a-folder'));
    writeFileSync(join(root, 'just-a-folder', 'notes.md'), 'hi\n');
    const result = migrateProjectsToDefault({ projectsRoot: root });
    expect(result.moved).toEqual([]);
    expect(existsSync(join(root, 'just-a-folder'))).toBe(true);
  });

  it('skips dirs whose name does not match the project regex', () => {
    mkdirSync(join(root, 'has space'), { recursive: true });
    mkdirSync(join(root, 'has space', '.git'), { recursive: true });
    const result = migrateProjectsToDefault({ projectsRoot: root });
    expect(result.moved).toEqual([]);
    expect(existsSync(join(root, 'has space'))).toBe(true);
  });

  it('does not touch existing user namespace dirs (default, alice)', () => {
    mkdirSync(join(root, 'default'));
    makeGitProject(join(root, 'default'), 'already-migrated');
    mkdirSync(join(root, 'alice'));
    makeGitProject(join(root, 'alice'), 'alice-proj');
    const result = migrateProjectsToDefault({ projectsRoot: root });
    expect(result.moved).toEqual([]);
    expect(existsSync(join(root, 'default', 'already-migrated', '.git'))).toBe(true);
    expect(existsSync(join(root, 'alice', 'alice-proj', '.git'))).toBe(true);
  });

  it('mixes the two: moves top-level project alongside existing user dirs', () => {
    mkdirSync(join(root, 'alice'));
    makeGitProject(join(root, 'alice'), 'alice-proj');
    makeGitProject(root, 'leftover');
    const result = migrateProjectsToDefault({ projectsRoot: root });
    expect(result.moved).toEqual(['leftover']);
    expect(existsSync(join(root, 'default', 'leftover', '.git'))).toBe(true);
    expect(existsSync(join(root, 'alice', 'alice-proj', '.git'))).toBe(true);
    expect(existsSync(join(root, 'leftover'))).toBe(false);
  });

  it('refuses to overwrite if default/<name>/ already exists', () => {
    makeGitProject(root, 'collide');
    mkdirSync(join(root, 'default', 'collide'), { recursive: true });
    writeFileSync(join(root, 'default', 'collide', 'existing.txt'), 'do not lose me\n');
    expect(() => migrateProjectsToDefault({ projectsRoot: root })).toThrow(/already exists/);
    // Source still intact (refused, did not partially move)
    expect(existsSync(join(root, 'collide'))).toBe(true);
  });

  it('is idempotent — running twice on a clean tree is a no-op', () => {
    const r1 = migrateProjectsToDefault({ projectsRoot: root });
    const r2 = migrateProjectsToDefault({ projectsRoot: root });
    expect(r1.moved).toEqual([]);
    expect(r2.moved).toEqual([]);
  });

  it('creates default/ even when empty (so subsequent rsync targets exist)', () => {
    makeGitProject(root, 'first');
    migrateProjectsToDefault({ projectsRoot: root });
    expect(statSync(join(root, 'default')).isDirectory()).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/cli && pnpm vitest run test/agent/migrate-projects.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/cli/src/agent/migrate-projects.ts`:

```typescript
import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT_NAME_RE = /^[a-zA-Z0-9_.-]+$/;
const DEFAULT_USER = 'default';

export interface MigrateProjectsInput {
  projectsRoot: string;
}

export interface MigrateProjectsResult {
  moved: string[];
}

/**
 * One-shot v0.1 → v0.2 project layout migration.
 *
 * Walks PROJECTS_ROOT/* and moves each child directory that looks like a
 * git project (valid name + has a .git subdir) into PROJECTS_ROOT/default/.
 * Existing user namespace dirs (e.g. PROJECTS_ROOT/default/ itself, or
 * PROJECTS_ROOT/alice/) are left untouched — they look like containers,
 * not v0.1 leftovers, because their .git would live deeper.
 *
 * Refuses to overwrite an existing PROJECTS_ROOT/default/<name>/ — that
 * means a manual setup already exists at the target; the operator must
 * resolve the conflict by hand.
 */
export function migrateProjectsToDefault(input: MigrateProjectsInput): MigrateProjectsResult {
  const root = input.projectsRoot;
  if (!existsSync(root)) {
    return { moved: [] };
  }
  const defaultRoot = join(root, DEFAULT_USER);

  const moved: string[] = [];
  for (const name of readdirSync(root)) {
    if (name === DEFAULT_USER) continue;
    if (!PROJECT_NAME_RE.test(name)) continue;
    const src = join(root, name);
    if (!statSync(src).isDirectory()) continue;
    if (!existsSync(join(src, '.git'))) continue; // not a git project, leave alone

    const dst = join(defaultRoot, name);
    if (existsSync(dst)) {
      throw new Error(
        `migrate-projects: ${dst} already exists; refusing to overwrite (move ${src} manually)`,
      );
    }
    mkdirSync(defaultRoot, { recursive: true });
    renameSync(src, dst);
    moved.push(name);
  }
  return { moved };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/cli && pnpm vitest run test/agent/migrate-projects.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/agent/migrate-projects.ts packages/cli/test/agent/migrate-projects.test.ts
git commit -m "feat(agent): one-shot project migration to PROJECTS_ROOT/default/"
```

---

## Task 2: Wire project migration into agent boot (`src/agent.ts`)

When `migrateIfNeeded` returns `migrated: true` (i.e., we just created the legacy `default` user), also run `migrateProjectsToDefault`. Log both migrations on a single line.

**Files:**
- Modify: `packages/cli/src/agent.ts`

- [ ] **Step 1: Edit `src/agent.ts`**

Apply these edits to `packages/cli/src/agent.ts`:

1. Add the import (just below the existing migration import):

```typescript
import { migrateProjectsToDefault } from './agent/migrate-projects.ts';
```

2. Replace the migration log block. Find:

```typescript
  if (migration.migrated) {
    app.log.info(`migrated v0.1 → v0.2: created 'default' user from PW_AGENT_TOKEN`);
  }
```

Replace with:

```typescript
  if (migration.migrated) {
    const projectsMigration = migrateProjectsToDefault({ projectsRoot });
    app.log.info(
      `migrated v0.1 → v0.2: created 'default' user from PW_AGENT_TOKEN, ` +
        `moved ${projectsMigration.moved.length} project(s) into ${projectsRoot}/default/`,
    );
    if (projectsMigration.moved.length > 0) {
      app.log.info(`moved projects: ${projectsMigration.moved.join(', ')}`);
    }
  }
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/cli && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/agent.ts
git commit -m "feat(agent): run project migration alongside users.json migration"
```

---

## Task 3: Server-side path resolution change (`src/agent/server.ts`)

Both `/ask` and `/chat` resolve a project directory from `opts.projectsRoot + project`. Phase 2 inserts the authenticated `req.username` as a segment between them. Add a defense-in-depth check that the resolved path actually lives under `PROJECTS_ROOT/<user>/`.

**Files:**
- Modify: `packages/cli/src/agent/server.ts`
- Modify: `packages/cli/test/agent.test.ts` (fixtures must move)

- [ ] **Step 1: Update `test/agent.test.ts` fixtures**

The existing tests put their fixture project at `projectsRoot/sample/`. Move it to `projectsRoot/tester/sample/` to match the new resolution (since `makeStore()` registers the test token against user `tester`).

In `packages/cli/test/agent.test.ts`, find the `beforeEach` block:

```typescript
beforeEach(async () => {
  projectsRoot = await mkdtemp(join(tmpdir(), 'devbridge-agent-'));
  projectDir = join(projectsRoot, 'sample');
  await makeProject();
});
```

Change to:

```typescript
beforeEach(async () => {
  projectsRoot = await mkdtemp(join(tmpdir(), 'devbridge-agent-'));
  projectDir = join(projectsRoot, 'tester', 'sample');
  await makeProject();
});
```

Also find the `'returns 412 when project is not a git repo'` test:

```typescript
const noGitDir = join(projectsRoot, 'plain');
await mkdir(noGitDir);
```

Change to:

```typescript
const noGitDir = join(projectsRoot, 'tester', 'plain');
await mkdir(noGitDir, { recursive: true });
```

(The `{ recursive: true }` is required because the `tester` parent dir does not exist yet in this test path.)

- [ ] **Step 2: Run the tests — expect FAIL**

```bash
cd packages/cli && pnpm vitest run test/agent.test.ts
```

Expected: tests now FAIL because `server.ts` still resolves `projectsRoot/sample/` not `projectsRoot/tester/sample/`.

- [ ] **Step 3: Modify `src/agent/server.ts`**

The current `/ask` handler resolves:

```typescript
const projectDir = resolve(opts.projectsRoot, project);
```

Replace with:

```typescript
const username = req.username!;
const userRoot = resolve(opts.projectsRoot, username);
const projectDir = resolve(userRoot, project);
if (!projectDir.startsWith(userRoot + path.sep)) {
  reply.code(400);
  return { error: 'invalid project name' };
}
```

(`req.username!` is safe because the auth hook runs before this handler and `null` returns 401 first.)

Add `import { sep } from 'node:path';` at the top of the file if not already present. Or use the existing `path` import — check what's already imported.

The current file imports `import { join, resolve } from 'node:path';`. Add `sep`:

```typescript
import { join, resolve, sep } from 'node:path';
```

Then `path.sep` becomes just `sep` in the check:

```typescript
if (!projectDir.startsWith(userRoot + sep)) {
```

Apply the **same change to the `/chat` handler**. Find:

```typescript
const cwd = resolve(opts.projectsRoot, body.projectName);
```

Replace with:

```typescript
const username = req.username!;
const userRoot = resolve(opts.projectsRoot, username);
const cwd = resolve(userRoot, body.projectName);
if (!cwd.startsWith(userRoot + sep)) {
  return reply.status(400).send({ ok: false, code: 'invalid_project_name' });
}
```

- [ ] **Step 4: Run all tests + typecheck**

```bash
cd packages/cli && pnpm vitest run test/agent.test.ts test/agent/ && pnpm typecheck
```

Expected: ALL PASS — the agent.test.ts fixtures now match the new path resolution, the existing /me + auth tests still pass.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/agent/server.ts packages/cli/test/agent.test.ts
git commit -m "feat(agent): per-user project paths (PROJECTS/<user>/<project>)"
```

---

## Task 4: `patchwire setup` writes PW_USER + user-scoped path

Add a `--username <name>` flag to `patchwire setup`. Default value: `os.userInfo().username`. Write `PW_USER=<name>` alongside `PW_TOKEN` in `~/.patchwire/env`. In the generated `patchwire.yml`, the `remote.path` includes `${PW_USER}` as a segment.

**Files:**
- Modify: `packages/cli/src/commands/setup.ts`
- Modify: `packages/cli/src/cli.ts` (add the new flag to the command definition)

- [ ] **Step 1: Add the `--username` flag in `src/cli.ts`**

In the `program.command('setup')` block, add a new option alongside the existing ones. Find the existing options (around `.option('--token ...')`), and add immediately below:

```typescript
.option('--username <name>', "the agent's name for you (default: os.userInfo().username)")
```

Then in the action handler at the bottom of that block, add `username: opts.username` to the call:

```typescript
await runSetup(process.cwd(), {
  force: opts.force,
  noTailscale: opts.tailscale === false,
  host: opts.host,
  user: opts.user,
  project: opts.project,
  path: opts.path,
  sshPort: opts.sshPort,
  agentPort: opts.agentPort,
  token: opts.token,
  username: opts.username,
});
```

- [ ] **Step 2: Wire the username through `src/commands/setup.ts`**

In `packages/cli/src/commands/setup.ts`:

1. Add `username?: string;` to the `SetupOptions` interface and `username: string;` to the `SetupAnswers` interface.

2. At the top of `runSetup`, after the existing `target` check, resolve the effective username:

```typescript
const username = opts.username ?? os.userInfo().username;
```

(Add `import * as os from 'node:os';` near the existing `import { homedir } from 'node:os';` — or extend that import to include `userInfo`: `import { homedir, userInfo } from 'node:os';` and use `userInfo().username`.)

3. Thread `username` into the answers object. Both `tailnetFlow` and `manualFlow` build a SetupAnswers; the simplest path is to set `username` on the returned object after the flow function returns:

```typescript
const answers = !skipTailscale && ts.running && ts.peers.length > 0
  ? await tailnetFlow(cwd, ts.peers, opts)
  : await manualFlow(cwd, ts, opts);
answers.username = username;
```

4. Update the env file write to also include `PW_USER`:

Find:
```typescript
await writeFile(envFile, `export PW_TOKEN=${answers.token}\n`, 'utf8');
```

Replace with:
```typescript
await writeFile(
  envFile,
  `export PW_TOKEN=${answers.token}\nexport PW_USER=${answers.username}\n`,
  'utf8',
);
```

5. In the YAML path field, prepend the user segment. Locate where the YAML is built (the `writeYaml` helper, or the inline string template that defines `remote.path`). The default path today is something like `~/workspace/<project>`. Update the path template to insert `${PW_USER}` before the project name. For example, if the current default `path` value is computed as `~/workspace/${PROJECT}`, change it to `~/workspace/${PW_USER}/${PROJECT}`.

In practice: search the file for any `remote.path` or `path:` literal that gets written into YAML, and ensure `${PW_USER}` precedes the project name. The current default appears in the `tailnetFlow`/`manualFlow` defaults — replace whatever defaults `~/workspace/<project>` (or `${HOME}/workspace/<project>`) with `~/workspace/${PW_USER}/<project>` (or `${HOME}/workspace/${PW_USER}/<project>`).

6. Update the "Next steps" output. Find:

```typescript
console.log(chalk.cyan('  1. Load the token in your shell:'));
console.log(`       echo 'source ~/.patchwire/env' >> ~/.zshrc`);
console.log(`       source ~/.patchwire/env`);
```

Append after `source ~/.patchwire/env`:

```typescript
console.log();
console.log(chalk.gray(`     PW_TOKEN and PW_USER (=${answers.username}) are exported.`));
```

- [ ] **Step 3: Update the setup test helper / test (if any tests cover setup output)**

There are existing setup-related tests at `packages/cli/test/commands/setup-list-peers.test.ts` and `setup-password-stdin.test.ts`. Neither exercises the full `runSetup` flow, so no test changes are required.

Add a small smoke test that constructs the env file content and checks it includes both lines. Create `packages/cli/test/commands/setup-env-file.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSetup } from '../../src/commands/setup.ts';

describe('runSetup writes ~/.patchwire/env with PW_USER + PW_TOKEN', () => {
  let cwd: string;
  let homeBackup: string | undefined;
  let fakeHome: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'pw-setup-env-'));
    fakeHome = mkdtempSync(join(tmpdir(), 'pw-fakehome-'));
    homeBackup = process.env.HOME;
    process.env.HOME = fakeHome;
  });
  afterEach(() => {
    if (homeBackup === undefined) delete process.env.HOME;
    else process.env.HOME = homeBackup;
    rmSync(cwd, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('writes both PW_TOKEN and PW_USER lines', async () => {
    await runSetup(cwd, {
      noTailscale: true,
      host: '127.0.0.1',
      user: 'me',
      project: 'demo',
      path: '/tmp/demo',
      sshPort: 22,
      agentPort: 7878,
      token: 'test-token-1234',
      username: 'alice',
    });
    const envPath = join(fakeHome, '.patchwire', 'env');
    expect(existsSync(envPath)).toBe(true);
    const content = readFileSync(envPath, 'utf8');
    expect(content).toMatch(/^export PW_TOKEN=test-token-1234\b/m);
    expect(content).toMatch(/^export PW_USER=alice\b/m);
  });
});
```

(`os.homedir()` resolves from `process.env.HOME` on Unix-like systems; overriding HOME swaps where setup writes the env file. This avoids polluting the developer's real `~/.patchwire/`.)

- [ ] **Step 4: Run tests + typecheck**

```bash
cd packages/cli && pnpm vitest run test/commands/setup-env-file.test.ts && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/cli.ts packages/cli/src/commands/setup.ts packages/cli/test/commands/setup-env-file.test.ts
git commit -m "feat(cli): patchwire setup writes PW_USER + user-scoped remote path"
```

---

## Task 5: End-to-end test — two users, same project name, no collision

Verify the key correctness property of phase 2: Alice and Bob can both have a project named `myapp` and each sees only their own files.

**File:**
- Create: `packages/cli/test/integration/per-user-paths.e2e.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildServer } from '../../src/agent/server.ts';
import { UsersStore } from '../../src/agent/users-store.ts';

describe('per-user paths end-to-end', () => {
  let dir: string;
  let app: ReturnType<typeof buildServer>;

  function git(args: string[], cwd: string): void {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  }

  function makeProject(parent: string, name: string, content: string): void {
    const p = join(parent, name);
    mkdirSync(p, { recursive: true });
    git(['init', '-q', '-b', 'main'], p);
    git(['config', 'user.email', 't@example.com'], p);
    git(['config', 'user.name', 'T'], p);
    git(['config', 'commit.gpgsign', 'false'], p);
    writeFileSync(join(p, 'README.md'), content);
    git(['add', '.'], p);
    git(['commit', '-q', '-m', 'init'], p);
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pw-perusr-e2e-'));
    const store = new UsersStore(join(dir, 'users.json'));
    store.addUser('alice', 'alice-token');
    store.addUser('bob', 'bob-token');
    // Both Alice and Bob have a project named "myapp" — different contents.
    makeProject(join(dir, 'alice'), 'myapp', "# Alice's app\n");
    makeProject(join(dir, 'bob'), 'myapp', "# Bob's app\n");
    app = buildServer({
      usersStore: store, projectsRoot: dir,
      aiCommand: 'sh', aiArgs: ['-c', 'true'], timeoutSec: 5, version: 'e2e',
    });
  });
  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('Alice and Bob each see only their own project named "myapp"', async () => {
    // Both /ask requests target the same project NAME but resolve under different user roots.
    const [a, b] = await Promise.all([
      app.inject({
        method: 'POST', url: '/ask',
        headers: { authorization: 'Bearer alice-token', 'content-type': 'application/json' },
        payload: { prompt: 'noop', project: 'myapp' },
      }),
      app.inject({
        method: 'POST', url: '/ask',
        headers: { authorization: 'Bearer bob-token', 'content-type': 'application/json' },
        payload: { prompt: 'noop', project: 'myapp' },
      }),
    ]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    // The fake AI command (sh -c true) makes no changes — diff is empty for both.
    expect((a.json() as { diff: string }).diff).toBe('');
    expect((b.json() as { diff: string }).diff).toBe('');
  });

  it('a user with no project at the expected path gets 404 even if another user has that name', async () => {
    rmSync(join(dir, 'bob'), { recursive: true });
    const res = await app.inject({
      method: 'POST', url: '/ask',
      headers: { authorization: 'Bearer bob-token', 'content-type': 'application/json' },
      payload: { prompt: 'noop', project: 'myapp' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('a project name with .. is rejected (path stays under user root)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/ask',
      headers: { authorization: 'Bearer alice-token', 'content-type': 'application/json' },
      payload: { prompt: 'noop', project: '..' },
    });
    // 400 from the zod regex; the user-root check is belt-and-suspenders.
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run it**

```bash
cd packages/cli && pnpm vitest run test/integration/per-user-paths.e2e.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 3: Run the full suite**

```bash
cd packages/cli && pnpm test && pnpm typecheck
```

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/test/integration/per-user-paths.e2e.test.ts
git commit -m "test(agent): per-user path isolation (two users, same project name)"
```

---

## Task 6: Documentation refresh

Three website doc files need notes for the new path layout and `PW_USER`.

**Files:**
- Modify: `packages/website/src/content/docs/configuration.md` — `PW_USER` env entry on the laptop side
- Modify: `packages/website/src/content/docs/agent.md` — describe `PROJECTS_ROOT/<user>/<project>` layout
- Modify: `packages/website/src/content/docs/quickstart.md` — update setup walkthrough to mention `--username`

- [ ] **Step 1: Read each file first**

```bash
cat packages/website/src/content/docs/configuration.md
cat packages/website/src/content/docs/agent.md
cat packages/website/src/content/docs/quickstart.md
```

- [ ] **Step 2: Add `PW_USER` to `configuration.md`**

Locate the "Laptop environment variables" section (or its closest equivalent — a list/table that documents `PW_TOKEN`). Add a new entry below `PW_TOKEN`:

```markdown
| `PW_USER` | yes (v0.2+) | (none) | The username the agent recognizes you as. Set by `patchwire setup` (defaults to `os.userInfo().username`). Used both for `/me` identity and in the rsync target path. |
```

If the doc uses a bullet-list rather than a table, adapt the style accordingly — keep the prose equivalent.

- [ ] **Step 3: Add a layout note to `agent.md`**

Inside or just after the "Adding more developers" section (introduced in phase 1), insert:

```markdown
### Project layout on the agent

As of v0.2, every project lives under a user namespace:

```
PROJECTS_ROOT/
├── alice/
│   ├── flutter-app/        # rsync target for Alice's `patchwire ask`
│   └── backend/
└── bob/
    └── flutter-app/        # Bob's copy — distinct from Alice's
```

The agent resolves `<projectsRoot>/<username>/<project>` per request, where
`<username>` comes from the authenticated bearer token. This means two
developers can have a project with the same name without collision.

On upgrade from v0.1, the first `patchwire-agent serve` run after install
moves any top-level `PROJECTS_ROOT/<project>/` into `PROJECTS_ROOT/default/<project>/`
automatically, so existing single-user setups keep working without manual
file moves.
```

- [ ] **Step 4: Update `quickstart.md`**

In the section that documents the first `patchwire setup` invocation, add a brief note about the new `--username` flag and the path implications:

```markdown
> **Multi-user agents:** if you're connecting to a shared agent box, pass
> `--username <yourname>` to `patchwire setup`. The agent admin will have
> issued you a token via `patchwire-agent user add <yourname>`. Your projects
> will live under `PROJECTS_ROOT/<yourname>/` on the agent so they don't
> collide with teammates' projects of the same name.
```

- [ ] **Step 5: Sanity-build the website (skip if too noisy)**

```bash
cd packages/website && pnpm build 2>&1 | tail -10
```

Expected: build succeeds (or pre-existing failures unrelated to your edits).

- [ ] **Step 6: Commit**

```bash
git add packages/website/src/content/docs/configuration.md packages/website/src/content/docs/agent.md packages/website/src/content/docs/quickstart.md
git commit -m "docs: per-user project paths + PW_USER env (v0.2 phase 2)"
```

---

## Final verification

- [ ] **Step 1: Full pipeline**

```bash
cd packages/cli && pnpm verify
```

Expected: typecheck, tests, build, smoke all green.

- [ ] **Step 2: Backward-compatibility check (manual)**

Confirm a v0.1-style install upgrades cleanly: spin up an agent with a populated `PROJECTS_ROOT/myapp/` (git repo, no user dir) and `PW_AGENT_TOKEN=legacy`, no `users.json`. After first request, `myapp` should now live at `PROJECTS_ROOT/default/myapp/`. Tester runs this manually if curl/dev:agent is available; otherwise rely on the unit + e2e tests.

- [ ] **Step 3: Tag**

```bash
git tag -a v0.2.1-phase2 -m "Phase 2: per-user project paths + boot migration"
```

---

## Spec coverage check

| Spec requirement | Covered by |
|---|---|
| `PROJECTS_ROOT/<user>/<project>` layout | Task 3 (server resolution), Task 4 (laptop YAML path), Task 5 (e2e isolation) |
| Path-escape defense (`startsWith(userRoot + sep)`) | Task 3 |
| One-shot v0.1 project migration into `default/` | Task 1 (helper), Task 2 (boot wiring) |
| Migration log line on agent start | Task 2 |
| Laptop `PW_USER` env var | Task 4 |
| `patchwire setup` writes user + path | Task 4 |
| Idempotent migration (safe re-runs) | Task 1 (idempotency test) |
| Refuses to clobber existing `default/<name>/` | Task 1 (overwrite-refusal test) |
| Docs updated | Task 6 |
