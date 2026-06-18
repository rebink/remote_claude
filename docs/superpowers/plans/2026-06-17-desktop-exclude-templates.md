# Desktop Sync Exclude Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the desktop Add Project flow, auto-detect the project type and let the user pick it from a dropdown that writes the matching `sync.exclude` template into `patchwire.yml` — sharing the template data with the VS Code extension via `@patchwire/core`.

**Architecture:** Move the pure exclude-template data into `@patchwire/core` (subpath export) so the extension and desktop share one source. A new Rust `detect_project_type` command mirrors the extension's detector; `write_project_yml` renders a dynamic exclude list (with a CR/LF YAML-injection guard). AddProject gains a project-type dropdown + excludes preview.

**Tech Stack:** TypeScript (core + desktop) + Svelte 5 runes + vitest, Rust + Tauri 2. Spec: `docs/superpowers/specs/2026-06-17-desktop-exclude-templates-design.md`.

---

## File Structure

**New:**
- `packages/core/src/sync-templates.ts` — pure `ProjectType`, `PROJECT_TYPES`, `EXCLUDE_TEMPLATES`, `PROJECT_TYPE_LABELS`.
- `packages/core/src/sync-templates.test.ts` — core test.

**Modified:**
- `packages/core/package.json` — add `"./sync-templates"` subpath export.
- `packages/extension/src/setup/syncTemplates.ts` — re-export from core.
- `packages/desktop/src-tauri/src/lib.rs` — `detect_project_type` command (+register); `write_project_yml` dynamic `exclude` + CR/LF guard.
- `packages/desktop/package.json` — add `@patchwire/core` dep.
- `packages/desktop/src/lib/ipc.ts` — `ProjectYmlArgs.exclude`, `detectProjectType()`.
- `packages/desktop/src/screens/AddProject.svelte` — project-type dropdown + detect + preview + pass `exclude`.
- `packages/desktop/src/screens/AddProject.test.ts` — extend.

**Test commands:** `pnpm --filter @patchwire/core test`, `pnpm --filter patchwire-vscode test` (extension), `pnpm --filter patchwire-desktop test`. Rust: `cd packages/desktop/src-tauri && PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo build` (after `pnpm --filter patchwire-desktop stage-sidecar` so the sidecar binary exists). Pre-existing desktop `tsc` errors in unrelated test fixtures are not your concern.

---

## Task 1: Shared templates in core + extension re-export

**Files:**
- Create: `packages/core/src/sync-templates.ts`
- Create: `packages/core/src/sync-templates.test.ts`
- Modify: `packages/core/package.json`
- Modify: `packages/extension/src/setup/syncTemplates.ts`

- [ ] **Step 1: Create `packages/core/src/sync-templates.ts`** (pure data moved verbatim from the extension)

```ts
// packages/core/src/sync-templates.ts
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

- [ ] **Step 2: Write the core test** `packages/core/src/sync-templates.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { EXCLUDE_TEMPLATES, PROJECT_TYPES, PROJECT_TYPE_LABELS } from './sync-templates.ts';

describe('sync-templates', () => {
  it('has 5 types, each with a non-empty exclude list and a label', () => {
    expect(PROJECT_TYPES).toHaveLength(5);
    for (const t of PROJECT_TYPES) {
      expect(EXCLUDE_TEMPLATES[t].length).toBeGreaterThan(0);
      expect(PROJECT_TYPE_LABELS[t]).toBeTruthy();
    }
  });
  it('merges the COMMON base into every type and never excludes the inbox', () => {
    for (const t of PROJECT_TYPES) {
      expect(EXCLUDE_TEMPLATES[t]).toContain('.DS_Store');
      expect(EXCLUDE_TEMPLATES[t].some((p) => p.includes('.patchwire-inbox'))).toBe(false);
    }
  });
  it('carries the right type-specific patterns', () => {
    expect(EXCLUDE_TEMPLATES.flutter).toEqual(expect.arrayContaining(['build/', '**/Pods/', '.dart_tool/']));
    expect(EXCLUDE_TEMPLATES.python).toContain('.venv/');
    expect(EXCLUDE_TEMPLATES['node-frontend']).toContain('node_modules/');
  });
});
```

- [ ] **Step 3: Run the core test → PASS**

Run: `cd /Users/apple/Documents/Workspace/patchwire && pnpm --filter @patchwire/core test 2>&1 | grep -E "Tests +[0-9]"`
Expected: all core tests pass (was 34; now +3 = 37).

- [ ] **Step 4: Add the subpath export to `packages/core/package.json`**

Change the `"exports"` field from `{ ".": "./src/index.ts" }` to:
```json
"exports": {
  ".": "./src/index.ts",
  "./sync-templates": "./src/sync-templates.ts"
}
```
(Keep all other package.json fields unchanged.)

- [ ] **Step 5: Repoint the extension's `syncTemplates.ts` to re-export from core**

Replace the entire contents of `packages/extension/src/setup/syncTemplates.ts` with:
```ts
// Templates now live in @patchwire/core so the desktop app and this extension
// share one source of truth. Re-exported here to keep existing importers stable.
export { PROJECT_TYPES, EXCLUDE_TEMPLATES, PROJECT_TYPE_LABELS } from '@patchwire/core/sync-templates';
export type { ProjectType } from '@patchwire/core/sync-templates';
```

- [ ] **Step 6: Run the extension tests → PASS (no behavior change)**

Run: `cd /Users/apple/Documents/Workspace/patchwire && pnpm --filter patchwire-vscode test 2>&1 | grep -E "Tests +[0-9]|FAIL"`
Expected: all pass (the extension's `syncTemplates.test.ts`, `SetupWizard.test.ts`, `mergeIgnores.test.ts` exercise the re-exported values). If the extension package name differs, find it: `node -e "console.log(require('./packages/extension/package.json').name)"` and use that with `--filter`.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/sync-templates.ts packages/core/src/sync-templates.test.ts packages/core/package.json packages/extension/src/setup/syncTemplates.ts
git commit -m "refactor(core): move sync exclude templates into @patchwire/core; extension re-exports"
```

---

## Task 2: Rust — `detect_project_type` + dynamic `write_project_yml` excludes

**Files:**
- Modify: `packages/desktop/src-tauri/src/lib.rs`

No Rust unit tests in this repo — verify with `cargo build`. Read `lib.rs`: the `ProjectYmlArgs` struct, `write_project_yml` (~line 653), and the `generate_handler!` list.

- [ ] **Step 1: Add `exclude` to the `ProjectYmlArgs` struct**

Find the `ProjectYmlArgs` struct (a `#[derive(...Deserialize...)]` struct with `project_dir`, `project`, `host`, `user`, `remote_path`, `ssh_port`, `agent_port`, `token`). Add a field:
```rust
    exclude: Vec<String>,
```
(Place it with the other fields. Serde will map the JS `exclude` array to it.)

- [ ] **Step 2: Replace the yml construction in `write_project_yml`**

The current function builds `yml` with a hardcoded `sync:\n  exclude:\n    - build/\n ...` block. Make two changes:

(a) Extend the existing CR/LF guard loop to also validate each exclude entry. Find:
```rust
    for (label, v) in [("project", &args.project), ("remote_path", &args.remote_path), ("token", &args.token)] {
        if v.contains('\n') || v.contains('\r') {
            return Err(format!("invalid {label}: contains a newline"));
        }
    }
```
Add directly after it:
```rust
    for e in &args.exclude {
        if e.contains('\n') || e.contains('\r') {
            return Err("invalid exclude entry: contains a newline".into());
        }
    }
```

(b) Build the exclude block from `args.exclude` and interpolate it. Replace the single `let yml = format!( "project: {project}\n...sync:\n  exclude:\n    - build/\n    - .dart_tool/\n    - ios/Pods/\n    - node_modules/\n    - .git/\n...` with:
```rust
    let exclude_block = if args.exclude.is_empty() {
        "  exclude: []\n".to_string()
    } else {
        let mut b = String::from("  exclude:\n");
        for e in &args.exclude {
            b.push_str("    - ");
            b.push_str(e);
            b.push('\n');
        }
        b
    };
    let yml = format!(
        "project: {project}\nremote:\n  host: {host}\n  user: {user}\n  path: {path}\n  sshPort: {ssh}\n  agentUrl: http://{host}:{ap}\n  token: {token}\nsync:\n{exclude_block}ai:\n  command: claude\n  args:\n    - --print\n  timeoutSec: 600\n",
        project = args.project,
        host = args.host,
        user = args.user,
        path = args.remote_path,
        ssh = args.ssh_port,
        ap = args.agent_port,
        token = args.token,
        exclude_block = exclude_block,
    );
```
(Keep the `safe_token` host/user check, the 0o600 write, and everything else in the function unchanged.)

- [ ] **Step 3: Add the `detect_project_type` command**

Add this command near the other `#[tauri::command]` fns:
```rust
// Best-effort project-type detection from a directory's root files. Mirrors the
// extension's detectProjectType.ts. Never errors on a readable dir → "common".
#[tauri::command]
fn detect_project_type(project_dir: String) -> Result<String, String> {
    use std::path::Path;
    let dir = Path::new(&project_dir);
    if dir.join("pubspec.yaml").exists() {
        return Ok("flutter".into());
    }
    let pkg = dir.join("package.json");
    if pkg.exists() {
        const FRONTEND_DEPS: [&str; 9] = [
            "next", "nuxt", "react", "react-dom", "vue", "@angular/core", "svelte", "vite", "astro",
        ];
        if let Ok(text) = std::fs::read_to_string(&pkg) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) {
                let has_frontend = ["dependencies", "devDependencies"].iter().any(|k| {
                    json.get(k)
                        .and_then(|d| d.as_object())
                        .map(|o| FRONTEND_DEPS.iter().any(|d| o.contains_key(*d)))
                        .unwrap_or(false)
                });
                if has_frontend {
                    return Ok("node-frontend".into());
                }
            }
        }
        return Ok("node-backend".into());
    }
    for f in ["requirements.txt", "pyproject.toml", "setup.py", "Pipfile"] {
        if dir.join(f).exists() {
            return Ok("python".into());
        }
    }
    Ok("common".into())
}
```
NOTE: `serde_json` is already a transitive dep via Tauri; if `serde_json::from_str` fails to resolve, add `serde_json = "1"` to `packages/desktop/src-tauri/Cargo.toml` `[dependencies]` (check first — Tauri re-exports it, but a direct dep may be needed). Prefer using the existing crate if `serde_json::...` already compiles.

- [ ] **Step 4: Register the command**

In `tauri::generate_handler![ ... ]`, add `detect_project_type,` next to the others.

- [ ] **Step 5: Build**

Run:
```
cd /Users/apple/Documents/Workspace/patchwire/packages/desktop && pnpm stage-sidecar
cd src-tauri && PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo build 2>&1 | tail -15
```
Expected: `Finished`. (If `serde_json` is unresolved, add it to Cargo.toml per Step 3's note and rebuild.)

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src-tauri/src/lib.rs packages/desktop/src-tauri/Cargo.toml packages/desktop/src-tauri/Cargo.lock
git commit -m "feat(desktop): detect_project_type command + dynamic write_project_yml excludes"
```
(Only add Cargo.toml/Cargo.lock if you changed them.)

---

## Task 3: ipc.ts — `exclude` arg + `detectProjectType()`

**Files:**
- Modify: `packages/desktop/src/lib/ipc.ts`
- Modify: `packages/desktop/package.json` (add `@patchwire/core` dep)

- [ ] **Step 1: Add the core dependency**

Run: `cd /Users/apple/Documents/Workspace/patchwire/packages/desktop && pnpm add "@patchwire/core@workspace:*"`
(This adds `"@patchwire/core": "workspace:*"` to `packages/desktop/package.json` dependencies and links it.)

- [ ] **Step 2: Update `ipc.ts`**

Find the `ProjectYmlArgs` interface and add an `exclude` field:
```ts
export interface ProjectYmlArgs {
  projectDir: string;
  project: string;
  host: string;
  user: string;
  sshPort: number;
  agentPort: number;
  remotePath: string;
  token: string;
  exclude: string[];
}
```
(`writeProjectYml(args)` already does `invoke("write_project_yml", { args })` — no change needed there; the new field rides along.)

Add a `detectProjectType` wrapper (place near `computerName`), importing the `ProjectType` type from core:
```ts
import type { ProjectType } from "@patchwire/core/sync-templates";

const PROJECT_TYPE_SET = new Set<ProjectType>(["flutter", "node-frontend", "node-backend", "python", "common"]);

/** Best-effort project-type detection of a local folder; "common" if unavailable/unrecognized. */
export async function detectProjectType(projectDir: string): Promise<ProjectType> {
  try {
    const r = await invoke<string>("detect_project_type", { projectDir });
    return PROJECT_TYPE_SET.has(r as ProjectType) ? (r as ProjectType) : "common";
  } catch {
    return "common";
  }
}
```
Put the `import type` line with the other top-of-file imports.

- [ ] **Step 3: Typecheck the changed files only**

Run: `cd /Users/apple/Documents/Workspace/patchwire/packages/desktop && pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'lib/ipc\.ts' || echo "ipc.ts clean"`
Expected: `ipc.ts clean`. If you see an error like `Cannot find module '@patchwire/core/sync-templates'`, the desktop tsconfig's `moduleResolution` doesn't read package `exports`. Check `packages/desktop/tsconfig.json`: it should be `"bundler"` (or `"nodenext"`). If it is neither and the error persists, set `"moduleResolution": "bundler"` in that tsconfig's `compilerOptions` (Vite projects use bundler resolution). Do NOT change anything else. The authoritative gate is vitest (next tasks) which uses Vite resolution and will resolve the subpath regardless.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/lib/ipc.ts packages/desktop/package.json pnpm-lock.yaml packages/desktop/tsconfig.json
git commit -m "feat(desktop): ipc detectProjectType() + ProjectYmlArgs.exclude; depend on @patchwire/core"
```
(Only add tsconfig.json if you changed it.)

---

## Task 4: AddProject.svelte — project-type dropdown + preview + write excludes

**Files:**
- Modify: `packages/desktop/src/screens/AddProject.svelte`
- Modify: `packages/desktop/src/screens/AddProject.test.ts`

Do the test edits first (TDD), watch fail, then update the component.

- [ ] **Step 1: Extend `AddProject.test.ts`**

The file has a `baseInvoke(overrides)` helper and a `flush()` helper (keep them). Make these edits:

(a) Add an import at the top (after the existing imports):
```ts
import { EXCLUDE_TEMPLATES } from "@patchwire/core/sync-templates";
```

(b) In `baseInvoke`'s default branch, add a `detect_project_type` default (right where `computer_name` is handled):
```ts
    if (cmd === "detect_project_type") return Promise.resolve("common");
```

(c) Add these test cases inside the `describe("AddProject", ...)` block:
```ts
  it("defaults the project-type dropdown to the detected type and previews its excludes", async () => {
    baseInvoke((cmd) => (cmd === "detect_project_type" ? "flutter" : undefined));
    openMock.mockResolvedValue("/home/r/app");
    const { getByTestId } = render(AddProject, { props: { connection: conn } });
    await flush();
    await fireEvent.click(getByTestId("pick-folder"));
    await flush();
    expect((getByTestId("project-type") as HTMLSelectElement).value).toBe("flutter");
    expect(getByTestId("exclude-preview").textContent).toContain(".dart_tool/");
  });

  it("writes the matching exclude template into write_project_yml", async () => {
    baseInvoke((cmd) => (cmd === "detect_project_type" ? "flutter" : undefined));
    openMock.mockResolvedValue("/home/r/app");
    const { getByTestId } = render(AddProject, { props: { connection: conn, onfinish: vi.fn() } });
    await flush();
    await fireEvent.click(getByTestId("pick-folder"));
    await flush();
    await fireEvent.click(getByTestId("create-project"));
    await flush();
    expect(invokeMock).toHaveBeenCalledWith("write_project_yml", { args: expect.objectContaining({
      exclude: EXCLUDE_TEMPLATES.flutter,
    }) });
  });

  it("changing the dropdown changes the written excludes", async () => {
    baseInvoke((cmd) => (cmd === "detect_project_type" ? "flutter" : undefined));
    openMock.mockResolvedValue("/home/r/app");
    const { getByTestId } = render(AddProject, { props: { connection: conn, onfinish: vi.fn() } });
    await flush();
    await fireEvent.click(getByTestId("pick-folder"));
    await flush();
    await fireEvent.change(getByTestId("project-type"), { target: { value: "python" } });
    await fireEvent.click(getByTestId("create-project"));
    await flush();
    expect(invokeMock).toHaveBeenCalledWith("write_project_yml", { args: expect.objectContaining({
      exclude: EXCLUDE_TEMPLATES.python,
    }) });
  });
```

- [ ] **Step 2: Run tests → FAIL**

Run: `cd /Users/apple/Documents/Workspace/patchwire/packages/desktop && pnpm vitest run src/screens/AddProject.test.ts`
Expected: the 3 new tests FAIL (no dropdown / no exclude in args yet); the existing 6 still pass.

- [ ] **Step 3: Update `AddProject.svelte`**

(a) In the `<script>`, add imports and a `projectType` state, and detect-on-choose. Make these specific edits:

After the existing imports, add:
```ts
  import { EXCLUDE_TEMPLATES, PROJECT_TYPES, PROJECT_TYPE_LABELS, type ProjectType } from "@patchwire/core/sync-templates";
  import { detectProjectType } from "../lib/ipc";
```
(Note: `detectProjectType` can also be added to the existing `from "../lib/ipc"` import list instead of a second import line — either is fine.)

Add a state declaration with the others (e.g. after `let existsPrompt = $state(false);`):
```ts
  let projectType = $state<ProjectType>("common");
```

In `choose()`, after `name = basename(dir);`, add a detection call (best-effort):
```ts
    projectType = await detectProjectType(dir);
```

In `create()`, change the `writeProjectYml({...})` call to include `exclude`:
```ts
      await writeProjectYml({ projectDir: localPath, project: name, host: chosen.host, user: chosen.user, sshPort: chosen.sshPort, agentPort: chosen.agentPort, remotePath, token: chosen.token, exclude: EXCLUDE_TEMPLATES[projectType] });
```

(b) In the markup, add the dropdown + preview. Insert this AFTER the Remote path `<label>` line (`<label>Remote path...`) and before the `{#if phase}` line:
```svelte
  <label>Project type
    <select aria-label="Project type" data-testid="project-type" bind:value={projectType}>
      {#each PROJECT_TYPES as t (t)}<option value={t}>{PROJECT_TYPE_LABELS[t]}</option>{/each}
    </select>
  </label>
  <div class="exclude-preview" data-testid="exclude-preview">
    <span class="ex-label">Excludes from sync:</span>
    {#each EXCLUDE_TEMPLATES[projectType] as e (e)}<code>{e}</code>{/each}
  </div>
```

(c) Add styles inside the `<style>` block (before the closing `</style>`):
```css
  .exclude-preview { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; font-size: 11px; color: var(--text-muted); }
  .exclude-preview .ex-label { width: 100%; }
  .exclude-preview code { background: var(--surface-base); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); padding: 1px 5px; color: var(--text); }
```

- [ ] **Step 4: Run tests → PASS**

Run: `cd /Users/apple/Documents/Workspace/patchwire/packages/desktop && pnpm vitest run src/screens/AddProject.test.ts`
Expected: PASS (9 tests — 6 existing + 3 new).

- [ ] **Step 5: Full desktop suite (no regressions)**

Run: `cd /Users/apple/Documents/Workspace/patchwire/packages/desktop && pnpm vitest run`
Expected: all green (was 179; now +3 AddProject = 182, plus core's +3 are a different package). Flag any regression.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/screens/AddProject.svelte packages/desktop/src/screens/AddProject.test.ts
git commit -m "feat(desktop): project-type dropdown + excludes preview, write matching template"
```

---

## Final verification

- [ ] `pnpm --filter @patchwire/core test` — green.
- [ ] `pnpm --filter patchwire-vscode test` — green (extension unchanged behavior).
- [ ] `pnpm --filter patchwire-desktop test` — green (182).
- [ ] `cd packages/desktop/src-tauri && PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo build` (after `pnpm --filter patchwire-desktop stage-sidecar`) — `Finished`.
- [ ] Manual live-verify: Add Project on a Flutter folder → dropdown defaults to "Flutter / Dart", preview shows `.dart_tool/`; create → `patchwire.yml` `sync.exclude` matches the flutter template. Switch to Python → excludes change.

---

## Self-Review notes (spec → tasks)

- Shared templates in core + subpath export + extension re-export → Task 1.
- `detect_project_type` Rust (flutter/node-frontend/node-backend/python/common) → Task 2 Step 3.
- `write_project_yml` dynamic excludes + CR/LF guard → Task 2 Steps 1-2.
- ipc `ProjectYmlArgs.exclude` + `detectProjectType()` → Task 3.
- AddProject dropdown (default to detected) + excludes preview + pass `EXCLUDE_TEMPLATES[type]` → Task 4.
- Tests: core templates (Task 1), extension re-export still green (Task 1 Step 6), desktop detect→dropdown default + write exclude + dropdown-change (Task 4). Rust = live-verify.
- Type/name consistency: `ProjectType`, `EXCLUDE_TEMPLATES`, `PROJECT_TYPES`, `PROJECT_TYPE_LABELS` (core); `detectProjectType` (ipc + Rust `detect_project_type`); `ProjectYmlArgs.exclude` (TS) ↔ `exclude: Vec<String>` (Rust); testids `project-type`, `exclude-preview`.
