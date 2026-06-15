import { writable, derived } from "svelte/store";
import type { Connection, Project } from "./types";
import { readConnection, listProjects } from "./ipc";

export const connection = writable<Connection | null>(null);
export const projects = writable<Project[]>([]);

export type Route = "connect" | "projects";

export const route = derived(connection, ($c): Route =>
  $c ? "projects" : "connect",
);

export async function loadConnection(): Promise<void> {
  connection.set(await readConnection());
}

export async function loadProjects(): Promise<void> {
  projects.set(await listProjects());
}
