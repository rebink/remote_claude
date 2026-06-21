import { describe, it, expect } from 'vitest';
import * as vscode from 'vscode';
import { ServicesTreeProvider, ServiceItem, iconFor } from './ServicesTreeProvider.ts';
import { initialServices, type ServicesView } from './protocol.ts';

const svc = { id: 'docker:db:5432', label: 'Postgres', kind: 'docker', localPort: 5432, connectionHint: 'postgres://127.0.0.1:5432' };

function fakeController(view: ServicesView) {
  const emitter = new vscode.EventEmitter<ServicesView>();
  return { onDidChange: emitter.event, current: () => view, emitter };
}

describe('iconFor', () => {
  it('maps statuses to theme icon ids', () => {
    expect(iconFor('active')).toBe('pass-filled');
    expect(iconFor('failed')).toBe('error');
    expect(iconFor('stale')).toBe('warning');
    expect(iconFor('available')).toBe('circle-outline');
  });
});

describe('ServicesTreeProvider', () => {
  it('renders a placeholder when there is no patchwire.yml', () => {
    const p = new ServicesTreeProvider(fakeController(initialServices), () => new Set());
    p.setHasConfig(false);
    const items = p.getChildren();
    expect(items).toHaveLength(1);
    expect(items[0].label).toMatch(/Setup first/i);
  });

  it('renders a placeholder when there are no candidates', () => {
    const p = new ServicesTreeProvider(fakeController(initialServices), () => new Set());
    const items = p.getChildren();
    expect(items[0].label).toMatch(/No local services/i);
  });

  it('renders one ServiceItem per candidate with status + contextValue', () => {
    const view: ServicesView = { candidates: [svc], projections: [{ service: svc, remotePort: 5432, mirrored: true, status: 'active' }], error: undefined };
    const p = new ServicesTreeProvider(fakeController(view), () => new Set(['docker:db:5432']));
    const items = p.getChildren();
    expect(items).toHaveLength(1);
    const it = items[0] as ServiceItem;
    expect(it.label).toBe('Postgres');
    expect(it.description).toContain('127.0.0.1:5432');
    expect(it.contextValue).toBe('service:bound:active');
    expect(it.data.remoteAddr).toBe('127.0.0.1:5432');
  });

  it('shows available status + no addr when a candidate is unbound', () => {
    const view: ServicesView = { candidates: [svc], projections: [], error: undefined };
    const p = new ServicesTreeProvider(fakeController(view), () => new Set());
    const it = p.getChildren()[0] as ServiceItem;
    expect(it.contextValue).toBe('service:available:available');
    expect(it.data.remoteAddr).toBeNull();
  });
});
