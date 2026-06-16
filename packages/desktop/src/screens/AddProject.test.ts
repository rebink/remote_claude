import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";
const invokeMock = vi.hoisted(() => vi.fn());
const openMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openMock }));
import AddProject from "./AddProject.svelte";
import { connections } from "../lib/stores";

const conn = { id: "c1", name: "mini", host: "studio-mini", user: "rebin", sshPort: 22, keyPath: "/k", agentPort: 7878, token: "TKN" };

beforeEach(() => { invokeMock.mockReset(); openMock.mockReset(); connections.set([conn]); });

describe("AddProject", () => {
  it("disables Create until a folder is chosen", () => {
    const { getByTestId } = render(AddProject, { props: { connection: conn } });
    expect((getByTestId("create-project") as HTMLButtonElement).disabled).toBe(true);
  });

  it("picks a folder and auto-fills the remote path", async () => {
    openMock.mockResolvedValue("/home/r/api");
    const { getByTestId } = render(AddProject, { props: { connection: conn } });
    await fireEvent.click(getByTestId("pick-folder"));
    await Promise.resolve();
    expect((getByTestId("remote-path") as HTMLInputElement).value).toBe("~/patchwire/rebin/api");
    expect((getByTestId("create-project") as HTMLButtonElement).disabled).toBe(false);
  });

  it("creates the project: write yml → init copy → sync start → save → onfinish", async () => {
    openMock.mockResolvedValue("/home/r/api");
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "init_remote_copy") return Promise.resolve("ok");
      if (cmd === "sync_command") return Promise.resolve('{"type":"sync_action","action":"start","ok":true}');
      return Promise.resolve(undefined); // write_project_yml, save_project
    });
    const onfinish = vi.fn();
    const { getByTestId } = render(AddProject, { props: { connection: conn, onfinish } });
    await fireEvent.click(getByTestId("pick-folder"));
    await Promise.resolve();
    await fireEvent.click(getByTestId("create-project"));
    // flush microtasks for each async step in the create() chain
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledWith("write_project_yml", { args: expect.objectContaining({
      projectDir: "/home/r/api", project: "api", host: "studio-mini", user: "rebin", remotePath: "~/patchwire/rebin/api", token: "TKN",
    }) });
    expect(invokeMock).toHaveBeenCalledWith("init_remote_copy", { projectDir: "/home/r/api", remotePath: "~/patchwire/rebin/api" });
    expect(invokeMock).toHaveBeenCalledWith("sync_command", { projectDir: "/home/r/api", sub: "start" });
    expect(invokeMock).toHaveBeenCalledWith("save_project", expect.objectContaining({
      project: expect.objectContaining({ name: "api", localPath: "/home/r/api", remotePath: "~/patchwire/rebin/api", host: "studio-mini", user: "rebin", connectionId: "c1" }),
    }));
    expect(onfinish).toHaveBeenCalled();
  });
});
