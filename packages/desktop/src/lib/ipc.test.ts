import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import {
  readConnection,
  saveConnection,
  listProjects,
  saveProject,
  checkHealth,
} from "./ipc";
import type { Connection } from "./types";

const conn: Connection = {
  host: "studio-mini",
  user: "rebin",
  sshPort: 22,
  keyPath: "/k",
  agentPort: 7878,
};

beforeEach(() => invokeMock.mockReset());

describe("readConnection", () => {
  it("returns null when no connection persisted", async () => {
    invokeMock.mockResolvedValue(null);
    expect(await readConnection()).toBeNull();
    expect(invokeMock).toHaveBeenCalledWith("read_connection");
  });
  it("returns the connection object when present", async () => {
    invokeMock.mockResolvedValue(conn);
    expect(await readConnection()).toEqual(conn);
  });
});

describe("saveConnection", () => {
  it("invokes save_connection with the connection payload", async () => {
    invokeMock.mockResolvedValue(undefined);
    await saveConnection(conn);
    expect(invokeMock).toHaveBeenCalledWith("save_connection", { connection: conn });
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

describe("checkHealth", () => {
  it("invokes host_health with mapped args and parses the JSON string result", async () => {
    invokeMock.mockResolvedValue('{"ok":true,"version":"0.4.0"}');
    const r = await checkHealth(conn);
    expect(invokeMock).toHaveBeenCalledWith("host_health", {
      args: { host: "studio-mini", user: "rebin", sshPort: 22, keyPath: "/k", agentPort: 7878 },
    });
    expect(r).toEqual({ ok: true, version: "0.4.0", user: undefined });
  });
});
