import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";
const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));
import SetupWizard from "./SetupWizard.svelte";

beforeEach(() => {
  invokeMock.mockReset();
  listenMock.mockReset();
  listenMock.mockResolvedValue(() => {});
});

function fillStep1(getByLabelText: (t: string) => HTMLElement) {
  return async () => {
    await fireEvent.input(getByLabelText("Host"), { target: { value: "studio-mini" } });
    await fireEvent.input(getByLabelText("User"), { target: { value: "rebin" } });
    await fireEvent.input(getByLabelText("Project name"), { target: { value: "api" } });
  };
}

describe("SetupWizard Step 4 (provision)", () => {
  it("shows failed-step detail when a step fails and result is rolled-back", async () => {
    let provCb: ((e: { payload: string }) => void) | null = null;
    listenMock.mockImplementation((name: string, cb: any) => {
      if (name === "pw://prov") provCb = cb;
      return Promise.resolve(() => {});
    });
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "ensure_ssh_key") return Promise.resolve("/k/studio-mini-rebin.pub");
      if (cmd === "verify_key") return Promise.resolve(true);
      return Promise.resolve(undefined);
    });
    const { getByTestId, getByLabelText } = render(SetupWizard, { props: { localPath: "/l/api" } });
    // walk to step 4
    await fireEvent.input(getByLabelText("Host"), { target: { value: "studio-mini" } });
    await fireEvent.input(getByLabelText("User"), { target: { value: "rebin" } });
    await fireEvent.input(getByLabelText("Project name"), { target: { value: "api" } });
    await fireEvent.click(getByTestId("wiz-next")); await Promise.resolve(); await Promise.resolve();
    await fireEvent.click(getByTestId("verify-key")); await Promise.resolve(); await Promise.resolve();
    await fireEvent.click(getByTestId("wiz-next")); // → step 3
    await fireEvent.click(getByTestId("wiz-next")); // → step 4 → starts provision
    await Promise.resolve(); await Promise.resolve();
    // preview event so steps are registered
    provCb!({ payload: '{"type":"preview","plan":{"steps":[{"id":"bootstrap-agent"}]},"elevation":[]}' });
    await Promise.resolve();
    await fireEvent.click(getByTestId("prov-confirm"));
    // step fails with detail
    provCb!({ payload: '{"type":"step","step":"bootstrap-agent","status":"failed","detail":"boom"}' });
    await Promise.resolve();
    // result rolled-back
    provCb!({ payload: '{"type":"result","status":"rolled-back","outcome":{"failedStep":"bootstrap-agent"}}' });
    await Promise.resolve();
    // prov-detail should contain the error message (may appear in both the step row and result banner)
    const { getAllByTestId } = await import("@testing-library/svelte");
    const details = document.querySelectorAll('[data-testid="prov-detail"]');
    expect(details.length).toBeGreaterThan(0);
    const detailTexts = Array.from(details).map((el) => el.textContent ?? "");
    expect(detailTexts.some((t) => t.includes("boom"))).toBe(true);
    // prov-result should mention the failed step
    expect(getByTestId("prov-result").textContent).toContain("bootstrap-agent");
  });

  it("starts provisioning and shows the consent gate on preview, then completes + saves", async () => {
    let provCb: ((e: { payload: string }) => void) | null = null;
    listenMock.mockImplementation((name: string, cb: any) => {
      if (name === "pw://prov") provCb = cb;
      return Promise.resolve(() => {});
    });
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "ensure_ssh_key") return Promise.resolve("/k/studio-mini-rebin.pub");
      if (cmd === "verify_key") return Promise.resolve(true);
      return Promise.resolve(undefined); // start_provision, send_consent, save_project
    });
    const onfinish = vi.fn();
    const { getByTestId, getByLabelText } = render(SetupWizard, { props: { localPath: "/l/api", onfinish } });
    // walk to step 4
    await fireEvent.input(getByLabelText("Host"), { target: { value: "studio-mini" } });
    await fireEvent.input(getByLabelText("User"), { target: { value: "rebin" } });
    await fireEvent.input(getByLabelText("Project name"), { target: { value: "api" } });
    await fireEvent.click(getByTestId("wiz-next")); await Promise.resolve(); await Promise.resolve();
    await fireEvent.click(getByTestId("verify-key")); await Promise.resolve(); await Promise.resolve();
    await fireEvent.click(getByTestId("wiz-next")); // → step 3
    await fireEvent.click(getByTestId("wiz-next")); // → step 4 → starts provision
    await Promise.resolve(); await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledWith("start_provision", expect.objectContaining({
      args: expect.objectContaining({ projectDir: "/l/api", host: "studio-mini", user: "rebin", project: "api" }),
    }));
    // preview → consent gate
    provCb!({ payload: '{"type":"preview","plan":{"steps":[{"id":"install"}]},"elevation":[]}' });
    await Promise.resolve();
    await fireEvent.click(getByTestId("prov-confirm"));
    expect(invokeMock).toHaveBeenCalledWith("send_consent", { consent: true });
    // result completed → save + finish
    provCb!({ payload: '{"type":"result","status":"completed","health":{"tailnet":true,"agent":"healthy"}}' });
    await Promise.resolve(); await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledWith("save_project", expect.objectContaining({
      project: expect.objectContaining({ name: "api", host: "studio-mini", user: "rebin", localPath: "/l/api", remotePath: "~/workspace/api" }),
    }));
    expect(onfinish).toHaveBeenCalled();
  });
});

describe("SetupWizard Steps 1-3", () => {
  it("Step 1 Next is disabled until host/user/project are valid", async () => {
    const { getByTestId, getByLabelText } = render(SetupWizard, { props: { localPath: "/l/api" } });
    expect((getByTestId("wiz-next") as HTMLButtonElement).disabled).toBe(true);
    await fillStep1(getByLabelText)();
    expect((getByTestId("wiz-next") as HTMLButtonElement).disabled).toBe(false);
  });

  it("rejects an unsafe host (keeps Next disabled)", async () => {
    const { getByTestId, getByLabelText } = render(SetupWizard, { props: { localPath: "/l/api" } });
    await fireEvent.input(getByLabelText("Host"), { target: { value: "bad host" } });
    await fireEvent.input(getByLabelText("User"), { target: { value: "rebin" } });
    await fireEvent.input(getByLabelText("Project name"), { target: { value: "api" } });
    expect((getByTestId("wiz-next") as HTMLButtonElement).disabled).toBe(true);
  });

  it("Step 2 generates the key and shows the ssh-copy-id command", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "ensure_ssh_key") return Promise.resolve("/k/studio-mini-rebin.pub");
      return Promise.resolve(undefined);
    });
    const { getByTestId, getByLabelText } = render(SetupWizard, { props: { localPath: "/l/api" } });
    await fillStep1(getByLabelText)();
    await fireEvent.click(getByTestId("wiz-next")); // → Step 2
    await Promise.resolve();
    await Promise.resolve();
    expect(getByTestId("copy-command").textContent).toContain("ssh-copy-id -i /k/studio-mini-rebin.pub");
  });

  it("Step 2 Verify enables advancing only when verify_key returns true", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "ensure_ssh_key") return Promise.resolve("/k/studio-mini-rebin.pub");
      if (cmd === "verify_key") return Promise.resolve(true);
      return Promise.resolve(undefined);
    });
    const { getByTestId, getByLabelText } = render(SetupWizard, { props: { localPath: "/l/api" } });
    await fillStep1(getByLabelText)();
    await fireEvent.click(getByTestId("wiz-next"));
    await Promise.resolve();
    await Promise.resolve();
    await fireEvent.click(getByTestId("verify-key"));
    await Promise.resolve();
    await Promise.resolve();
    expect((getByTestId("wiz-next") as HTMLButtonElement).disabled).toBe(false);
  });
});
