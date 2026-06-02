import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { hashToken } from './token.ts';
import type { UserPolicy, RateLimit } from './policy.ts';

const USERNAME_RE = /^[a-zA-Z0-9_.-]+$/;
const RESERVED_NAMES = new Set(['__admin__']);
const ADMIN_KEY = '__admin__';

interface UserRecord {
  tokenHash: string;
  createdAt: string;
  disabled: boolean;
  lastSeen?: string;
  policy?: UserPolicy;
}

/** Drop an all-empty policy so we never persist `{}`. */
function normalizePolicy(p: UserPolicy): UserPolicy | undefined {
  const hasProjects = !!(p.projects && p.projects.length > 0);
  const hasRate = !!p.rateLimit;
  if (!hasProjects && !hasRate) return undefined;
  return p;
}

export interface UserSummary {
  user: string;
  createdAt: string;
  disabled: boolean;
  lastSeen?: string;
}

export interface LookupResult {
  user: string;
  disabled: boolean;
}

export class UsersStore {
  private users: Record<string, UserRecord> = {};

  constructor(private readonly path: string) {
    if (existsSync(path)) {
      try {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        if (parsed && typeof parsed === 'object') {
          this.users = parsed as Record<string, UserRecord>;
        }
      } catch {
        this.users = {};
      }
    } else {
      mkdirSync(dirname(path), { recursive: true });
    }
  }

  addUser(name: string, plaintextToken: string): void {
    if (RESERVED_NAMES.has(name)) {
      throw new Error(`'${name}' is a reserved username`);
    }
    if (!USERNAME_RE.test(name)) {
      throw new Error(`invalid username '${name}' (must match ${USERNAME_RE})`);
    }
    if (this.users[name]) {
      throw new Error(`user '${name}' already exists`);
    }
    this.users[name] = {
      tokenHash: hashToken(plaintextToken),
      createdAt: new Date().toISOString(),
      disabled: false,
    };
    this.persist();
  }

  addAdmin(plaintextToken: string): void {
    this.users[ADMIN_KEY] = {
      tokenHash: hashToken(plaintextToken),
      createdAt: new Date().toISOString(),
      disabled: false,
    };
    this.persist();
  }

  list(): UserSummary[] {
    return Object.entries(this.users)
      .filter(([name]) => !RESERVED_NAMES.has(name))
      .map(([user, r]) => ({
        user,
        createdAt: r.createdAt,
        disabled: r.disabled,
        ...(r.lastSeen ? { lastSeen: r.lastSeen } : {}),
      }));
  }

  disable(name: string): void {
    this.mutate(name, (r) => { r.disabled = true; });
  }
  enable(name: string): void {
    this.mutate(name, (r) => { r.disabled = false; });
  }
  remove(name: string): void {
    if (!this.users[name]) throw new Error(`user '${name}' not found`);
    delete this.users[name];
    this.persist();
  }
  rotate(name: string, newPlaintext: string): void {
    this.mutate(name, (r) => { r.tokenHash = hashToken(newPlaintext); });
  }
  touchLastSeen(name: string): void {
    const r = this.users[name];
    if (!r) return;
    r.lastSeen = new Date().toISOString();
    this.persist();
  }

  getPolicy(name: string): UserPolicy {
    return this.users[name]?.policy ?? {};
  }

  setProjects(name: string, projects: string[] | null): void {
    this.mutate(name, (r) => {
      const p: UserPolicy = { ...(r.policy ?? {}) };
      if (projects && projects.length > 0) p.projects = projects;
      else delete p.projects;
      r.policy = normalizePolicy(p);
    });
  }

  setRateLimit(name: string, rate: RateLimit | null): void {
    this.mutate(name, (r) => {
      const p: UserPolicy = { ...(r.policy ?? {}) };
      if (rate) p.rateLimit = rate;
      else delete p.rateLimit;
      r.policy = normalizePolicy(p);
    });
  }

  /**
   * Look up a plaintext bearer token. Returns null if no match.
   * Uses constant-time compare across all candidate hashes to defeat
   * timing side-channels on a per-entry basis (the iteration itself is
   * O(n) and not constant-time across n, which is acceptable for the
   * single-team scale this product targets).
   */
  lookupByToken(plaintext: string): LookupResult | null {
    if (!plaintext) return null;
    const candidate = Buffer.from(hashToken(plaintext), 'hex');
    for (const [user, rec] of Object.entries(this.users)) {
      const stored = Buffer.from(rec.tokenHash, 'hex');
      if (stored.length !== candidate.length) continue;
      if (timingSafeEqual(stored, candidate)) {
        return { user, disabled: rec.disabled };
      }
    }
    return null;
  }

  private mutate(name: string, fn: (r: UserRecord) => void): void {
    const r = this.users[name];
    if (!r) throw new Error(`user '${name}' not found`);
    fn(r);
    this.persist();
  }

  private persist(): void {
    writeFileSync(this.path, JSON.stringify(this.users, null, 2), { mode: 0o600 });
  }
}
