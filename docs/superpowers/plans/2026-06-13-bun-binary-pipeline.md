# Standalone agent binaries via `bun build --compile`

**Status:** in progress (2026-06-13)

**Goal:** Produce prerequisite-free standalone agent binaries (no Node on the
remote) and make them consumable by the `BinaryInstaller` seam (PR #46). Closes the
production→publish→consume loop: `bun build --compile` in CI → uploaded as GitHub
release assets → a runtime `BinaryArtifactSource` downloads + sha256-verifies the
right os/arch binary, ready to hand to `binaryInstaller(conn, { source, detected })`.

**Mechanism chosen by the user:** `bun build --compile` (simplest cross-compile,
small binaries; the codebase already uses explicit `.ts` import specifiers, which
Bun resolves natively).

**Out of scope / deferred (noted, NOT done here):**
- **Executor auto-selection** (Node-absent → binaryInstaller). It's entangled with a
  separate orchestrator gap: `planProvision` emits no `bootstrap-agent` step, so the
  AgentInstaller isn't invoked in the orchestrator path at all yet (the lean wizard
  installs inline). Fixing that plan↔executor gap + wiring selection is its own slice.
- Windows binary (`bun` Windows target) and nftables egress.

## Local-verifiability note

There is **no Bun on the dev machine**, so the build script + `release.yml` changes
are CI-only artifacts (reviewable, not locally runnable). CI validates them on the
next `v*.*.*` tag, including a `--version` smoke run of the linux-x64 binary. The
**runtime source is fully unit-tested locally** with an injected fetch.

## 1. `scripts/build-agent-binaries.mjs` (CI-run, needs bun)

ESM Node script run from repo root. Reads version from `packages/cli/package.json`.
For each target compile `packages/cli/src/agent.ts`:

| bun --target        | asset name                      |
|---------------------|---------------------------------|
| bun-darwin-x64      | patchwire-agent-darwin-x64      |
| bun-darwin-arm64    | patchwire-agent-darwin-arm64    |
| bun-linux-x64       | patchwire-agent-linux-x64       |
| bun-linux-arm64     | patchwire-agent-linux-arm64     |

`execFileSync('bun', ['build','--compile',`--target=${target}`,'--outfile',
join('dist-bin', asset), 'packages/cli/src/agent.ts'])`, then sha256 each, and write
`dist-bin/manifest.json` = `{ version, binaries: { "<os>-<arch>": { file, sha256 } } }`.
Asset naming MUST match `assetName()` in release-binary-source.ts (single contract —
add a comment cross-referencing it).

## 2. `.github/workflows/release.yml`

In the `publish` job, before "Create GitHub release":
- `- uses: oven-sh/setup-bun@v2`
- `- name: Build standalone agent binaries` → `run: node scripts/build-agent-binaries.mjs`
- `- name: Smoke-test the linux-x64 binary` → `run: ./dist-bin/patchwire-agent-linux-x64 --version` (runner is ubuntu/x64; the agent CLI has `.version`).
Add to the `softprops/action-gh-release@v2` `files:` list:
`dist-bin/patchwire-agent-*` and `dist-bin/manifest.json`.

## 3. `packages/cli/src/agent/provision/release-binary-source.ts`

```
OS_TOKEN = { macos: 'darwin', linux: 'linux' }
assetName(os, arch): string   // throws for unsupported os (e.g. windows)
releaseBinarySource({ version, baseUrl?, fetch? }): BinaryArtifactSource
```
- default baseUrl = `https://github.com/rebink/remote_claude/releases/download/v<version>`.
- source(detected): GET `<base>/manifest.json` → look up `binaries["<token>-<arch>"]`
  (authoritative sha256); GET `<base>/<assetName>`; sha256 the bytes; throw on
  manifest/asset HTTP failure, missing manifest entry, or sha mismatch; else return
  `{ bytes, sha256, version }`.
- `FetchLike` is injected (default lazy-imports `undici`).

## Tests — `release-binary-source.test.ts` (injected fetch, deterministic sha)
1. happy: manifest + bytes → returns `{bytes, sha256, version}`; assert the manifest
   URL and asset URL requested.
2. sha mismatch (manifest sha ≠ bytes) → throws /mismatch/.
3. manifest HTTP 404 → throws.
4. asset HTTP 404 → throws.
5. unsupported os ('windows') → throws /no standalone agent binary/.

## Verify
`pnpm -r typecheck` (4× Done) + `pnpm --filter @rebink/patchwire test` green
(build script + release.yml are CI-only — not run locally).
