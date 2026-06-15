import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

import App from "./App.svelte";
import { connection, projects } from "./lib/stores";

beforeEach(() => {
  invokeMock.mockReset();
  listenMock.mockReset();
  listenMock.mockResolvedValue(() => {});
  connection.set(null);
  projects.set([]);
});

describe("App routing", () => {
  it("shows Connect when there is no connection", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "read_connection") return Promise.resolve(null);
      if (cmd === "list_projects") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    const { findByText } = render(App);
    expect(await findByText("Connect your remote")).toBeTruthy();
  });

  it("shows Projects when a connection exists", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "read_connection") return Promise.resolve({ host: "h", user: "u", sshPort: 22, keyPath: "/k", agentPort: 7878 });
      if (cmd === "list_projects") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    const { findByText } = render(App);
    expect(await findByText("Projects")).toBeTruthy();
  });

  it("opens the Workspace when a project row is clicked", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "read_connection") return Promise.resolve({ host: "h", user: "u", sshPort: 22, keyPath: "/k", agentPort: 7878 });
      if (cmd === "list_projects") return Promise.resolve([
        { id: "a", name: "api-server", branch: "main", localPath: "/l/a", remotePath: "/r/a", lastStatus: "in-sync", syncPaused: false },
      ]);
      return Promise.resolve(undefined);
    });
    const { findByTestId } = render(App);
    const row = await findByTestId("row");
    await fireEvent.click(row);
    expect((await findByTestId("ws-title")).textContent).toContain("api-server");
  });
});
