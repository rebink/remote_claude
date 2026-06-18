export type FlutterTarget = 'device' | 'web' | 'desktop';

export interface Capabilities { hotReload: boolean; screenshot: boolean; inspect: boolean; logs: boolean; }

export function capabilitiesFor(target: FlutterTarget): Capabilities {
  return { hotReload: true, screenshot: target === 'device', inspect: true, logs: true };
}

export type AttachState =
  | { kind: 'detached' }
  | { kind: 'attaching' }
  | { kind: 'attached'; target: FlutterTarget; capabilities: Capabilities }
  | { kind: 'error'; message: string };

export type AttachEvent =
  | { type: 'attach_requested' }
  | { type: 'attached'; target: FlutterTarget }
  | { type: 'vm_closed' }
  | { type: 'detach_requested' }
  | { type: 'error'; message: string };

export const initialAttach: AttachState = { kind: 'detached' };

export function reduceAttach(_state: AttachState, ev: AttachEvent): AttachState {
  switch (ev.type) {
    case 'attach_requested': return { kind: 'attaching' };
    case 'attached': return { kind: 'attached', target: ev.target, capabilities: capabilitiesFor(ev.target) };
    case 'error': return { kind: 'error', message: ev.message };
    case 'vm_closed':
    case 'detach_requested': return { kind: 'detached' };
  }
}
