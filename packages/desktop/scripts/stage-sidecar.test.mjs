import { describe, it, expect } from 'vitest';
import { bunTargetToTriple } from './stage-sidecar.mjs';
describe('bunTargetToTriple', () => {
  it.each([
    ['bun-darwin-arm64', 'aarch64-apple-darwin'],
    ['bun-darwin-x64', 'x86_64-apple-darwin'],
    ['bun-linux-x64', 'x86_64-unknown-linux-gnu'],
    ['bun-linux-arm64', 'aarch64-unknown-linux-gnu'],
    ['bun-windows-x64', 'x86_64-pc-windows-msvc'],
  ])('%s -> %s', (bun, triple) => { expect(bunTargetToTriple(bun)).toBe(triple); });
  it('throws on unknown target', () => { expect(() => bunTargetToTriple('bun-solaris-sparc')).toThrow(/unknown bun target/i); });
});

it.each([
  ['patchwire-cli-darwin-arm64', 'aarch64-apple-darwin'],
  ['patchwire-cli-darwin-x64', 'x86_64-apple-darwin'],
  ['patchwire-cli-linux-x64', 'x86_64-unknown-linux-gnu'],
  ['patchwire-cli-linux-arm64', 'aarch64-unknown-linux-gnu'],
  ['patchwire-cli-windows-x64.exe', 'x86_64-pc-windows-msvc'],
])('maps CLI asset %s -> %s', (asset, triple) => {
  expect(bunTargetToTriple(asset)).toBe(triple);
});
