import { render, waitFor } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import Projects from "./Projects.svelte";
import { projects } from "../lib/stores";

beforeEach(() => {
  invokeMock.mockReset();
  // Default: sync_command returns undefined (no status update)
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "sync_command") return Promise.resolve(undefined);
    return Promise.resolve(undefined);
  });
  projects.set([
    { id: "a", name: "api-server", branch: "main", localPath: "/l/a", remotePath: "/r/a", host: "studio-mini", user: "rebin", lastStatus: "in-sync", syncPaused: false },
    { id: "b", name: "web-app", branch: "main", localPath: "/l/b", remotePath: "/r/b", host: "studio-mini", user: "rebin", lastStatus: "working", syncPaused: false },
  ]);
});

describe("Projects", () => {
  it("renders one row per project", () => {
    const { getAllByTestId } = render(Projects);
    expect(getAllByTestId("row")).toHaveLength(2);
  });
  it("shows an empty state when there are no projects", () => {
    projects.set([]);
    const { getByTestId } = render(Projects);
    expect(getByTestId("projects-empty").textContent).toContain("No projects yet");
  });
  it("populates per-project sync status from sync_command on mount", async () => {
    // Start with unknown status so the test can only pass if onMount updates it
    projects.set([
      { id: "a", name: "api-server", branch: "main", localPath: "/l/a", remotePath: "/r/a", host: "studio-mini", user: "rebin", lastStatus: "unknown", syncPaused: false },
    ]);
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "sync_command") return Promise.resolve('{"type":"sync_status","kind":"watching","conflicts":[]}');
      return Promise.resolve(undefined);
    });
    const { getByTestId } = render(Projects);
    // waitFor polls until the store update from onMount reflects in the DOM
    await waitFor(() => {
      expect(getByTestId("row-status").textContent).toContain("In sync");
    });
  });
});
