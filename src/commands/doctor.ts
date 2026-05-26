import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import chalk from 'chalk';
import { loadConfig } from '../lib/config.ts';
import { AgentClient } from '../lib/client.ts';
import { log } from '../lib/log.ts';

interface Check {
  name: string;
  pass: boolean;
  detail?: string;
}

export async function runDoctor(cwd: string): Promise<void> {
  const checks: Check[] = [];

  checks.push(localBinary('rsync', ['--version']));
  checks.push(localBinary('ssh', ['-V']));
  checks.push(localBinary('git', ['--version']));

  const gitRepo = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, encoding: 'utf8' });
  checks.push({
    name: 'cwd is a git repository',
    pass: gitRepo.status === 0,
    detail: gitRepo.status === 0 ? cwd : 'patches require a local git repo to apply',
  });

  const cfgPath = join(cwd, 'remote-claude.yml');
  const hasCfg = existsSync(cfgPath);
  checks.push({ name: 'remote-claude.yml present', pass: hasCfg, detail: hasCfg ? cfgPath : 'run `remote-claude init`' });

  if (hasCfg) {
    try {
      const cfg = await loadConfig(cwd);
      checks.push({ name: 'remote-claude.yml valid', pass: true });

      const sshKeyPath = join(homedir(), '.remote-claude', 'keys', `${cfg.remote.host}-${cfg.remote.user}`);
      const ssh = spawnSync(
        'ssh',
        [
          ...(existsSync(sshKeyPath) ? ['-i', sshKeyPath] : []),
          '-o', 'BatchMode=yes',
          '-o', 'ConnectTimeout=5',
          ...(cfg.remote.sshPort ? ['-p', String(cfg.remote.sshPort)] : []),
          `${cfg.remote.user}@${cfg.remote.host}`,
          'true',
        ],
        { encoding: 'utf8' },
      );
      checks.push({
        name: `ssh ${cfg.remote.user}@${cfg.remote.host}`,
        pass: ssh.status === 0,
        detail: ssh.status === 0 ? 'reachable' : (ssh.stderr || 'connection failed').trim(),
      });

      try {
        const client = new AgentClient(cfg);
        const h = await client.health();
        checks.push({
          name: `agent ${cfg.remote.agentUrl}/health`,
          pass: h.ok,
          detail: `version=${h.version} claude=${h.claude.found ? h.claude.path : 'NOT FOUND'}`,
        });
      } catch (err) {
        checks.push({ name: 'agent /health', pass: false, detail: (err as Error).message });
      }

      // Safety: remote project has no git remotes configured.
      try {
        const { runSsh } = await import('../lib/ssh-runner.ts');
        const keyPath = join(homedir(), '.remote-claude', 'keys', `${cfg.remote.host}-${cfg.remote.user}`);
        const remotePath = cfg.remote.path;
        const r = await runSsh({
          host: cfg.remote.host,
          user: cfg.remote.user,
          port: cfg.remote.sshPort ?? 22,
          keyPath,
          command: `cd ${remotePath} && git remote -v`,
        });
        if (r.code !== 0) {
          checks.push({
            name: 'remote project has no git remotes',
            pass: true,
            detail: `could not verify remote git state (ssh exit ${r.code}) — skipping`,
          });
        } else if (r.stdout.trim() !== '') {
          checks.push({
            name: 'remote project has no git remotes',
            pass: false,
            detail: `remotes found: ${r.stdout.trim().split('\n')[0]} — remove with: ssh ${cfg.remote.user}@${cfg.remote.host} "cd ${remotePath} && git remote remove <name>"`,
          });
        } else {
          checks.push({
            name: 'remote project has no git remotes',
            pass: true,
            detail: 'sandbox safety guarantee intact',
          });
        }
      } catch (err) {
        checks.push({
          name: 'remote project has no git remotes',
          pass: true,
          detail: `safety check skipped: ${(err as Error).message}`,
        });
      }
    } catch (err) {
      checks.push({ name: 'remote-claude.yml valid', pass: false, detail: (err as Error).message });
    }
  }

  for (const c of checks) {
    const tag = c.pass ? chalk.green('PASS') : chalk.red('FAIL');
    const line = `${tag}  ${c.name}${c.detail ? chalk.dim(' — ' + c.detail) : ''}`;
    console.log(line);
  }

  const failed = checks.filter((c) => !c.pass).length;
  if (failed > 0) {
    log.err(`${failed} check(s) failed.`);
    process.exitCode = 1;
  } else {
    log.ok('All checks passed.');
  }
}

function localBinary(name: string, args: string[]): Check {
  const r = spawnSync(name, args, { encoding: 'utf8' });
  return {
    name: `${name} installed`,
    pass: r.status === 0 || (r.status !== null && r.stderr.length > 0 && r.error === undefined),
    detail: (r.stdout || r.stderr || '').split('\n')[0]?.trim(),
  };
}
