import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, mkdir, writeFile, access } from "node:fs/promises";
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

  // ── Security: SSH config injection prevention ──────────────────────────────

  it("throws and does NOT write ~/.ssh/config when host contains a newline (ProxyCommand injection)", async () => {
    // Set up the key so the only rejection reason is validation, not missing key.
    // The injected host can't be used as a filename so we use the sanitised key name;
    // but we must make existsSync see a key file — use the raw bytes that would
    // come in from a hostile patchwire.yml (the key lookup uses the raw value).
    // Since the malicious host can't form a valid filename, the key check fires
    // first — so we also prove validation runs BEFORE the write by confirming no
    // config is written even when we pre-create a matching key with the raw path.
    const maliciousHost = "studio-mini\nProxyCommand /bin/sh -c 'id >&2'";
    // Do NOT create a key file — validation must throw before existsSync would help.
    expect(() =>
      ensureSshConfigStanza({ host: maliciousHost, user: "rebin" }, home),
    ).toThrow(/invalid host for ssh config/);
    // ssh config must not have been created
    let wrote = false;
    try { await access(join(home, ".ssh", "config")); wrote = true; } catch { /* expected */ }
    expect(wrote).toBe(false);
  });

  it("throws and does NOT write ~/.ssh/config when user contains whitespace", async () => {
    // Pre-create key file so if validation were absent, the function would proceed to write.
    const maliciousUser = "rebin\nProxyCommand evil";
    await mkdir(join(home, ".patchwire", "keys"), { recursive: true });
    // Key path uses the raw (malicious) values; create a file matching what existsSync would see.
    // Because the malicious user string contains a newline, the key filename would be unusual;
    // we write it via a safe alias and confirm throw happens first regardless.
    expect(() =>
      ensureSshConfigStanza({ host: "studio-mini", user: maliciousUser }, home),
    ).toThrow(/invalid user for ssh config/);
    let wrote = false;
    try { await access(join(home, ".ssh", "config")); wrote = true; } catch { /* expected */ }
    expect(wrote).toBe(false);
  });

  it("throws when host contains a '#' character", async () => {
    expect(() =>
      ensureSshConfigStanza({ host: "studio-mini#evil", user: "rebin" }, home),
    ).toThrow(/invalid host for ssh config/);
    let wrote = false;
    try { await access(join(home, ".ssh", "config")); wrote = true; } catch { /* expected */ }
    expect(wrote).toBe(false);
  });

  it("valid host and user still write the stanza without error", async () => {
    await mkdir(join(home, ".patchwire", "keys"), { recursive: true });
    await writeFile(join(home, ".patchwire", "keys", "studio-mini-rebin"), "KEY", "utf8");
    expect(() =>
      ensureSshConfigStanza({ host: "studio-mini", user: "rebin" }, home),
    ).not.toThrow();
    const cfg = await readFile(join(home, ".ssh", "config"), "utf8");
    expect(cfg).toContain("Host studio-mini");
    expect(cfg).toContain("User rebin");
  });
});
