import { describe, it, expect } from 'vitest';
import { TreeItem, ThemeIcon, TreeItemCollapsibleState } from 'vscode';

describe('vscode stub tree primitives', () => {
  it('TreeItem stores label + collapsible state', () => {
    const t = new TreeItem('hi', TreeItemCollapsibleState.None);
    expect(t.label).toBe('hi');
    expect(t.collapsibleState).toBe(TreeItemCollapsibleState.None);
  });
  it('ThemeIcon stores its id', () => {
    expect(new ThemeIcon('pass-filled').id).toBe('pass-filled');
  });
});
