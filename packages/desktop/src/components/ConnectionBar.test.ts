import { render } from "@testing-library/svelte";
import { describe, it, expect } from "vitest";
import ConnectionBar from "./ConnectionBar.svelte";
import type { Connection } from "../lib/types";

const conn: Connection = {
  host: "studio-mini",
  user: "rebin",
  sshPort: 22,
  keyPath: "/k",
  agentPort: 7878,
  tailnetAddr: "100.92.14.3",
  agentVersion: "0.4.0",
};

describe("ConnectionBar", () => {
  it("shows user@host, tailnet, and version", () => {
    const { getByTestId } = render(ConnectionBar, { props: { connection: conn, healthy: true } });
    expect(getByTestId("conn-who").textContent).toBe("rebin@studio-mini");
    expect(getByTestId("conn-sub").textContent).toContain("100.92.14.3");
    expect(getByTestId("conn-sub").textContent).toContain("0.4.0");
  });
  it("reflects health state in the status text", () => {
    const { getByTestId } = render(ConnectionBar, { props: { connection: conn, healthy: false } });
    expect(getByTestId("conn-status").textContent).toContain("Unreachable");
  });
});
