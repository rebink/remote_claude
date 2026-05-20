import * as config from '../lib/config.ts';
import * as client from '../lib/client.ts';
import { log } from '../lib/log.ts';

export interface InitRemoteOpts {
  gitUrl: string;
  branch: string;
  project: string;
}

interface InitRemoteResult {
  ok: boolean;
  sha: string;
  path: string;
}

export async function runInitRemote(opts: InitRemoteOpts): Promise<unknown> {
  const cfg = await config.loadConfig(process.cwd());
  const result = (await client.agentRequest(cfg, 'POST', '/init', {
    gitUrl: opts.gitUrl,
    branch: opts.branch,
    projectName: opts.project,
  })) as InitRemoteResult;
  log.info(`Remote initialized at ${result.path} @ ${result.sha}`);
  return result;
}
