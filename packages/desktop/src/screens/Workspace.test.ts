import { render, fireEvent, waitFor } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());
const openMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openMock }));

import Workspace from "./Workspace.svelte";
import type { Project } from "../lib/types";

const project: Project = {
  id: "a", name: "api-server", branch: "main",
  localPath: "/home/r/api", remotePath: "/remote/api",
  lastStatus: "in-sync", syncPaused: false,
};

beforeEach(() => {
  invokeMock.mockReset();
  listenMock.mockReset();
  openMock.mockReset();
  listenMock.mockResolvedValue(() => {});
});

describe("Workspace", () => {
  it("renders the project header and a back control", () => {
    const onback = vi.fn();
    const { getByTestId } = render(Workspace, { props: { project, onback } });
    expect(getByTestId("ws-title").textContent).toContain("api-server");
  });

  it("sending a prompt starts a chat turn via IPC with the project dir", async () => {
    invokeMock.mockResolvedValue(undefined);
    const { getByTestId } = render(Workspace, { props: { project } });
    await fireEvent.input(getByTestId("composer"), { target: { value: "add retry" } });
    await fireEvent.click(getByTestId("send-btn"));
    expect(invokeMock).toHaveBeenCalledWith("start_chat", expect.objectContaining({
      projectDir: "/home/r/api",
      prompt: "add retry",
    }));
    // user + assistant bubbles appear
    expect(getByTestId("messages").textContent).toContain("add retry");
  });

  it("subscribes to chat events on mount", () => {
    render(Workspace, { props: { project } });
    expect(listenMock).toHaveBeenCalledWith("pw://chat", expect.any(Function));
  });

  it("starts a sync watch on mount and subscribes to pw://sync", async () => {
    render(Workspace, { props: { project } });
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("start_sync_watch", { projectDir: project.localPath });
    });
    expect(listenMock).toHaveBeenCalledWith("pw://sync", expect.any(Function));
  });

  it("pause button issues sync_command pause", async () => {
    invokeMock.mockResolvedValue('{"type":"sync_action","action":"pause","ok":true}');
    const { getByTestId } = render(Workspace, { props: { project } });
    await fireEvent.click(getByTestId("sync-pause"));
    expect(invokeMock).toHaveBeenCalledWith("sync_command", { projectDir: project.localPath, sub: "pause" });
  });

  it("attaching a file calls push_attachment and shows a chip", async () => {
    openMock.mockResolvedValue("/home/r/mock.png");
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "push_attachment") return Promise.resolve("/remote/.patchwire-inbox/mock.png");
      return Promise.resolve(undefined);
    });
    const { getByTestId, getAllByTestId } = render(Workspace, { props: { project } });
    await fireEvent.click(getByTestId("attach-file"));
    // flush microtasks: pickFile() + pushAttachment() + state update + DOM
    for (let i = 0; i < 6; i++) await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledWith("push_attachment", expect.objectContaining({ projectDir: project.localPath, useClipboard: false }));
    expect(getAllByTestId("attach-chip")).toHaveLength(1);
  });

  it("send appends attachment paths to the prompt and clears chips", async () => {
    openMock.mockResolvedValue("/home/r/mock.png");
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "push_attachment") return Promise.resolve("/remote/.patchwire-inbox/mock.png");
      return Promise.resolve(undefined); // start_chat
    });
    const { getByTestId, queryAllByTestId, getAllByTestId } = render(Workspace, { props: { project } });
    await fireEvent.click(getByTestId("attach-file"));
    for (let i = 0; i < 6; i++) await Promise.resolve();
    // chip should be visible
    expect(getAllByTestId("attach-chip")).toHaveLength(1);
    await fireEvent.input(getByTestId("composer"), { target: { value: "use this" } });
    await fireEvent.click(getByTestId("send-btn"));
    for (let i = 0; i < 6; i++) await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledWith("start_chat", expect.objectContaining({
      prompt: "use this\n\nAttached:\n- /remote/.patchwire-inbox/mock.png",
    }));
    expect(queryAllByTestId("attach-chip")).toHaveLength(0); // cleared
  });
});
