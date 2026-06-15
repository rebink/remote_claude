import { loadConfig } from '../lib/config.ts';

export interface ConfigShowOpts {
  json?: boolean;
  print?: (line: string) => void;
}

export async function runConfigShow(cwd: string, opts: ConfigShowOpts = {}): Promise<void> {
  const print = opts.print ?? ((l: string) => console.log(l));
  try {
    const cfg = await loadConfig(cwd);
    print(
      JSON.stringify({
        type: 'config',
        project: cfg.project,
        host: cfg.remote.host,
        user: cfg.remote.user,
        remotePath: cfg.remote.path,
        sshPort: cfg.remote.sshPort ?? 22,
      }),
    );
  } catch (err) {
    print(
      JSON.stringify({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
