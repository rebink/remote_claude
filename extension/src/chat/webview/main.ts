import { h, clear } from './h.ts';

declare const acquireVsCodeApi: () => { postMessage: (m: unknown) => void };
const vscode = acquireVsCodeApi();

interface ChangedFile {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  conflict?: boolean;
}

interface State {
  configured: boolean;
  project?: string;
  host?: string;
  user?: string;
  remotePath?: string;
  sessionRunning: boolean;
  liveSync: boolean;
  syncing: boolean;
  dirtyCount: number;
  lastSync?: number;
  syncError?: string;
  pulling: boolean;
  applying: boolean;
  pendingFiles: ChangedFile[];
  lastError?: string;
}

const root = document.getElementById('app')!;
let currentState: State = {
  configured: false,
  sessionRunning: false,
  liveSync: false,
  syncing: false,
  dirtyCount: 0,
  pulling: false,
  applying: false,
  pendingFiles: [],
};
let selectedFiles = new Set<string>();

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as { type: string; state?: State };
  if (msg.type === 'state' && msg.state) {
    const previousIds = new Set(currentState.pendingFiles.map((f) => f.path));
    currentState = msg.state;
    // Default-check newly-arrived files (don't clobber user's earlier choices
    // on a re-fetch of the same files).
    for (const f of currentState.pendingFiles) {
      if (!previousIds.has(f.path)) selectedFiles.add(f.path);
    }
    // Drop selections for files no longer in the pending list.
    const stillPending = new Set(currentState.pendingFiles.map((f) => f.path));
    for (const p of [...selectedFiles]) if (!stillPending.has(p)) selectedFiles.delete(p);
    render();
  }
});

function render(): void {
  clear(root);

  if (!currentState.configured) {
    root.append(
      h('div', { className: 'header' }, h('h2', {}, 'Remote Claude')),
      h('p', { className: 'empty' }, 'No remote-claude.yml in this workspace yet.'),
      h('button', { className: 'primary', events: { click: () => vscode.postMessage({ type: 'openSetup' }) } }, 'Run Setup Wizard'),
    );
    return;
  }

  root.append(renderHeader(), renderActions(), renderSync(), renderPending(), renderFooter());
}

function renderHeader(): HTMLElement {
  return h('div', { className: 'header' },
    h('h2', {}, currentState.project ?? 'Remote Claude'),
    h('div', { className: 'subtitle' }, `${currentState.user}@${currentState.host}`),
    h('div', { className: 'subtitle' }, currentState.remotePath ?? ''),
  );
}

function renderActions(): HTMLElement {
  const wrap = h('div', { className: 'actions' });
  wrap.append(
    h('button', {
      className: 'primary',
      events: { click: () => vscode.postMessage({ type: 'openSession' }) },
    }, currentState.sessionRunning ? '⎈ Focus Claude session' : '⎈ Open Claude session'),
    h('button', {
      events: { click: () => vscode.postMessage({ type: 'pullChanges' }) },
    }, currentState.pulling ? 'Fetching…' : '⇣ Pull remote changes'),
  );
  if (currentState.pulling) ((wrap.lastChild) as HTMLButtonElement).disabled = true;
  return wrap;
}

function renderSync(): HTMLElement {
  const wrap = h('div', { className: 'sync-panel' });

  // Status pill
  let label = '';
  let cls = '';
  if (currentState.syncing) {
    label = '⟳ Syncing…';
    cls = 'syncing';
  } else if (currentState.syncError) {
    label = '✗ Sync error';
    cls = 'error';
  } else if (currentState.dirtyCount > 0) {
    label = `${currentState.dirtyCount} file${currentState.dirtyCount === 1 ? '' : 's'} dirty`;
    cls = 'dirty';
  } else if (currentState.lastSync) {
    label = `✓ In sync · ${formatAgo(currentState.lastSync)}`;
    cls = 'clean';
  } else {
    label = 'Not yet synced';
    cls = 'idle';
  }

  wrap.append(
    h('div', { className: 'sync-header' },
      h('span', { className: 'sync-title' }, 'Live sync (laptop → remote)'),
      h('span', { className: `sync-status ${cls}` }, label),
    ),
    h('div', { className: 'sync-actions' },
      h('button', {
        className: currentState.liveSync ? 'toggle on' : 'toggle off',
        events: { click: () => vscode.postMessage({ type: 'toggleLiveSync' }) },
      }, currentState.liveSync ? '● Live sync ON' : '○ Live sync OFF'),
      h('button', {
        events: { click: () => vscode.postMessage({ type: 'syncNow' }) },
      }, currentState.syncing ? 'Syncing…' : '⇡ Sync now'),
    ),
  );
  if (currentState.syncing) ((wrap.querySelector('.sync-actions button:last-child')) as HTMLButtonElement).disabled = true;
  if (currentState.syncError) {
    wrap.append(h('p', { className: 'error' }, currentState.syncError));
  }
  return wrap;
}

function renderPending(): HTMLElement {
  if (currentState.pulling) {
    return h('div', { className: 'pending' }, h('p', { className: 'empty' }, 'Checking remote for changes…'));
  }
  if (!currentState.pendingFiles.length) {
    return h('div', { className: 'pending' },
      h('p', { className: 'empty' },
        'No remote changes pending.',
        h('br', {}),
        h('span', { className: 'hint' }, 'Open the Claude session, edit files, then click Pull.'),
      ),
    );
  }

  const list = h('div', { className: 'file-list' });
  for (const f of currentState.pendingFiles) {
    const cb = h('input', { type: 'checkbox', checked: selectedFiles.has(f.path) }) as HTMLInputElement;
    // Conflicts default to unchecked — explicit opt-in only
    if (f.conflict && !selectedFiles.has(f.path)) {
      cb.checked = false;
      selectedFiles.delete(f.path);
    }
    cb.addEventListener('change', () => {
      if (cb.checked) selectedFiles.add(f.path);
      else selectedFiles.delete(f.path);
    });
    const row = h('label', {
      className: 'file-row' + (f.conflict ? ' conflict' : ''),
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
    if (f.conflict) row.append(h('span', { className: 'conflict-tag', title: 'Also changed locally — review before applying' }, '⚠ conflict'));
    list.append(row);
  }

  const wrap = h('div', { className: 'pending' },
    h('div', { className: 'pending-header' },
      `${currentState.pendingFiles.length} file${currentState.pendingFiles.length === 1 ? '' : 's'} changed on remote`,
    ),
    list,
    h('div', { className: 'pending-actions' },
      h('button', {
        className: 'primary',
        events: { click: () => {
          const paths = Array.from(selectedFiles);
          if (!paths.length) return;
          vscode.postMessage({ type: 'applySelected', paths });
        }},
      }, currentState.applying ? 'Applying…' : 'Apply selected'),
      h('button', { events: { click: () => vscode.postMessage({ type: 'savePatch' }) } }, 'Save patch'),
      h('button', { events: { click: () => vscode.postMessage({ type: 'dismissPending' }) } }, 'Dismiss'),
    ),
  );

  if (currentState.lastError) {
    wrap.append(h('p', { className: 'error' }, currentState.lastError));
  }
  return wrap;
}

function renderFooter(): HTMLElement {
  return h('div', { className: 'footer' },
    h('button', {
      className: 'footer-link',
      events: { click: () => vscode.postMessage({ type: 'viewOutput' }) },
    }, 'Show output'),
    h('button', {
      className: 'footer-link',
      events: { click: () => vscode.postMessage({ type: 'openSetup' }) },
    }, 'Setup wizard'),
  );
}

function formatAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

void currentState;
vscode.postMessage({ type: 'ready' });
