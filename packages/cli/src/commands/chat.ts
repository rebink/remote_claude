import * as config from '../lib/config.ts';
import * as client from '../lib/client.ts';
import { runSync } from './sync.ts';

const PROTOCOL_VERSION = '1';

export interface ChatOpts {
  cwd: string;
  prompt: string;
  sessionUuid: string;
  skipSync?: boolean;
}

function emit(e: unknown): void {
  process.stdout.write(JSON.stringify(e) + '\n');
}

export async function runChat(opts: ChatOpts): Promise<void> {
  emit({ type: 'protocol', version: PROTOCOL_VERSION });

  const cfg = await config.loadConfig(opts.cwd);
  if (!opts.skipSync) {
    emit({ type: 'sync_start' });
    const syncStart = Date.now();
    await runSync(opts.cwd);
    // filesChanged is still 0 until rsync --stats parsing lands (M4 follow-up)
    emit({ type: 'sync_done', filesChanged: 0, durationMs: Date.now() - syncStart });
  }

  for await (const evt of client.streamPostNdjson(cfg, '/chat', {
    uuid: opts.sessionUuid,
    prompt: opts.prompt,
    projectName: cfg.project,
  })) {
    emit(evt);
  }
}
