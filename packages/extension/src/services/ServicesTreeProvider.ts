import * as vscode from 'vscode';
import type { ServicesView, WireService, WireProjection } from './protocol.ts';

export interface ServiceItemData {
  id: string;
  label: string;
  status: string;
  bound: boolean;
  remoteAddr: string | null;
  connectionHint: string;
}

export function iconFor(status: string): string {
  switch (status) {
    case 'active': return 'pass-filled';
    case 'binding':
    case 'reconnecting': return 'sync~spin';
    case 'failed': return 'error';
    case 'stale': return 'warning';
    default: return 'circle-outline';
  }
}

export class ServiceItem extends vscode.TreeItem {
  constructor(public readonly data: ServiceItemData) {
    super(data.label, vscode.TreeItemCollapsibleState.None);
    this.description = data.remoteAddr ? `${data.status} · ${data.remoteAddr}` : data.status;
    this.iconPath = new vscode.ThemeIcon(iconFor(data.status));
    this.contextValue = `service:${data.bound ? 'bound' : 'available'}:${data.status}`;
    this.tooltip = data.connectionHint;
  }
}

interface ControllerView {
  onDidChange: vscode.Event<ServicesView>;
  current(): ServicesView;
}

function placeholder(text: string): vscode.TreeItem {
  const t = new vscode.TreeItem(text, vscode.TreeItemCollapsibleState.None);
  t.contextValue = 'placeholder';
  return t;
}

function toItemData(s: WireService, projections: WireProjection[], bound: Set<string>): ServiceItemData {
  const p = projections.find((x) => x.service.id === s.id);
  return {
    id: s.id,
    label: s.label,
    status: p ? p.status : 'available',
    bound: bound.has(s.id),
    remoteAddr: p ? `127.0.0.1:${p.remotePort}` : null,
    connectionHint: s.connectionHint,
  };
}

export class ServicesTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private hasConfig = true;

  constructor(
    private readonly controller: ControllerView,
    private readonly boundIds: () => Set<string>,
  ) {
    this.controller.onDidChange(() => this.changeEmitter.fire());
  }

  setHasConfig(v: boolean): void { this.hasConfig = v; this.changeEmitter.fire(); }
  refresh(): void { this.changeEmitter.fire(); }

  getTreeItem(item: vscode.TreeItem): vscode.TreeItem { return item; }

  getChildren(): vscode.TreeItem[] {
    if (!this.hasConfig) return [placeholder('Run Patchwire: Setup first')];
    const view = this.controller.current();
    if (view.error === 'session stopped') return [placeholder('Session stopped — reopen the view')];
    if (view.candidates.length === 0) return [placeholder('No local services discovered')];
    const bound = this.boundIds();
    return view.candidates.map((s) => new ServiceItem(toItemData(s, view.projections, bound)));
  }
}
