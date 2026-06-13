export type Phase = 'idle' | 'preview' | 'executing' | 'done';
export interface StepRef { id: string }
export interface ProvEvent { type: string; [k: string]: unknown }
export interface ProvisionUiState {
  phase: Phase;
  steps: StepRef[];
  elevation: string[];
  events: ProvEvent[];
  awaitingConsent: boolean;
  result?: { status: string; health?: { tailnet: boolean; agent: string } };
}
export function initialState(): ProvisionUiState {
  return { phase: 'idle', steps: [], elevation: [], events: [], awaitingConsent: false };
}
export function reduce(state: ProvisionUiState, line: string): ProvisionUiState {
  let e: ProvEvent;
  try { e = JSON.parse(line) as ProvEvent; } catch { return state; }
  const next: ProvisionUiState = { ...state, events: [...state.events, e] };
  switch (e.type) {
    case 'preview': {
      const plan = e.plan as { steps?: StepRef[] } | undefined;
      next.phase = 'preview';
      next.steps = plan?.steps ?? [];
      next.elevation = ((e.elevation as StepRef[]) ?? []).map((s) => s.id);
      next.awaitingConsent = true;
      return next;
    }
    case 'step':
      next.phase = 'executing';
      next.awaitingConsent = false;
      return next;
    case 'result':
      next.phase = 'done';
      next.result = { status: e.status as string, health: e.health as NonNullable<ProvisionUiState['result']>['health'] };
      return next;
    default:
      return next;
  }
}
