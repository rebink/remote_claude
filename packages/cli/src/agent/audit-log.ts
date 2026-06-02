import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { dirname } from 'node:path';

interface BaseEntry {
  ts: string;
  user: string;
  project: string;
  prompt_sha256: string;
  duration_ms: number;
  queue_wait_ms: number;
}

export interface AskAuditEntry extends BaseEntry {
  route: '/ask';
  files: number;
  lines_added: number;
  lines_removed: number;
  exit_code: number;
}

export interface ChatAuditEntry extends BaseEntry {
  route: '/chat';
  uuid: string;
  tokens_in: number;
  tokens_out: number;
}

export type AuditEntry = AskAuditEntry | ChatAuditEntry;

export interface AuditLog {
  append(entry: AuditEntry): void;
  readAll(): AuditEntry[];
}

export interface JsonlAuditLogOptions {
  path: string;
  maxBytes?: number;
  maxFiles?: number;
}

export class JsonlAuditLog implements AuditLog {
  private readonly path: string;
  private readonly maxBytes: number;
  private readonly maxFiles: number;

  constructor(opts: JsonlAuditLogOptions) {
    this.path = opts.path;
    this.maxBytes = opts.maxBytes ?? 50 * 1024 * 1024;
    this.maxFiles = opts.maxFiles ?? 3;
    mkdirSync(dirname(this.path), { recursive: true });
  }

  append(entry: AuditEntry): void {
    this.rotateIfNeeded();
    appendFileSync(this.path, JSON.stringify(entry) + '\n', { mode: 0o600 });
  }

  readAll(): AuditEntry[] {
    if (!existsSync(this.path)) return [];
    const raw = readFileSync(this.path, 'utf8');
    const out: AuditEntry[] = [];
    for (const line of raw.split('\n')) {
      if (!line) continue;
      try {
        out.push(JSON.parse(line) as AuditEntry);
      } catch {
        // tolerate partial / malformed trailing lines
      }
    }
    return out;
  }

  private rotateIfNeeded(): void {
    if (!existsSync(this.path)) return;
    const size = statSync(this.path).size;
    if (size < this.maxBytes) return;
    // Shift .N → .N+1, dropping anything beyond maxFiles.
    for (let i = this.maxFiles; i >= 1; i--) {
      const src = i === 1 ? this.path : `${this.path}.${i - 1}`;
      const dst = `${this.path}.${i}`;
      if (i === this.maxFiles && existsSync(dst)) {
        // Drop the oldest.
        unlinkSync(dst);
      }
      if (existsSync(src)) {
        renameSync(src, dst);
      }
    }
  }
}

export class NoopAuditLog implements AuditLog {
  append(): void { /* intentional no-op */ }
  readAll(): AuditEntry[] { return []; }
}
