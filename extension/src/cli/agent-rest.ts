import { CliClient } from './CliClient.ts';

/**
 * Asks the local CLI to call the agent's DELETE /session/:uuid endpoint.
 * The extension never opens HTTP directly — it always shells out to the CLI.
 *
 * Idempotent: the agent returns 204 even if the uuid is unknown.
 */
export async function deleteRemoteSession(cli: CliClient, uuid: string): Promise<void> {
  const run = cli.spawn(['delete-session', '--session', uuid]);
  await run.done;
}
