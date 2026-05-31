import { timingSafeEqual } from 'node:crypto';

export function verifyToken(headerValue: string | undefined, expected: string): boolean {
  if (!headerValue || !headerValue.startsWith('Bearer ')) return false;
  const provided = headerValue.slice('Bearer '.length).trim();
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}
