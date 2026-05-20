import * as config from '../lib/config.ts';
import * as client from '../lib/client.ts';
import { log } from '../lib/log.ts';

export interface InitRemoteOpts {
  gitUrl: string;
  branch: string;
  project: string;
}

export type InitRemoteResult =
  | { ok: true; sha: string; path: string }
  | { ok: false; code: string; stderr?: string };

export async function runInitRemote(opts: InitRemoteOpts): Promise<InitRemoteResult> {
  const cfg = await config.loadConfig(process.cwd());
  const result = (await client.agentRequest(cfg, 'POST', '/init', {
    gitUrl: opts.gitUrl,
    branch: opts.branch,
    projectName: opts.project,
  })) as InitRemoteResult;

  if (result.ok) {
    log.info(`Remote initialized at ${result.path} @ ${result.sha}`);
  }
  return result;
}
