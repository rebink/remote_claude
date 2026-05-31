/**
 * Per-server in-memory record of chat turns. Used by `GET /session/:id/status`
 * so the VS Code extension can reconcile turns marked as in-flight in its
 * persisted state after a reload (per M6 Task 34).
 *
 * The state is intentionally NOT persisted across agent restarts — on a fresh
 * agent process the map is empty and previously in-flight turns return 404 /
 * `unknown_uuid`, which the extension surfaces as "previous turn lost; please
 * retry".
 */
export interface TurnRecord {
  uuid: string;
  status: 'in_flight' | 'done' | 'error';
  startedAt: number;
  tokensIn?: number;
  tokensOut?: number;
  durationMs?: number;
  errorMessage?: string;
}

export class TurnState {
  private map = new Map<string, TurnRecord>();

  start(uuid: string): void {
    this.map.set(uuid, { uuid, status: 'in_flight', startedAt: Date.now() });
  }

  complete(
    uuid: string,
    info: { tokensIn: number; tokensOut: number; durationMs: number },
  ): void {
    this.map.set(uuid, {
      uuid,
      status: 'done',
      startedAt: this.map.get(uuid)?.startedAt ?? Date.now(),
      ...info,
    });
  }

  error(uuid: string, message: string): void {
    this.map.set(uuid, {
      uuid,
      status: 'error',
      startedAt: this.map.get(uuid)?.startedAt ?? Date.now(),
      errorMessage: message,
    });
  }

  get(uuid: string): TurnRecord | undefined {
    return this.map.get(uuid);
  }
}
