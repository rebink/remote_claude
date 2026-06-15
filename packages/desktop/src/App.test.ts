import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";
const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());
const pickFolderMock = vi.hoisted(() => vi.fn());
const readProjectConfigMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));
vi.mock("./lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/ipc")>();
  return {
    ...actual,
    pickFolder: pickFolderMock,
    readProjectConfig: readProjectConfigMock,
  };
});
import App from "./App.svelte";
import { projects } from "./lib/stores";

beforeEach(() => {
  invokeMock.mockReset(); listenMock.mockReset();
  pickFolderMock.mockReset(); readProjectConfigMock.mockReset();
  listenMock.mockResolvedValue(() => {});
  projects.set([]);
});

describe("App routing (per-project)", () => {
  it("shows the Projects list by default (empty state)", async () => {
    invokeMock.mockImplementation((cmd: string) => cmd === "list_projects" ? Promise.resolve([]) : Promise.resolve(undefined));
    const { findByTestId } = render(App);
    expect(await findByTestId("projects-empty")).toBeTruthy();
  });

  it("opens the Workspace when a project row is clicked", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_projects") return Promise.resolve([{ id: "a", name: "api", branch: "main", localPath: "/l/a", remotePath: "/r/a", host: "h", user: "u", lastStatus: "in-sync", syncPaused: false }]);
      return Promise.resolve(undefined);
    });
    const { findByTestId } = render(App);
    await fireEvent.click(await findByTestId("row"));
    expect((await findByTestId("ws-title")).textContent).toContain("api");
  });

  it("routes to the SetupWizard when a folder needs setup", async () => {
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "list_projects" ? Promise.resolve([]) : Promise.resolve(undefined)
    );
    pickFolderMock.mockResolvedValue("/tmp/unconfigured");
    readProjectConfigMock.mockResolvedValue(null); // unconfigured → onneedssetup
    const { findByTestId } = render(App);
    // Open AddProjectDialog via the "+ New" button on Projects screen
    await fireEvent.click(await findByTestId("new-project"));
    // Click "Choose folder…" in the dialog
    await fireEvent.click(await findByTestId("pick-folder"));
    // pickFolder returns a path, readProjectConfig returns null → onneedssetup fires
    // App should now show the SetupWizard
    expect(await findByTestId("setup-wizard")).toBeTruthy();
  });
});
