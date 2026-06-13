/** Windows provisioning command builders (PowerShell over the OpenSSH default shell).
 *  Quote-safe: single quotes + Join-Path, no nested double quotes. UNVALIDATED on a
 *  real Windows host — see docs/superpowers/plans/2026-06-13-windows-executors.md. */

/** Lowercase-hex sha256 (64 chars) guard — shared with the POSIX binary installer. */
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * PowerShell that reads the agent binary as base64 from stdin, decodes it to
 * %USERPROFILE%\.patchwire\bin\patchwire-agent.exe, and verifies its SHA256 against
 * the expected digest (exit 4 + PW_SHA_MISMATCH on mismatch). Quote-safe.
 */
export function buildWindowsBinaryInstallPs(sha256: string): string {
  const sha = sha256.toLowerCase();
  if (!HEX64.test(sha)) throw new Error(`invalid artifact sha256 (${sha256})`);
  return `powershell -NoProfile -Command "$d=Join-Path $env:USERPROFILE '.patchwire\\bin'; New-Item -ItemType Directory -Force -Path $d > $null; $p=Join-Path $d 'patchwire-agent.exe'; [IO.File]::WriteAllBytes($p, [Convert]::FromBase64String([Console]::In.ReadToEnd())); $h=(Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLower(); if($h -ne '${sha}'){ Remove-Item -LiteralPath $p -ErrorAction SilentlyContinue; Write-Error 'PW_SHA_MISMATCH'; exit 4 }; Write-Output PW_BIN_OK"`;
}

/** PowerShell that runs the installed Windows agent binary's --version. */
export const WINDOWS_BIN_VERSION_CMD =
  `powershell -NoProfile -Command "& (Join-Path $env:USERPROFILE '.patchwire\\bin\\patchwire-agent.exe') --version"`;

/** PowerShell that removes the installed Windows agent binary. */
export const REMOVE_WINDOWS_BIN_PS =
  `powershell -NoProfile -Command "Remove-Item -LiteralPath (Join-Path $env:USERPROFILE '.patchwire\\bin\\patchwire-agent.exe') -ErrorAction SilentlyContinue"`;

/** PowerShell that runs `patchwire-agent install` via the known absolute install path. */
export const WINDOWS_AGENT_INSTALL_PS =
  `powershell -NoProfile -Command "& (Join-Path $env:USERPROFILE '.patchwire\\bin\\patchwire-agent.exe') install"`;

/** PowerShell that runs `patchwire-agent uninstall` via the known absolute install path. */
export const WINDOWS_AGENT_UNINSTALL_PS =
  `powershell -NoProfile -Command "& (Join-Path $env:USERPROFILE '.patchwire\\bin\\patchwire-agent.exe') uninstall"`;

/** PowerShell that reads the agent env from stdin and writes %USERPROFILE%\.patchwire\agent.env. */
export const WRITE_AGENT_ENV_PS =
  `powershell -NoProfile -Command "$d=Join-Path $env:USERPROFILE '.patchwire'; New-Item -ItemType Directory -Force -Path $d > $null; Set-Content -LiteralPath (Join-Path $d 'agent.env') -Value ([Console]::In.ReadToEnd()) -NoNewline -Encoding ascii; Write-Output PW_ENV_OK"`;

/** PowerShell that removes the agent env file (write-secret's compensator). */
export const REMOVE_AGENT_ENV_PS =
  `powershell -NoProfile -Command "Remove-Item -LiteralPath (Join-Path $env:USERPROFILE '.patchwire\\agent.env') -ErrorAction SilentlyContinue"`;

/** Scheduled-task name for the agent autostart. */
export const WINDOWS_TASK_NAME = 'PatchwireAgent';

/**
 * The .ps1 launcher: source agent.env (strip `export`, trim quotes), set $env:, run the agent.
 * Pure builder; written to %USERPROFILE%\.patchwire\bin\agent-launcher.ps1 by the daemon.
 */
export function buildAgentLauncherPs1(): string {
  return [
    `$ErrorActionPreference = 'Stop'`,
    `$envFile = Join-Path $env:USERPROFILE '.patchwire\\agent.env'`,
    `Get-Content -LiteralPath $envFile | ForEach-Object {`,
    `  if ($_ -match '^(?:export\\s+)?([^=]+)=(.*)$') {`,
    `    $val = $matches[2].Trim().Trim("'").Trim('"')`,
    `    Set-Item -Path ('Env:' + $matches[1].Trim()) -Value $val`,
    `  }`,
    `}`,
    `& (Join-Path $env:USERPROFILE '.patchwire\\bin\\patchwire-agent.exe') serve`,
    ``,
  ].join('\r\n');
}

/** `schtasks /Create` line for a logon-triggered task running the launcher via -File. */
export function buildSchtasksCreate(launcherPath: string): string {
  return `schtasks /Create /F /TN ${WINDOWS_TASK_NAME} /SC ONLOGON /TR "powershell -NoProfile -File \\"${launcherPath}\\""`;
}

export function buildSchtasksDelete(): string {
  return `schtasks /Delete /F /TN ${WINDOWS_TASK_NAME}`;
}
