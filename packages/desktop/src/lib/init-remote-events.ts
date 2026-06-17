// packages/desktop/src/lib/init-remote-events.ts

export type InitRemoteResult =
  | { ok: true }
  | { ok: false; code: "target_exists" }
  | { ok: false; code: string; stderr?: string };

/**
 * Parse the NDJSON stream emitted by `patchwire init-remote --json`. Tracks the
 * last `status:'fail'` event and whether a `done:true` arrived — mirroring the
 * VS Code extension's SetupWizard parsing. Non-JSON / blank lines are ignored.
 */
export function parseInitRemoteResult(stdout: string): InitRemoteResult {
  let doneOk = false;
  let lastFail: { code: string; stderr?: string } | undefined;
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let evt: { type?: string; status?: string; code?: string; stderr?: string; ok?: boolean };
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    if (evt.type === "step" && evt.status === "fail" && typeof evt.code === "string") {
      lastFail = { code: evt.code, stderr: evt.stderr };
    }
    if (evt.type === "done" && evt.ok === true) doneOk = true;
  }
  if (doneOk) return { ok: true };
  if (lastFail?.code === "target_exists") return { ok: false, code: "target_exists" };
  if (lastFail) return { ok: false, code: lastFail.code, ...(lastFail.stderr ? { stderr: lastFail.stderr } : {}) };
  return { ok: false, code: "unknown_error" };
}
