const TOKEN = /^[A-Za-z0-9._-]+$/;

export function isSafeToken(v: string): boolean {
  return TOKEN.test(v);
}

export function defaultRemotePath(project: string): string {
  return `~/workspace/${project}`;
}

export function genToken(): string {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function sshCopyIdCommand(
  pubKeyPath: string,
  user: string,
  host: string,
  sshPort: number
): string {
  return `ssh-copy-id -i ${pubKeyPath} -p ${sshPort} ${user}@${host}`;
}

export function wizardCanProvision(s: {
  host: string;
  user: string;
  project: string;
  keyVerified: boolean;
}): boolean {
  return isSafeToken(s.host) && isSafeToken(s.user) && s.project.trim() !== "" && s.keyVerified;
}
