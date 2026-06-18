import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";
const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
import ChangesList from "./ChangesList.svelte";

beforeEach(() => invokeMock.mockReset());

describe("ChangesList", () => {
  it("loads and renders git-status entries on Refresh", async () => {
    invokeMock.mockResolvedValue(" M lib/main.dart\n?? notes.txt\n");
    const { getByTestId } = render(ChangesList, { props: { projectDir: "/l/app" } });
    await fireEvent.click(getByTestId("changes-refresh"));
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(getByTestId("changes-body").textContent).toContain("lib/main.dart");
    expect(getByTestId("changes-body").textContent).toContain("notes.txt");
  });
});
