import { spawn } from 'node:child_process';
import { delimiter, join } from 'node:path';
import { statSync } from 'node:fs';
import { log } from './log.ts';

export type ScanMode = 'off' | 'warn' | 'block';

export interface SecretFinding {
  file: string;
  rule: string;
  line?: number;
}

export interface ScanResult {
  /** false when no scanner was available (we can't prove the tree is clean, so we don't pretend). */
  ran: boolean;
  reason?: string;
  findings: SecretFinding[];
}

export interface GateDecision {
  proceed: boolean;
  /** human-readable explanation when we warn or block. */
  message?: string;
}

/**
 * Parse a gitleaks JSON report (an array of finding objects) into our shape.
 * Tolerant of empty/whitespace/invalid input (returns []), so a clean scan or a
 * scanner that printed nothing never throws.
 */
export function parseGitleaksReport(jsonText: string): SecretFinding[] {
  const text = jsonText.trim();
  if (!text) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map((f) => {
    const o = (f ?? {}) as Record<string, unknown>;
    const finding: SecretFinding = {
      file: String(o.File ?? o.file ?? ''),
      rule: String(o.RuleID ?? o.Rule ?? o.rule ?? 'secret'),
    };
    const line = o.StartLine ?? o.startLine ?? o.line;
    if (typeof line === 'number') finding.line = line;
    return finding;
  });
}

/**
 * Decide whether sync should proceed given the configured mode, the number of
 * findings, and whether the user passed --force. Pure — the I/O lives in the caller.
 */
export function decideScanGate(mode: ScanMode, findingsCount: number, force: boolean): GateDecision {
  if (mode === 'off' || findingsCount === 0) return { proceed: true };
  const noun = `${findingsCount} potential secret${findingsCount === 1 ? '' : 's'}`;
  if (mode === 'warn') {
    return { proceed: true, message: `Found ${noun} in files about to sync — continuing (secretScan: warn).` };
  }
  // mode === 'block'
  if (force) {
    return { proceed: true, message: `Found ${noun}, but --force was passed — syncing anyway.` };
  }
  return {
    proceed: false,
    message: `Refusing to sync: ${noun} found in tracked files. Remove them (or move to a .gitignore'd file), or re-run with --force.`,
  };
}

/** True if a `gitleaks` binary is on PATH. */
export function findGitleaks(): boolean {
  const pathEnv = process.env.PATH ?? '';
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    try {
      if (statSync(join(dir, 'gitleaks')).isFile()) return true;
    } catch {
      /* not here */
    }
  }
  return false;
}

/**
 * Scan the working tree about to be synced for committed/tracked secrets using
 * gitleaks (`detect --no-git`, which honors `.gitignore`). Best-effort: if
 * gitleaks isn't installed we report `ran: false` rather than blocking.
 *
 * `.gitignore`'d files never sync, so this specifically closes the remaining
 * hole — a secret hard-coded into a *tracked* file.
 */
export function runSecretScan(cwd: string): Promise<ScanResult> {
  return new Promise((resolve) => {
    if (!findGitleaks()) {
      resolve({ ran: false, reason: 'gitleaks-not-installed', findings: [] });
      return;
    }
    const child = spawn(
      'gitleaks',
      ['detect', '--no-git', '--no-banner', '--redact', '--report-format', 'json', '--report-path', '/dev/stdout'],
      { cwd, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    let out = '';
    child.stdout?.on('data', (b) => (out += b.toString()));
    child.on('error', () => resolve({ ran: false, reason: 'gitleaks-spawn-error', findings: [] }));
    child.on('close', () => resolve({ ran: true, findings: parseGitleaksReport(out) }));
  });
}

/**
 * Run the configured pre-sync secret gate. Returns true if sync should proceed.
 * Best-effort: a missing scanner never blocks (we log and continue). When the
 * gate refuses, it logs the reason and returns false so the caller can abort.
 */
export async function preSyncSecretGate(cwd: string, mode: ScanMode, force: boolean): Promise<boolean> {
  if (mode === 'off') return true;
  const scan = await runSecretScan(cwd);
  if (!scan.ran) {
    log.dim(`Secret scan skipped (${scan.reason}). Install gitleaks to enable it.`);
    return true;
  }
  if (scan.findings.length) {
    for (const f of scan.findings.slice(0, 10)) {
      log.dim(`  ${f.rule}  ${f.file}${f.line ? `:${f.line}` : ''}`);
    }
    if (scan.findings.length > 10) log.dim(`  …and ${scan.findings.length - 10} more`);
  }
  const decision = decideScanGate(mode, scan.findings.length, force);
  if (!decision.proceed) {
    log.err(decision.message!);
    return false;
  }
  if (decision.message) log.warn(decision.message);
  return true;
}
