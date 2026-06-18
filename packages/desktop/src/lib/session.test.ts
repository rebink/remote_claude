import { describe, it, expect } from "vitest";
import { buildLaunchCommand } from "./session";

const conn = { id: "c1", name: "mini", host: "100.64.0.1", user: "Admin", sshPort: 22, keyPath: "/keys/k", agentPort: 7878, token: "T" };
const project = { id: "p1", name: "app", branch: "main", localPath: "/l/app", remotePath: "~/patchwire/box/app", host: "100.64.0.1", user: "Admin", lastStatus: "in-sync" as const, syncPaused: false, connectionId: "c1" };

describe("buildLaunchCommand", () => {
  it("assembles an ssh+claude command from a connection + project", () => {
    const cmd = buildLaunchCommand(conn, project, false);
    expect(cmd).toContain("ssh -tt -i '/keys/k' -p 22");
    expect(cmd).toContain("Admin@100.64.0.1");
    expect(cmd).toContain("cd ~/patchwire/box/app && exec zsh -lic");
  });
  it("threads the skip-permissions flag", () => {
    expect(buildLaunchCommand(conn, project, true)).toContain("--dangerously-skip-permissions");
  });
});
