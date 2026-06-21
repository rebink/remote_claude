import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));

describe('package.json contributes the services UI', () => {
  it('registers the patchwire.services tree view', () => {
    const views = pkg.contributes.views.patchwire as Array<{ id: string }>;
    expect(views.some((v) => v.id === 'patchwire.services')).toBe(true);
  });
  it('registers the four service commands', () => {
    const ids = (pkg.contributes.commands as Array<{ command: string }>).map((c) => c.command);
    for (const c of ['patchwire.services.bind', 'patchwire.services.unbind', 'patchwire.services.retry', 'patchwire.services.copyAddress']) {
      expect(ids).toContain(c);
    }
  });
  it('gates item context menus by contextValue', () => {
    const menus = pkg.contributes.menus['view/item/context'] as Array<{ command: string; when: string }>;
    expect(menus.some((m) => m.command === 'patchwire.services.bind' && /service:available/.test(m.when))).toBe(true);
    expect(menus.some((m) => m.command === 'patchwire.services.unbind' && /service:bound/.test(m.when))).toBe(true);
    expect(menus.some((m) => m.command === 'patchwire.services.retry' && /(failed|stale)/.test(m.when))).toBe(true);
  });
});
