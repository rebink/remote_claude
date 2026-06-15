export interface Connection {
  host: string;
  user: string;
  sshPort: number;
  keyPath: string;
  agentPort: number;
  tailnetAddr?: string;
  agentVersion?: string;
}

export interface HostArgs {
  host: string;
  user: string;
  sshPort: number;
  keyPath: string;
  agentPort: number;
}

export interface HealthResult {
  ok: boolean;
  version?: string;
  user?: string;
}

export type ProjectStatus =
  | "in-sync"
  | "working"
  | "paused"
  | "error"
  | "conflict"
  | "unknown";

export interface Project {
  id: string;
  name: string;
  branch: string;
  localPath: string;
  remotePath: string;
  lastStatus: ProjectStatus;
  syncPaused: boolean;
}
