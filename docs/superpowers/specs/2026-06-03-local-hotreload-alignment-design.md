# Milestone 5 — Realign to the local-hot-reload + privacy model

**Date:** 2026-06-03
**Status:** Approved design, ready for plan

## The corrected product model (user-clarified)
AI runs on a remote box the team controls; it works **only on the synced project**; its edits return as a git diff **applied to the developer's *local* project**. The developer runs/`flutter run`s **locally** — full hot reload, debugger, real device over USB — so it "feels like local AI" while the heavy AI compute is remote. This is the loop `patchwire ask` already implements (`rsyncPush` → `/ask` → `applyPatchInteractive(diff, cwd)`). Developing *on* the remote (the team's current SSH-terminal workflow) is what breaks Flutter hot reload; this model avoids it.

Three changes make the product + site honest and focused on this.

## A. Secret-safe sync (respect `.gitignore`) — makes the privacy claim TRUE
**Problem:** `rsyncPush` currently excludes only `.git/`, `.devbridge/`, and `cfg.sync.exclude` (default `[]`). A `.env`/secret in the project dir **is** copied to the remote and readable by the AI. So "the AI never reads your env/secrets" is false today.

**Fix:** add a per-directory git-ignore filter to the rsync invocation so anything git ignores never crosses:
- Add `--filter=dir-merge,- .gitignore` to the rsync args (each dir's `.gitignore` entries become excludes). Keep the existing `.git/` + `.devbridge/` + `cfg.sync.exclude` exclude file.
- Extract the rsync arg/filter assembly into a **pure, testable** function `buildRsyncArgs(...)` in `lib/rsync.ts`.

**Guarantee (now true):** *only your git-tracked / non-ignored code crosses the wire — your `.env`, secrets, and anything git ignores never leave your laptop. The agent only ever sees the project you sync, never the rest of your machine.*

**Tests:** (1) unit — `buildRsyncArgs` includes the `dir-merge,- .gitignore` filter + the `.git/`/`.devbridge/` excludes; (2) integration — invoke the real `rsync` **local→local** with those args over a temp project where `.env` is gitignored, assert `.env` is **absent** in the destination while a tracked `lib/main.dart` is present (skip if `rsync` not on PATH).

**Migration note (in docs):** a `.env` synced before this change persists on the remote (sync omits `--delete`); operators clean it once.

## B. Remove the Android device bridge (M4) — off-model
The local-hot-reload model never runs Flutter on the remote, so the device bridge (`patchwire device`, adb-over-Tailscale) is unnecessary. **Delete it:**
- Remove `packages/cli/src/lib/device-bridge.ts`, `packages/cli/src/commands/device.ts`, `packages/cli/test/lib/device-bridge.test.ts`, `packages/cli/test/commands/device.test.ts`, `docs/device-bridge.md`.
- Remove the `registerDeviceCommands` import + call from `packages/cli/src/cli.ts`.
- Remove the device-bridge `[roadmap]` teaser from the website proving-ground section (workstream C).
- Update the uncommitted `docs/release-notes-v0.3.0.md` draft and the `patchwire-prod-readiness-status` memory to drop the device-bridge claim. (The CHANGELOG `[0.3.0]` section never listed it — no change needed there.)

## C. Re-center the website (serious tone, privacy + local-hot-reload)
`packages/website/src/pages/index.astro`. Keep the structure/design; change copy to lead with the two real points. Proposed (user may tweak):
- **Hero sub** → "Your coding agent runs on a machine you control and only ever sees the project you sync — never your `.env`, never the rest of your laptop. Its edits come back as a git diff applied locally, so your Flutter hot reload and debugger keep working exactly as before."
- **`04 · the stance`** H2 → "Only the code you share crosses the wire." Body → "The agent works on a machine you control, and only on what you sync — your `.env`, your secrets, and everything git ignores never leave your laptop. Only the resulting diff comes back."
- **`05 · proving ground`** → replace the device-bridge teaser with the local-hot-reload story: "The agent runs on the remote; its edits land on *your* laptop. You `flutter run` locally — full hot reload, real device over USB — exactly as before. The remote does the AI; your machine does the running." Keep the Flutter origin paragraph.
- Leave governance/usage/teams sections as-is (still accurate).

## Out of scope
- Changing the hero headline ("Shared AI infrastructure…" stays).
- Re-running the AI against a clean checkout vs working tree (unchanged).
- Handling `.gitignore` negation edge cases beyond what rsync's dir-merge supports (documented).

## Success criteria
- A gitignored `.env` provably does not cross sync (integration test); tracked files still sync.
- `buildRsyncArgs` is pure + unit-tested; `rsyncPush` uses it.
- All device-bridge code/tests/docs/wiring removed; `pnpm --filter patchwire test/typecheck/build` green with the device tests gone and nothing else broken; `patchwire device` no longer exists.
- Website hero/stance/proving-ground copy reflects the privacy + local-hot-reload story; no device-bridge teaser remains; site builds.
- Release-notes draft + prod-readiness memory no longer claim the device bridge.

## Affected files
- Modify: `packages/cli/src/lib/rsync.ts` (+ pure `buildRsyncArgs`), `packages/cli/src/cli.ts`, `packages/website/src/pages/index.astro`, `docs/release-notes-v0.3.0.md`, `~/.claude/.../memory/patchwire-prod-readiness-status.md`
- Create: `packages/cli/test/lib/rsync.test.ts`
- Delete: `packages/cli/src/lib/device-bridge.ts`, `packages/cli/src/commands/device.ts`, `packages/cli/test/lib/device-bridge.test.ts`, `packages/cli/test/commands/device.test.ts`, `docs/device-bridge.md`
