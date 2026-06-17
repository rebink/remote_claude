import { describe, it, expect } from "vitest";
import { parseGitStatus } from "./git-status";

describe("parseGitStatus", () => {
  it("parses modified, added, untracked entries", () => {
    const out = " M lib/main.dart\nA  lib/new.dart\n?? notes.txt\n";
    expect(parseGitStatus(out)).toEqual([
      { status: "M", path: "lib/main.dart" },
      { status: "A", path: "lib/new.dart" },
      { status: "??", path: "notes.txt" },
    ]);
  });
  it("handles renames (R old -> new) keeping the new path", () => {
    expect(parseGitStatus("R  a.txt -> b.txt\n")).toEqual([{ status: "R", path: "b.txt" }]);
  });
  it("returns [] for empty/whitespace", () => {
    expect(parseGitStatus("")).toEqual([]);
    expect(parseGitStatus("\n  \n")).toEqual([]);
  });
});
