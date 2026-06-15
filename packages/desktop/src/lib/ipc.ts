import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { Connection, HealthResult, Project } from "./types";
import { connectionToHostArgs, parseHealth, parseProjects } from "./model";
import { parseChatLine, type ChatEvent } from "./chat-events";
import { parseApplyResult, type ApplyResult } from "./chat-session";

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

export async function pickFolder(): Promise<string | null> {
  const result = await open({ directory: true, multiple: false });
  return typeof result === "string" ? result : null;
}

export async function startChat(projectDir: string, sessionUuid: string, prompt: string): Promise<void> {
  await invoke("start_chat", { projectDir, sessionUuid, prompt });
}

export async function cancelChat(): Promise<void> {
  await invoke("cancel_chat");
}

export async function applyPatch(projectDir: string, patch: string): Promise<ApplyResult> {
  const line = await invoke<string>("apply_patch", { projectDir, patch });
  return parseApplyResult(line);
}

export async function onChatEvent(handler: (ev: ChatEvent) => void): Promise<UnlistenFn> {
  return listen<string>("pw://chat", (e) => {
    const ev = parseChatLine(e.payload);
    if (ev) handler(ev);
  });
}

export async function onChatEnd(handler: (code: number | null) => void): Promise<UnlistenFn> {
  return listen<number | null>("pw://chat-end", (e) => handler(e.payload));
}
