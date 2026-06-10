# Sync-exclude templates by project type — design

**Date:** 2026-06-10
**Status:** approved in brainstorming → ready for spec review
**Surface:** VS Code extension setup wizard + the extension's Mutagen sync (with a shared templates module)

## Goal

When setting up a project, offer a sensible **per-project-type** sync-exclude list
(so Flutter doesn't sync `Pods/` / `build/`, Node doesn't sync `node_modules/`, etc.)
instead of the one hardcoded Flutter-ish list the wizard writes today. Auto-detect
the project type, let the user confirm or change it, and make the excludes actually
take effect in the extension's two-way sync.

## Context (current state, verified)

- `patchwire.yml` already has a **`sync.exclude: string[]`** field (`packages/cli/src/lib/config.ts`).
- **The CLI** (`patchwire ask/sync`) already honors `sync.exclude` (via `rsync.ts`,
  plus per-dir `.gitignore`).
- **The extension setup wizard** (`packages/extension/src/setup/SetupWizard.ts`)
  writes a **fixed** list regardless of project type:
  `sync.exclude: ['build/', '.dart_tool/', 'ios/Pods/', 'node_modules/', '.git/']`.
- **The extension's two-way sync (Mutagen)** uses a **hardcoded `IGNORE_PATTERNS`**
  (`MutagenController.ts`) plus `--ignore-vcs`, and **does not read `sync.exclude` at
  all**. So configured excludes never reach the live sync. Closing this gap is part
  of the feature, not optional: without it the templates have no effect on the
  extension.
- The initial remote checkout is a `git clone` (so gitignored heavy dirs aren't in
  it); the ongoing churn that needs excludes is **Mutagen**.
- `patchwire.yml` is **per-project**, so "different setup per project" already holds:
  each project's wizard run writes its own file. No global state.

## Templates

A shared module `packages/extension/src/setup/syncTemplates.ts` exports the type
list, the per-type exclude patterns, and the auto-detector. Patterns are chosen to
be valid in both rsync `--exclude` and Mutagen/gitignore ignore syntax.

```ts
export type ProjectType = 'flutter' | 'node-frontend' | 'node-backend' | 'python' | 'common';

// Always merged in (OS / editor junk). Never excludes .patchwire-inbox/ (it must sync).
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

## Auto-detect

`detectProjectType(projectDir): ProjectType` inspects root files (best-effort, never throws):

- `pubspec.yaml` present → `flutter`.
- `package.json` present → read it; if deps/devDeps include a frontend framework
  (`next`, `nuxt`, `react`, `react-dom`, `vue`, `@angular/core`, `svelte`, `vite`,
  `astro`) → `node-frontend`, else → `node-backend`.
- `requirements.txt` / `pyproject.toml` / `setup.py` / `Pipfile` → `python`.
- otherwise → `common`.

## Setup wizard UX

In the wizard's **bootstrap step** (where the project is configured), after the local
folder is known:

1. Run `detectProjectType` and **pre-select** the result.
2. Show a **confirm control**: the detected type plus the five options (radio/select),
   so the user can change it. Label: "Sync profile" with a one-line "what gets
   excluded from sync" hint and a small expandable preview of the pattern list.
3. On submit, the chosen type's `EXCLUDE_TEMPLATES[type]` is written to
   `sync.exclude` in `patchwire.yml` (replacing today's fixed list).

The wizard already imports `yaml` and writes `patchwire.yml`; this only changes the
`sync.exclude` value it computes. The webview gains one selection field.

## Close the gap: Mutagen honors the excludes

- `ChatPanel.loadConfig()` parses `sync.exclude` from `patchwire.yml` and includes it
  in the config object passed to `MutagenController`.
- `MutagenController` gains an `ignore: string[]` option. Its session-create argv uses
  `--ignore-vcs` (unchanged) plus `--ignore <pattern>` for the **union of its safety
  baseline (`IGNORE_PATTERNS`) and the project's `sync.exclude`**, deduped. Merging
  with the baseline (rather than replacing) means projects with no/sparse excludes
  don't suddenly start syncing `node_modules/` (no regression), while templates add
  the type-specific patterns.
- Changing `sync.exclude` takes effect on the next session start (reload / restart
  sync). Live re-application of ignores mid-session is out of scope.

## Editing later

It is just `sync.exclude` in `patchwire.yml`. Power users hand-edit; the wizard seeds
a good default. Re-running setup rewrites it to the chosen template.

## Testing

- **Templates module:** `detectProjectType` returns the right type for fixture dirs
  (pubspec.yaml → flutter; package.json with `next` → node-frontend; plain
  package.json → node-backend; requirements.txt → python; empty → common);
  `EXCLUDE_TEMPLATES` includes COMMON in every type and never lists `.patchwire-inbox/`.
- **Mutagen argv:** the session-create command includes `--ignore` for the merged,
  deduped baseline + `sync.exclude` (unit-test the argv builder with a stub config).
- **ChatPanel:** `loadConfig` surfaces `sync.exclude` (extend an existing test fixture
  with a `sync.exclude` and assert it reaches the Mutagen config).

## Out of scope (v1)

- The CLI gaining a `--sync-profile` flag (the CLI already honors `sync.exclude`; this
  feature is about seeding it from the wizard).
- Auto-distinguishing more granular frontend frameworks; live mid-session ignore
  reload; monorepo multi-type detection (picks one type; user can edit).
- Go / Rust / other types (easy to add to the same map later).

## Success criteria

- Setup auto-detects the project type, shows it pre-selected, and the user can change
  it among the five options.
- The chosen template is written to `sync.exclude` in that project's `patchwire.yml`.
- The extension's two-way sync (Mutagen) actually skips those paths (no more syncing
  `node_modules/` / `Pods/` / `.dart_tool/`), merged with the existing safety baseline.
- Different projects keep independent profiles (per `patchwire.yml`).
