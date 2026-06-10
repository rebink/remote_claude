import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectProjectType } from './detectProjectType.ts';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pw-detect-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('detectProjectType', () => {
  it('detects flutter from pubspec.yaml', () => {
    writeFileSync(join(dir, 'pubspec.yaml'), 'name: app\n');
    expect(detectProjectType(dir)).toBe('flutter');
  });
  it('detects node-frontend when package.json has a frontend dep', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { next: '14' } }));
    expect(detectProjectType(dir)).toBe('node-frontend');
  });
  it('detects node-backend for a plain package.json', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { express: '4' } }));
    expect(detectProjectType(dir)).toBe('node-backend');
  });
  it('detects python from requirements.txt', () => {
    writeFileSync(join(dir, 'requirements.txt'), 'flask\n');
    expect(detectProjectType(dir)).toBe('python');
  });
  it('treats a malformed package.json as node-backend', () => {
    writeFileSync(join(dir, 'package.json'), '{ not json');
    expect(detectProjectType(dir)).toBe('node-backend');
  });
  it('falls back to common', () => {
    expect(detectProjectType(dir)).toBe('common');
  });
});
