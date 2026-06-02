const DURATION_RE = /^(\d+)\s*(s|m|h|d)$/;

/** Parse '30s' | '15m' | '6h' | '7d' into milliseconds. Throws on bad input. */
export function parseDurationMs(value: string): number {
  const m = value.match(DURATION_RE);
  if (!m) {
    throw new Error(`duration must look like '15m', '6h', '7d', '30s' (got '${value}')`);
  }
  const n = Number(m[1]);
  const unit = m[2];
  const ms = unit === 's' ? 1000
    : unit === 'm' ? 60 * 1000
    : unit === 'h' ? 60 * 60 * 1000
    : 24 * 60 * 60 * 1000;
  return n * ms;
}
