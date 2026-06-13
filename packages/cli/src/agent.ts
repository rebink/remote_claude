import { Command } from 'commander';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from './agent/server.ts';
import { UsersStore } from './agent/users-store.ts';
import { migrateIfNeeded } from './agent/migrate-v01.ts';
import { migrateProjectsToDefault } from './agent/migrate-projects.ts';
import { ConcurrencyManager } from './agent/concurrency.ts';
import { JsonlAuditLog } from './agent/audit-log.ts';
import { tryDisableKeychainAutoLock } from './agent/keychain.ts';
import { runDaemonInstall, runDaemonUninstall } from './commands/daemon.ts';
import { registerUserCommands } from './commands/user.ts';
import { registerAgentLogCommand } from './commands/agent-log.ts';
import { registerUsageCommand } from './commands/usage.ts';
import { loadPricing } from './agent/pricing.ts';
import { mergeAllowHosts, resolveHosts, buildSeatbeltProfile, egressAvailable, runEgressProbe } from './agent/egress.ts';
import { detectNodeServerPlatform } from './agent/server-platform/node-detect.ts';
import { summarizeCapabilities } from './agent/server-platform/guards.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { VERSION } from './version.ts';

function envRequired(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

async function runServe(): Promise<void> {
  const projectsRoot = envRequired('PW_PROJECTS_ROOT');
  const host = process.env.PW_AGENT_HOST ?? '127.0.0.1';
  const port = Number(process.env.PW_AGENT_PORT ?? 7878);
  const aiCommand = process.env.PW_AI_BIN ?? 'claude';
  const aiArgs = (process.env.PW_AI_ARGS ?? '--print').split(/\s+/).filter(Boolean);
  const timeoutSec = Number(process.env.PW_TIMEOUT_SEC ?? 600);
  const verifyCommand = process.env.PW_VERIFY_CMD?.trim() || undefined;
  const verifyTimeoutSec = Number(process.env.PW_VERIFY_TIMEOUT_SEC ?? 300);
  const pricing = loadPricing(process.env.PW_PRICING_FILE ?? join(homedir(), '.patchwire', 'pricing.yml'));

  // Surface the detected server platform + capabilities at startup so degraded
  // security (e.g. egress: NONE) is visible rather than silent.
  for (const line of summarizeCapabilities(detectNodeServerPlatform())) {
    console.error(`[platform] ${line}`);
  }

  // Default-deny egress (M3, macOS). When enabled, the AI runs under a seatbelt
  // profile that blocks all outbound except localhost, DNS, and the resolved
  // allowlist (Anthropic API by default). Fail-closed: refuse to start if the
  // mechanism is unavailable rather than silently running unconfined.
  let egressProfilePath: string | undefined;
  if ((process.env.PW_EGRESS ?? 'off').toLowerCase() === 'deny') {
    if (!egressAvailable()) {
      console.error(
        'PW_EGRESS=deny requires macOS `sandbox-exec`, which was not found on PATH. ' +
          'Refusing to start (fail-closed). Unset PW_EGRESS to run without egress confinement.',
      );
      process.exit(1);
    }
    const hosts = mergeAllowHosts(process.env.PW_EGRESS_ALLOW);
    const allowDns = process.env.PW_EGRESS_ALLOW_DNS !== '0';
    const ips = await resolveHosts(hosts);
    const profile = buildSeatbeltProfile({ allowIps: ips, allowDns });
    egressProfilePath = join(homedir(), '.patchwire', 'egress.sb');
    mkdirSync(join(homedir(), '.patchwire'), { recursive: true });
    writeFileSync(egressProfilePath, profile, { mode: 0o600 });
    console.error(
      `egress: default-deny enabled — allow ${hosts.join(', ')} (${ips.length} IP(s))` +
        `${allowDns ? ' + DNS' : ''}; profile ${egressProfilePath}`,
    );
  }

  const usersJsonPath = process.env.PW_USERS_FILE ?? join(homedir(), '.patchwire', 'users.json');
  const legacyToken = process.env.PW_AGENT_TOKEN;

  const migration = migrateIfNeeded({ usersJsonPath, legacyToken });
  const usersStore = new UsersStore(usersJsonPath);

  const globalCap = Number(process.env.PW_MAX_CONCURRENT_TOTAL ?? 3);
  const perUserCap = Number(process.env.PW_MAX_CONCURRENT_PER_USER ?? 1);
  if (!Number.isInteger(globalCap) || globalCap < 1) {
    console.error(`PW_MAX_CONCURRENT_TOTAL must be a positive integer (got ${process.env.PW_MAX_CONCURRENT_TOTAL})`);
    process.exit(1);
  }
  if (!Number.isInteger(perUserCap) || perUserCap < 1) {
    console.error(`PW_MAX_CONCURRENT_PER_USER must be a positive integer (got ${process.env.PW_MAX_CONCURRENT_PER_USER})`);
    process.exit(1);
  }
  const concurrency = new ConcurrencyManager({ globalCap, perUserCap });

  const auditLogPath = process.env.PW_AUDIT_LOG ?? join(homedir(), '.patchwire', 'agent.log');
  const auditMaxBytes = process.env.PW_AUDIT_LOG_MAX_BYTES
    ? Number(process.env.PW_AUDIT_LOG_MAX_BYTES)
    : undefined;
  const auditMaxFiles = process.env.PW_AUDIT_LOG_MAX_FILES
    ? Number(process.env.PW_AUDIT_LOG_MAX_FILES)
    : undefined;
  const auditLog = new JsonlAuditLog({
    path: auditLogPath,
    ...(auditMaxBytes !== undefined ? { maxBytes: auditMaxBytes } : {}),
    ...(auditMaxFiles !== undefined ? { maxFiles: auditMaxFiles } : {}),
  });

  const app = buildServer({
    usersStore,
    projectsRoot,
    aiCommand,
    aiArgs,
    timeoutSec,
    ...(verifyCommand ? { verifyCommand, verifyTimeoutSec } : {}),
    ...(pricing ? { pricing } : {}),
    ...(egressProfilePath ? { egressProfilePath } : {}),
    version: VERSION,
    concurrency,
    auditLog,
  });

  if (migration.migrated) {
    try {
      const projectsMigration = migrateProjectsToDefault({ projectsRoot });
      app.log.info(
        `migrated v0.1 → v0.2: created 'default' user from PW_AGENT_TOKEN, ` +
          `moved ${projectsMigration.moved.length} project(s) into ${projectsRoot}/default/`,
      );
      if (projectsMigration.moved.length > 0) {
        app.log.info(`moved projects: ${projectsMigration.moved.join(', ')}`);
      }
    } catch (err) {
      // A migration conflict (e.g., PROJECTS_ROOT/default/<name> already exists)
      // must not silently corrupt state. Surface a clear error and refuse to start
      // so the operator can resolve the collision by hand before retrying.
      app.log.error(`v0.1 → v0.2 project migration failed: ${(err as Error).message}`);
      app.log.error(`refusing to start; resolve the conflict manually and rerun`);
      process.exit(1);
    }
  }
  if (usersStore.list().length === 0) {
    app.log.warn(
      'no users registered — agent will 401 every request. ' +
      'Run: patchwire-agent user add <name>',
    );
  }

  // Best-effort: keep the macOS login keychain from auto-locking so `claude`
  // can read its OAuth credentials. Only takes effect if the keychain is
  // currently unlocked (e.g., admin just logged in or SSH'd). No-op on
  // non-macOS. Failures are non-fatal — chat turns surface a clearer error
  // if claude still hits "Not logged in" later.
  const kc = tryDisableKeychainAutoLock();
  if (kc.ok && process.platform === 'darwin') {
    app.log.info('login keychain auto-lock disabled');
  } else if (!kc.ok) {
    app.log.warn(`could not adjust login keychain settings: ${kc.reason ?? 'unknown'}`);
  }

  try {
    const addr = await app.listen({ host, port });
    app.log.info(`patchwire-agent listening on ${addr}`);
    app.log.info(`concurrency: global=${globalCap}, per_user=${perUserCap}`);
    app.log.info(`audit log: ${auditLogPath}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

const program = new Command();
program
  .name('patchwire-agent')
  .description('Patchwire HTTP agent — runs `claude` on a remote machine and returns diffs.')
  .version(VERSION);

program
  .command('serve', { isDefault: true })
  .description('Start the HTTP server (default)')
  .action(async () => { await runServe(); });

program
  .command('install')
  .description('Install as a launchd LaunchAgent so it starts on login (macOS)')
  .option('--projects-root <path>', 'override PW_PROJECTS_ROOT')
  .option('--port <n>', 'override PW_AGENT_PORT', (v: string) => Number(v))
  .option('--host <h>', 'override PW_AGENT_HOST')
  .option('--token <t>', 'override PW_AGENT_TOKEN')
  .option('--ai-bin <path>', 'override PW_AI_BIN')
  .action(async (opts) => { await runDaemonInstall(opts); });

program
  .command('uninstall')
  .description('Remove the launchd LaunchAgent')
  .action(async () => { await runDaemonUninstall(); });

async function runEgressCheck(): Promise<void> {
  if (!egressAvailable()) {
    console.error('egress-check needs macOS `sandbox-exec` (not found on PATH).');
    process.exit(1);
  }
  const hosts = mergeAllowHosts(process.env.PW_EGRESS_ALLOW);
  const allowDns = process.env.PW_EGRESS_ALLOW_DNS !== '0';
  const ips = await resolveHosts(hosts);
  const profilePath = join(homedir(), '.patchwire', 'egress-check.sb');
  mkdirSync(join(homedir(), '.patchwire'), { recursive: true });
  writeFileSync(profilePath, buildSeatbeltProfile({ allowIps: ips, allowDns }), { mode: 0o600 });
  console.log(`Profile ${profilePath} — allow ${hosts.join(', ')} = ${ips.length} IP(s)${allowDns ? ' + DNS' : ''}`);

  const allowedReachable = await runEgressProbe(profilePath, 'https://api.anthropic.com');
  const blockedReachable = await runEgressProbe(profilePath, 'https://example.com');
  console.log(`  allowlisted (api.anthropic.com) reachable: ${allowedReachable ? 'YES ✅' : 'NO ❌'}`);
  console.log(`  non-allowlisted (example.com) blocked:     ${!blockedReachable ? 'YES ✅' : 'NO ❌ — egress NOT enforced'}`);
  if (!allowedReachable || blockedReachable) {
    console.error('egress-check FAILED — see above.');
    process.exit(1);
  }
  console.log('egress-check passed.');
}

program
  .command('egress-check')
  .description('Verify default-deny egress on this box: allowlist reachable, other hosts blocked (macOS)')
  .action(async () => { await runEgressCheck(); });

registerUserCommands(program);
registerAgentLogCommand(program);
registerUsageCommand(program);

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
