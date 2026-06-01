# Phase 1: Identity Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-user bearer tokens, a hashed users-store, `patchwire-agent user` CRUD subcommands, an authenticated `/me` endpoint, and one-shot auto-migration from v0.1's single-token mode.

**Architecture:** A new `UsersStore` class (mirroring the existing `SessionStore` pattern) persists `{user → tokenHash}` to `~/.patchwire/users.json`. The Fastify auth hook in `src/agent/server.ts` resolves the incoming bearer to a username via SHA-256 hash lookup, then decorates the request with `req.username`. A migration helper runs once at agent boot: if `users.json` is absent and the legacy `PW_AGENT_TOKEN` env exists, a `default` user is created with that token's hash, so v0.1 laptops keep authenticating with no changes. A new `patchwire whoami` command and `AgentClient.whoami()` method consume `GET /me`.

**Tech Stack:** TypeScript, Node 20+, Fastify 4, Commander 12, Zod 3, Vitest 2, node:crypto.

**Spec reference:** `docs/superpowers/specs/2026-06-01-multi-developer-agent-design.md` (sections 4.2, 5.1, 5.2, 5.3, 6.1, 6.3, 10).

**Out of scope for this phase** (deferred to later plans):
- Per-user project paths (`PROJECTS/<user>/<project>/`) — phase 2
- Concurrency / queue / semaphores — phase 3
- Audit log — phase 4
- SSE protocol on `/ask` — phase 5
- Admin panel — phase 6
- Laptop `PW_USER` env var — only needed once rsync paths gain a `<user>/` segment, deferred to phase 2

---

## File Structure

**New files (agent side):**
- `packages/cli/src/agent/token.ts` — pure helpers: `generateToken()`, `hashToken(plaintext)`
- `packages/cli/src/agent/users-store.ts` — `class UsersStore` (CRUD + token-hash lookup)
- `packages/cli/src/agent/migrate-v01.ts` — one-shot `migrateIfNeeded(...)` boot helper

**New files (laptop side):**
- `packages/cli/src/commands/user.ts` — `patchwire-agent user add|list|disable|enable|rm|rotate` handlers
- `packages/cli/src/commands/whoami.ts` — `patchwire whoami` command handler

**New tests:**
- `packages/cli/test/agent/token.test.ts`
- `packages/cli/test/agent/users-store.test.ts`
- `packages/cli/test/agent/migrate-v01.test.ts`
- `packages/cli/test/agent/auth-multi-user.test.ts` (covers `resolveUserFromHeader` + `/me`)
- `packages/cli/test/commands/user.test.ts`
- `packages/cli/test/commands/whoami.test.ts`
- `packages/cli/test/integration/multi-user.e2e.test.ts`

**Modified files:**
- `packages/cli/src/agent/auth.ts` — add `resolveUserFromHeader(header, store)`, keep `verifyToken` for legacy callers
- `packages/cli/src/agent/server.ts` — `usersStore` in `AgentOptions`, auth hook uses lookup, `req.username` decoration, new `GET /me` route
- `packages/cli/src/agent.ts` — construct `UsersStore`, run migration, register `user` subcommand
- `packages/cli/src/lib/client.ts` — `whoami()` on `AgentClient` + `WhoamiResponse` type
- `packages/cli/src/cli.ts` — register `whoami` command
- `packages/cli/test/agent.test.ts` — adapt existing `/ask` tests to construct a `UsersStore` instead of passing a raw `token`

---

## Task 1: Token utilities (`src/agent/token.ts`)

**Files:**
- Create: `packages/cli/src/agent/token.ts`
- Test: `packages/cli/test/agent/token.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/test/agent/token.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { generateToken, hashToken } from '../../src/agent/token.ts';

describe('generateToken', () => {
  it('returns a 64-character hex string (32 bytes)', () => {
    const t = generateToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns a different value on each call', () => {
    expect(generateToken()).not.toBe(generateToken());
  });
});

describe('hashToken', () => {
  it('returns a 64-character hex sha256', () => {
    expect(hashToken('hello')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
  });

  it('matches the known sha256 of an empty string', () => {
    expect(hashToken('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/cli && pnpm vitest run test/agent/token.test.ts
```

Expected: FAIL with `Failed to load url ../../src/agent/token.ts`.

- [ ] **Step 3: Write the minimal implementation**

Create `packages/cli/src/agent/token.ts`:

```typescript
import { randomBytes, createHash } from 'node:crypto';

/** Generate a 256-bit (32-byte) token as lowercase hex. */
export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

/** SHA-256 of the plaintext token, as lowercase hex. */
export function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd packages/cli && pnpm vitest run test/agent/token.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/agent/token.ts packages/cli/test/agent/token.test.ts
git commit -m "feat(agent): token utilities (generate + sha256 hash)"
```

---

## Task 2: UsersStore class (`src/agent/users-store.ts`)

The store mirrors `SessionStore`'s pattern: a JSON file at a caller-chosen path, chmod 0600, in-memory map, sync writes. It maps `username → { tokenHash, createdAt, disabled, lastSeen? }`. It exposes a `lookupByToken(plaintext)` that returns `{ user, disabled } | null` via SHA-256 hash compare.

**Files:**
- Create: `packages/cli/src/agent/users-store.ts`
- Test: `packages/cli/test/agent/users-store.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/test/agent/users-store.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsersStore } from '../../src/agent/users-store.ts';
import { hashToken } from '../../src/agent/token.ts';

describe('UsersStore', () => {
  let dir: string;
  let path: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pw-users-'));
    path = join(dir, 'users.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('starts empty when file does not exist', () => {
    const s = new UsersStore(path);
    expect(s.list()).toEqual([]);
  });

  it('addUser persists a sha256 hash, never plaintext', () => {
    const s = new UsersStore(path);
    s.addUser('alice', 'plaintext-token-value');
    const raw = readFileSync(path, 'utf8');
    expect(raw).not.toContain('plaintext-token-value');
    expect(raw).toContain(hashToken('plaintext-token-value'));
  });

  it('persists with mode 0600', () => {
    const s = new UsersStore(path);
    s.addUser('alice', 'tok');
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('addUser rejects duplicate username', () => {
    const s = new UsersStore(path);
    s.addUser('alice', 'tok1');
    expect(() => s.addUser('alice', 'tok2')).toThrow(/already exists/);
  });

  it('addUser rejects invalid username (regex [a-zA-Z0-9_.-]+)', () => {
    const s = new UsersStore(path);
    expect(() => s.addUser('al ice', 'tok')).toThrow(/invalid username/);
    expect(() => s.addUser('../etc', 'tok')).toThrow(/invalid username/);
    expect(() => s.addUser('', 'tok')).toThrow(/invalid username/);
  });

  it('addUser rejects the reserved __admin__ name', () => {
    const s = new UsersStore(path);
    expect(() => s.addUser('__admin__', 'tok')).toThrow(/reserved/);
  });

  it('list returns user metadata without hashes', () => {
    const s = new UsersStore(path);
    s.addUser('alice', 'tok');
    const [u] = s.list();
    expect(u.user).toBe('alice');
    expect(u.disabled).toBe(false);
    expect(typeof u.createdAt).toBe('string');
    expect((u as Record<string, unknown>).tokenHash).toBeUndefined();
  });

  it('lookupByToken returns the user for a valid plaintext token', () => {
    const s = new UsersStore(path);
    s.addUser('alice', 'tok-A');
    s.addUser('bob', 'tok-B');
    expect(s.lookupByToken('tok-A')).toEqual({ user: 'alice', disabled: false });
    expect(s.lookupByToken('tok-B')).toEqual({ user: 'bob', disabled: false });
  });

  it('lookupByToken returns null for unknown tokens', () => {
    const s = new UsersStore(path);
    s.addUser('alice', 'tok');
    expect(s.lookupByToken('wrong')).toBeNull();
    expect(s.lookupByToken('')).toBeNull();
  });

  it('lookupByToken reports disabled state', () => {
    const s = new UsersStore(path);
    s.addUser('alice', 'tok');
    s.disable('alice');
    expect(s.lookupByToken('tok')).toEqual({ user: 'alice', disabled: true });
  });

  it('rotate changes the hash and invalidates the old token', () => {
    const s = new UsersStore(path);
    s.addUser('alice', 'old');
    s.rotate('alice', 'new');
    expect(s.lookupByToken('old')).toBeNull();
    expect(s.lookupByToken('new')).toEqual({ user: 'alice', disabled: false });
  });

  it('remove drops the user', () => {
    const s = new UsersStore(path);
    s.addUser('alice', 'tok');
    s.remove('alice');
    expect(s.list()).toEqual([]);
    expect(s.lookupByToken('tok')).toBeNull();
  });

  it('touchLastSeen updates lastSeen and persists', () => {
    const s = new UsersStore(path);
    s.addUser('alice', 'tok');
    s.touchLastSeen('alice');
    const reloaded = new UsersStore(path);
    const u = reloaded.list().find((x) => x.user === 'alice')!;
    expect(typeof u.lastSeen).toBe('string');
  });

  it('reloading from disk preserves all users', () => {
    const s1 = new UsersStore(path);
    s1.addUser('alice', 'tok-A');
    s1.addUser('bob', 'tok-B');
    s1.disable('bob');
    const s2 = new UsersStore(path);
    expect(s2.list().map((u) => u.user).sort()).toEqual(['alice', 'bob']);
    expect(s2.lookupByToken('tok-A')).toEqual({ user: 'alice', disabled: false });
    expect(s2.lookupByToken('tok-B')).toEqual({ user: 'bob', disabled: true });
  });

  it('addAdmin stores the admin token under the reserved __admin__ key', () => {
    const s = new UsersStore(path);
    s.addAdmin('admin-token');
    // not visible in regular list
    expect(s.list().map((u) => u.user)).not.toContain('__admin__');
    // but lookupByToken finds it with a flag
    expect(s.lookupByToken('admin-token')).toEqual({ user: '__admin__', disabled: false });
  });

  it('does not crash if the file exists but is malformed', () => {
    writeFileSync(path, '{not json', { mode: 0o600 });
    const s = new UsersStore(path);
    expect(s.list()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/cli && pnpm vitest run test/agent/users-store.test.ts
```

Expected: FAIL with `Failed to load url ../../src/agent/users-store.ts`.

- [ ] **Step 3: Write the implementation**

Create `packages/cli/src/agent/users-store.ts`:

```typescript
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { hashToken } from './token.ts';

const USERNAME_RE = /^[a-zA-Z0-9_.-]+$/;
const RESERVED_NAMES = new Set(['__admin__']);
const ADMIN_KEY = '__admin__';

interface UserRecord {
  tokenHash: string;
  createdAt: string;
  disabled: boolean;
  lastSeen?: string;
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/cli && pnpm vitest run test/agent/users-store.test.ts
```

Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/agent/users-store.ts packages/cli/test/agent/users-store.test.ts
git commit -m "feat(agent): UsersStore with hashed-token CRUD and lookup"
```

---

## Task 3: v0.1 → v0.2 migration helper (`src/agent/migrate-v01.ts`)

A pure function called once at agent boot, before `buildServer`. If `users.json` is absent and a legacy `PW_AGENT_TOKEN` is provided, it creates a `default` user with that token's hash.

**Files:**
- Create: `packages/cli/src/agent/migrate-v01.ts`
- Test: `packages/cli/test/agent/migrate-v01.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/test/agent/migrate-v01.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrateIfNeeded } from '../../src/agent/migrate-v01.ts';
import { UsersStore } from '../../src/agent/users-store.ts';

describe('migrateIfNeeded', () => {
  let dir: string;
  let path: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pw-migrate-'));
    path = join(dir, 'users.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('creates "default" user when users.json absent + legacy token present', () => {
    const result = migrateIfNeeded({ usersJsonPath: path, legacyToken: 'legacy-tok' });
    expect(result.migrated).toBe(true);
    expect(result.users).toBe(1);
    const s = new UsersStore(path);
    expect(s.lookupByToken('legacy-tok')).toEqual({ user: 'default', disabled: false });
  });

  it('does nothing when users.json already exists', () => {
    writeFileSync(path, '{}', { mode: 0o600 });
    const result = migrateIfNeeded({ usersJsonPath: path, legacyToken: 'legacy-tok' });
    expect(result.migrated).toBe(false);
  });

  it('does nothing when users.json absent + no legacy token', () => {
    const result = migrateIfNeeded({ usersJsonPath: path, legacyToken: undefined });
    expect(result.migrated).toBe(false);
    expect(existsSync(path)).toBe(false);
  });

  it('does nothing when legacy token is empty string', () => {
    const result = migrateIfNeeded({ usersJsonPath: path, legacyToken: '' });
    expect(result.migrated).toBe(false);
    expect(existsSync(path)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/cli && pnpm vitest run test/agent/migrate-v01.test.ts
```

Expected: FAIL with `Failed to load url ../../src/agent/migrate-v01.ts`.

- [ ] **Step 3: Write the implementation**

Create `packages/cli/src/agent/migrate-v01.ts`:

```typescript
import { existsSync } from 'node:fs';
import { UsersStore } from './users-store.ts';

export interface MigrationInput {
  usersJsonPath: string;
  legacyToken: string | undefined;
}

export interface MigrationResult {
  migrated: boolean;
  users: number;
}

/**
 * One-shot v0.1 → v0.2 migration. Run once at agent boot, BEFORE constructing
 * the UsersStore that buildServer consumes.
 *
 * Behavior:
 *   - If users.json already exists, no-op.
 *   - If users.json absent + legacyToken provided, create a `default` user
 *     with that token's hash so existing v0.1 laptops keep authenticating
 *     unchanged.
 *   - If users.json absent + no legacyToken, no-op (admin will need to run
 *     `patchwire-agent user add`).
 */
export function migrateIfNeeded(input: MigrationInput): MigrationResult {
  if (existsSync(input.usersJsonPath)) {
    return { migrated: false, users: 0 };
  }
  if (!input.legacyToken) {
    return { migrated: false, users: 0 };
  }
  const store = new UsersStore(input.usersJsonPath);
  store.addUser('default', input.legacyToken);
  return { migrated: true, users: 1 };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/cli && pnpm vitest run test/agent/migrate-v01.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/agent/migrate-v01.ts packages/cli/test/agent/migrate-v01.test.ts
git commit -m "feat(agent): v0.1 single-token → v0.2 auto-migration to 'default' user"
```

---

## Task 4: Auth refactor — `resolveUserFromHeader`

Add a new exported function that combines header parsing with a `UsersStore.lookupByToken`. Keep the legacy `verifyToken` for backward compatibility (it's used nowhere outside `server.ts` today, but its tests live in the agent test file and removing it would force the server-test changes in this same task).

**Files:**
- Modify: `packages/cli/src/agent/auth.ts`
- Test: `packages/cli/test/agent/auth-multi-user.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/test/agent/auth-multi-user.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveUserFromHeader } from '../../src/agent/auth.ts';
import { UsersStore } from '../../src/agent/users-store.ts';

describe('resolveUserFromHeader', () => {
  let dir: string;
  let store: UsersStore;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pw-auth-'));
    store = new UsersStore(join(dir, 'users.json'));
    store.addUser('alice', 'alice-token');
    store.addUser('bob', 'bob-token');
    store.disable('bob');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns the user for a valid Bearer header', () => {
    expect(resolveUserFromHeader('Bearer alice-token', store))
      .toEqual({ user: 'alice', disabled: false });
  });

  it('returns null for a missing header', () => {
    expect(resolveUserFromHeader(undefined, store)).toBeNull();
  });

  it('returns null for a header without the Bearer prefix', () => {
    expect(resolveUserFromHeader('alice-token', store)).toBeNull();
  });

  it('returns null for an unknown token', () => {
    expect(resolveUserFromHeader('Bearer not-real', store)).toBeNull();
  });

  it('returns user + disabled=true for a disabled user', () => {
    expect(resolveUserFromHeader('Bearer bob-token', store))
      .toEqual({ user: 'bob', disabled: true });
  });

  it('trims surrounding whitespace in the token portion', () => {
    expect(resolveUserFromHeader('Bearer   alice-token  ', store))
      .toEqual({ user: 'alice', disabled: false });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/cli && pnpm vitest run test/agent/auth-multi-user.test.ts
```

Expected: FAIL with `resolveUserFromHeader is not exported`.

- [ ] **Step 3: Modify `src/agent/auth.ts`**

Replace the entire file `packages/cli/src/agent/auth.ts` with:

```typescript
import { timingSafeEqual } from 'node:crypto';
import type { UsersStore, LookupResult } from './users-store.ts';

/**
 * Legacy single-token check. Retained because the migration path may still
 * want to validate the PW_AGENT_TOKEN env at boot. Not used by the server's
 * per-request hook anymore — `resolveUserFromHeader` is.
 */
export function verifyToken(headerValue: string | undefined, expected: string): boolean {
  if (!headerValue || !headerValue.startsWith('Bearer ')) return false;
  const provided = headerValue.slice('Bearer '.length).trim();
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

/**
 * Parse a Bearer header and look the token up in the UsersStore. Returns
 * the user + disabled flag on match, or null if the header is missing,
 * malformed, or the token does not correspond to any known user.
 *
 * The auth hook in server.ts uses this and maps:
 *   - null            → 401 unauthorized
 *   - { disabled: true } → 403 user disabled
 *   - { disabled: false} → continue, decorate req.username
 */
export function resolveUserFromHeader(
  headerValue: string | undefined,
  store: UsersStore,
): LookupResult | null {
  if (!headerValue || !headerValue.startsWith('Bearer ')) return null;
  const provided = headerValue.slice('Bearer '.length).trim();
  if (!provided) return null;
  return store.lookupByToken(provided);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/cli && pnpm vitest run test/agent/auth-multi-user.test.ts test/agent/users-store.test.ts test/agent/token.test.ts
```

Expected: All three files PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/agent/auth.ts packages/cli/test/agent/auth-multi-user.test.ts
git commit -m "feat(agent): add resolveUserFromHeader against UsersStore"
```

---

## Task 5: Server wiring — UsersStore + per-user auth hook + `/me`

Replace `opts.token` with `opts.usersStore` in `AgentOptions`. The auth hook calls `resolveUserFromHeader`, maps null→401, disabled→403, success→decorate `req.username` and call `usersStore.touchLastSeen`. Add a `GET /me` route. Update `test/agent.test.ts` to construct a `UsersStore` instead of passing a raw token.

**Files:**
- Modify: `packages/cli/src/agent/server.ts`
- Modify: `packages/cli/test/agent.test.ts`

- [ ] **Step 1: Write the failing `/me` + auth tests**

Append to `packages/cli/test/agent/auth-multi-user.test.ts`:

```typescript
import { buildServer } from '../../src/agent/server.ts';

describe('server auth hook (multi-user)', () => {
  let dir: string;
  let projectsRoot: string;
  let store: UsersStore;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pw-srv-auth-'));
    projectsRoot = join(dir, 'projects');
    store = new UsersStore(join(dir, 'users.json'));
    store.addUser('alice', 'alice-token');
    store.addUser('bob', 'bob-token');
    store.disable('bob');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function app() {
    return buildServer({
      usersStore: store,
      projectsRoot,
      aiCommand: 'sh',
      aiArgs: [],
      timeoutSec: 5,
      version: 'x',
    });
  }

  it('GET /health is unauthenticated', async () => {
    const a = app();
    const res = await a.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    await a.close();
  });

  it('GET /me returns 401 with no token', async () => {
    const a = app();
    const res = await a.inject({ method: 'GET', url: '/me' });
    expect(res.statusCode).toBe(401);
    await a.close();
  });

  it('GET /me returns 401 for an unknown token', async () => {
    const a = app();
    const res = await a.inject({
      method: 'GET', url: '/me',
      headers: { authorization: 'Bearer not-real' },
    });
    expect(res.statusCode).toBe(401);
    await a.close();
  });

  it('GET /me returns 403 for a disabled user', async () => {
    const a = app();
    const res = await a.inject({
      method: 'GET', url: '/me',
      headers: { authorization: 'Bearer bob-token' },
    });
    expect(res.statusCode).toBe(403);
    await a.close();
  });

  it('GET /me returns the username and createdAt for a valid user', async () => {
    const a = app();
    const res = await a.inject({
      method: 'GET', url: '/me',
      headers: { authorization: 'Bearer alice-token' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { user: string; createdAt: string; disabled: boolean };
    expect(body.user).toBe('alice');
    expect(body.disabled).toBe(false);
    expect(typeof body.createdAt).toBe('string');
    await a.close();
  });

  it('successful request updates lastSeen on the user', async () => {
    const a = app();
    const before = store.list().find((u) => u.user === 'alice')!.lastSeen;
    expect(before).toBeUndefined();
    await a.inject({
      method: 'GET', url: '/me',
      headers: { authorization: 'Bearer alice-token' },
    });
    const after = store.list().find((u) => u.user === 'alice')!.lastSeen;
    expect(typeof after).toBe('string');
    await a.close();
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

```bash
cd packages/cli && pnpm vitest run test/agent/auth-multi-user.test.ts
```

Expected: the new `server auth hook (multi-user)` block FAILs because `buildServer` still requires `token`, not `usersStore`.

- [ ] **Step 3: Modify `src/agent/server.ts`**

Apply these edits to `packages/cli/src/agent/server.ts`:

1. Add imports at the top:

```typescript
import type { UsersStore } from './users-store.ts';
import { resolveUserFromHeader } from './auth.ts';
```

Remove the existing `import { verifyToken } from './auth.ts';` (not used after this change).

2. Replace the `AgentOptions` interface:

```typescript
export interface AgentOptions {
  usersStore: UsersStore;
  projectsRoot: string;
  aiCommand: string;
  aiArgs: string[];
  timeoutSec: number;
  version: string;
  /** Path to the persistent session-store JSON. Defaults to `~/.patchwire/agent-sessions.json`. */
  sessionStorePath?: string;
}
```

3. Add a Fastify type augmentation just below the imports so `req.username` typechecks:

```typescript
declare module 'fastify' {
  interface FastifyRequest {
    username?: string;
  }
}
```

4. Replace the auth hook (currently `app.addHook('onRequest', ...)`) with:

```typescript
  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/health') return;
    const result = resolveUserFromHeader(req.headers.authorization, opts.usersStore);
    if (!result) {
      reply.code(401).send({ error: 'unauthorized' });
      return;
    }
    if (result.disabled) {
      reply.code(403).send({ error: 'user disabled' });
      return;
    }
    req.username = result.user;
    opts.usersStore.touchLastSeen(result.user);
  });
```

5. Add the `/me` route immediately after `app.get('/health', ...)`:

```typescript
  app.get('/me', async (req) => {
    const name = req.username!;
    const summary = opts.usersStore.list().find((u) => u.user === name);
    // Admin lookups won't appear in `list()`; surface a minimal record.
    if (!summary) {
      return { user: name, disabled: false };
    }
    return summary;
  });
```

- [ ] **Step 4: Update `test/agent.test.ts` to use UsersStore**

Apply these edits to `packages/cli/test/agent.test.ts`:

1. Add the import at the top of the file, immediately below `import { buildServer } from '../src/agent/server.ts';`:

```typescript
import { UsersStore } from '../src/agent/users-store.ts';
```

2. Inside the top-level `describe('agent server', () => { ... })`, add a helper just below the existing `beforeEach`/`afterEach` hooks:

```typescript
  function makeStore(): UsersStore {
    const s = new UsersStore(join(projectsRoot, 'users.json'));
    s.addUser('tester', TOKEN);
    return s;
  }
```

3. In every `buildServer({...})` call inside this file (there are 7), replace the line `token: TOKEN,` with `usersStore: makeStore(),`. The `TOKEN` constant itself stays — tests still send `Authorization: Bearer ${TOKEN}` in request headers, and `makeStore` registers it against user `tester` so the lookup succeeds.

4. No assertion changes needed: the `'rejects /ask without bearer token'` test still expects 401 (new auth hook returns 401 for missing tokens), and the project-resolution tests still pass because `TOKEN` is registered.

- [ ] **Step 5: Run all agent tests**

```bash
cd packages/cli && pnpm vitest run test/agent.test.ts test/agent/
```

Expected: all PASS. The original 7 `/ask` tests still pass with the new `UsersStore`-backed server, and the new `/me` tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/agent/server.ts packages/cli/test/agent.test.ts packages/cli/test/agent/auth-multi-user.test.ts
git commit -m "feat(agent): per-user auth hook, /me endpoint, UsersStore in AgentOptions"
```

---

## Task 6: Agent boot wiring (`src/agent.ts`)

`runServe()` now constructs a `UsersStore`, runs `migrateIfNeeded`, and passes the store into `buildServer`. The `PW_AGENT_TOKEN` env becomes legacy-only: it's used solely as the seed for migration. After migration, the agent looks at the populated store. If the store is empty, the agent logs a warning telling the admin to run `patchwire-agent user add`.

**Files:**
- Modify: `packages/cli/src/agent.ts`

- [ ] **Step 1: Modify `src/agent.ts`**

Apply these edits to `packages/cli/src/agent.ts`. Only the boot/serve plumbing changes here — the `user` subcommand registration is wired up in Task 7 to keep this task self-contained and compilable on its own.

1. Replace the imports block at the top:

```typescript
import { Command } from 'commander';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from './agent/server.ts';
import { UsersStore } from './agent/users-store.ts';
import { migrateIfNeeded } from './agent/migrate-v01.ts';
import { tryDisableKeychainAutoLock } from './agent/keychain.ts';
import { runDaemonInstall, runDaemonUninstall } from './commands/daemon.ts';
```

2. Replace the `runServe()` function with:

```typescript
async function runServe(): Promise<void> {
  const projectsRoot = envRequired('PW_PROJECTS_ROOT');
  const host = process.env.PW_AGENT_HOST ?? '127.0.0.1';
  const port = Number(process.env.PW_AGENT_PORT ?? 7878);
  const aiCommand = process.env.PW_AI_BIN ?? 'claude';
  const aiArgs = (process.env.PW_AI_ARGS ?? '--print').split(/\s+/).filter(Boolean);
  const timeoutSec = Number(process.env.PW_TIMEOUT_SEC ?? 600);

  const usersJsonPath = process.env.PW_USERS_FILE ?? join(homedir(), '.patchwire', 'users.json');
  const legacyToken = process.env.PW_AGENT_TOKEN;

  const migration = migrateIfNeeded({ usersJsonPath, legacyToken });
  const usersStore = new UsersStore(usersJsonPath);

  const app = buildServer({
    usersStore,
    projectsRoot,
    aiCommand,
    aiArgs,
    timeoutSec,
    version: VERSION,
  });

  if (migration.migrated) {
    app.log.info(`migrated v0.1 → v0.2: created 'default' user from PW_AGENT_TOKEN`);
  }
  if (usersStore.list().length === 0) {
    app.log.warn(
      'no users registered — agent will 401 every request. ' +
      'Run: patchwire-agent user add <name>',
    );
  }

  const kc = tryDisableKeychainAutoLock();
  if (kc.ok && process.platform === 'darwin') {
    app.log.info('login keychain auto-lock disabled');
  } else if (!kc.ok) {
    app.log.warn(`could not adjust login keychain settings: ${kc.reason ?? 'unknown'}`);
  }

  try {
    const addr = await app.listen({ host, port });
    app.log.info(`patchwire-agent listening on ${addr}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
```

The key changes vs. v0.1: `PW_AGENT_TOKEN` is no longer required (it was the first `envRequired`); migration runs before the store is opened; the store is what `buildServer` consumes.

- [ ] **Step 2: Run a typecheck**

```bash
cd packages/cli && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Sanity-run the agent against a tmp users.json with the legacy token**

```bash
cd packages/cli && PW_AGENT_TOKEN=legacy-tok \
  PW_USERS_FILE=/tmp/pw-boot-test-users.json \
  PW_PROJECTS_ROOT=/tmp \
  PW_AGENT_PORT=17878 \
  pnpm dev:agent &
sleep 1
curl -s http://127.0.0.1:17878/me -H "Authorization: Bearer legacy-tok" ; echo
kill %1
rm -f /tmp/pw-boot-test-users.json
```

Expected output: `{"user":"default","createdAt":"...","disabled":false}`.

(Tester: the user runs this manually if `curl`/process-spawning is not approved; skip if blocked.)

- [ ] **Step 4: Run all tests**

```bash
cd packages/cli && pnpm test
```

Expected: all PASS (no test changes in this task, only `agent.ts` edits).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/agent.ts
git commit -m "feat(agent): wire UsersStore + v0.1 migration into runServe"
```

---

## Task 7: `patchwire-agent user` subcommands

Add a single `src/commands/user.ts` file that exports `registerUserCommands(program: Command)`, mounting `user add`, `user list`, `user disable`, `user enable`, `user rm`, `user rotate`. Each handler opens a `UsersStore` against `~/.patchwire/users.json` (or `PW_USERS_FILE`) and prints results to stdout.

**Files:**
- Create: `packages/cli/src/commands/user.ts`
- Modify: `packages/cli/src/agent.ts` (register the subcommand)
- Test: `packages/cli/test/commands/user.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/test/commands/user.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { registerUserCommands } from '../../src/commands/user.ts';
import { UsersStore } from '../../src/agent/users-store.ts';

describe('patchwire-agent user', () => {
  let dir: string;
  let usersJson: string;
  let logs: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pw-user-cmd-'));
    usersJson = join(dir, 'users.json');
    process.env.PW_USERS_FILE = usersJson;
    logs = [];
    logSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      logs.push(String(chunk));
      return true;
    });
  });
  afterEach(() => {
    logSpy.mockRestore();
    delete process.env.PW_USERS_FILE;
    rmSync(dir, { recursive: true, force: true });
  });

  function run(argv: string[]): Promise<void> {
    const program = new Command();
    program.exitOverride(); // throw instead of process.exit on errors
    registerUserCommands(program);
    return program.parseAsync(['node', 'patchwire-agent', ...argv]);
  }

  it('add creates a user and prints the token once', async () => {
    await run(['user', 'add', 'alice']);
    const out = logs.join('');
    expect(out).toMatch(/Created user: alice/);
    expect(out).toMatch(/[0-9a-f]{64}/);
    const store = new UsersStore(usersJson);
    expect(store.list().map((u) => u.user)).toEqual(['alice']);
  });

  it('add --token uses a caller-supplied token', async () => {
    await run(['user', 'add', 'alice', '--token', 'my-explicit-token']);
    const store = new UsersStore(usersJson);
    expect(store.lookupByToken('my-explicit-token')).toEqual({ user: 'alice', disabled: false });
  });

  it('list prints all users with status', async () => {
    await run(['user', 'add', 'alice']);
    logs.length = 0;
    await run(['user', 'add', 'bob']);
    logs.length = 0;
    await run(['user', 'disable', 'bob']);
    logs.length = 0;
    await run(['user', 'list']);
    const out = logs.join('');
    expect(out).toMatch(/alice.*active/i);
    expect(out).toMatch(/bob.*disabled/i);
  });

  it('disable then enable toggles status', async () => {
    await run(['user', 'add', 'alice']);
    await run(['user', 'disable', 'alice']);
    let store = new UsersStore(usersJson);
    expect(store.list()[0].disabled).toBe(true);
    await run(['user', 'enable', 'alice']);
    store = new UsersStore(usersJson);
    expect(store.list()[0].disabled).toBe(false);
  });

  it('rm drops the user', async () => {
    await run(['user', 'add', 'alice']);
    await run(['user', 'rm', 'alice']);
    const store = new UsersStore(usersJson);
    expect(store.list()).toEqual([]);
  });

  it('rotate replaces the token and prints the new one', async () => {
    await run(['user', 'add', 'alice', '--token', 'old-tok']);
    logs.length = 0;
    await run(['user', 'rotate', 'alice']);
    const out = logs.join('');
    expect(out).toMatch(/Rotated token for alice/);
    expect(out).toMatch(/[0-9a-f]{64}/);
    const store = new UsersStore(usersJson);
    expect(store.lookupByToken('old-tok')).toBeNull();
  });

  it('add rejects an existing username with a useful error', async () => {
    await run(['user', 'add', 'alice']);
    await expect(run(['user', 'add', 'alice'])).rejects.toThrow(/already exists/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/cli && pnpm vitest run test/commands/user.test.ts
```

Expected: FAIL with `Failed to load url ../../src/commands/user.ts`.

- [ ] **Step 3: Create `src/commands/user.ts`**

```typescript
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Command } from 'commander';
import { UsersStore } from '../agent/users-store.ts';
import { generateToken } from '../agent/token.ts';

function usersJsonPath(): string {
  return process.env.PW_USERS_FILE ?? join(homedir(), '.patchwire', 'users.json');
}

function openStore(): UsersStore {
  return new UsersStore(usersJsonPath());
}

function printToken(user: string, token: string): void {
  process.stdout.write(
    `Created user: ${user}\n` +
      `Token (save this — it will not be shown again):\n  ${token}\n\n` +
      `To register on the laptop, add to ~/.patchwire/env:\n` +
      `  PW_TOKEN=${token}\n`,
  );
}

export function registerUserCommands(program: Command): void {
  const user = program.command('user').description('Manage agent users (multi-developer mode)');

  user
    .command('add <name>')
    .description('Create a new user; prints the generated token once.')
    .option('--token <value>', 'use a caller-supplied token instead of generating one')
    .action((name: string, opts: { token?: string }) => {
      const token = opts.token ?? generateToken();
      const store = openStore();
      store.addUser(name, token);
      printToken(name, token);
    });

  user
    .command('list')
    .description('List all users with their status.')
    .action(() => {
      const store = openStore();
      const rows = store.list();
      if (rows.length === 0) {
        process.stdout.write('(no users)\n');
        return;
      }
      const lines = rows.map((u) => {
        const status = u.disabled ? 'disabled' : 'active';
        const seen = u.lastSeen ?? 'never';
        return `${u.user}\t${status}\tcreated=${u.createdAt}\tlast_seen=${seen}`;
      });
      process.stdout.write(lines.join('\n') + '\n');
    });

  user
    .command('disable <name>')
    .description('Disable a user (token continues to resolve but every request 403s).')
    .action((name: string) => {
      openStore().disable(name);
      process.stdout.write(`Disabled user: ${name}\n`);
    });

  user
    .command('enable <name>')
    .description('Re-enable a previously disabled user.')
    .action((name: string) => {
      openStore().enable(name);
      process.stdout.write(`Enabled user: ${name}\n`);
    });

  user
    .command('rm <name>')
    .description('Permanently remove a user. Their token stops working immediately.')
    .action((name: string) => {
      openStore().remove(name);
      process.stdout.write(`Removed user: ${name}\n`);
    });

  user
    .command('rotate <name>')
    .description("Generate a new token for an existing user; old token dies immediately.")
    .option('--token <value>', 'use a caller-supplied token instead of generating one')
    .action((name: string, opts: { token?: string }) => {
      const token = opts.token ?? generateToken();
      openStore().rotate(name, token);
      process.stdout.write(
        `Rotated token for ${name}\n` +
          `New token (save it):\n  ${token}\n`,
      );
    });
}
```

- [ ] **Step 4: Wire it into `src/agent.ts`**

In `packages/cli/src/agent.ts`, add the import:

```typescript
import { registerUserCommands } from './commands/user.ts';
```

Below the `program.command('uninstall')...` block, register:

```typescript
registerUserCommands(program);
```

- [ ] **Step 5: Run the tests**

```bash
cd packages/cli && pnpm vitest run test/commands/user.test.ts && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Smoke-run the CLI**

```bash
cd packages/cli && PW_USERS_FILE=/tmp/pw-smoke-users.json \
  pnpm dev:agent user add alice && \
  PW_USERS_FILE=/tmp/pw-smoke-users.json \
  pnpm dev:agent user list && \
  rm /tmp/pw-smoke-users.json
```

Expected: prints "Created user: alice" + a hex token, then "alice\tactive\tcreated=...\tlast_seen=never".

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/commands/user.ts packages/cli/src/agent.ts packages/cli/test/commands/user.test.ts
git commit -m "feat(agent): patchwire-agent user add|list|disable|enable|rm|rotate"
```

---

## Task 8: Laptop `whoami` — client + command

Add an `AgentClient.whoami()` method, a `WhoamiResponse` type, and a new `patchwire whoami` command. The command prints `<user> (created <date>, last seen <date>)` to stdout.

**Files:**
- Modify: `packages/cli/src/lib/client.ts`
- Create: `packages/cli/src/commands/whoami.ts`
- Modify: `packages/cli/src/cli.ts`
- Test: `packages/cli/test/commands/whoami.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/cli/test/commands/whoami.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../../src/agent/server.ts';
import { UsersStore } from '../../src/agent/users-store.ts';
import { runWhoami } from '../../src/commands/whoami.ts';

describe('patchwire whoami', () => {
  let dir: string;
  let projectsRoot: string;
  let cwd: string;
  let port: number;
  let app: ReturnType<typeof buildServer>;
  let logs: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'pw-whoami-'));
    projectsRoot = join(dir, 'projects');
    cwd = join(dir, 'proj');
    mkdirSync(cwd, { recursive: true });
    const store = new UsersStore(join(dir, 'users.json'));
    store.addUser('alice', 'alice-token');
    app = buildServer({
      usersStore: store, projectsRoot,
      aiCommand: 'sh', aiArgs: [], timeoutSec: 5, version: '0-test',
    });
    const addr = await app.listen({ host: '127.0.0.1', port: 0 });
    port = Number(addr.split(':').pop());
    writeFileSync(
      join(cwd, 'patchwire.yml'),
      [
        'project: demo',
        'remote:',
        '  host: 127.0.0.1',
        '  user: nobody',
        '  path: /tmp/demo',
        `  agentUrl: http://127.0.0.1:${port}`,
        '  token: alice-token',
      ].join('\n'),
    );
    logs = [];
    logSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      logs.push(String(chunk));
      return true;
    });
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('prints the authenticated username', async () => {
    await runWhoami(cwd);
    expect(logs.join('')).toMatch(/^alice\b/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd packages/cli && pnpm vitest run test/commands/whoami.test.ts
```

Expected: FAIL with `Failed to load url ../../src/commands/whoami.ts`.

- [ ] **Step 3: Add the client method**

Apply this edit to `packages/cli/src/lib/client.ts`:

1. Add to the exported types near `HealthResponse`:

```typescript
export interface WhoamiResponse {
  user: string;
  createdAt?: string;
  disabled: boolean;
  lastSeen?: string;
}
```

2. Add the `whoami()` method on `AgentClient` (right after `health()`):

```typescript
  async whoami(): Promise<WhoamiResponse> {
    const res = await request(`${this.cfg.remote.agentUrl}/me`, {
      method: 'GET',
      headers: this.headers(),
    });
    if (res.statusCode !== 200) {
      const text = await res.body.text();
      throw new Error(`Agent /me returned ${res.statusCode}: ${text}`);
    }
    return (await res.body.json()) as WhoamiResponse;
  }
```

- [ ] **Step 4: Create `src/commands/whoami.ts`**

```typescript
import { loadConfig } from '../lib/config.ts';
import { AgentClient } from '../lib/client.ts';

export async function runWhoami(cwd: string): Promise<void> {
  const cfg = await loadConfig(cwd);
  const client = new AgentClient(cfg);
  const me = await client.whoami();
  const created = me.createdAt ? `created ${me.createdAt}` : 'no created date';
  const seen = me.lastSeen ? `last seen ${me.lastSeen}` : 'never seen before';
  const status = me.disabled ? ' [DISABLED]' : '';
  process.stdout.write(`${me.user}${status} (${created}, ${seen})\n`);
}
```

- [ ] **Step 5: Register the CLI command**

In `packages/cli/src/cli.ts`, just before `program.parseAsync(process.argv)...`, add:

```typescript
program
  .command('whoami')
  .description('Show which user the agent recognizes you as')
  .action(async () => {
    const { runWhoami } = await import('./commands/whoami.ts');
    await runWhoami(process.cwd());
  });
```

- [ ] **Step 6: Run all relevant tests**

```bash
cd packages/cli && pnpm vitest run test/commands/whoami.test.ts && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/lib/client.ts packages/cli/src/commands/whoami.ts packages/cli/src/cli.ts packages/cli/test/commands/whoami.test.ts
git commit -m "feat(cli): patchwire whoami + AgentClient.whoami() against /me"
```

---

## Task 9: End-to-end multi-user integration test

Spin up `buildServer` with two real users, hit `/me` with each token, and confirm both work in parallel. Also confirm the `verifyToken` legacy export still works (no behavior change).

**Files:**
- Create: `packages/cli/test/integration/multi-user.e2e.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../../src/agent/server.ts';
import { UsersStore } from '../../src/agent/users-store.ts';

describe('multi-user end-to-end', () => {
  let dir: string;
  let app: ReturnType<typeof buildServer>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'pw-mu-e2e-'));
    const store = new UsersStore(join(dir, 'users.json'));
    store.addUser('alice', 'alice-token');
    store.addUser('bob', 'bob-token');
    app = buildServer({
      usersStore: store, projectsRoot: dir,
      aiCommand: 'sh', aiArgs: [], timeoutSec: 5, version: 'e2e',
    });
  });
  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('two users hitting /me in parallel both succeed with their own identity', async () => {
    const [a, b] = await Promise.all([
      app.inject({ method: 'GET', url: '/me', headers: { authorization: 'Bearer alice-token' } }),
      app.inject({ method: 'GET', url: '/me', headers: { authorization: 'Bearer bob-token' } }),
    ]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect((a.json() as { user: string }).user).toBe('alice');
    expect((b.json() as { user: string }).user).toBe('bob');
  });

  it('a third unknown token gets 401', async () => {
    const r = await app.inject({
      method: 'GET', url: '/me', headers: { authorization: 'Bearer nope' },
    });
    expect(r.statusCode).toBe(401);
  });

  it('/health remains unauthenticated', async () => {
    const r = await app.inject({ method: 'GET', url: '/health' });
    expect(r.statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: Run it**

```bash
cd packages/cli && pnpm vitest run test/integration/multi-user.e2e.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 3: Run the full suite**

```bash
cd packages/cli && pnpm test && pnpm typecheck && pnpm build
```

Expected: all PASS, no type errors, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/test/integration/multi-user.e2e.test.ts
git commit -m "test(agent): multi-user end-to-end (/me, 401, /health unauthed)"
```

---

## Task 10: Documentation refresh

Update the website docs that describe the single-token model so they reflect phase 1 reality. This is the minimum doc surface that would otherwise mislead an existing user upgrading.

**Files:**
- Modify: `packages/website/src/content/docs/security.md` (token-handling section)
- Modify: `packages/website/src/content/docs/configuration.md` (env vars section — confirm `PW_AGENT_TOKEN` is now legacy / optional)
- Modify: `packages/website/src/content/docs/agent.md` (mention `patchwire-agent user` subcommand)

- [ ] **Step 1: Read each file first**

```bash
cat packages/website/src/content/docs/security.md
cat packages/website/src/content/docs/configuration.md
cat packages/website/src/content/docs/agent.md
```

- [ ] **Step 2: Add a phase-1 note to `security.md`**

Just below the existing "Token handling" section, insert:

```markdown
## Per-user tokens (v0.2+)

The agent now supports multiple developers via per-user bearer tokens:

- `patchwire-agent user add <name>` generates a 256-bit token and prints it once.
- Tokens are stored hashed (SHA-256) in `~/.patchwire/users.json`; plaintext is never persisted on the agent.
- A laptop authenticates by putting `PW_TOKEN=<the-token>` in `~/.patchwire/env`.
- `patchwire-agent user rotate <name>` invalidates the old token immediately.

A v0.1 install upgrades transparently: on first v0.2 agent start, if `PW_AGENT_TOKEN`
is set and `users.json` does not exist, a `default` user is created with that token's
hash. Existing laptops keep working with no config change.
```

- [ ] **Step 3: Update `configuration.md`**

Find the row/line documenting `PW_AGENT_TOKEN` and replace it with:

```markdown
- `PW_AGENT_TOKEN` — **legacy.** Used only at first boot to auto-migrate to a
  per-user `default` user. After migration, manage users with
  `patchwire-agent user add|list|rotate|disable|rm`.
- `PW_USERS_FILE` — path to the agent's users JSON (default: `~/.patchwire/users.json`).
```

- [ ] **Step 4: Update `agent.md`**

Find any reference to the bearer-token bootstrap and add a paragraph:

```markdown
### Adding more developers

The agent supports multiple developers. Each gets their own token:

```bash
patchwire-agent user add alice
# → prints a hex token, copy it to Alice's ~/.patchwire/env as PW_TOKEN

patchwire-agent user list       # see who's registered
patchwire-agent user rotate bob # invalidate Bob's old token, issue a new one
patchwire-agent user disable carol  # carol's requests now get 403, no delete
```

Tokens are stored hashed in `~/.patchwire/users.json`; the plaintext is shown
to you exactly once.
```

- [ ] **Step 5: Build the website to confirm no markdown errors**

```bash
cd packages/website && pnpm build
```

Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/website/src/content/docs/security.md packages/website/src/content/docs/configuration.md packages/website/src/content/docs/agent.md
git commit -m "docs: per-user tokens (v0.2 phase 1)"
```

---

## Final verification

- [ ] **Step 1: Run the whole pipeline**

```bash
cd packages/cli && pnpm verify
```

Expected: typecheck, tests, build, smoke all pass.

- [ ] **Step 2: Confirm no behavior regression for v0.1 callers**

```bash
cd packages/cli && PW_AGENT_TOKEN=legacy-tok \
  PW_USERS_FILE=/tmp/pw-final-users.json \
  PW_PROJECTS_ROOT=/tmp \
  PW_AGENT_PORT=17979 \
  pnpm dev:agent &
sleep 1
# Old laptop still works with the legacy token (now mapped to "default" user)
curl -s -H "Authorization: Bearer legacy-tok" http://127.0.0.1:17979/me ; echo
# Unknown token gets 401
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer nope" http://127.0.0.1:17979/me
kill %1
rm -f /tmp/pw-final-users.json
```

Expected output:
```
{"user":"default","createdAt":"...","disabled":false}
401
```

- [ ] **Step 3: Tag the milestone**

```bash
git tag -a v0.2.0-phase1 -m "Phase 1: identity layer (users.json, per-user tokens, /me, migration)"
```

---

## Spec coverage check

| Spec requirement | Covered by |
|---|---|
| `users.json` at `~/.patchwire/users.json` | Task 2 (UsersStore), Task 6 (boot wiring) |
| SHA-256 hashed tokens, no plaintext | Task 1 (hashToken), Task 2 (test asserts file doesn't contain plaintext) |
| Reserved `__admin__` entry | Task 2 (addAdmin, reserved name) — admin token *bootstrap* itself ships in phase 6 |
| Constant-time compare | Task 2 (`timingSafeEqual` per entry) |
| Username regex `[a-zA-Z0-9_.-]+` | Task 2 (`USERNAME_RE`) |
| `patchwire-agent user add/list/disable/enable/rm/rotate` | Task 7 |
| `GET /me` returns user + state | Task 5 |
| 401 unknown token / 403 disabled user | Task 5 (auth hook) |
| v0.1 → v0.2 auto-migration to `default` user | Task 3 (helper), Task 6 (boot calls it) |
| `--multi-user` install flag | Deferred — the install wizard touches `daemon.ts` which is shared with the launchd plist; sequencing a flag change is cleaner in phase 2 when `PW_USERS_FILE` is also being threaded into the plist. Noted in the design's section 10 but not gating phase 1. |
| Laptop `whoami` UX | Task 8 |
| Docs reflect per-user model | Task 10 |
