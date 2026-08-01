import { describe, it, expect } from 'vitest';
import { refreshConfirmed } from './commands.ts';

describe('refreshConfirmed', () => {
  it('true only on exact project-name match', () => {
    expect(refreshConfirmed('myproj', 'myproj')).toBe(true);
    expect(refreshConfirmed(' myproj ', 'myproj')).toBe(false);
    expect(refreshConfirmed('MYPROJ', 'myproj')).toBe(false);
    expect(refreshConfirmed(undefined, 'myproj')).toBe(false);
    expect(refreshConfirmed('', 'myproj')).toBe(false);
  });
});
