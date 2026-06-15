import { describe, it, expect } from "vitest";
import {
  sessionName,
  buildCreateArgs,
  parseStatusLine,
  extractConflictPaths,
  type MutagenTarget,
} from "../src/lib/mutagen.ts";

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
