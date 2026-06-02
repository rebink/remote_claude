export interface RateLimit {
  max: number;
  windowMs: number;
}

export interface UserPolicy {
  /** Allowlist of project names. Absent or empty = all projects allowed. */
  projects?: string[];
  /** Max requests per rolling window. Absent = unlimited. */
  rateLimit?: RateLimit;
}

export interface PolicyContext {
  project: string;
  /** Count of the user's requests already recorded within `rateLimit.windowMs`. */
  recentCount: number;
}

export type PolicyDecision =
  | { allowed: true }
  | { allowed: false; code: string; message: string };

/** Evaluate a user's policy against one request. Allowlist is checked before rate limit. */
export function evaluatePolicy(policy: UserPolicy, ctx: PolicyContext): PolicyDecision {
  if (policy.projects && policy.projects.length > 0 && !policy.projects.includes(ctx.project)) {
    return {
      allowed: false,
      code: 'project_not_allowed',
      message: `project '${ctx.project}' is not in your allowed list`,
    };
  }
  if (policy.rateLimit && ctx.recentCount >= policy.rateLimit.max) {
    return {
      allowed: false,
      code: 'rate_limited',
      message: `rate limit reached (${policy.rateLimit.max} requests per window)`,
    };
  }
  return { allowed: true };
}
