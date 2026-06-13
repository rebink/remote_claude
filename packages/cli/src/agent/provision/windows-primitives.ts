/** Windows provisioning command builders (PowerShell over the OpenSSH default shell).
 *  Quote-safe: single quotes + Join-Path, no nested double quotes. UNVALIDATED on a
 *  real Windows host — see docs/superpowers/plans/2026-06-13-windows-executors.md. */

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
    `& patchwire-agent serve`,
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
