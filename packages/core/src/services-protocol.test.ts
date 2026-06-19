import { describe, it, expect } from 'vitest';
import { parseServicesLine, reduceServices, initialServices, type ServicesView } from './services-protocol.ts';

const svc = { id: 'docker:db:5432', label: 'Postgres', kind: 'docker', localPort: 5432, connectionHint: 'postgres://127.0.0.1:5432' };
const proj = { service: svc, remotePort: 5432, mirrored: true, status: 'active' };

describe('parseServicesLine', () => {
  it('parses a candidates event', () => {
    expect(parseServicesLine(JSON.stringify({ type: 'candidates', services: [svc] }))).toEqual({ type: 'candidates', services: [svc] });
  });
  it('returns null for malformed or unknown lines', () => {
    expect(parseServicesLine('nope')).toBeNull();
    expect(parseServicesLine(JSON.stringify({ type: 'bogus' }))).toBeNull();
  });
});

describe('reduceServices', () => {
  it('candidates replaces candidates and clears error', () => {
    const s = reduceServices({ ...initialServices, error: 'x' }, { type: 'candidates', services: [svc] });
    expect(s.candidates).toEqual([svc]);
    expect(s.error).toBeUndefined();
  });
  it('status replaces projections', () => {
    const s = reduceServices(initialServices, { type: 'status', projections: [proj] });
    expect(s.projections).toEqual([proj]);
  });
  it('error sets the message', () => {
    const s: ServicesView = reduceServices(initialServices, { type: 'error', message: 'bad' });
    expect(s.error).toBe('bad');
  });
});
