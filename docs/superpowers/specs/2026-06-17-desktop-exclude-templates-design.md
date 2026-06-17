# Desktop: per-project-type sync exclude templates in Add Project

**Date:** 2026-06-17
**Status:** Approved design, ready for plan
**Relates to:** `packages/extension/src/setup/syncTemplates.ts` + `detectProjectType.ts` (the extension behavior being matched), `2026-06-10-sync-exclude-templates-design.md` (original CLI/extension templates).

---

## Problem

The VS Code extension auto-detects a project's type and writes the matching `sync.exclude` template into `patchwire.yml` at setup (`SetupWizard.ts:261`, `EXCLUDE_TEMPLATES[projectType]`). The desktop Add Project flow does NOT: its Rust `write_project_yml` **hardcodes** one exclude list (`build/`, `.dart_tool/`, `ios/Pods/`, `node_modules/`, `.git/`) — a fixed Flutter+node blend, not project-type-specific and not selectable. So desktop projects of other types sync junk (e.g. a Python `.venv/`, a node `dist/`) and the user can't choose the config.

Goal: in desktop Add Project, auto-detect the project type, let the user pick it from a dropdown (defaulting to detected), preview the resulting excludes, and write the matching template — matching the extension, with the template data shared so they can't drift.

## Decisions (from brainstorm)

| Topic | Decision |
|---|---|
| Template source | **Share via `@patchwire/core`** — move the pure data into core; extension + desktop both import it. |
| Detection | **Auto-detect (Rust command) + editable dropdown**, default to the detected type. |
| Scope of choice | Pick a project TYPE → its template. No free-form exclude editing in the UI (yml stays hand-editable after). |

## Architecture

### A. Shared templates in core (pure)

**New `packages/core/src/sync-templates.ts`** — move the PURE data verbatim from `packages/extension/src/setup/syncTemplates.ts`: `ProjectType` (`'flutter' | 'node-frontend' | 'node-backend' | 'python' | 'common'`), `PROJECT_TYPES`, `EXCLUDE_TEMPLATES` (the `COMMON`-merged per-type arrays), `PROJECT_TYPE_LABELS`. No `node:*` imports — safe to bundle in the desktop webview.

**`packages/core/package.json`** — add a subpath export so the desktop imports ONLY this pure file (not the core index, which pulls `node:child_process` via node-host-platform):
```json
"exports": { ".": "./src/index.ts", "./sync-templates": "./src/sync-templates.ts" }
```

**`packages/extension/src/setup/syncTemplates.ts`** — becomes a thin re-export from core so the extension's existing importers (`SetupWizard.ts`, `detectProjectType.ts`, `webview/main.ts`, `syncTemplates.test.ts`) keep working unchanged:
```ts
export { PROJECT_TYPES, EXCLUDE_TEMPLATES, PROJECT_TYPE_LABELS } from '@patchwire/core/sync-templates';
export type { ProjectType } from '@patchwire/core/sync-templates';
```
(The extension already depends on `@patchwire/core`. `detectProjectType.ts` stays in the extension — it uses `node:fs`.)

### B. Detection (Rust)

**New Tauri command `detect_project_type(project_dir: String) -> Result<String, String>`** in `packages/desktop/src-tauri/src/lib.rs`, mirroring `detectProjectType.ts`. Returns one of the `ProjectType` strings; never errors on a readable dir (falls back to `"common"`):
- `pubspec.yaml` exists → `"flutter"`.
- else `package.json` exists → read+parse it; if any of `next, nuxt, react, react-dom, vue, @angular/core, svelte, vite, astro` appears in `dependencies`/`devDependencies` → `"node-frontend"`, else `"node-backend"` (malformed package.json → `"node-backend"`).
- else any of `requirements.txt, pyproject.toml, setup.py, Pipfile` → `"python"`.
- else → `"common"`.
Register `detect_project_type` in the `generate_handler!` list.

### C. `write_project_yml` renders dynamic excludes

**`ProjectYmlArgs`** gains `exclude: Vec<String>`. Replace the hardcoded `sync:\n  exclude:\n    - build/\n ...` block with a rendered list built from `args.exclude`.
- **Security (matches existing guards):** before rendering, reject any exclude entry containing CR/LF (same loop that already guards `project`/`remote_path`/`token`) — prevents YAML key injection. (Templates are static/safe; this is defense-in-depth since the field now crosses the IPC boundary.)
- Render:
  ```
  sync:\n  exclude:\n    - <e1>\n    - <e2>\n...
  ```
  If `exclude` is empty, render `sync:\n  exclude: []\n` (the templates are always non-empty in practice, but handle it).
- Keep the existing `safe_token(host/user)` and 0o600 write behavior unchanged.

### D. ipc.ts

- `ProjectYmlArgs` (TS) gains `exclude: string[]`; `writeProjectYml` passes it through (`invoke("write_project_yml", { args })` — already passes the whole args object).
- New: `detectProjectType(projectDir: string): Promise<ProjectType>` → `invoke<string>("detect_project_type", { projectDir })`, returning the string narrowed to `ProjectType` (default `"common"` on reject / unrecognized value). Import `ProjectType` from `@patchwire/core/sync-templates`.

### E. AddProject.svelte

- Add desktop dep `"@patchwire/core": "workspace:*"`. Import `{ EXCLUDE_TEMPLATES, PROJECT_TYPES, PROJECT_TYPE_LABELS, type ProjectType }` from `@patchwire/core/sync-templates`; `detectProjectType` from `../lib/ipc`.
- State: `let projectType = $state<ProjectType>("common")`.
- In `choose()` (after setting `localPath`): `projectType = await detectProjectType(localPath)` (best-effort; stays `"common"` on failure).
- New **Project type** `<select>` (data-testid `project-type`) bound to `projectType`, options `PROJECT_TYPES` with `PROJECT_TYPE_LABELS` text.
- A compact read-only **excludes preview** (data-testid `exclude-preview`) listing `EXCLUDE_TEMPLATES[projectType]` (derived, updates with the dropdown).
- In `create()`, pass `exclude: EXCLUDE_TEMPLATES[projectType]` into the `writeProjectYml({...})` args.

## Data flow

```
choose folder → detect_project_type (Rust) → projectType default
   user may change dropdown → preview = EXCLUDE_TEMPLATES[projectType]
create → write_project_yml(args incl. exclude = EXCLUDE_TEMPLATES[projectType]) → patchwire.yml sync.exclude
```

## Testing

- **core** `sync-templates.test.ts`: assert `PROJECT_TYPES` has the 5 types; `EXCLUDE_TEMPLATES.flutter` contains `.dart_tool/` and `build/`; `EXCLUDE_TEMPLATES.python` contains `.venv/`; every template includes a `COMMON` entry (`.DS_Store`). (Mirrors/replaces the extension's existing `syncTemplates.test.ts` coverage, which now exercises the re-export.)
- **extension**: existing `syncTemplates.test.ts` + `SetupWizard.test.ts` + `mergeIgnores.test.ts` must still pass against the re-export (no behavior change).
- **desktop** `AddProject.test.ts` (extend): mock `detect_project_type` → `"flutter"`, assert the dropdown value defaults to `flutter` after choose and the preview lists a flutter entry; assert `write_project_yml` is called with `args.exclude` deep-equal to `EXCLUDE_TEMPLATES.flutter`; assert changing the dropdown to `python` changes the `exclude` passed on create.
- **Rust** `detect_project_type` + the yml exclude rendering + CR/LF guard: **live-verify** (no Rust unit tests in this repo). Manual: Add Project on a Flutter folder → confirm dropdown=Flutter, yml `sync.exclude` matches the flutter template; switch to Python → confirm yml changes.

## Out of scope

- Free-form / custom exclude editing in the UI (dropdown selects a template; the written `patchwire.yml` remains hand-editable).
- Changing the CLI or the extension's behavior (extension only swaps its template source to core).
- Re-detecting / re-writing excludes for already-added projects (this is Add Project only).

## Build sequence (for the plan)

1. Create `packages/core/src/sync-templates.ts` (move pure data) + core subpath export + core test; repoint `packages/extension/src/setup/syncTemplates.ts` to re-export from core; run extension tests green.
2. Rust: `detect_project_type` command (+register) and `write_project_yml` dynamic `exclude` + CR/LF guard; `cargo build`.
3. `ipc.ts`: `ProjectYmlArgs.exclude`, `detectProjectType()`.
4. `AddProject.svelte`: add core dep, project-type dropdown + detect-on-choose + excludes preview, pass `exclude` on create; extend `AddProject.test.ts`.
