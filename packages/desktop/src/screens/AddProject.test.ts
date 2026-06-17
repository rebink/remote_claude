import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";
const invokeMock = vi.hoisted(() => vi.fn());
const openMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openMock }));
import AddProject from "./AddProject.svelte";
import { connections } from "../lib/stores";

const conn = { id: "c1", name: "mini", host: "studio-mini", user: "rebin", sshPort: 22, keyPath: "/k", agentPort: 7878, token: "TKN" };
const DONE_OK = '{"type":"done","ok":true}';
const TARGET_EXISTS = '{"type":"step","name":"probe","status":"fail","code":"target_exists"}\n{"type":"done","ok":false}';

beforeEach(() => { invokeMock.mockReset(); openMock.mockReset(); connections.set([conn]); });

// Default invoke handler: computer_name resolves to a machine name; init_remote_copy ok.
function baseInvoke(overrides: (cmd: string) => unknown | undefined = () => undefined) {
  invokeMock.mockImplementation((cmd: string) => {
    const o = overrides(cmd);
    if (o !== undefined) return Promise.resolve(o);
    if (cmd === "computer_name") return Promise.resolve("studio-box");
    if (cmd === "init_remote_copy") return Promise.resolve(DONE_OK);
    if (cmd === "sync_command") return Promise.resolve('{"type":"sync_action","action":"start","ok":true}');
    return Promise.resolve(undefined); // write_project_yml, save_project
  });
}

async function flush(n = 10) { for (let i = 0; i < n; i++) await Promise.resolve(); }

describe("AddProject", () => {
  it("disables Create until a folder is chosen", () => {
    baseInvoke();
    const { getByTestId } = render(AddProject, { props: { connection: conn } });
    expect((getByTestId("create-project") as HTMLButtonElement).disabled).toBe(true);
  });

  it("auto-fills the remote path namespaced by the computer name", async () => {
    baseInvoke();
    openMock.mockResolvedValue("/home/r/api");
    const { getByTestId } = render(AddProject, { props: { connection: conn } });
    await flush();
    await fireEvent.click(getByTestId("pick-folder"));
    await flush();
    expect((getByTestId("remote-path") as HTMLInputElement).value).toBe("~/patchwire/studio-box/api");
  });

  it("falls back to the SSH user when the computer name is unavailable", async () => {
    baseInvoke((cmd) => (cmd === "computer_name" ? "" : undefined));
    openMock.mockResolvedValue("/home/r/api");
    const { getByTestId } = render(AddProject, { props: { connection: conn } });
    await flush();
    await fireEvent.click(getByTestId("pick-folder"));
    await flush();
    expect((getByTestId("remote-path") as HTMLInputElement).value).toBe("~/patchwire/rebin/api");
  });

  it("creates the project: write yml → init copy(create) → sync → save → onfinish", async () => {
    baseInvoke();
    openMock.mockResolvedValue("/home/r/api");
    const onfinish = vi.fn();
    const { getByTestId } = render(AddProject, { props: { connection: conn, onfinish } });
    await flush();
    await fireEvent.click(getByTestId("pick-folder"));
    await flush();
    await fireEvent.click(getByTestId("create-project"));
    await flush();
    expect(invokeMock).toHaveBeenCalledWith("write_project_yml", { args: expect.objectContaining({
      projectDir: "/home/r/api", project: "api", host: "studio-mini", user: "rebin", remotePath: "~/patchwire/studio-box/api", token: "TKN",
    }) });
    expect(invokeMock).toHaveBeenCalledWith("init_remote_copy", { projectDir: "/home/r/api", remotePath: "~/patchwire/studio-box/api", mode: "create" });
    expect(invokeMock).toHaveBeenCalledWith("sync_command", { projectDir: "/home/r/api", sub: "start" });
    expect(onfinish).toHaveBeenCalled();
  });

  it("on target_exists shows the modal, then Overwrite re-runs init copy with mode=overwrite", async () => {
    let copyCalls = 0;
    baseInvoke((cmd) => {
      if (cmd === "init_remote_copy") {
        copyCalls += 1;
        return copyCalls === 1 ? TARGET_EXISTS : DONE_OK;
      }
      return undefined;
    });
    openMock.mockResolvedValue("/home/r/api");
    const onfinish = vi.fn();
    const { getByTestId, queryByTestId } = render(AddProject, { props: { connection: conn, onfinish } });
    await flush();
    await fireEvent.click(getByTestId("pick-folder"));
    await flush();
    await fireEvent.click(getByTestId("create-project"));
    await flush();
    expect(getByTestId("exists-modal")).toBeTruthy();
    expect(onfinish).not.toHaveBeenCalled();
    await fireEvent.click(getByTestId("exists-overwrite"));
    await flush();
    const overwriteCall = invokeMock.mock.calls.find(
      (c) => c[0] === "init_remote_copy" && (c[1] as { mode?: string }).mode === "overwrite",
    );
    expect(overwriteCall).toBeTruthy();
    expect(queryByTestId("exists-modal")).toBeNull();
    expect(onfinish).toHaveBeenCalled();
  });

  it("Cancel on the modal aborts without finishing", async () => {
    baseInvoke((cmd) => (cmd === "init_remote_copy" ? TARGET_EXISTS : undefined));
    openMock.mockResolvedValue("/home/r/api");
    const onfinish = vi.fn();
    const { getByTestId, queryByTestId } = render(AddProject, { props: { connection: conn, onfinish } });
    await flush();
    await fireEvent.click(getByTestId("pick-folder"));
    await flush();
    await fireEvent.click(getByTestId("create-project"));
    await flush();
    await fireEvent.click(getByTestId("exists-cancel"));
    await flush();
    expect(queryByTestId("exists-modal")).toBeNull();
    expect(onfinish).not.toHaveBeenCalled();
    expect(getByTestId("add-error").textContent).toContain("Cancelled");
  });
});
