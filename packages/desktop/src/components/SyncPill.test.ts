import { render } from "@testing-library/svelte";
import { describe, it, expect } from "vitest";
import SyncPill from "./SyncPill.svelte";

describe("SyncPill", () => {
  it("shows In sync for watching", () => {
    const { getByTestId } = render(SyncPill, { props: { status: { kind: "watching", conflicts: [] } } });
    expect(getByTestId("sync-pill").textContent).toContain("In sync");
  });
  it("shows Syncing for syncing", () => {
    const { getByTestId } = render(SyncPill, { props: { status: { kind: "syncing", conflicts: [] } } });
    expect(getByTestId("sync-pill").textContent).toContain("Syncing");
  });
  it("shows conflict count", () => {
    const { getByTestId } = render(SyncPill, { props: { status: { kind: "conflict", conflicts: ["a", "b"] } } });
    expect(getByTestId("sync-pill").textContent).toContain("2");
    expect(getByTestId("sync-pill").textContent.toLowerCase()).toContain("conflict");
  });
  it("shows Paused", () => {
    const { getByTestId } = render(SyncPill, { props: { status: { kind: "paused", conflicts: [] } } });
    expect(getByTestId("sync-pill").textContent).toContain("Paused");
  });
});
