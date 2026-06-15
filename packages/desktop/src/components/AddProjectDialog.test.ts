import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
const openMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openMock }));

import AddProjectDialog from "./AddProjectDialog.svelte";

beforeEach(() => {
  invokeMock.mockReset();
  openMock.mockReset();
});

describe("AddProjectDialog", () => {
  it("picks a folder, fills the name, and saves a project on confirm", async () => {
    openMock.mockResolvedValue("/home/rebin/code/api-server");
    invokeMock.mockResolvedValue(undefined);
    const onsaved = vi.fn();
    const { getByTestId } = render(AddProjectDialog, { props: { onsaved } });

    await fireEvent.click(getByTestId("pick-folder"));
    await Promise.resolve();
    expect((getByTestId("local-path") as HTMLInputElement).value).toBe("/home/rebin/code/api-server");

    await fireEvent.input(getByTestId("remote-path"), { target: { value: "/remote/api-server" } });
    await fireEvent.click(getByTestId("save-project"));
    await Promise.resolve();

    expect(invokeMock).toHaveBeenCalledWith("save_project", expect.objectContaining({
      project: expect.objectContaining({ localPath: "/home/rebin/code/api-server", remotePath: "/remote/api-server", name: "api-server" }),
    }));
    expect(onsaved).toHaveBeenCalled();
  });

  it("disables save until both paths are set", async () => {
    const { getByTestId } = render(AddProjectDialog);
    expect((getByTestId("save-project") as HTMLButtonElement).disabled).toBe(true);
  });
});
