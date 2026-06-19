export interface WireService { id: string; label: string; kind: string; localPort: number; connectionHint: string; meta?: Record<string, string>; }
export interface WireProjection { service: WireService; remotePort: number; mirrored: boolean; status: string; }

export type ServicesEvent =
  | { type: 'candidates'; services: WireService[] }
  | { type: 'status'; projections: WireProjection[] }
  | { type: 'error'; message: string };

export interface ServicesView { candidates: WireService[]; projections: WireProjection[]; error?: string; }

export const initialServices: ServicesView = { candidates: [], projections: [] };

export function parseServicesLine(raw: string): ServicesEvent | null {
  let o: unknown;
  try { o = JSON.parse(raw); } catch { return null; }
  if (!o || typeof o !== 'object') return null;
  const e = o as { type?: string; services?: unknown; projections?: unknown; message?: unknown };
  if (e.type === 'candidates' && Array.isArray(e.services)) return { type: 'candidates', services: e.services as WireService[] };
  if (e.type === 'status' && Array.isArray(e.projections)) return { type: 'status', projections: e.projections as WireProjection[] };
  if (e.type === 'error' && typeof e.message === 'string') return { type: 'error', message: e.message };
  return null;
}

export function reduceServices(state: ServicesView, ev: ServicesEvent): ServicesView {
  switch (ev.type) {
    case 'candidates': return { ...state, candidates: ev.services, error: undefined };
    case 'status': return { ...state, projections: ev.projections, error: undefined };
    case 'error': return { ...state, error: ev.message };
  }
}
