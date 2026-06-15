import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { projects, loadProjects } from "./stores";

beforeEach(() => {
  invokeMock.mockReset();
  projects.set([]);
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
