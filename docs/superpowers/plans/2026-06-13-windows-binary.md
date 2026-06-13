# Windows binary install + bun windows target (B3)

**Status:** in progress (2026-06-13)

**Goal:** Complete the prereq-free (no-Node) install path on Windows — the final
Windows slice. `binaryInstaller` is POSIX-only (`openssl base64 -A -d`, `chmod 700`,
`$HOME`, `mv`); Windows needs a PowerShell copy. Also add a Windows target to the bun
build matrix + asset naming so a `patchwire-agent-windows-x64.exe` exists to install.

**Validation note:** No Windows host / no Bun here — implemented + unit-tested for
command/asset SHAPE; pending team validation.

## Changes

### `packages/cli/src/agent/provision/windows-primitives.ts`
- `buildWindowsBinaryInstallPs(sha256: string): string` — `powershell -NoProfile -Command`
  that reads base64 from stdin, decodes, writes `%USERPROFILE%\.patchwire\bin\patchwire-agent.exe`,
  `Get-FileHash -Algorithm SHA256` and compares (exit 4 + `PW_SHA_MISMATCH` on mismatch),
  else `PW_BIN_OK`. Quote-safe (single quotes, Join-Path, `[Convert]::FromBase64String`,
  `[IO.File]::WriteAllBytes`). Validate the `sha256` is 64-hex before interpolating.
- `WINDOWS_BIN_VERSION_CMD` — `powershell … "& (Join-Path $env:USERPROFILE '.patchwire\bin\patchwire-agent.exe') --version"`.
- `REMOVE_WINDOWS_BIN_PS` — Remove-Item the exe (`-ErrorAction SilentlyContinue`).

### `packages/cli/src/agent/provision/binary-installer.ts`
Branch each method on `deps.detected.os === 'windows'`:
- `install()`: windows → `runner(buildWindowsBinaryInstallPs(sha), base64Payload)`; non-zero → fatal; ok → detail + compensate (REMOVE_WINDOWS_BIN_PS). The 64-hex guard stays for both paths.
- `version()`: windows → `runner(WINDOWS_BIN_VERSION_CMD)`; else the POSIX `"${REMOTE_BIN_PATH}" --version`.
- `uninstall()`: windows → `runner(REMOVE_WINDOWS_BIN_PS)`; else `rm -f`.
(POSIX path unchanged.)

### `packages/cli/src/agent/provision/release-binary-source.ts`
- `OS_TOKEN`: add `windows: 'windows'`.
- `assetName`: append `.exe` for Windows → `patchwire-agent-windows-x64.exe`. Manifest
  key stays `windows-x64`.

### `scripts/build-agent-binaries.mjs`
- Add `{ target: 'bun-windows-x64', asset: 'patchwire-agent-windows-x64.exe', key: 'windows-x64' }`
  to the matrix. (bun-windows-arm64 omitted — limited Bun support; noted as a TODO.)

## Tests
- `windows-primitives.test`: `buildWindowsBinaryInstallPs('a'.repeat(64))` contains
  `FromBase64String`, `WriteAllBytes`, `Get-FileHash`, the sha, `PW_BIN_OK`;
  `WINDOWS_BIN_VERSION_CMD` contains `--version` + `.exe`.
- `binary-installer.test`: with `detected.os==='windows'` and an injected runner —
  install runs `buildWindowsBinaryInstallPs(sha)` with the base64 payload + compensator;
  version uses the PS version cmd; uninstall uses Remove-Item. (POSIX cases unchanged.)
- `release-binary-source.test`: `assetName('windows','x64') === 'patchwire-agent-windows-x64.exe'`;
  a windows happy-path download (manifest key `windows-x64`).

## Verify
`pnpm -r typecheck` (4× Done) + `pnpm --filter @rebink/patchwire test` green;
`node --check scripts/build-agent-binaries.mjs`.
