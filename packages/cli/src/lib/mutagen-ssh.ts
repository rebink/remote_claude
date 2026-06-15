import { join } from "node:path";
import { homedir } from "node:os";
import {
  mkdirSync,
  chmodSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";

export interface SshTarget {
  host: string;
  user: string;
  sshPort?: number;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Ensure ~/.ssh/config (or <home>/.ssh/config) has a managed Host stanza for
 * the given target, pointing at the per-project key
 * `<home>/.patchwire/keys/<host>-<user>`.
 *
 * The stanza is delimited by Patchwire-managed markers so it can be replaced
 * idempotently without disturbing the user's other SSH config.
 *
 * @param target - SSH connection details
 * @param home   - Override home directory (injectable for tests). Defaults to os.homedir().
 */
export function ensureSshConfigStanza(
  target: SshTarget,
  home: string = homedir(),
): void {
  const keyPath = join(home, ".patchwire", "keys", `${target.host}-${target.user}`);
  if (!existsSync(keyPath)) return;

  const sshDir = join(home, ".ssh");
  const cfgPath = join(sshDir, "config");
  mkdirSync(sshDir, { recursive: true });
  chmodSync(sshDir, 0o700);

  const marker = `# === Patchwire managed: ${target.host} ===`;
  const endMarker = `# === Patchwire managed: ${target.host} end ===`;
  const block = [
    marker,
    `Host ${target.host}`,
    `  HostName ${target.host}`,
    `  User ${target.user}`,
    `  IdentityFile ${keyPath}`,
    `  IdentitiesOnly yes`,
    `  IdentityAgent none`,
    `  StrictHostKeyChecking accept-new`,
    ...(target.sshPort && target.sshPort !== 22 ? [`  Port ${target.sshPort}`] : []),
    endMarker,
    "",
  ].join("\n");

  let existing = "";
  try { existing = readFileSync(cfgPath, "utf8"); } catch { /* not present yet */ }

  const stanzaRe = new RegExp(
    `\\n*${escapeRegex(marker)}[\\s\\S]*?${escapeRegex(endMarker)}\\n?`,
    "g",
  );
  const cleaned = existing.replace(stanzaRe, "");
  // PREPEND the managed block so our key is tried before any broad Host * stanza.
  const next = `${block}\n${cleaned.replace(/^\n+/, "")}`;
  writeFileSync(cfgPath, next, "utf8");
  chmodSync(cfgPath, 0o600);
}
