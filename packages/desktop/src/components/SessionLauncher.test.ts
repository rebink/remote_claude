import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";
const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
import SessionLauncher from "./SessionLauncher.svelte";

const conn = { id: "c1", name: "mini", host: "100.64.0.1", user: "Admin", sshPort: 22, keyPath: "/k", agentPort: 7878, token: "T" };
const project = { id: "p1", name: "app", branch: "main", localPath: "/l/app", remotePath: "~/p/app", host: "100.64.0.1", user: "Admin", lastStatus: "in-sync" as const, syncPaused: false, connectionId: "c1" };

beforeEach(() => invokeMock.mockReset());

describe("SessionLauncher", () => {
  it("launches the terminal with an ssh+claude command on click", async () => {
    invokeMock.mockResolvedValue(undefined);
    const { getByTestId } = render(SessionLauncher, { props: { connection: conn, project } });
    await fireEvent.click(getByTestId("open-session"));
    const call = invokeMock.mock.calls.find((c) => c[0] === "open_terminal");
    expect(call).toBeTruthy();
    expect((call![1] as { command: string }).command).toContain("ssh -tt -i '/k'");
    expect((call![1] as { command: string }).command).not.toContain("--dangerously-skip-permissions");
  });
  it("includes the skip-permissions flag when the checkbox is on", async () => {
    invokeMock.mockResolvedValue(undefined);
    const { getByTestId } = render(SessionLauncher, { props: { connection: conn, project } });
    await fireEvent.click(getByTestId("skip-perms"));
    await fireEvent.click(getByTestId("open-session"));
    const call = invokeMock.mock.calls.find((c) => c[0] === "open_terminal");
    expect((call![1] as { command: string }).command).toContain("--dangerously-skip-permissions");
  });
  it("disables the button when no connection is resolved", () => {
    const { getByTestId } = render(SessionLauncher, { props: { connection: undefined, project } });
    expect((getByTestId("open-session") as HTMLButtonElement).disabled).toBe(true);
  });
});
