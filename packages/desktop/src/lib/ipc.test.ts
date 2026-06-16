import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
const openMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

import {
  listProjects,
  saveProject,
  pickFolder,
  pickFile,
  pushAttachment,
  startChat,
  cancelChat,
  applyPatch,
  onChatEvent,
  onChatEnd,
  syncCommand,
  startSyncWatch,
  stopSyncWatch,
  onSyncEvent,
  readProjectConfig,
  ensureSshKey,
  verifyKey,
  openTerminal,
  startProvision,
  listConnections,
  saveConnection,
  deleteConnection,
  writeProjectYml,
  initRemoteCopy,
} from "./ipc";

beforeEach(() => invokeMock.mockReset());

describe("readProjectConfig", () => {
  it("invokes read_project_config and parses the config JSON line", async () => {
    invokeMock.mockResolvedValue('{"type":"config","project":"api","host":"h","user":"u","remotePath":"/r","sshPort":22}');
    const cfg = await readProjectConfig("/l/api");
    expect(invokeMock).toHaveBeenCalledWith("read_project_config", { projectDir: "/l/api" });
    expect(cfg).toEqual({ type: "config", project: "api", host: "h", user: "u", remotePath: "/r", sshPort: 22 });
  });
  it("returns null on an error line or unparseable output", async () => {
    invokeMock.mockResolvedValue('{"type":"error","message":"no config"}');
    expect(await readProjectConfig("/l/api")).toBeNull();
  });
});

describe("listProjects", () => {
  it("parses raw records into Project[]", async () => {
    invokeMock.mockResolvedValue([
      { id: "a", name: "api", localPath: "/l", remotePath: "/r" },
    ]);
    const out = await listProjects();
    expect(out).toHaveLength(1);
    expect(out[0].branch).toBe("main");
  });
});

describe("saveProject", () => {
  it("invokes save_project with the project payload", async () => {
    invokeMock.mockResolvedValue(undefined);
    const p = { id: "x", name: "n", branch: "main", localPath: "/l", remotePath: "/r", lastStatus: "unknown", syncPaused: false } as const;
    await saveProject(p);
    expect(invokeMock).toHaveBeenCalledWith("save_project", { project: p });
  });
});

describe("pickFolder", () => {
  beforeEach(() => openMock.mockReset());
  it("returns the chosen directory path", async () => {
    openMock.mockResolvedValue("/home/rebin/code/api");
    expect(await pickFolder()).toBe("/home/rebin/code/api");
    expect(openMock).toHaveBeenCalledWith({ directory: true, multiple: false });
  });
  it("returns null when the dialog is cancelled", async () => {
    openMock.mockResolvedValue(null);
    expect(await pickFolder()).toBeNull();
  });
});

describe("startChat", () => {
  it("invokes start_chat with project dir, session uuid, and prompt", async () => {
    invokeMock.mockResolvedValue(undefined);
    await startChat("/home/r/api", "uuid-1", "add retry");
    expect(invokeMock).toHaveBeenCalledWith("start_chat", {
      projectDir: "/home/r/api",
      sessionUuid: "uuid-1",
      prompt: "add retry",
    });
  });
});

describe("cancelChat", () => {
  it("invokes cancel_chat", async () => {
    invokeMock.mockResolvedValue(undefined);
    await cancelChat();
    expect(invokeMock).toHaveBeenCalledWith("cancel_chat");
  });
});

describe("applyPatch", () => {
  it("invokes apply_patch and parses the JSON result line", async () => {
    invokeMock.mockResolvedValue('{"type":"result","applied":true,"files":["a.ts"]}');
    const r = await applyPatch("/home/r/api", "PATCH");
    expect(invokeMock).toHaveBeenCalledWith("apply_patch", { projectDir: "/home/r/api", patch: "PATCH" });
    expect(r).toEqual({ applied: true, files: ["a.ts"] });
  });
});

describe("onChatEvent", () => {
  it("subscribes to pw://chat, forwards parsed events, and returns the unlisten handle", async () => {
    const unlisten = vi.fn();
    let captured: ((e: { payload: string }) => void) | null = null;
    listenMock.mockImplementation((name: string, cb: (e: { payload: string }) => void) => {
      if (name === "pw://chat") captured = cb;
      return Promise.resolve(unlisten);
    });
    const seen: unknown[] = [];
    const stop = await onChatEvent((ev) => seen.push(ev));
    captured!({ payload: '{"type":"chat_text","chunk":"hi"}' });
    captured!({ payload: "blank-ignored-not-json" });
    expect(seen).toEqual([{ type: "chat_text", chunk: "hi" }]); // unparseable line dropped
    expect(typeof stop).toBe("function");
  });
});

describe("onChatEnd", () => {
  it("subscribes to pw://chat-end, forwards the exit code payload, and returns the unlisten handle", async () => {
    const unlisten = vi.fn();
    let captured: ((e: { payload: number | null }) => void) | null = null;
    listenMock.mockImplementation((name: string, cb: (e: { payload: number | null }) => void) => {
      if (name === "pw://chat-end") captured = cb;
      return Promise.resolve(unlisten);
    });
    const codes: (number | null)[] = [];
    const stop = await onChatEnd((code) => codes.push(code));
    captured!({ payload: 1 });
    captured!({ payload: null });
    expect(codes).toEqual([1, null]);
    expect(stop).toBe(unlisten);
  });
});

describe("syncCommand", () => {
  it("invokes sync_command and parses a status line", async () => {
    invokeMock.mockResolvedValue('{"type":"sync_status","kind":"watching","conflicts":[]}');
    const r = await syncCommand("/p", "status");
    expect(invokeMock).toHaveBeenCalledWith("sync_command", { projectDir: "/p", sub: "status" });
    expect(r).toEqual({ type: "status", status: { kind: "watching", conflicts: [] } });
  });
});

describe("startSyncWatch / stopSyncWatch", () => {
  it("invoke the right commands", async () => {
    invokeMock.mockResolvedValue(undefined);
    await startSyncWatch("/p");
    expect(invokeMock).toHaveBeenCalledWith("start_sync_watch", { projectDir: "/p" });
    await stopSyncWatch();
    expect(invokeMock).toHaveBeenCalledWith("stop_sync_watch");
  });
});

describe("onSyncEvent", () => {
  it("subscribes to pw://sync and forwards parsed status events", async () => {
    let cb: ((e: { payload: string }) => void) | null = null;
    listenMock.mockImplementation((name: string, fn: any) => { if (name === "pw://sync") cb = fn; return Promise.resolve(() => {}); });
    const seen: unknown[] = [];
    await onSyncEvent((l) => seen.push(l));
    expect(listenMock).toHaveBeenCalledWith("pw://sync", expect.any(Function));
    cb!({ payload: '{"type":"sync_status","kind":"syncing","conflicts":[]}' });
    cb!({ payload: "garbage" });
    expect(seen).toEqual([{ type: "status", status: { kind: "syncing", conflicts: [] } }]);
  });
});

describe("wizard ipc", () => {
  it("ensureSshKey invokes ensure_ssh_key", async () => {
    invokeMock.mockResolvedValue("/k/h-u.pub");
    expect(await ensureSshKey("h", "u")).toBe("/k/h-u.pub");
    expect(invokeMock).toHaveBeenCalledWith("ensure_ssh_key", { host: "h", user: "u" });
  });
  it("verifyKey invokes verify_key and returns the bool", async () => {
    invokeMock.mockResolvedValue(true);
    expect(await verifyKey({ host: "h", user: "u", sshPort: 22, keyPath: "/k" })).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("verify_key", { host: "h", user: "u", sshPort: 22, keyPath: "/k" });
  });
  it("openTerminal invokes open_terminal", async () => {
    invokeMock.mockResolvedValue(undefined);
    await openTerminal("ssh-copy-id ...");
    expect(invokeMock).toHaveBeenCalledWith("open_terminal", { command: "ssh-copy-id ..." });
  });
  it("startProvision passes the full args incl. projectDir/project/remotePath", async () => {
    invokeMock.mockResolvedValue(undefined);
    const args = { host: "h", user: "u", port: 22, keyPath: "/k", agentPort: 7878, token: "T", projectDir: "/l", project: "p", remotePath: "/r" };
    await startProvision(args);
    expect(invokeMock).toHaveBeenCalledWith("start_provision", { args });
  });
});

describe("connections ipc", () => {
  it("listConnections parses records", async () => {
    invokeMock.mockResolvedValue([{ id: "a", name: "mini", host: "h", user: "u", sshPort: 22, keyPath: "/k", agentPort: 7878, token: "T" }]);
    const out = await listConnections();
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("mini");
  });
  it("saveConnection invokes save_connection", async () => {
    invokeMock.mockResolvedValue(undefined);
    const c = { id: "a", name: "m", host: "h", user: "u", sshPort: 22, keyPath: "/k", agentPort: 7878, token: "T" };
    await saveConnection(c);
    expect(invokeMock).toHaveBeenCalledWith("save_connection", { connection: c });
  });
  it("deleteConnection invokes delete_connection", async () => {
    invokeMock.mockResolvedValue(undefined);
    await deleteConnection("a");
    expect(invokeMock).toHaveBeenCalledWith("delete_connection", { id: "a" });
  });
});

describe("attachment ipc", () => {
  beforeEach(() => openMock.mockReset());
  it("pickFile opens a file (not directory) dialog", async () => {
    openMock.mockResolvedValue("/home/r/mock.png");
    expect(await pickFile()).toBe("/home/r/mock.png");
    expect(openMock).toHaveBeenCalledWith({ directory: false, multiple: false });
  });
  it("pickFile returns null on cancel", async () => {
    openMock.mockResolvedValue(null);
    expect(await pickFile()).toBeNull();
  });
  it("pushAttachment (file) invokes push_attachment", async () => {
    invokeMock.mockResolvedValue("/remote/.patchwire-inbox/mock.png");
    const r = await pushAttachment("/l/api", "/home/r/mock.png", false);
    expect(invokeMock).toHaveBeenCalledWith("push_attachment", { projectDir: "/l/api", filePath: "/home/r/mock.png", useClipboard: false });
    expect(r).toBe("/remote/.patchwire-inbox/mock.png");
  });
  it("pushAttachment (clipboard) passes filePath null + useClipboard true", async () => {
    invokeMock.mockResolvedValue("/remote/.patchwire-inbox/clip.png");
    await pushAttachment("/l/api", undefined, true);
    expect(invokeMock).toHaveBeenCalledWith("push_attachment", { projectDir: "/l/api", filePath: null, useClipboard: true });
  });
});

describe("add-project ipc", () => {
  it("writeProjectYml invokes write_project_yml with all fields", async () => {
    invokeMock.mockResolvedValue(undefined);
    const a = { projectDir: "/l/api", project: "api", host: "h", user: "u", sshPort: 22, agentPort: 7878, remotePath: "~/patchwire/api", token: "T" };
    await writeProjectYml(a);
    expect(invokeMock).toHaveBeenCalledWith("write_project_yml", { args: a });
  });
  it("initRemoteCopy invokes init_remote_copy with the project dir and remote path", async () => {
    invokeMock.mockResolvedValue("ok");
    expect(await initRemoteCopy("/l/api", "~/patchwire/api")).toBe("ok");
    expect(invokeMock).toHaveBeenCalledWith("init_remote_copy", { projectDir: "/l/api", remotePath: "~/patchwire/api" });
  });
});
