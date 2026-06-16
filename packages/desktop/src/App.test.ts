import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";
const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));
import App from "./App.svelte";
import { connections, projects } from "./lib/stores";

beforeEach(() => {
  invokeMock.mockReset(); listenMock.mockReset(); listenMock.mockResolvedValue(() => {});
  connections.set([]); projects.set([]);
});

const conn = { id: "c1", name: "mini", host: "h", user: "u", sshPort: 22, keyPath: "/k", agentPort: 7878, token: "T" };

describe("App routing (connections)", () => {
  it("shows the Connections empty state by default", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_connections") return Promise.resolve([]);
      if (cmd === "list_projects") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    const { findByTestId } = render(App);
    expect(await findByTestId("connections-empty")).toBeTruthy();
  });

  it("selecting a connection shows its Projects", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_connections") return Promise.resolve([conn]);
      if (cmd === "list_projects") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    const { findByTestId } = render(App);
    await fireEvent.click(await findByTestId("conn-row-c1"));
    expect((await findByTestId("projects-empty")).textContent).toBeTruthy();
  });

  it("clicking ＋ New on Projects renders the real AddProject screen", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_connections") return Promise.resolve([conn]);
      if (cmd === "list_projects") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    const { findByTestId } = render(App);
    await fireEvent.click(await findByTestId("conn-row-c1"));
    await fireEvent.click(await findByTestId("new-project"));
    expect(await findByTestId("create-project")).toBeTruthy();
  });
});
