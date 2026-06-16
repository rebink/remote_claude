import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { projects, loadProjects, connections, activeConnectionId, loadConnections } from "./stores";

beforeEach(() => {
  invokeMock.mockReset();
  projects.set([]);
  connections.set([]);
  activeConnectionId.set(null);
});

describe("loadProjects", () => {
  it("populates the projects store from IPC", async () => {
    invokeMock.mockResolvedValue([
      { id: "a", name: "api", localPath: "/l", remotePath: "/r", host: "h", user: "u" },
    ]);
    await loadProjects();
    expect(get(projects)).toHaveLength(1);
    expect(get(projects)[0].host).toBe("h");
  });
});

it("loadConnections populates the store", async () => {
  invokeMock.mockResolvedValue([{ id: "a", name: "mini", host: "h", user: "u", sshPort: 22, keyPath: "/k", agentPort: 7878, token: "T" }]);
  await loadConnections();
  expect(get(connections)).toHaveLength(1);
});

it("activeConnectionId is settable", () => {
  activeConnectionId.set("a");
  expect(get(activeConnectionId)).toBe("a");
});
