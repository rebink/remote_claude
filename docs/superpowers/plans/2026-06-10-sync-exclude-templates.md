# Sync-exclude templates by project type — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-detect a project's type in the setup wizard, let the user confirm or change it among Flutter / Node-frontend / Node-backend / Python / Common, write the matching `sync.exclude` into `patchwire.yml`, and make the extension's Mutagen two-way sync actually honor those excludes.

**Architecture:** A pure templates module (`syncTemplates.ts`) + a node-only detector (`detectProjectType.ts`). The setup wizard (host + webview) gains a "Sync profile" selector seeded by detection. `MutagenController` merges the project's `sync.exclude` with its safety baseline; `ChatPanel.loadConfig` reads `sync.exclude` and passes it through.

**Tech Stack:** TypeScript, VS Code extension API, tsup (extension host CJS + setup webview IIFE), vitest with `src/test/vscode-stub.ts`.

**Spec:** `docs/superpowers/specs/2026-06-10-sync-exclude-templates-design.md`

**Commands (repo root):** single test `pnpm --filter patchwire-vscode exec vitest run <path>`; all `pnpm --filter patchwire-vscode test`; `pnpm --filter patchwire-vscode typecheck`; `pnpm --filter patchwire-vscode build`.

---

## File structure

- Create: `packages/extension/src/setup/syncTemplates.ts` — pure data: `ProjectType`, `PROJECT_TYPES`, `EXCLUDE_TEMPLATES`, `PROJECT_TYPE_LABELS`. No node imports (the webview imports it).
- Create: `packages/extension/src/setup/syncTemplates.test.ts`
- Create: `packages/extension/src/setup/detectProjectType.ts` — node-only `detectProjectType(dir)`.
- Create: `packages/extension/src/setup/detectProjectType.test.ts`
- Modify: `packages/extension/src/sync/MutagenController.ts` — `ignore?` on `MutagenTarget`, exported `mergeIgnores`, use it in argv.
- Create: `packages/extension/src/sync/mergeIgnores.test.ts`
- Modify: `packages/extension/src/chat/ChatPanel.ts` — `loadConfig` parses `sync.exclude`; `startMutagen` passes `ignore`.
- Modify: `packages/extension/src/setup/SetupWizard.ts` — `detectProjectType` message handler; `step3Submit` writes `EXCLUDE_TEMPLATES[projectType]`.
- Modify: `packages/extension/src/setup/webview/main.ts` — Sync-profile `<select>`, detect-on-input, send `projectType` on submit.

---

## Task 1: Templates module + detector

**Files:** Create `src/setup/syncTemplates.ts`, `src/setup/syncTemplates.test.ts`, `src/setup/detectProjectType.ts`, `src/setup/detectProjectType.test.ts`.

- [ ] **Step 1: Write the failing tests**

`src/setup/syncTemplates.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { EXCLUDE_TEMPLATES, PROJECT_TYPES, PROJECT_TYPE_LABELS } from './syncTemplates.ts';

describe('sync templates', () => {
  it('has a non-empty exclude list and a label for every type', () => {
    for (const t of PROJECT_TYPES) {
      expect(EXCLUDE_TEMPLATES[t].length).toBeGreaterThan(0);
      expect(PROJECT_TYPE_LABELS[t]).toBeTruthy();
    }
  });
  it('includes the common base in every type and never excludes the inbox', () => {
    for (const t of PROJECT_TYPES) {
      expect(EXCLUDE_TEMPLATES[t]).toContain('.DS_Store');
      expect(EXCLUDE_TEMPLATES[t].some((p) => p.includes('.patchwire-inbox'))).toBe(false);
      expect(EXCLUDE_TEMPLATES[t]).not.toContain('.git/'); // handled by --ignore-vcs / always-excluded
    }
  });
  it('carries the right type-specific patterns', () => {
    expect(EXCLUDE_TEMPLATES.flutter).toEqual(expect.arrayContaining(['build/', '**/Pods/', '.dart_tool/']));
    expect(EXCLUDE_TEMPLATES['node-frontend']).toContain('node_modules/');
    expect(EXCLUDE_TEMPLATES['node-backend']).toContain('node_modules/');
    expect(EXCLUDE_TEMPLATES.python).toContain('__pycache__/');
  });
});
```

`src/setup/detectProjectType.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectProjectType } from './detectProjectType.ts';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pw-detect-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('detectProjectType', () => {
  it('detects flutter from pubspec.yaml', () => {
    writeFileSync(join(dir, 'pubspec.yaml'), 'name: app\n');
    expect(detectProjectType(dir)).toBe('flutter');
  });
  it('detects node-frontend when package.json has a frontend dep', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { next: '14' } }));
    expect(detectProjectType(dir)).toBe('node-frontend');
  });
  it('detects node-backend for a plain package.json', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { express: '4' } }));
    expect(detectProjectType(dir)).toBe('node-backend');
  });
  it('detects python from requirements.txt', () => {
    writeFileSync(join(dir, 'requirements.txt'), 'flask\n');
    expect(detectProjectType(dir)).toBe('python');
  });
  it('treats a malformed package.json as node-backend', () => {
    writeFileSync(join(dir, 'package.json'), '{ not json');
    expect(detectProjectType(dir)).toBe('node-backend');
  });
  it('falls back to common', () => {
    expect(detectProjectType(dir)).toBe('common');
  });
});
```

- [ ] **Step 2: Run the tests, confirm they fail** (`pnpm --filter patchwire-vscode exec vitest run src/setup/syncTemplates.test.ts src/setup/detectProjectType.test.ts`) — Expected: cannot resolve the new modules.

- [ ] **Step 3: Implement**

`src/setup/syncTemplates.ts` (pure — NO node imports, the webview bundles it):

```ts
export type ProjectType = 'flutter' | 'node-frontend' | 'node-backend' | 'python' | 'common';

export const PROJECT_TYPES: ProjectType[] = ['flutter', 'node-frontend', 'node-backend', 'python', 'common'];

// Always merged in (OS / editor junk). Never lists .patchwire-inbox/ — it must sync.
const COMMON = ['.DS_Store', 'Thumbs.db', '*.swp', '.idea/'];

export const EXCLUDE_TEMPLATES: Record<ProjectType, string[]> = {
  common: [...COMMON],
  flutter: [...COMMON, 'build/', '.dart_tool/', '**/Pods/', 'ios/.symlinks/',
    'android/.gradle/', '.flutter-plugins', '.flutter-plugins-dependencies', '**/*.iml'],
  'node-frontend': [...COMMON, 'node_modules/', 'dist/', 'build/', '.next/', '.nuxt/',
    '.svelte-kit/', '.vite/', '.turbo/', '.cache/', '.parcel-cache/', 'coverage/'],
  'node-backend': [...COMMON, 'node_modules/', 'dist/', 'build/', 'coverage/', '.turbo/', 'logs/', 'tmp/'],
  python: [...COMMON, '__pycache__/', '*.pyc', '.venv/', 'venv/', '.mypy_cache/',
    '.pytest_cache/', '.ruff_cache/', '*.egg-info/', '.tox/', 'build/', 'dist/'],
};

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  flutter: 'Flutter / Dart',
  'node-frontend': 'Node — web / frontend',
  'node-backend': 'Node — backend / service',
  python: 'Python',
  common: 'Common (minimal)',
};
```

`src/setup/detectProjectType.ts` (node):

```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProjectType } from './syncTemplates.ts';

const FRONTEND_DEPS = ['next', 'nuxt', 'react', 'react-dom', 'vue', '@angular/core', 'svelte', 'vite', 'astro'];

/** Best-effort project-type detection from a directory's root files. Never throws. */
export function detectProjectType(projectDir: string): ProjectType {
  try {
    if (existsSync(join(projectDir, 'pubspec.yaml'))) return 'flutter';
    const pkgPath = join(projectDir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (FRONTEND_DEPS.some((d) => d in deps)) return 'node-frontend';
      } catch { /* malformed package.json → treat as backend below */ }
      return 'node-backend';
    }
    if (['requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile'].some((f) => existsSync(join(projectDir, f)))) {
      return 'python';
    }
  } catch { /* fall through to common */ }
  return 'common';
}
```

- [ ] **Step 4: Run tests, confirm pass** (same command) — Expected: all pass.
- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/setup/syncTemplates.ts packages/extension/src/setup/syncTemplates.test.ts packages/extension/src/setup/detectProjectType.ts packages/extension/src/setup/detectProjectType.test.ts
git commit -m "feat(extension): sync-exclude templates + project-type detection"
```

---

## Task 2: Mutagen honors sync.exclude

**Files:** Modify `src/sync/MutagenController.ts`, `src/chat/ChatPanel.ts`; create `src/sync/mergeIgnores.test.ts`.

- [ ] **Step 1: Write the failing test**

`src/sync/mergeIgnores.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mergeIgnores } from './MutagenController.ts';

describe('mergeIgnores', () => {
  it('merges baseline + excludes, deduped, baseline first', () => {
    expect(mergeIgnores(['node_modules', 'build'], ['build', '.dart_tool', 'node_modules']))
      .toEqual(['node_modules', 'build', '.dart_tool']);
  });
  it('returns the baseline when excludes are empty', () => {
    expect(mergeIgnores(['a', 'b'], [])).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run it, confirm it fails** (`pnpm --filter patchwire-vscode exec vitest run src/sync/mergeIgnores.test.ts`) — Expected: `mergeIgnores` is not exported.

- [ ] **Step 3: Implement**

In `src/sync/MutagenController.ts`:

(a) Add `ignore?` to `MutagenTarget`:

```ts
export interface MutagenTarget {
  project: string;
  host: string;
  user: string;
  sshPort?: number;
  localPath: string;
  remotePath: string;
  ignore?: string[]; // project sync.exclude, merged with IGNORE_PATTERNS baseline
}
```

(b) Export `mergeIgnores` (place just after the `IGNORE_PATTERNS` const):

```ts
/** Merge the safety baseline with the project's excludes, deduped, order-stable. */
export function mergeIgnores(baseline: string[], exclude: string[]): string[] {
  return Array.from(new Set([...baseline, ...exclude]));
}
```

(c) In the `sync create` argv, replace the baseline-only line:

```ts
      ...IGNORE_PATTERNS.flatMap((p) => ['--ignore', p]),
```

with the merged list:

```ts
      ...mergeIgnores(IGNORE_PATTERNS, this.target.ignore ?? []).flatMap((p) => ['--ignore', p]),
```

In `src/chat/ChatPanel.ts`:

(d) Add a config type that carries the excludes (near the top imports / interfaces):

```ts
import type { SessionTarget } from '../session/sessionTerminal.ts';
interface ProjectConfig extends SessionTarget { syncExclude: string[]; }
```

(e) Change `loadConfig` to return `ProjectConfig | null` and parse `sync.exclude`. Replace the `return { ... }` block in `loadConfig`:

```ts
      const syncRaw = parsed.sync as { exclude?: unknown } | undefined;
      const syncExclude = Array.isArray(syncRaw?.exclude)
        ? (syncRaw!.exclude as unknown[]).filter((x): x is string => typeof x === 'string')
        : [];
      return {
        project,
        host: remote.host as string,
        user: remote.user as string,
        sshPort: remote.sshPort as number | undefined,
        remotePath: remote.path as string,
        syncExclude,
      };
```

and change the method signature `private loadConfig(): SessionTarget | null {` → `private loadConfig(): ProjectConfig | null {`.

(f) In `startMutagen`, pass the excludes when constructing the controller. The object passed to `new MutagenController({...}, this.deps.output)` gains:

```ts
        ignore: cfg.syncExclude,
```

(the existing `const cfg = this.loadConfig();` is a `ProjectConfig`, so `cfg.syncExclude` is available).

- [ ] **Step 4: Run the test + full suite + typecheck**

`pnpm --filter patchwire-vscode exec vitest run src/sync/mergeIgnores.test.ts` → PASS;
`pnpm --filter patchwire-vscode test` → all pass; `pnpm --filter patchwire-vscode typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/sync/MutagenController.ts packages/extension/src/sync/mergeIgnores.test.ts packages/extension/src/chat/ChatPanel.ts
git commit -m "feat(extension): Mutagen two-way sync honors patchwire.yml sync.exclude"
```

---

## Task 3: Setup wizard host (detect + write template)

**Files:** Modify `src/setup/SetupWizard.ts`.

- [ ] **Step 1: Add imports** (top of file):

```ts
import { detectProjectType } from './detectProjectType.ts';
import { EXCLUDE_TEMPLATES, PROJECT_TYPES, type ProjectType } from './syncTemplates.ts';
```

- [ ] **Step 2: Add a `detectProjectType` message handler.** In `handleMessage`'s `switch (msg.type)`, add a case (alongside the existing cases):

```ts
      case 'detectProjectType': {
        const lp = (msg.localPath as string) ?? '';
        const os = await import('node:os');
        const path = await import('node:path');
        const expanded = lp.startsWith('~') ? path.join(os.homedir(), lp.slice(1)) : lp;
        const projectType: ProjectType = expanded ? detectProjectType(expanded) : 'common';
        this.panel?.webview.postMessage({ type: 'detectedProjectType', projectType });
        return;
      }
```

- [ ] **Step 3: Use the selected template in `step3Submit`.** Near the top of the `step3Submit` case (after `const { host, user, sshPort = 22 } = this.state;`), resolve the chosen type:

```ts
        const projectType: ProjectType = PROJECT_TYPES.includes(msg.projectType as ProjectType)
          ? (msg.projectType as ProjectType)
          : 'common';
```

Then in the `stringify({ ... })` call that writes `patchwire.yml`, replace the hardcoded line:

```ts
              sync: { exclude: ['build/', '.dart_tool/', 'ios/Pods/', 'node_modules/', '.git/'] },
```

with:

```ts
              sync: { exclude: EXCLUDE_TEMPLATES[projectType] },
```

- [ ] **Step 4: Typecheck** (`pnpm --filter patchwire-vscode typecheck`) → clean. (No new unit test; the host message wiring is covered by typecheck + the manual check in Task 4.)
- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/setup/SetupWizard.ts
git commit -m "feat(extension): setup wizard detects project type + writes its sync template"
```

---

## Task 4: Setup wizard webview (Sync profile selector)

**Files:** Modify `src/setup/webview/main.ts`. No webview unit-test harness — verified by typecheck + build + a render note.

- [ ] **Step 1: Import the pure template data + track the selection.** At the top of `src/setup/webview/main.ts` add:

```ts
import { PROJECT_TYPES, PROJECT_TYPE_LABELS, type ProjectType } from '../syncTemplates.ts';
```

and near the other module-level `let` state declarations:

```ts
let selectedType: ProjectType = 'common';
let typeUserEdited = false;
```

- [ ] **Step 2: Handle the detection reply.** In the `window.addEventListener('message', ...)` handler, add a branch (alongside the existing `else if (msg.type === ...)` branches):

```ts
  } else if (msg.type === 'detectedProjectType' && msg.projectType) {
    if (!typeUserEdited) {
      selectedType = msg.projectType as ProjectType;
      render();
    }
```

- [ ] **Step 3: Add the selector to `renderStep3`.** Build a `<select>` and request detection when the local path changes. Inside `renderStep3`, after the `localPathInput` is created, add:

```ts
  const typeSelect = h('select', {}) as HTMLSelectElement;
  for (const t of PROJECT_TYPES) {
    typeSelect.append(h('option', { value: t }, PROJECT_TYPE_LABELS[t]));
  }
  typeSelect.value = selectedType;
  typeSelect.addEventListener('change', () => {
    typeUserEdited = true;
    selectedType = typeSelect.value as ProjectType;
  });

  const requestDetect = () => {
    if (localPathValue) vscode.postMessage({ type: 'detectProjectType', localPath: localPathValue });
  };
```

Call `requestDetect()` from the existing `localPathInput` `input` listener (append at its end) and once on render:

```ts
  // inside the existing localPathInput 'input' handler, after updating localPathValue:
  requestDetect();
```

and immediately before `return container;`:

```ts
  requestDetect();
```

Add a form row for the selector to the `container.append(...)` list (place it after the project-name row, before the warn banner):

```ts
    h('div', { className: 'form-row' },
      h('label', {}, 'Sync profile (what to skip when syncing)'),
      typeSelect,
      h('p', { className: 'hint' }, 'Auto-detected from your project; change it if needed. Skips build caches, dependencies, etc.'),
    ),
```

- [ ] **Step 4: Send the chosen type on submit.** In `renderStep3`'s `submitBtn` click handler, add `projectType` to the posted message:

```ts
    vscode.postMessage({
      type: 'step3Submit',
      localPath: localPathValue,
      projectName: projectNameValue,
      projectType: selectedType,
    });
```

- [ ] **Step 5: Typecheck + build**

`pnpm --filter patchwire-vscode typecheck` → clean; `pnpm --filter patchwire-vscode build` → success (the setup webview IIFE bundles `syncTemplates.ts`; confirm no `node:` import leaked into it — `syncTemplates.ts` is pure).

- [ ] **Step 6: Render note (for the PR).** In the Extension Development Host, run **Patchwire: Setup**, reach step 3 in a Flutter and a Node project: the **Sync profile** select shows the detected type pre-selected, changing it sticks, and after finishing, `patchwire.yml`'s `sync.exclude` matches the chosen template.

- [ ] **Step 7: Commit**

```bash
git add packages/extension/src/setup/webview/main.ts
git commit -m "feat(extension): setup wizard Sync profile selector (auto-detected)"
```

---

## Final verification

- [ ] `pnpm --filter patchwire-vscode test` (existing + new template/detect/mergeIgnores tests pass).
- [ ] `pnpm --filter patchwire-vscode typecheck` clean; `pnpm --filter patchwire-vscode build` clean (incl. the bundle guard from 0.3.13).
- [ ] `git diff --stat main...HEAD` touches only the files in this plan (extension setup/sync/chat + this spec/plan). The CLI and `cli/src/lib/config.ts` (`sync.exclude` schema already exists) are unchanged.
