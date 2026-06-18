import { describe, it, expect } from 'vitest';
import { EXCLUDE_TEMPLATES, PROJECT_TYPES, PROJECT_TYPE_LABELS } from './sync-templates.ts';

describe('sync-templates', () => {
  it('has 5 types, each with a non-empty exclude list and a label', () => {
    expect(PROJECT_TYPES).toHaveLength(5);
    for (const t of PROJECT_TYPES) {
      expect(EXCLUDE_TEMPLATES[t].length).toBeGreaterThan(0);
      expect(PROJECT_TYPE_LABELS[t]).toBeTruthy();
    }
  });
  it('merges the COMMON base into every type and never excludes the inbox', () => {
    for (const t of PROJECT_TYPES) {
      expect(EXCLUDE_TEMPLATES[t]).toContain('.DS_Store');
      expect(EXCLUDE_TEMPLATES[t].some((p) => p.includes('.patchwire-inbox'))).toBe(false);
    }
  });
  it('carries the right type-specific patterns', () => {
    expect(EXCLUDE_TEMPLATES.flutter).toEqual(expect.arrayContaining(['build/', '**/Pods/', '.dart_tool/']));
    expect(EXCLUDE_TEMPLATES.python).toContain('.venv/');
    expect(EXCLUDE_TEMPLATES['node-frontend']).toContain('node_modules/');
  });
});
