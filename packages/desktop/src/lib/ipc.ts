import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { Project, ProjectConfig, Connection } from "./types";
import { parseProjects, parseConnections } from "./model";
import { parseChatLine, type ChatEvent } from "./chat-events";
import { parseApplyResult, type ApplyResult } from "./chat-session";
import { parseSyncLine, type SyncLine } from "./sync-events";
import type { FlutterTarget } from "./flutter-attach";
export type { ProvisionArgs } from "../ipc";
export { startProvision, sendConsent, onProvEvent } from "../ipc";

export async function readProjectConfig(projectDir: string): Promise<ProjectConfig | null> {
  const line = await invoke<string>("read_project_config", { projectDir });
  try {
    const o = JSON.parse(line);
    return o && o.type === "config" ? (o as ProjectConfig) : null;
  } catch {
    return null;
  }
}

export async function listProjects(): Promise<Project[]> {
  const raw = await invoke<unknown>("list_projects");
  return parseProjects(raw);
}

export async function saveProject(project: Project): Promise<void> {
  await invoke("save_project", { project });
}

export async function pickFolder(): Promise<string | null> {
  const result = await open({ directory: true, multiple: false });
  return typeof result === "string" ? result : null;
}

export async function pickFile(): Promise<string | null> {
  const result = await open({ directory: false, multiple: false });
  return typeof result === "string" ? result : null;
}

export async function pushAttachment(projectDir: string, filePath: string | undefined, useClipboard: boolean): Promise<string> {
  return invoke<string>("push_attachment", { projectDir, filePath: filePath ?? null, useClipboard });
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

export async function syncCommand(projectDir: string, sub: "status" | "start" | "pause" | "resume" | "flush" | "stop"): Promise<SyncLine | null> {
  const line = await invoke<string>("sync_command", { projectDir, sub });
  return parseSyncLine(line);
}

export async function startSyncWatch(projectDir: string): Promise<void> {
  await invoke("start_sync_watch", { projectDir });
}

export async function stopSyncWatch(): Promise<void> {
  await invoke("stop_sync_watch");
}

export async function onSyncEvent(handler: (line: SyncLine) => void): Promise<UnlistenFn> {
  return listen<string>("pw://sync", (e) => {
    const l = parseSyncLine(e.payload);
    if (l) handler(l);
  });
}

export async function ensureSshKey(host: string, user: string): Promise<string> {
  return invoke<string>("ensure_ssh_key", { host, user });
}

export async function verifyKey(a: { host: string; user: string; sshPort: number; keyPath: string }): Promise<boolean> {
  return invoke<boolean>("verify_key", a);
}

export async function openTerminal(command: string): Promise<void> {
  await invoke("open_terminal", { command });
}

export async function listConnections(): Promise<Connection[]> {
  return parseConnections(await invoke<unknown>("list_connections"));
}

export async function saveConnection(connection: Connection): Promise<void> {
  await invoke("save_connection", { connection });
}

export async function deleteConnection(id: string): Promise<void> {
  await invoke("delete_connection", { id });
}

export interface ProjectYmlArgs {
  projectDir: string;
  project: string;
  host: string;
  user: string;
  sshPort: number;
  agentPort: number;
  remotePath: string;
  token: string;
}

export async function writeProjectYml(args: ProjectYmlArgs): Promise<void> {
  await invoke("write_project_yml", { args });
}

export async function initRemoteCopy(projectDir: string, remotePath: string): Promise<string> {
  return invoke<string>("init_remote_copy", { projectDir, remotePath });
}

/** Best-effort detection of a running VM Service URI (clipboard scan in the Rust cmd). Returns null if none. */
export async function detectVmUri(): Promise<string | null> {
  const r = await invoke<string | null>("detect_vm_uri");
  return typeof r === "string" && r ? r : null;
}

/** Validate the URI, open the reverse tunnel, register the session with the agent. Returns the detected target. */
export async function startFlutterAttach(projectDir: string, vmUri: string): Promise<FlutterTarget> {
  return invoke<FlutterTarget>("start_flutter_attach", { projectDir, vmUri });
}

export async function stopFlutterAttach(projectDir: string): Promise<void> {
  await invoke("stop_flutter_attach", { projectDir });
}

/** Fires when the tunnelled VM Service WebSocket closes (app restart). */
export async function onFlutterVmClosed(handler: () => void): Promise<UnlistenFn> {
  return listen<string>("pw://flutter-vm-closed", () => handler());
}
