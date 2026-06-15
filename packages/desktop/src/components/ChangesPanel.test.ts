import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi } from "vitest";
import ChangesPanel from "./ChangesPanel.svelte";
import type { PendingDiff } from "../lib/chat-session";

const diff: PendingDiff = {
  patch: "diff --git a/src/upload.ts b/src/upload.ts\n@@ -1 +1,2 @@\n-old\n+new\n+more",
  files: [{ path: "src/upload.ts", status: "M", additions: 2, deletions: 1 }],
};

describe("ChangesPanel", () => {
  it("renders a file row with additions/deletions", () => {
    const { getByTestId } = render(ChangesPanel, { props: { diff } });
    expect(getByTestId("changes-summary").textContent).toContain("1 file");
    expect(getByTestId("file-src/upload.ts").textContent).toContain("+2");
    expect(getByTestId("file-src/upload.ts").textContent).toContain("−1");
  });
  it("fires onapply and onreject", async () => {
    const onapply = vi.fn();
    const onreject = vi.fn();
    const { getByTestId } = render(ChangesPanel, { props: { diff, onapply, onreject } });
    await fireEvent.click(getByTestId("apply-btn"));
    await fireEvent.click(getByTestId("reject-btn"));
    expect(onapply).toHaveBeenCalled();
    expect(onreject).toHaveBeenCalled();
  });
  it("shows an empty state when diff is null", () => {
    const { getByTestId } = render(ChangesPanel, { props: { diff: null } });
    expect(getByTestId("changes-empty").textContent).toContain("No changes yet");
  });
  it("disables the apply button while applying", () => {
    const { getByTestId } = render(ChangesPanel, { props: { diff, applying: true } });
    expect((getByTestId("apply-btn") as HTMLButtonElement).disabled).toBe(true);
  });
});
