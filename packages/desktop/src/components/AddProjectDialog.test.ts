import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";
const invokeMock = vi.hoisted(() => vi.fn());
const openMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openMock }));
import AddProjectDialog from "./AddProjectDialog.svelte";

beforeEach(() => { invokeMock.mockReset(); openMock.mockReset(); });

describe("AddProjectDialog", () => {
  it("adds a configured folder (has patchwire.yml) directly", async () => {
    openMock.mockResolvedValue("/home/r/api");
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "read_project_config") return Promise.resolve('{"type":"config","project":"api","host":"h","user":"u","remotePath":"/r","sshPort":22}');
      return Promise.resolve(undefined); // save_project
    });
    const onsaved = vi.fn();
    const { getByTestId } = render(AddProjectDialog, { props: { onsaved } });
    await fireEvent.click(getByTestId("pick-folder"));
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledWith("save_project", expect.objectContaining({
      project: expect.objectContaining({ localPath: "/home/r/api", host: "h", user: "u", remotePath: "/r" }),
    }));
    expect(onsaved).toHaveBeenCalled();
  });

  it("routes an unconfigured folder to setup", async () => {
    openMock.mockResolvedValue("/home/r/fresh");
    invokeMock.mockResolvedValue('{"type":"error","message":"no config"}'); // read_project_config → null
    const onneedssetup = vi.fn();
    const { getByTestId } = render(AddProjectDialog, { props: { onneedssetup } });
    await fireEvent.click(getByTestId("pick-folder"));
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(onneedssetup).toHaveBeenCalledWith("/home/r/fresh");
  });
});
