import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { connection, projects, route, loadConnection, loadProjects } from "./stores";

beforeEach(() => {
  invokeMock.mockReset();
  connection.set(null);
  projects.set([]);
});

describe("route", () => {
  it("is 'connect' when no connection", () => {
    connection.set(null);
    expect(get(route)).toBe("connect");
  });
  it("is 'projects' when a connection exists", () => {
    connection.set({ host: "h", user: "u", sshPort: 22, keyPath: "/k", agentPort: 7878 });
    expect(get(route)).toBe("projects");
  });
});

describe("loadConnection", () => {
  it("populates the connection store from IPC", async () => {
    invokeMock.mockResolvedValue({ host: "h", user: "u", sshPort: 22, keyPath: "/k", agentPort: 7878 });
    await loadConnection();
    expect(get(connection)?.host).toBe("h");
  });
});

describe("loadProjects", () => {
  it("populates the projects store from IPC", async () => {
    invokeMock.mockResolvedValue([{ id: "a", name: "api", localPath: "/l", remotePath: "/r" }]);
    await loadProjects();
    expect(get(projects)).toHaveLength(1);
  });
});
