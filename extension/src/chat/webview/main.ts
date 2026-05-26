import { h, clear } from './h.ts';

declare const acquireVsCodeApi: () => { postMessage: (m: unknown) => void };
const vscode = acquireVsCodeApi();

interface ChangedFile { path: string; status: 'modified' | 'added' | 'deleted' | 'renamed'; additions: number; deletions: number }

interface State {
  configured: boolean;
  project?: string;
  host?: string;
  user?: string;
  remotePath?: string;
  sessionRunning: boolean;
  pulling: boolean;
  applying: boolean;
  pendingFiles: ChangedFile[];
  lastError?: string;
}

const root = document.getElementById('app')!;
let currentState: State = { configured: false, sessionRunning: false, pulling: false, applying: false, pendingFiles: [] };
let selectedFiles = new Set<string>();

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as { type: string; state?: State };
  if (msg.type === 'state' && msg.state) {
    currentState = msg.state;
    // Default-select all pending files on each refresh
    selectedFiles = new Set(currentState.pendingFiles.map((f) => f.path));
    render();
  }
});

function render(): void {
  clear(root);

  if (!currentState.configured) {
    root.append(
      h('div', { className: 'header' },
        h('h2', {}, 'Remote Claude'),
      ),
      h('p', { className: 'empty' }, 'No remote-claude.yml in this workspace yet.'),
      h('button', {
        className: 'primary',
        events: { click: () => vscode.postMessage({ type: 'openSetup' }) },
      }, 'Run Setup Wizard'),
    );
    return;
  }

  root.append(renderHeader(), renderActions(), renderPending());
}

function renderHeader(): HTMLElement {
  return h('div', { className: 'header' },
    h('h2', {}, currentState.project ?? 'Remote Claude'),
    h('div', { className: 'subtitle' }, `${currentState.user}@${currentState.host} · ${currentState.remotePath}`),
  );
}

function renderActions(): HTMLElement {
  const wrap = h('div', { className: 'actions' });

  const sessionBtn = h('button', {
    className: 'primary',
    events: { click: () => vscode.postMessage({ type: 'openSession' }) },
  }, currentState.sessionRunning ? '⎈ Focus Claude session' : '⎈ Open Claude session');
  wrap.append(sessionBtn);

  const pullBtn = h('button', {
    events: { click: () => vscode.postMessage({ type: 'pullChanges' }) },
  }, currentState.pulling ? 'Fetching…' : '⇣ Pull remote changes');
  if (currentState.pulling) (pullBtn as HTMLButtonElement).disabled = true;
  wrap.append(pullBtn);

  return wrap;
}

function renderPending(): HTMLElement {
  if (currentState.pulling) {
    return h('p', { className: 'empty' }, 'Checking remote for changes…');
  }
  if (!currentState.pendingFiles.length) {
    return h('p', { className: 'empty' },
      'No remote changes pending.',
      h('br', {}),
      h('span', { className: 'hint' }, 'Open the Claude session and make edits, then come back and Pull.'),
    );
  }

  const list = h('div', { className: 'file-list' });
  for (const f of currentState.pendingFiles) {
    const cb = h('input', { type: 'checkbox', checked: selectedFiles.has(f.path) }) as HTMLInputElement;
    cb.addEventListener('change', () => {
      if (cb.checked) selectedFiles.add(f.path);
      else selectedFiles.delete(f.path);
    });
    const row = h('label', {
      className: 'file-row',
      events: { click: (e: Event) => {
        if ((e.target as HTMLElement).tagName === 'INPUT') return;
        vscode.postMessage({ type: 'openDiff', path: f.path });
      }},
    },
      cb,
      h('span', { className: 'badge ' + f.status }, f.status[0].toUpperCase()),
      h('span', { className: 'path' }, f.path),
      h('span', { className: 'stat' }, `+${f.additions} −${f.deletions}`),
    );
    list.append(row);
  }

  const actionBar = h('div', { className: 'pending-actions' },
    h('button', {
      className: 'primary',
      events: { click: () => {
        const paths = Array.from(selectedFiles);
        if (!paths.length) return;
        vscode.postMessage({ type: 'applySelected', paths });
      }},
    }, currentState.applying ? 'Applying…' : 'Apply selected'),
    h('button', {
      className: 'secondary',
      events: { click: () => vscode.postMessage({ type: 'savePatch' }) },
    }, 'Save patch file'),
    h('button', {
      className: 'secondary',
      events: { click: () => vscode.postMessage({ type: 'dismissPending' }) },
    }, 'Dismiss'),
  );

  const wrap = h('div', { className: 'pending' },
    h('div', { className: 'pending-header' }, `${currentState.pendingFiles.length} file${currentState.pendingFiles.length === 1 ? '' : 's'} changed on remote`),
    list,
    actionBar,
  );

  if (currentState.lastError) {
    wrap.append(h('p', { className: 'error' }, currentState.lastError));
  }
  return wrap;
}

void currentState;
vscode.postMessage({ type: 'ready' });
