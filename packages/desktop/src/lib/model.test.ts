import { describe, it, expect } from "vitest";
import {
  isConnectionComplete,
  connectionToHostArgs,
  parseHealth,
  parseProjects,
  buildProject,
  projectStatusLabel,
} from "./model";
import type { Connection } from "./types";

const conn: Connection = {
  host: "studio-mini",
  user: "rebin",
  sshPort: 22,
  keyPath: "/home/rebin/.ssh/id_ed25519",
  agentPort: 7878,
};

describe("isConnectionComplete", () => {
  it("is true when all required fields are present and ports positive", () => {
    expect(isConnectionComplete(conn)).toBe(true);
  });
  it("is false when host is empty", () => {
    expect(isConnectionComplete({ ...conn, host: "" })).toBe(false);
  });
  it("is false when agentPort is 0", () => {
    expect(isConnectionComplete({ ...conn, agentPort: 0 })).toBe(false);
  });
});

describe("connectionToHostArgs", () => {
  it("maps connection fields to the sidecar HostArgs shape", () => {
    expect(connectionToHostArgs(conn)).toEqual({
      host: "studio-mini",
      user: "rebin",
      sshPort: 22,
      keyPath: "/home/rebin/.ssh/id_ed25519",
      agentPort: 7878,
    });
  });
});

describe("parseHealth", () => {
  it("parses a healthy JSON string", () => {
    const r = parseHealth('{"ok":true,"version":"0.4.0","user":"rebin"}');
    expect(r).toEqual({ ok: true, version: "0.4.0", user: "rebin" });
  });
  it("returns ok:false on malformed input", () => {
    expect(parseHealth("not json")).toEqual({ ok: false });
  });
});

describe("parseProjects", () => {
  it("returns [] for non-array input", () => {
    expect(parseProjects(null)).toEqual([]);
    expect(parseProjects({})).toEqual([]);
  });
  it("coerces records and drops ones missing id/localPath/remotePath", () => {
    const raw = [
      { id: "a", name: "api", branch: "main", localPath: "/l/a", remotePath: "/r/a" },
      { id: "b", localPath: "/l/b", remotePath: "/r/b" },
      { name: "broken" },
    ];
    const out = parseProjects(raw);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      id: "a", name: "api", branch: "main",
      localPath: "/l/a", remotePath: "/r/a",
      lastStatus: "unknown", syncPaused: false,
    });
    expect(out[1].name).toBe("b");      // falls back to id when name missing
    expect(out[1].branch).toBe("main"); // default branch
  });
});

describe("buildProject", () => {
  it("builds a project with defaults and a non-empty id", () => {
    const p = buildProject("/home/rebin/code/api", "/remote/api", "api");
    expect(p.localPath).toBe("/home/rebin/code/api");
    expect(p.remotePath).toBe("/remote/api");
    expect(p.name).toBe("api");
    expect(p.branch).toBe("main");
    expect(p.lastStatus).toBe("unknown");
    expect(p.syncPaused).toBe(false);
    expect(p.id.length).toBeGreaterThan(0);
  });
  it("derives the name from the local folder basename when name omitted", () => {
    const p = buildProject("/home/rebin/code/web-app", "/remote/web-app");
    expect(p.name).toBe("web-app");
  });
  it("derives the name from a Windows-style path basename", () => {
    const p = buildProject("C:\\Users\\rebin\\code\\api-server", "/remote/api-server");
    expect(p.name).toBe("api-server");
  });
});

describe("projectStatusLabel", () => {
  it("maps status to display text and kind", () => {
    expect(projectStatusLabel("in-sync")).toEqual({ text: "In sync", kind: "ok" });
    expect(projectStatusLabel("working")).toEqual({ text: "Claude working…", kind: "warn" });
    expect(projectStatusLabel("paused")).toEqual({ text: "Sync paused", kind: "muted" });
    expect(projectStatusLabel("error")).toEqual({ text: "Error", kind: "error" });
    expect(projectStatusLabel("unknown")).toEqual({ text: "—", kind: "muted" });
  });
  it("projectStatusLabel maps conflict", () => {
    expect(projectStatusLabel("conflict")).toEqual({ text: "Conflict", kind: "error" });
  });
});
