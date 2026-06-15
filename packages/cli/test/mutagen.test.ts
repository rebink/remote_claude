import { describe, it, expect } from "vitest";
import {
  sessionName,
  buildCreateArgs,
  parseStatusLine,
  extractConflictPaths,
  getStatus,
  ensureSession,
  pauseSession,
  resumeSession,
  flushSession,
  stopSession,
  type MutagenTarget,
} from "../src/lib/mutagen.ts";

function fakeRunner(responses: Record<string, { status?: number; stdout?: string; stderr?: string }>) {
  const calls: string[][] = [];
  const run = (args: string[]) => {
    calls.push(args);
    // key by the mutagen subcommand (args[1]) for simplicity
    const key = args[1];
    const r = responses[key] ?? {};
    return { status: r.status ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
  return { run, calls };
}

const target: MutagenTarget = {
  project: "api-server",
  host: "studio-mini",
  user: "rebin",
  localPath: "/home/rebin/code/api-server",
  remotePath: "/remote/api-server",
  ignore: ["build/"],
};

describe("sessionName", () => {
  it("derives rc-<project>-<host> sanitized", () => {
    expect(sessionName("api-server", "studio-mini")).toBe("rc-api-server-studio-mini");
  });
  it("lowercases, replaces non [a-z0-9-], collapses + trims dashes", () => {
    expect(sessionName("My_App!", "Host.Local")).toBe("rc-my-app-host-local");
  });
});

describe("buildCreateArgs", () => {
  it("builds the two-way-resolved create args with beta endpoint and ignores", () => {
    const args = buildCreateArgs("rc-api-server-studio-mini", target);
    expect(args.slice(0, 6)).toEqual([
      "sync", "create", "--name", "rc-api-server-studio-mini", "--mode", "two-way-resolved",
    ]);
    expect(args).toContain("--symlink-mode");
    expect(args).toContain("posix-raw");
    expect(args).toContain("--ignore-vcs");
    // baseline + project ignore each prefixed by --ignore
    expect(args).toContain("node_modules");
    expect(args).toContain("build/");
    // endpoints last: localPath then user@host:remotePath
    expect(args.at(-2)).toBe("/home/rebin/code/api-server");
    expect(args.at(-1)).toBe("rebin@studio-mini:/remote/api-server");
  });
});

describe("parseStatusLine", () => {
  it("paused beats everything", () => {
    expect(parseStatusLine("Watching|true|0").kind).toBe("paused");
  });
  it("conflict count > 0 → conflict", () => {
    expect(parseStatusLine("Watching|false|2").kind).toBe("conflict");
  });
  it("watching / ready / empty → watching", () => {
    expect(parseStatusLine("Watching|false|0").kind).toBe("watching");
    expect(parseStatusLine("Ready|false|0").kind).toBe("watching");
    expect(parseStatusLine("|false|0").kind).toBe("watching");
  });
  it("connect → connecting", () => {
    expect(parseStatusLine("Connecting...|false|0").kind).toBe("connecting");
  });
  it("scanning/staging/reconciling → syncing", () => {
    expect(parseStatusLine("Scanning|false|0").kind).toBe("syncing");
    expect(parseStatusLine("Staging files...|false|0").kind).toBe("syncing");
    expect(parseStatusLine("Reconciling|false|0").kind).toBe("syncing");
  });
});

describe("extractConflictPaths", () => {
  it("pulls paths from a Conflicts: section", () => {
    const longOut = [
      "Name: rc-x",
      "Status: Watching",
      "Conflicts:",
      "  α (src/upload.ts)",
      "  β (src/upload.ts)",
      "",
      "Other: stuff",
    ].join("\n");
    expect(extractConflictPaths(longOut)).toContain("src/upload.ts");
  });
  it("returns [] when no conflicts section", () => {
    expect(extractConflictPaths("Name: x\nStatus: Watching\n")).toEqual([]);
  });
});

describe("getStatus", () => {
  it("returns no_session when list exits non-zero", () => {
    const { run } = fakeRunner({ list: { status: 1 } });
    expect(getStatus(run, "rc-x").kind).toBe("no_session");
  });
  it("parses a watching status", () => {
    const { run } = fakeRunner({ list: { status: 0, stdout: "Watching|false|0" } });
    expect(getStatus(run, "rc-x").kind).toBe("watching");
  });
  it("on conflict, fetches --long and fills files", () => {
    const longOut = "Conflicts:\n  α (a.ts)\n\n";
    let n = 0;
    const run = (args: string[]) => {
      // first list = template (conflict count 1), second list = --long
      if (args.includes("--long")) return { status: 0, stdout: longOut, stderr: "" };
      n++;
      return { status: 0, stdout: "Watching|false|1", stderr: "" };
    };
    const s = getStatus(run, "rc-x");
    expect(s.kind).toBe("conflict");
    if (s.kind === "conflict") expect(s.files).toContain("a.ts");
  });
});

describe("ensureSession", () => {
  it("creates the session when it does not exist", () => {
    // existence check (template Name) returns empty → create
    const calls: string[][] = [];
    const run = (args: string[]) => {
      calls.push(args);
      if (args.includes("create")) return { status: 0, stdout: "", stderr: "" };
      return { status: 0, stdout: "", stderr: "" }; // list returns empty name
    };
    ensureSession(run, { project: "api", host: "h", user: "u", localPath: "/l", remotePath: "/r" });
    expect(calls.some((a) => a.includes("create"))).toBe(true);
  });
});

describe("pause/resume/flush/stop", () => {
  it("issue the right mutagen subcommands", () => {
    const { run, calls } = fakeRunner({});
    pauseSession(run, "rc-x"); resumeSession(run, "rc-x"); flushSession(run, "rc-x"); stopSession(run, "rc-x");
    expect(calls).toEqual([
      ["sync", "pause", "rc-x"],
      ["sync", "resume", "rc-x"],
      ["sync", "flush", "rc-x"],
      ["sync", "terminate", "rc-x"],
    ]);
  });
});
