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
  host: string;
  user: string;
  lastStatus: ProjectStatus;
  syncPaused: boolean;
}

export interface ProjectConfig {
  type: "config";
  project: string;
  host: string;
  user: string;
  remotePath: string;
  sshPort: number;
}
