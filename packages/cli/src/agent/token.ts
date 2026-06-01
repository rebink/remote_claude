import { randomBytes, createHash } from 'node:crypto';

/** Generate a 256-bit (32-byte) token as lowercase hex. */
export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

/** SHA-256 of the plaintext token, as lowercase hex. */
export function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}
