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
  it("derives rc-<project>-<host>-<pathhash> sanitized", () => {
    expect(sessionName("api-server", "studio-mini", "/x")).toBe("rc-api-server-studio-mini-629e2b1d");
  });
  it("lowercases, replaces non [a-z0-9-], collapses + trims dashes", () => {
    expect(sessionName("My_App!", "Host.Local", "/x")).toBe("rc-my-app-host-local-629e2b1d");
  });
  it("gives distinct names to distinct local paths (worktree isolation)", () => {
    expect(sessionName("p", "h", "/a")).not.toBe(sessionName("p", "h", "/b"));
  });
  it("is stable + trailing-slash insensitive for the same local path", () => {
    expect(sessionName("p", "h", "/a")).toBe(sessionName("p", "h", "/a/"));
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

describe("getStatus — error kind + conflict cap (P3b)", () => {
  it("returns { kind: 'error' } when the runner throws", () => {
    const run = (): never => { throw new Error("spawn failed"); };
    const s = getStatus(run, "rc-x");
    expect(s.kind).toBe("error");
    if (s.kind === "error") expect(s.message).toMatch(/spawn failed/);
  });

  it("caps conflict files at 10 when runner returns >10 entries", () => {
    // 15 conflict lines → getStatus must slice to 10
    const many = Array.from({ length: 15 }, (_, i) => `  α (f${i}.ts)`).join("\n");
    const longOut = `Conflicts:\n${many}\n\n`;
    const run = (args: string[]) => {
      if (args.includes("--long")) return { status: 0, stdout: longOut, stderr: "" };
      // template call returns conflict count 15
      return { status: 0, stdout: "Watching|false|15", stderr: "" };
    };
    const s = getStatus(run, "rc-x");
    expect(s.kind).toBe("conflict");
    if (s.kind === "conflict") expect(s.files.length).toBe(10);
  });

  it("regression: conflict files ≤10 are returned unchanged", () => {
    const few = Array.from({ length: 3 }, (_, i) => `  α (g${i}.ts)`).join("\n");
    const longOut = `Conflicts:\n${few}\n\n`;
    const run = (args: string[]) => {
      if (args.includes("--long")) return { status: 0, stdout: longOut, stderr: "" };
      return { status: 0, stdout: "Watching|false|3", stderr: "" };
    };
    const s = getStatus(run, "rc-x");
    expect(s.kind).toBe("conflict");
    if (s.kind === "conflict") expect(s.files.length).toBe(3);
  });
});
