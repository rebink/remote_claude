import { render, waitFor } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import Projects from "./Projects.svelte";
import { projects } from "../lib/stores";

const conn = { id: "c1", name: "mini", host: "h", user: "u", sshPort: 22, keyPath: "/k", agentPort: 7878, token: "T" };

beforeEach(() => {
  invokeMock.mockReset();
  // Default: sync_command returns undefined (no status update)
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "sync_command") return Promise.resolve(undefined);
    return Promise.resolve(undefined);
  });
  projects.set([
    { id: "a", name: "api-server", branch: "main", localPath: "/l/a", remotePath: "/r/a", host: "h", user: "u", lastStatus: "in-sync", syncPaused: false, connectionId: "c1" },
    { id: "b", name: "web-app", branch: "main", localPath: "/l/b", remotePath: "/r/b", host: "h", user: "u", lastStatus: "working", syncPaused: false, connectionId: "c1" },
    { id: "c", name: "other-proj", branch: "main", localPath: "/l/c", remotePath: "/r/c", host: "h2", user: "u", lastStatus: "unknown", syncPaused: false, connectionId: "c2" },
  ]);
});

describe("Projects", () => {
  it("renders only projects for the given connection", () => {
    const { getAllByTestId } = render(Projects, { props: { connection: conn } });
    expect(getAllByTestId("row")).toHaveLength(2);
  });
  it("shows an empty state when there are no projects for this connection", () => {
    projects.set([
      { id: "c", name: "other-proj", branch: "main", localPath: "/l/c", remotePath: "/r/c", host: "h2", user: "u", lastStatus: "unknown", syncPaused: false, connectionId: "c2" },
    ]);
    const { getByTestId } = render(Projects, { props: { connection: conn } });
    expect(getByTestId("projects-empty").textContent).toContain("No projects yet");
  });
  it("shows a back control", () => {
    const { getByTestId } = render(Projects, { props: { connection: conn } });
    expect(getByTestId("proj-back")).toBeTruthy();
  });
  it("header shows connection name", () => {
    const { getByText } = render(Projects, { props: { connection: conn } });
    expect(getByText("mini")).toBeTruthy();
  });
  it("populates per-project sync status from sync_command on mount", async () => {
    // Start with unknown status so the test can only pass if onMount updates it
    projects.set([
      { id: "a", name: "api-server", branch: "main", localPath: "/l/a", remotePath: "/r/a", host: "h", user: "u", lastStatus: "unknown", syncPaused: false, connectionId: "c1" },
    ]);
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "sync_command") return Promise.resolve('{"type":"sync_status","kind":"watching","conflicts":[]}');
      return Promise.resolve(undefined);
    });
    const { getByTestId } = render(Projects, { props: { connection: conn } });
    // waitFor polls until the store update from onMount reflects in the DOM
    await waitFor(() => {
      expect(getByTestId("row-status").textContent).toContain("In sync");
    });
  });
});
