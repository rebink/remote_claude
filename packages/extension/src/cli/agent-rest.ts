import { CliClient } from './CliClient.ts';

/**
 * Asks the local CLI to call the agent's DELETE /session/:uuid endpoint.
 * The extension never opens HTTP directly — it always shells out to the CLI.
 *
 * Idempotent: the agent returns 204 even if the uuid is unknown.
 */
export async function deleteRemoteSession(cli: CliClient, uuid: string): Promise<void> {
  const run = cli.spawn(['delete-session', '--session', uuid]);
  // Collect any error events from the JSONL stream as supplementary detail
  let stderrSummary = '';
  for await (const e of run.events) {
    if (e.type === 'error') stderrSummary += `${e.code}: ${e.message}\n`;
  }
  const code = await run.done;
  if (code !== 0) {
    throw new Error(`delete-session exited with code ${code}${stderrSummary ? `: ${stderrSummary.trim()}` : ''}`);
  }
}
