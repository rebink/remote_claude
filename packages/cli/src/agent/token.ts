import { randomBytes, createHash } from 'node:crypto';

/** Generate a 256-bit (32-byte) token as lowercase hex. */
export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * SHA-256 of the plaintext token, as lowercase hex.
 * A KDF (bcrypt/Argon2) is intentionally NOT used: tokens are 256-bit random
 * values (see generateToken), so a plain SHA-256 is preimage-infeasible and
 * adds no per-request latency. Do not introduce low-entropy tokens against this.
 */
export function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}
