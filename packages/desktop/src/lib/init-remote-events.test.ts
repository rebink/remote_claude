// packages/desktop/src/lib/init-remote-events.test.ts
import { describe, it, expect } from "vitest";
import { parseInitRemoteResult } from "./init-remote-events";

describe("parseInitRemoteResult", () => {
  it("returns ok when a done:true event is present", () => {
    const out = [
      '{"type":"step","name":"probe","status":"ok"}',
      '{"type":"done","ok":true,"projectName":"api"}',
    ].join("\n");
    expect(parseInitRemoteResult(out)).toEqual({ ok: true });
  });

  it("detects target_exists from a fail event", () => {
    const out = [
      '{"type":"step","name":"probe","status":"start"}',
      '{"type":"step","name":"probe","status":"fail","code":"target_exists"}',
      '{"type":"done","ok":false}',
    ].join("\n");
    expect(parseInitRemoteResult(out)).toEqual({ ok: false, code: "target_exists" });
  });

  it("surfaces another failure code with stderr", () => {
    const out = [
      '{"type":"step","name":"probe","status":"fail","code":"ssh_auth_failed","stderr":"perm denied"}',
      '{"type":"done","ok":false}',
    ].join("\n");
    expect(parseInitRemoteResult(out)).toEqual({ ok: false, code: "ssh_auth_failed", stderr: "perm denied" });
  });

  it("ignores blank and non-JSON lines, defaults to unknown_error", () => {
    const out = "warming up\n\n{not json}\n";
    expect(parseInitRemoteResult(out)).toEqual({ ok: false, code: "unknown_error" });
  });
});
