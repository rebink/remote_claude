import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import Connect from "./Connect.svelte";

beforeEach(() => invokeMock.mockReset());

function fill(getByLabelText: (t: string) => HTMLElement) {
  return async () => {
    await fireEvent.input(getByLabelText("Host"), { target: { value: "studio-mini" } });
    await fireEvent.input(getByLabelText("User"), { target: { value: "rebin" } });
    await fireEvent.input(getByLabelText("SSH key path"), { target: { value: "/home/rebin/.ssh/id" } });
  };
}

describe("Connect", () => {
  it("disables Connect until required fields are filled", async () => {
    const { getByTestId, getByLabelText } = render(Connect);
    const btn = getByTestId("connect-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    await fill(getByLabelText)();
    expect(btn.disabled).toBe(false);
  });

  it("on successful health check, saves connection and fires onconnected", async () => {
    const onconnected = vi.fn();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "host_health") return Promise.resolve('{"ok":true,"version":"0.4.0","user":"rebin"}');
      return Promise.resolve(undefined);
    });
    const { getByTestId, getByLabelText } = render(Connect, { props: { onconnected } });
    await fill(getByLabelText)();
    await fireEvent.click(getByTestId("connect-btn"));
    await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledWith("host_health", expect.anything());
    expect(invokeMock).toHaveBeenCalledWith("save_connection", expect.anything());
    expect(onconnected).toHaveBeenCalled();
  });

  it("shows an error and does not save when health check fails", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "host_health") return Promise.resolve('{"ok":false}');
      return Promise.resolve(undefined);
    });
    const { getByTestId, getByLabelText } = render(Connect);
    await fill(getByLabelText)();
    await fireEvent.click(getByTestId("connect-btn"));
    await Promise.resolve();
    expect(getByTestId("connect-error").textContent).toContain("Could not reach");
    expect(invokeMock).not.toHaveBeenCalledWith("save_connection", expect.anything());
  });
});
