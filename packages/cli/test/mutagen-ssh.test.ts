import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSshConfigStanza } from "../src/lib/mutagen-ssh.ts";

describe("ensureSshConfigStanza", () => {
  let home: string;
  beforeEach(async () => { home = await mkdtemp(join(tmpdir(), "pw-ssh-")); });
  afterEach(async () => { await rm(home, { recursive: true, force: true }); });

  it("writes a managed stanza when the key exists", async () => {
    await mkdir(join(home, ".patchwire", "keys"), { recursive: true });
    await writeFile(join(home, ".patchwire", "keys", "studio-mini-rebin"), "KEY", "utf8");
    ensureSshConfigStanza({ host: "studio-mini", user: "rebin" }, home);
    const cfg = await readFile(join(home, ".ssh", "config"), "utf8");
    expect(cfg).toContain("# === Patchwire managed: studio-mini ===");
    expect(cfg).toContain("Host studio-mini");
    expect(cfg).toContain("User rebin");
    expect(cfg).toContain(join(home, ".patchwire", "keys", "studio-mini-rebin"));
    expect(cfg).toContain("IdentitiesOnly yes");
  });

  it("does nothing when the key is missing", async () => {
    ensureSshConfigStanza({ host: "studio-mini", user: "rebin" }, home);
    // No key → no config written (or empty). Reading should reject or be empty.
    let wrote = true;
    try { await readFile(join(home, ".ssh", "config"), "utf8"); } catch { wrote = false; }
    expect(wrote).toBe(false);
  });

  it("replaces an existing managed stanza instead of duplicating", async () => {
    await mkdir(join(home, ".patchwire", "keys"), { recursive: true });
    await writeFile(join(home, ".patchwire", "keys", "studio-mini-rebin"), "KEY", "utf8");
    ensureSshConfigStanza({ host: "studio-mini", user: "rebin" }, home);
    ensureSshConfigStanza({ host: "studio-mini", user: "rebin" }, home);
    const cfg = await readFile(join(home, ".ssh", "config"), "utf8");
    const count = (cfg.match(/# === Patchwire managed: studio-mini ===/g) ?? []).length;
    expect(count).toBe(1);
  });

  it("includes a Port line only when sshPort is set and not 22", async () => {
    await mkdir(join(home, ".patchwire", "keys"), { recursive: true });
    await writeFile(join(home, ".patchwire", "keys", "studio-mini-rebin"), "KEY", "utf8");
    ensureSshConfigStanza({ host: "studio-mini", user: "rebin", sshPort: 2222 }, home);
    const cfg = await readFile(join(home, ".ssh", "config"), "utf8");
    expect(cfg).toContain("Port 2222");
  });
});
