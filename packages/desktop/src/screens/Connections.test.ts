import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";
const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
import Connections from "./Connections.svelte";
import { connections } from "../lib/stores";

beforeEach(() => { invokeMock.mockReset(); connections.set([]); });

const conn = { id: "a", name: "studio-mini", host: "100.100.100.100", user: "admin", sshPort: 22, keyPath: "/k", agentPort: 7878, token: "T", agentVersion: "0.3.17" };

describe("Connections", () => {
  it("shows empty state with an add prompt when none", () => {
    const { getByTestId } = render(Connections);
    expect(getByTestId("connections-empty").textContent).toMatch(/connection/i);
  });
  it("renders a row per connection with name + user@host", () => {
    connections.set([conn]);
    const { getByTestId } = render(Connections);
    expect(getByTestId("conn-row-a").textContent).toContain("studio-mini");
    expect(getByTestId("conn-row-a").textContent).toContain("admin@100.100.100.100");
  });
  it("selecting a row fires onselect", async () => {
    connections.set([conn]);
    const onselect = vi.fn();
    const { getByTestId } = render(Connections, { props: { onselect } });
    await fireEvent.click(getByTestId("conn-row-a"));
    expect(onselect).toHaveBeenCalledWith(conn);
  });
  it("Add connection fires onadd", async () => {
    const onadd = vi.fn();
    const { getByTestId } = render(Connections, { props: { onadd } });
    await fireEvent.click(getByTestId("add-connection"));
    expect(onadd).toHaveBeenCalled();
  });
});
