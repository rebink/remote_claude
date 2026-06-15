import { invoke } from "@tauri-apps/api/core";
import type { Connection, HealthResult, Project } from "./types";
import { connectionToHostArgs, parseHealth, parseProjects } from "./model";

export async function readConnection(): Promise<Connection | null> {
  const raw = await invoke<Connection | null>("read_connection");
  return raw ?? null;
}

export async function saveConnection(connection: Connection): Promise<void> {
  await invoke("save_connection", { connection });
}

export async function listProjects(): Promise<Project[]> {
  const raw = await invoke<unknown>("list_projects");
  return parseProjects(raw);
}

export async function saveProject(project: Project): Promise<void> {
  await invoke("save_project", { project });
}

export async function checkHealth(connection: Connection): Promise<HealthResult> {
  const json = await invoke<string>("host_health", {
    args: connectionToHostArgs(connection),
  });
  return parseHealth(json);
}
