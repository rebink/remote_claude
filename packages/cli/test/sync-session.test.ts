import { describe, it, expect } from "vitest";
import {
  runSyncStatus,
  runSyncStart,
  runSyncPause,
  runSyncResume,
  runSyncFlush,
  runSyncStop,
  type SyncDeps,
} from "../src/commands/sync-session.ts";
import type { MutagenTarget } from "../src/lib/mutagen.ts";

const target: MutagenTarget = {
  project: "myproj",
  host: "mini.local",
  user: "dev",
  localPath: "/home/dev/myproj",
  remotePath: "/Users/dev/myproj",
};

function deps(over: Partial<SyncDeps> = {}): { deps: SyncDeps; lines: string[]; calls: string[][] } {
  const lines: string[] = [];
  const calls: string[][] = [];
  const d: SyncDeps = {
    loadTarget: () => target,
    resolveBin: async () => "mutagen",
    ensureSsh: () => {},
    run: (args) => { calls.push(args); return { status: 0, stdout: "Watching|false|0", stderr: "" }; },
    print: (l) => lines.push(l),
    ...over,
  };
  return { deps: d, lines, calls };
}

describe("runSyncStatus", () => {
  it("prints a sync_status JSON line", async () => {
    const { deps: d, lines } = deps();
    await runSyncStatus("/cwd", d);
    expect(JSON.parse(lines.at(-1)!)).toEqual({ type: "sync_status", kind: "watching", conflicts: [] });
  });

  it("emits not_installed when the binary cannot be resolved", async () => {
    const { deps: d, lines } = deps({ resolveBin: async () => null });
    await runSyncStatus("/cwd", d);
    expect(JSON.parse(lines.at(-1)!)).toEqual({ type: "sync_status", kind: "not_installed", conflicts: [] });
  });
});

describe("runSyncStart", () => {
  it("ensures ssh + session and prints a sync_action ok line", async () => {
    let sshCalled = false;
    const { deps: d, lines } = deps({ ensureSsh: () => { sshCalled = true; } });
    await runSyncStart("/cwd", d);
    expect(sshCalled).toBe(true);
    expect(JSON.parse(lines.at(-1)!)).toEqual({ type: "sync_action", action: "start", ok: true });
  });
});

describe("pause/resume/flush/stop handlers", () => {
  it("each prints its sync_action line", async () => {
    for (const [fn, action] of [
      [runSyncPause, "pause"], [runSyncResume, "resume"], [runSyncFlush, "flush"], [runSyncStop, "stop"],
    ] as const) {
      const { deps: d, lines } = deps();
      await fn("/cwd", d);
      expect(JSON.parse(lines.at(-1)!)).toEqual({ type: "sync_action", action, ok: true });
    }
  });
});
