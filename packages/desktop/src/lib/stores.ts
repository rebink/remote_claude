import { writable } from "svelte/store";
import type { Project, Connection } from "./types";
import { listProjects, listConnections } from "./ipc";

export const projects = writable<Project[]>([]);
export const connections = writable<Connection[]>([]);
export const activeConnectionId = writable<string | null>(null);

export async function loadProjects(): Promise<void> {
  projects.set(await listProjects());
}

export async function loadConnections(): Promise<void> {
  connections.set(await listConnections());
}
