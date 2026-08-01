import { describe, it, expect } from "vitest";
import {
  runRefresh,
  type RefreshDeps,
  type RefreshOpts,
} from "../src/commands/refresh.ts";
import type { MutagenTarget } from "../src/lib/mutagen.ts";
import type { InitRemoteResult } from "../src/commands/init-remote.ts";

const target: MutagenTarget = {
  project: "myproj",
  host: "mini.local",
  user: "dev",
  localPath: "/home/dev/myproj",
  remotePath: "/Users/dev/myproj",
};

function deps(over: Partial<RefreshDeps> = {}): {
  deps: RefreshDeps;
  lines: string[];
  calls: string[];
} {
  const lines: string[] = [];
  const calls: string[] = [];
  const d: RefreshDeps = {
    loadTarget: () => target,
    resolveBin: async () => "mutagen",
    makeRun: () => (args: string[]) => {
      calls.push("mutagen " + args.join(" "));
      return { status: 0, stdout: "", stderr: "" };
    },
    ensureSsh: () => {
      calls.push("ensureSsh");
    },
    initRemote: async (): Promise<InitRemoteResult> => {
      calls.push("initRemote");
      return { ok: true, projectName: "myproj", remotePath: "/Users/dev/myproj" };
    },
    print: (l) => lines.push(l),
    ...over,
  };
  return { deps: d, lines, calls };
}

const opts = (over: Partial<RefreshOpts> = {}): RefreshOpts => ({
  confirmed: true,
  json: false,
  ...over,
});

describe("runRefresh", () => {
  it("aborts without any calls when not confirmed", async () => {
    const { deps: d, lines, calls } = deps();
    const res = await runRefresh("/cwd", d, opts({ confirmed: false }));
    expect(res).toEqual({ ok: false, code: "unconfirmed" });
    expect(calls).toEqual([]);
    expect(JSON.parse(lines.at(-1)!)).toEqual({
      type: "refresh_aborted",
      reason: "unconfirmed",
    });
  });

  it("terminates, inits, ensures ssh, then recreates in order on success", async () => {
    const { deps: d, calls } = deps();
    const res = await runRefresh("/cwd", d, opts());
    expect(res).toEqual({ ok: true });

    const terminateIdx = calls.findIndex((c) => c.includes("sync terminate"));
    const initIdx = calls.indexOf("initRemote");
    const sshIdx = calls.indexOf("ensureSsh");
    const createIdx = calls.findIndex((c) => c.includes("sync create"));

    expect(terminateIdx).toBeGreaterThanOrEqual(0);
    expect(initIdx).toBeGreaterThan(terminateIdx);
    expect(sshIdx).toBeGreaterThan(initIdx);
    expect(createIdx).toBeGreaterThan(sshIdx);
  });

  it("aborts without destructive work when mutagen binary is absent", async () => {
    const { deps: d, lines, calls } = deps({
      resolveBin: async () => null,
    });
    const res = await runRefresh("/cwd", d, opts());
    expect(res).toEqual({ ok: false, code: "not_installed" });
    expect(calls.some((c) => c.includes("sync terminate"))).toBe(false);
    expect(calls.some((c) => c.includes("sync create"))).toBe(false);
    expect(calls).not.toContain("initRemote");
    expect(JSON.parse(lines.at(-1)!)).toEqual({
      type: "refresh_aborted",
      reason: "not_installed",
    });
  });

  it("stops after a failed init without recreating the session", async () => {
    const { deps: d, calls } = deps({
      initRemote: async (): Promise<InitRemoteResult> => {
        calls.push("initRemote");
        return { ok: false, code: "rsync_failed", stderr: "boom" };
      },
    });
    const res = await runRefresh("/cwd", d, opts());
    expect(res).toEqual({ ok: false, code: "rsync_failed" });
    expect(calls).toContain("initRemote");
    expect(calls).not.toContain("ensureSsh");
    expect(calls.some((c) => c.includes("sync create"))).toBe(false);
  });
});
