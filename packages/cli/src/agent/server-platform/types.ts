export type OsKind = 'macos' | 'linux' | 'windows';

/** A capability is described by its implementation type + version, not just a string. */
export interface CapabilityDescriptor {
  /** Implementation, e.g. 'seatbelt' | 'nftables' | 'keychain' | 'launchd' | 'none'. */
  type: string;
  /** Implementation/schema version, when meaningful. */
  version?: string;
  /** True if applying this capability needs sudo/admin. */
  requiresElevation: boolean;
}

export interface ServerCapabilities {
  egress: CapabilityDescriptor;
  filesystemIsolation: CapabilityDescriptor;
  secrets: CapabilityDescriptor;
  service: CapabilityDescriptor;
  shell: CapabilityDescriptor;
  packageManager: CapabilityDescriptor;
}

export interface DetectedServerPlatform {
  os: OsKind;
  arch: string;
  pathStyle: 'posix' | 'win';
  /** Node.js runtime presence on the host. Absent Node → the prereq-free binary install path. */
  node?: { present: boolean };
  capabilities: ServerCapabilities;
}

/** Injected probes for detectServerPlatform — keeps detection pure and testable. */
export interface DetectDeps {
  platform: NodeJS.Platform;
  arch: string;
  /** True if `cmd` is present/runnable on this host. */
  has(cmd: string): boolean;
}
