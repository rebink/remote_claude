import { describe, it, expect } from "vitest";
import {
  parseProjects,
  buildProject,
  projectFromConfig,
  projectStatusLabel,
} from "./model";

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

describe("buildProject with host/user", () => {
  it("includes host and user", () => {
    const p = buildProject("/l/api", "/r/api", "api", "studio-mini", "rebin");
    expect(p.host).toBe("studio-mini");
    expect(p.user).toBe("rebin");
    expect(p.remotePath).toBe("/r/api");
  });
  it("defaults host/user to empty when omitted", () => {
    const p = buildProject("/l/api", "/r/api");
    expect(p.host).toBe("");
    expect(p.user).toBe("");
  });
});

describe("projectFromConfig", () => {
  it("builds a Project from a config-show JSON object", () => {
    const cfg = { type: "config" as const, project: "api", host: "h", user: "u", remotePath: "/r/api", sshPort: 22 };
    const p = projectFromConfig("/l/api", cfg);
    expect(p).toMatchObject({ name: "api", host: "h", user: "u", localPath: "/l/api", remotePath: "/r/api", branch: "main", lastStatus: "unknown", syncPaused: false });
    expect(p.id.length).toBeGreaterThan(0);
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
    expect(out[0]).toMatchObject({
      id: "a", name: "api", branch: "main",
      localPath: "/l/a", remotePath: "/r/a",
      lastStatus: "unknown", syncPaused: false,
    });
    expect(out[1].name).toBe("b");      // falls back to id when name missing
    expect(out[1].branch).toBe("main"); // default branch
  });
});

describe("parseProjects carries host/user", () => {
  it("preserves host/user, defaults to empty", () => {
    const out = parseProjects([
      { id: "a", name: "api", localPath: "/l", remotePath: "/r", host: "h", user: "u" },
      { id: "b", name: "web", localPath: "/l2", remotePath: "/r2" },
    ]);
    expect(out[0].host).toBe("h"); expect(out[0].user).toBe("u");
    expect(out[1].host).toBe(""); expect(out[1].user).toBe("");
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
