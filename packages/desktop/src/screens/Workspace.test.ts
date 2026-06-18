import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";
const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
import Workspace from "./Workspace.svelte";
import { connections } from "../lib/stores";

const conn = { id: "c1", name: "mini", host: "100.64.0.1", user: "Admin", sshPort: 22, keyPath: "/k", agentPort: 7878, token: "T" };
const project = { id: "p1", name: "app", branch: "main", localPath: "/l/app", remotePath: "~/p/app", host: "100.64.0.1", user: "Admin", lastStatus: "in-sync" as const, syncPaused: false, connectionId: "c1" };

beforeEach(() => {
  invokeMock.mockReset(); listenMock.mockReset();
  listenMock.mockResolvedValue(() => {});
  invokeMock.mockResolvedValue(undefined);
  connections.set([conn]);
});

describe("Workspace", () => {
  it("renders the session launcher and the changes/attach panes", async () => {
    const { getByTestId } = render(Workspace, { props: { project } });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(getByTestId("open-session")).toBeTruthy();
    expect(getByTestId("attach-list")).toBeTruthy();
    expect(getByTestId("changes-body")).toBeTruthy();
  });

  it("clicking Open claude session launches the terminal", async () => {
    const { getByTestId } = render(Workspace, { props: { project } });
    await fireEvent.click(getByTestId("open-session"));
    expect(invokeMock.mock.calls.some((c) => c[0] === "open_terminal")).toBe(true);
  });
});
