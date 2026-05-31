import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { newSessionId } from '../lib/session-id.ts';

interface PersistedMap { [extensionUuid: string]: string }

export class SessionStore {
  private map: PersistedMap = {};
  constructor(private readonly path: string) {
    if (existsSync(path)) {
      try { this.map = JSON.parse(readFileSync(path, 'utf8')); } catch { this.map = {}; }
    } else {
      mkdirSync(dirname(path), { recursive: true });
    }
  }

  async getOrCreate(uuid: string): Promise<string> {
    if (this.map[uuid]) return this.map[uuid];
    const claudeId = newSessionId();
    this.map[uuid] = claudeId;
    this.persist();
    return claudeId;
  }

  async delete(uuid: string): Promise<void> {
    delete this.map[uuid];
    this.persist();
  }

  async get(uuid: string): Promise<string | undefined> {
    return this.map[uuid];
  }

  private persist(): void {
    writeFileSync(this.path, JSON.stringify(this.map, null, 2), { mode: 0o600 });
  }
}
