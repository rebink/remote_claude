import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi } from "vitest";
import ChatPane from "./ChatPane.svelte";
import type { ChatMessage } from "../lib/chat-session";

const messages: ChatMessage[] = [
  { role: "user", text: "add retry" },
  { role: "assistant", text: "Done — see the diff." },
];

describe("ChatPane", () => {
  it("renders user and assistant messages", () => {
    const { getAllByTestId } = render(ChatPane, { props: { messages, streaming: false, syncing: false } });
    const bubbles = getAllByTestId("bubble");
    expect(bubbles).toHaveLength(2);
    expect(bubbles[0].textContent).toContain("add retry");
    expect(bubbles[1].textContent).toContain("Done");
  });

  it("shows a syncing indicator when syncing", () => {
    const { getByTestId } = render(ChatPane, { props: { messages, streaming: true, syncing: true } });
    expect(getByTestId("sync-indicator").textContent).toContain("Syncing");
  });

  it("fires onsend with the composer text and clears it", async () => {
    const onsend = vi.fn();
    const { getByTestId } = render(ChatPane, { props: { messages: [], streaming: false, syncing: false, onsend } });
    const input = getByTestId("composer") as HTMLTextAreaElement;
    await fireEvent.input(input, { target: { value: "fix the bug" } });
    await fireEvent.click(getByTestId("send-btn"));
    expect(onsend).toHaveBeenCalledWith("fix the bug");
  });

  it("disables send while streaming and shows Stop", async () => {
    const oncancel = vi.fn();
    const { getByTestId } = render(ChatPane, { props: { messages, streaming: true, syncing: false, oncancel } });
    expect((getByTestId("send-btn") as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(getByTestId("stop-btn"));
    expect(oncancel).toHaveBeenCalled();
  });

  it("renders attachment chips and fires remove", async () => {
    const onremoveattachment = vi.fn();
    const { getAllByTestId, getByTestId } = render(ChatPane, {
      props: { messages: [], streaming: false, syncing: false, attachments: [{ name: "a.png" }, { name: "b.png" }], onremoveattachment },
    });
    expect(getAllByTestId("attach-chip")).toHaveLength(2);
    await fireEvent.click(getByTestId("chip-remove-0"));
    expect(onremoveattachment).toHaveBeenCalledWith(0);
  });

  it("attach buttons fire their handlers", async () => {
    const onattachfile = vi.fn(); const onattachclip = vi.fn();
    const { getByTestId } = render(ChatPane, { props: { messages: [], streaming: false, syncing: false, onattachfile, onattachclip } });
    await fireEvent.click(getByTestId("attach-file"));
    await fireEvent.click(getByTestId("attach-clip"));
    expect(onattachfile).toHaveBeenCalled();
    expect(onattachclip).toHaveBeenCalled();
  });
});
