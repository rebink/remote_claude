import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRsyncArgs } from '../../src/lib/rsync.ts';

describe('buildRsyncArgs', () => {
  it('honors .gitignore and points at the exclude file; includes ssh transport when given', () => {
    const args = buildRsyncArgs({ cwd: '/p', remoteTarget: 'u@h:/r/', sshArg: 'ssh -i k', excludeFile: '/tmp/ex.txt' });
    expect(args).toContain('--filter=dir-merge,- .gitignore');
    expect(args).toContain('--exclude-from');
    expect(args).toContain('/tmp/ex.txt');
    expect(args).toContain('-e');
    expect(args[args.length - 1]).toBe('u@h:/r/');
  });
  it('omits the ssh transport for a local copy (empty sshArg)', () => {
    const args = buildRsyncArgs({ cwd: '/p', remoteTarget: '/d/', sshArg: '', excludeFile: '/tmp/ex.txt' });
    expect(args).not.toContain('-e');
  });
});

const hasRsync = spawnSync('rsync', ['--version'], { encoding: 'utf8' }).status === 0;

describe.skipIf(!hasRsync)('rsync respects .gitignore (local→local, proves secrets do not cross)', () => {
  it('a gitignored .env / build dir is NOT transferred; tracked code is', () => {
    const root = mkdtempSync(join(tmpdir(), 'pw-rsync-'));
    const src = join(root, 'src');
    const dst = join(root, 'dst');
    mkdirSync(join(src, 'lib'), { recursive: true });
    mkdirSync(join(src, 'build'), { recursive: true });
    mkdirSync(dst, { recursive: true });
    writeFileSync(join(src, '.gitignore'), '.env\nbuild/\n');
    writeFileSync(join(src, '.env'), 'SECRET=shh');
    writeFileSync(join(src, 'build', 'app.bin'), 'x');
    writeFileSync(join(src, 'lib', 'main.dart'), 'void main() {}');

    const excludeFile = join(root, 'exclude.txt');
    writeFileSync(excludeFile, '.git/\n.devbridge/\n');
    const args = buildRsyncArgs({ cwd: src, remoteTarget: dst + '/', sshArg: '', excludeFile });

    const r = spawnSync('rsync', args, { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(existsSync(join(dst, 'lib', 'main.dart'))).toBe(true);   // tracked code crosses
    expect(existsSync(join(dst, '.env'))).toBe(false);              // gitignored secret does NOT
    expect(existsSync(join(dst, 'build', 'app.bin'))).toBe(false);  // gitignored dir does NOT
    rmSync(root, { recursive: true, force: true });
  });
});
