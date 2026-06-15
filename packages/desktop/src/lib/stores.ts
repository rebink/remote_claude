import { writable } from "svelte/store";
import type { Project } from "./types";
import { listProjects } from "./ipc";

export const projects = writable<Project[]>([]);

export async function loadProjects(): Promise<void> {
  projects.set(await listProjects());
}
