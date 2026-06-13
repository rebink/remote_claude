export type Phase = 'idle' | 'preview' | 'executing' | 'done';
export interface StepRef { id: string }
export interface ProvEvent { type: string; [k: string]: unknown }
export interface StepStatus { status: 'start' | 'ok' | 'degraded' | 'failed'; detail?: string }
export interface ProvisionUiState {
  phase: Phase;
  steps: StepRef[];
  elevation: string[];
  events: ProvEvent[];
  awaitingConsent: boolean;
  stepStatus: Record<string, StepStatus>;
  degraded: string[];
  result?: { status: string; failedStep?: string; health?: { tailnet: boolean; agent: string } };
}
export function initialState(): ProvisionUiState {
  return { phase: 'idle', steps: [], elevation: [], events: [], awaitingConsent: false, stepStatus: {}, degraded: [] };
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
    case 'step': {
      next.phase = 'executing';
      next.awaitingConsent = false;
      const id = e.step as string;
      const status = e.status as StepStatus['status'];
      next.stepStatus = { ...state.stepStatus, [id]: { status, detail: e.detail as string | undefined } };
      next.degraded = status === 'degraded' && !state.degraded.includes(id) ? [...state.degraded, id] : state.degraded;
      return next;
    }
    case 'result': {
      next.phase = 'done';
      const outcome = e.outcome as { failedStep?: string } | undefined;
      next.result = { status: e.status as string, failedStep: outcome?.failedStep, health: e.health as ProvisionUiState['result']['health'] };
      return next;
    }
    default:
      return next;
  }
}
