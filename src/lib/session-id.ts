import { randomBytes } from 'node:crypto';

export function newSessionId(): string {
  return randomBytes(16).toString('hex');
}
