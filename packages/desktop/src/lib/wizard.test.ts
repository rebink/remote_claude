import { describe, it, expect } from "vitest";
import { isSafeToken, genToken, defaultRemotePath, remoteProjectPath, sshCopyIdCommand, wizardCanProvision } from "./wizard";

describe("isSafeToken", () => {
  it("accepts hostnames/users; rejects whitespace/newline/#/@", () => {
    expect(isSafeToken("studio-mini")).toBe(true);
    expect(isSafeToken("rebin_dev")).toBe(true);
    expect(isSafeToken("a b")).toBe(false);
    expect(isSafeToken("a\nb")).toBe(false);
    expect(isSafeToken("a#b")).toBe(false);
    expect(isSafeToken("")).toBe(false);
  });
});

describe("genToken", () => {
  it("returns a 64-char hex string and is unique each call", () => {
    const t1 = genToken();
    const t2 = genToken();
    expect(t1).toMatch(/^[0-9a-f]{64}$/);
    expect(t2).toMatch(/^[0-9a-f]{64}$/);
    expect(t1).not.toBe(t2);
  });
});

describe("defaultRemotePath", () => {
  it("is ~/workspace/<project>", () => {
    expect(defaultRemotePath("api-server")).toBe("~/workspace/api-server");
  });
});

describe("remoteProjectPath", () => {
  it("is ~/patchwire/<name>", () => {
    expect(remoteProjectPath("api")).toBe("~/patchwire/api");
  });
});

describe("sshCopyIdCommand", () => {
  it("builds ssh-copy-id with the pub key, port, user@host", () => {
    expect(sshCopyIdCommand("/k/studio-mini-rebin.pub", "rebin", "studio-mini", 22))
      .toBe("ssh-copy-id -i /k/studio-mini-rebin.pub -p 22 rebin@studio-mini");
  });
});

describe("wizardCanProvision", () => {
  it("requires safe host+user, a project name, a key, and key-verified", () => {
    const base = { host: "h", user: "u", project: "p", keyVerified: true };
    expect(wizardCanProvision(base)).toBe(true);
    expect(wizardCanProvision({ ...base, keyVerified: false })).toBe(false);
    expect(wizardCanProvision({ ...base, host: "a b" })).toBe(false);
    expect(wizardCanProvision({ ...base, project: "" })).toBe(false);
  });
});
