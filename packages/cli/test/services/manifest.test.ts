// packages/cli/test/services/manifest.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeManifest, readManifest, manifestPath } from '../../src/services/manifest.ts';
import type { Projection } from '../../src/services/types.ts';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pw-manifest-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const proj: Projection = {
  service: { id: 'docker:pw-db:5432', label: 'Postgres (pw-db)', kind: 'docker', localPort: 5432, connectionHint: 'postgres://127.0.0.1:5432' },
  remotePort: 5432, mirrored: true, status: 'active',
};

describe('manifest', () => {
  it('writes services.json under .patchwire and reads it back', () => {
    const p = writeManifest(dir, [proj]);
    expect(p).toBe(manifestPath(dir));
    const back = readManifest(dir);
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ id: 'docker:pw-db:5432', remotePort: 5432, host: '127.0.0.1', mirrored: true });
  });

  it('writes the file 0o600', () => {
    writeManifest(dir, [proj]);
    const mode = statSync(manifestPath(dir)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('returns [] when no manifest exists', () => {
    expect(readManifest(dir)).toEqual([]);
  });
});
