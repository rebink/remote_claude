import { h, clear } from './h.ts';

declare const acquireVsCodeApi: () => { postMessage: (m: unknown) => void };
const vscode = acquireVsCodeApi();

interface ChatSummary { id: string; title: string }
interface ChangedFile { path: string; status: string; additions: number; deletions: number }
interface Turn {
  role: 'user' | 'assistant' | 'system';
  text: string;
  patch?: string | null;
  files?: ChangedFile[];
  applied?: boolean;
  rejected?: boolean;
  saved?: boolean;
}
interface State { chats: ChatSummary[]; activeChatId?: string; turns: Turn[]; inFlight: boolean }

const root = document.getElementById('app')!;
const chatsEl = h('div', { className: 'chat-list', id: 'chats' });
const turnsEl = h('div', { id: 'turns' });
const composerEl = h('div', { id: 'composer' });
root.append(chatsEl, turnsEl, composerEl);

let currentState: State = { chats: [], activeChatId: undefined, turns: [], inFlight: false };

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as { type: string; state?: State };
  if (msg.type === 'state' && msg.state) {
    currentState = msg.state;
    render(currentState);
  }
});

function render(state: State): void {
  renderChatList(state);
  renderTurns(state);
  renderComposer(state);
}

function renderChatList(state: State): void {
  clear(chatsEl);
  for (const c of state.chats) {
    const row = h('div', {
      className: 'chat-item' + (c.id === state.activeChatId ? ' active' : ''),
      events: { click: () => vscode.postMessage({ type: 'switch', id: c.id }) },
    },
      h('span', { className: 'chat-title' }, c.title),
      h('button', {
        className: 'chat-del',
        title: 'Delete chat',
        events: { click: (e: Event) => { e.stopPropagation(); vscode.postMessage({ type: 'deleteChat', id: c.id }); } },
      }, '×'),
    );
    chatsEl.append(row);
  }
  chatsEl.append(h('button', {
    id: 'new-chat',
    events: { click: () => vscode.postMessage({ type: 'newChat' }) },
  }, '+ New chat'));
}

function renderTurns(state: State): void {
  clear(turnsEl);
  state.turns.forEach((t, i) => turnsEl.append(renderTurn(t, i, state.activeChatId!)));
  turnsEl.scrollTop = turnsEl.scrollHeight;
}

function renderTurn(turn: Turn, index: number, chatId: string): HTMLElement {
  if (turn.role === 'user') return h('div', { className: 'turn user' }, '▶ ' + turn.text);
  const wrap = h('div', { className: 'turn assistant' }, turn.text);
  if (turn.applied)     wrap.append(h('div', { className: 'diff-card' }, '✓ Applied'));
  else if (turn.rejected) wrap.append(h('div', { className: 'diff-card' }, '✗ Rejected'));
  else if (turn.saved)    wrap.append(h('div', { className: 'diff-card' }, '💾 Saved'));
  else if (turn.patch && turn.files?.length) wrap.append(renderDiffCard(turn, index, chatId));
  return wrap;
}

function renderDiffCard(turn: Turn, index: number, chatId: string): HTMLElement {
  const card = h('div', { className: 'diff-card' });
  const checkboxes: HTMLInputElement[] = [];

  for (const f of turn.files!) {
    const cb = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
    checkboxes.push(cb);
    const row = h('label', {
      className: 'diff-file',
      events: { click: (e: Event) => {
        if ((e.target as HTMLElement).tagName === 'INPUT') return;
        const fileIndex = turn.files!.indexOf(f);
        vscode.postMessage({ type: 'openDiff', chatId, turn: index, fileIndex });
      }},
    },
      cb,
      h('span', {}, f.status),
      h('span', {}, f.path),
      h('span', {}, `+${f.additions} -${f.deletions}`),
    );
    card.append(row);
  }

  const dispatch = (action: 'apply'|'save'|'reject') => {
    const fileIndices = checkboxes.map((cb, i) => ({ i, on: cb.checked })).filter((x) => x.on).map((x) => x.i);
    vscode.postMessage({ type: 'diffAction', chatId, turn: index, action, fileIndices });
  };

  card.append(h('div', { className: 'diff-actions' },
    h('button', { events: { click: () => dispatch('apply') } }, 'Apply selected'),
    h('button', { className: 'secondary', events: { click: () => dispatch('save') } }, 'Save patch'),
    h('button', { className: 'secondary', events: { click: () => dispatch('reject') } }, 'Reject'),
  ));
  return card;
}

function renderComposer(state: State): void {
  clear(composerEl);
  if (state.inFlight) {
    composerEl.append(h('button', { events: { click: () => vscode.postMessage({ type: 'cancel' }) } }, 'Stop'));
    return;
  }
  const ta = h('textarea', { placeholder: 'Ask Claude…' }) as HTMLTextAreaElement;
  const btn = h('button', {
    events: { click: () => {
      const v = ta.value.trim();
      if (!v) return;
      vscode.postMessage({ type: 'send', prompt: v });
      ta.value = '';
    }},
  }, 'Send');
  composerEl.append(ta, btn);
}

// Touch currentState to avoid noUnusedLocals (it's used inside the message handler closure on assignment).
void currentState;

vscode.postMessage({ type: 'ready' });
