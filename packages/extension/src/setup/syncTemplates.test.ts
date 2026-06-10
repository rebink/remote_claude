import { describe, it, expect } from 'vitest';
import { EXCLUDE_TEMPLATES, PROJECT_TYPES, PROJECT_TYPE_LABELS } from './syncTemplates.ts';

describe('sync templates', () => {
  it('has a non-empty exclude list and a label for every type', () => {
    for (const t of PROJECT_TYPES) {
      expect(EXCLUDE_TEMPLATES[t].length).toBeGreaterThan(0);
      expect(PROJECT_TYPE_LABELS[t]).toBeTruthy();
    }
  });
  it('includes the common base in every type and never excludes the inbox', () => {
    for (const t of PROJECT_TYPES) {
      expect(EXCLUDE_TEMPLATES[t]).toContain('.DS_Store');
      expect(EXCLUDE_TEMPLATES[t].some((p) => p.includes('.patchwire-inbox'))).toBe(false);
      expect(EXCLUDE_TEMPLATES[t]).not.toContain('.git/'); // handled by --ignore-vcs / always-excluded
    }
  });
  it('carries the right type-specific patterns', () => {
    expect(EXCLUDE_TEMPLATES.flutter).toEqual(expect.arrayContaining(['build/', '**/Pods/', '.dart_tool/']));
    expect(EXCLUDE_TEMPLATES['node-frontend']).toContain('node_modules/');
    expect(EXCLUDE_TEMPLATES['node-backend']).toContain('node_modules/');
    expect(EXCLUDE_TEMPLATES.python).toContain('__pycache__/');
  });
});
