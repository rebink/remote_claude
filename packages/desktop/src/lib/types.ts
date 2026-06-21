export type ProjectStatus =
  | "in-sync"
  | "working"
  | "paused"
  | "error"
  | "conflict"
  | "unknown";

export interface Connection {
  id: string;
  name: string;
  host: string;
  user: string;
  sshPort: number;
  keyPath: string;
  agentPort: number;
  token: string;
  agentVersion?: string;
}

export interface Project {
  id: string;
  name: string;
  branch: string;
  localPath: string;
  remotePath: string;
  host: string;
  user: string;
  lastStatus: ProjectStatus;
  syncPaused: boolean;
  connectionId: string;
  boundServiceIds?: string[];
}

export interface ProjectConfig {
  type: "config";
  project: string;
  host: string;
  user: string;
  remotePath: string;
  sshPort: number;
}
