import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";
const invokeMock = vi.hoisted(() => vi.fn());
const openMock = vi.hoisted(() => vi.fn());
const writeTextMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openMock }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: writeTextMock }));
import AttachPanel from "./AttachPanel.svelte";

beforeEach(() => { invokeMock.mockReset(); openMock.mockReset(); writeTextMock.mockReset(); });

describe("AttachPanel", () => {
  it("uploads a picked file and copies the remote path to the clipboard", async () => {
    openMock.mockResolvedValue("/l/app/img.png");
    invokeMock.mockImplementation((cmd: string) => cmd === "push_attachment" ? Promise.resolve("~/p/app/.patchwire-inbox/img.png") : Promise.resolve(undefined));
    writeTextMock.mockResolvedValue(undefined);
    const { getByTestId } = render(AttachPanel, { props: { projectDir: "/l/app" } });
    await fireEvent.click(getByTestId("attach-file"));
    for (let i = 0; i < 6; i++) await Promise.resolve();
    expect(writeTextMock).toHaveBeenCalledWith("~/p/app/.patchwire-inbox/img.png");
    expect(getByTestId("attach-list").textContent).toContain("img.png");
  });
});
