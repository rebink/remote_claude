import type { FlutterSession } from '@patchwire/protocol';

/** In-memory per-(user, project) registry of live Flutter sessions. Ephemeral by design. */
export class FlutterSessionStore {
  private map = new Map<string, FlutterSession>();
  private key(user: string, project: string): string { return `${user} ${project}`; }

  set(user: string, session: FlutterSession): void { this.map.set(this.key(user, session.project), session); }
  get(user: string, project: string): FlutterSession | undefined { return this.map.get(this.key(user, project)); }
  clear(user: string, project: string): void { this.map.delete(this.key(user, project)); }
}
