import type {
  DetectDeps,
  DetectedServerPlatform,
  OsKind,
  CapabilityDescriptor,
  ServerCapabilities,
} from './types.ts';

function osKind(platform: NodeJS.Platform): OsKind {
  if (platform === 'darwin') return 'macos';
  if (platform === 'win32') return 'windows';
  return 'linux'; // other unixes are treated as linux-like for capability purposes
}

const NONE: CapabilityDescriptor = { type: 'none', requiresElevation: false };

/** Map an OS + tool probes into a typed capability set. Pure. */
export function detectServerPlatform(deps: DetectDeps): DetectedServerPlatform {
  const os = osKind(deps.platform);
  const win = os === 'windows';
  const seatbelt = os === 'macos' && deps.has('sandbox-exec');

  const egress: CapabilityDescriptor = seatbelt
    ? { type: 'seatbelt', requiresElevation: false }
    : os === 'linux' && deps.has('nft')
      ? { type: 'nftables', requiresElevation: true }
      : NONE;

  // Filesystem isolation reuses seatbelt on macOS; Linux namespaces / Windows impls are S2/S3.
  const filesystemIsolation: CapabilityDescriptor = seatbelt
    ? { type: 'seatbelt', requiresElevation: false }
    : NONE;

  const secrets: CapabilityDescriptor =
    os === 'macos'
      ? { type: 'keychain', requiresElevation: false }
      : win
        ? { type: 'dpapi', requiresElevation: false }
        : deps.has('secret-tool')
          ? { type: 'libsecret', requiresElevation: false }
          : { type: 'file', requiresElevation: false };

  const service: CapabilityDescriptor =
    os === 'macos' && deps.has('launchctl')
      ? { type: 'launchd', requiresElevation: false }
      : os === 'linux' && deps.has('systemctl')
        ? { type: 'systemd-user', requiresElevation: false }
        : win && deps.has('sc')
          ? { type: 'windows-service', requiresElevation: true }
          : NONE;

  const shell: CapabilityDescriptor = win
    ? { type: 'pwsh', requiresElevation: false }
    : deps.has('zsh')
      ? { type: 'zsh', requiresElevation: false }
      : { type: 'bash', requiresElevation: false };

  const packageManager: CapabilityDescriptor = deps.has('brew')
    ? { type: 'brew', requiresElevation: false }
    : deps.has('apt-get')
      ? { type: 'apt', requiresElevation: true }
      : win && deps.has('winget')
        ? { type: 'winget', requiresElevation: false }
        : { type: 'manual', requiresElevation: false };

  const capabilities: ServerCapabilities = {
    egress,
    filesystemIsolation,
    secrets,
    service,
    shell,
    packageManager,
  };

  return { os, arch: deps.arch, pathStyle: win ? 'win' : 'posix', node: { present: deps.has('node') }, capabilities };
}
