import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, unlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ChangedFile } from '../cli/events.ts';

export interface ChatSummary { id: string; title: string; createdAt: number; lastActivity: number }
export interface Turn {
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: number;
  patch?: string | null;
  files?: ChangedFile[];
  applied?: boolean;
  rejected?: boolean;
  saved?: boolean;
}

export class ChatStore {
  private indexPath: string;
  private index: ChatSummary[] = [];
  public readonly root: string;

  constructor(root: string) {
    this.root = root;
    mkdirSync(root, { recursive: true });
    this.indexPath = join(root, 'index.json');
    if (existsSync(this.indexPath)) {
      try { this.index = JSON.parse(readFileSync(this.indexPath, 'utf8')); }
      catch { this.index = []; }
    }
  }

  listChats(): ChatSummary[] { return [...this.index].sort((a, b) => b.lastActivity - a.lastActivity); }

  createChat(title: string): string {
    const id = randomUUID();
    const now = Date.now();
    this.index.push({ id, title, createdAt: now, lastActivity: now });
    this.persistIndex();
    writeFileSync(this.transcriptPath(id), '');
    return id;
  }

  deleteChat(id: string): void {
    this.index = this.index.filter((c) => c.id !== id);
    this.persistIndex();
    const p = this.transcriptPath(id);
    if (existsSync(p)) unlinkSync(p);
    const dir = join(this.root, id);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }

  appendTurn(id: string, turn: Turn): void {
    appendFileSync(this.transcriptPath(id), JSON.stringify(turn) + '\n');
    const c = this.index.find((x) => x.id === id);
    if (c) { c.lastActivity = Date.now(); this.persistIndex(); }
  }

  rewriteTranscript(id: string, turns: Turn[]): void {
    writeFileSync(this.transcriptPath(id), turns.map((t) => JSON.stringify(t)).join('\n') + (turns.length ? '\n' : ''));
  }

  loadTranscript(id: string): Turn[] {
    const p = this.transcriptPath(id);
    if (!existsSync(p)) return [];
    const out: Turn[] = [];
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      if (!line) continue;
      try { out.push(JSON.parse(line) as Turn); }
      catch { /* skip malformed line — e.g., half-written entry */ }
    }
    return out;
  }

  savePatch(id: string, turnIndex: number, patch: string): string {
    const dir = join(this.root, id);
    mkdirSync(dir, { recursive: true });
    const p = join(dir, `turn-${turnIndex}.patch`);
    writeFileSync(p, patch);
    return p;
  }

  transcriptPath(id: string): string { return join(this.root, `${id}.jsonl`); }
  private persistIndex(): void { writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2)); }
}
