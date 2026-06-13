import type { DetectedServerPlatform, CapabilityDescriptor, ServerCapabilities } from './types.ts';

/** A capability is enforceable when it has a real implementation (not 'none'). */
export function isEnforceable(cap: CapabilityDescriptor): boolean {
  return cap.type !== 'none';
}

/** Capabilities whose absence is a security downgrade worth flagging loudly. */
const SECURITY_CRITICAL: (keyof ServerCapabilities)[] = ['egress', 'filesystemIsolation'];

/** Human-readable one-line-per-capability summary for logs / diagnostics. */
export function summarizeCapabilities(d: DetectedServerPlatform): string[] {
  const lines = [`os: ${d.os} (${d.arch}, ${d.pathStyle} paths)`];
  for (const [name, cap] of Object.entries(d.capabilities)) {
    const critical = SECURITY_CRITICAL.includes(name as keyof ServerCapabilities);
    const note =
      cap.type === 'none'
        ? critical
          ? ' — NONE (degraded: no OS enforcement)'
          : ' — none'
        : cap.requiresElevation
          ? ' (requires elevation)'
          : '';
    lines.push(`${name}: ${cap.type}${cap.version ? '@' + cap.version : ''}${note}`);
  }
  return lines;
}

/** Throw a clear fail-closed error if a capability has no enforcement mechanism. */
export function assertEnforceable(d: DetectedServerPlatform, key: keyof ServerCapabilities): void {
  if (!isEnforceable(d.capabilities[key])) {
    throw new Error(
      `Capability "${key}" is not enforceable on this ${d.os} host (no OS mechanism available). ` +
        'Refusing to proceed (fail-closed).',
    );
  }
}
