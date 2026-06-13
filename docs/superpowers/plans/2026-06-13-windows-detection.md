# Windows detection over SSH (B1)

**Status:** in progress (2026-06-13)

**Goal:** Remove the "Windows remote provisioning is not yet supported" hard stop in
`detectRemoteServerPlatform`. `detect.ts` already maps Windows capabilities (dpapi
secrets, windows-service, pwsh shell, winget) — the missing piece is detecting a
Windows host over SSH, where the POSIX `uname` probe doesn't run.

**Validation note:** No Windows host available here — this is implemented + fully
unit-tested (injected probe runner), pending real-Windows validation by the team.

## Design

The POSIX probe (`uname -sm; …`) fails on a native Windows OpenSSH server (default
shell cmd.exe). So `detectRemoteServerPlatform` runs the POSIX probe first; if its
output isn't a recognized `uname`, it falls back to a **PowerShell probe**
(`powershell -NoProfile -Command "…"`, invokable from cmd). Only then, if neither is
recognized, does it throw.

### Assumptions (for team validation)
- The remote runs Windows OpenSSH with `powershell.exe` resolvable from the default
  shell (the standard modern setup). PowerShell 5.1+ / 7+ both work.
- True OS arch via `[System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture`
  (not `$env:PROCESSOR_ARCHITECTURE`, which reports the *process* arch).

## Changes — `packages/cli/src/agent/provision/remote-detect.ts`

- `export const WINDOWS_PROBE_TOOLS = ['node','corepack','pnpm','claude','sc','winget'] as const;`
- `export function buildWindowsProbeScript(tools = WINDOWS_PROBE_TOOLS): string` →
  ```
  powershell -NoProfile -Command "Write-Output ('WINDOWS ' + [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture); foreach($c in 'node','corepack',…){ if(Get-Command $c -ErrorAction SilentlyContinue){ Write-Output ('has:' + $c) } }"
  ```
- `export function parseWindowsProbe(stdout: string): DetectDeps | null` — trims each
  line (handles `\r\n`); first line must match `/^WINDOWS\s+(\S+)/`; map arch
  (X64→x64, Arm64→arm64, X86→ia32, else lowercased); collect `has:` lines; return
  `{ platform: 'win32', arch, has }` or null.
- `detectRemoteServerPlatform(conn, runner?)`: run POSIX `buildProbeScript`; if
  `parseProbe` is null, run `buildWindowsProbeScript` via the same runner and
  `parseWindowsProbe`; if both null, throw an actionable error naming both attempts.
  Feed the resulting `DetectDeps` to `detectServerPlatform` (unchanged) → a Windows
  `DetectedServerPlatform`.

## Tests — `remote-detect.test.ts`
- `buildWindowsProbeScript`: contains `powershell -NoProfile -Command`,
  `OSArchitecture`, `Get-Command`, and each tool.
- `parseWindowsProbe`: `'WINDOWS X64\r\nhas:node\r\nhas:winget'` → platform win32,
  arch x64, has('winget') true, has('sc') false; `'WINDOWS Arm64'` → arm64;
  non-`WINDOWS` first line → null.
- `detectRemoteServerPlatform`: REPLACE the old "throws not-yet-supported" test with
  a fallback test — a runner that returns non-POSIX output for the uname script and
  the Windows probe output for the PS script → `d.os === 'windows'`,
  `capabilities.service.type === 'windows-service'`, `secrets.type === 'dpapi'`. Add
  a test where BOTH probes are unrecognized → rejects with the new actionable error.
