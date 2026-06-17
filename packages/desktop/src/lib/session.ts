import { buildSessionShellCommand } from "@patchwire/core/session-command";
import type { Connection, Project } from "./types";

/** Build the terminal launch command for a project's claude session. */
export function buildLaunchCommand(connection: Connection, project: Project, skipPermissions: boolean): string {
  return buildSessionShellCommand(
    {
      project: project.name,
      host: connection.host,
      user: connection.user,
      sshPort: connection.sshPort,
      remotePath: project.remotePath,
    },
    connection.keyPath,
    skipPermissions,
  );
}
