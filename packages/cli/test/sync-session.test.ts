import { describe, it, expect } from "vitest";
import {
  runSyncStatus,
  runSyncStart,
  runSyncPause,
  runSyncResume,
  runSyncFlush,
  runSyncStop,
  runSyncWatch,
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

describe("runSyncWatch", () => {
  it("ensures the session then emits one status line per tick for the bounded run", async () => {
    const lines: string[] = [];
    let calls = 0;
    const d = {
      loadTarget: () => target,
      resolveBin: async () => "mutagen",
      ensureSsh: () => {},
      run: (args: string[]) => {
        if (args.includes("create") || args.includes("--name") && args.includes("{{ range . }}{{ .Name }}{{ end }}")) {
          return { status: 0, stdout: "rc-api-h", stderr: "" }; // session exists
        }
        return { status: 0, stdout: "Watching|false|0", stderr: "" };
      },
      print: (l: string) => lines.push(l),
    };
    // bounded: 3 ticks, zero delay
    await runSyncWatch("/cwd", d as any, { intervalMs: 0, maxTicks: 3 });
    const statusLines = lines.filter((l) => l.includes("sync_status"));
    expect(statusLines).toHaveLength(3);
    expect(JSON.parse(statusLines[0]).kind).toBe("watching");
  });

  it("emits not_installed once and stops when the binary is missing", async () => {
    const lines: string[] = [];
    const d = { loadTarget: () => target, resolveBin: async () => null, ensureSsh: () => {}, run: () => ({ status: 0, stdout: "", stderr: "" }), print: (l: string) => lines.push(l) };
    await runSyncWatch("/cwd", d as any, { intervalMs: 0, maxTicks: 3 });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).kind).toBe("not_installed");
  });
});
