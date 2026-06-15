import { render } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import Projects from "./Projects.svelte";
import { connection, projects } from "../lib/stores";

beforeEach(() => {
  invokeMock.mockReset();
  connection.set({ host: "studio-mini", user: "rebin", sshPort: 22, keyPath: "/k", agentPort: 7878, agentVersion: "0.4.0" });
  projects.set([
    { id: "a", name: "api-server", branch: "main", localPath: "/l/a", remotePath: "/r/a", lastStatus: "in-sync", syncPaused: false },
    { id: "b", name: "web-app", branch: "main", localPath: "/l/b", remotePath: "/r/b", lastStatus: "working", syncPaused: false },
  ]);
});

describe("Projects", () => {
  it("renders the connection bar and one row per project", () => {
    const { getByTestId, getAllByTestId } = render(Projects);
    expect(getByTestId("conn-who").textContent).toBe("rebin@studio-mini");
    expect(getAllByTestId("row")).toHaveLength(2);
  });
  it("shows an empty state when there are no projects", () => {
    projects.set([]);
    const { getByTestId } = render(Projects);
    expect(getByTestId("projects-empty").textContent).toContain("No projects yet");
  });
});
