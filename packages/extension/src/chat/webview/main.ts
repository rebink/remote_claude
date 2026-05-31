import { h, clear } from './h.ts';

declare const acquireVsCodeApi: () => { postMessage: (m: unknown) => void };
const vscode = acquireVsCodeApi();

type SyncKind = 'not_installed' | 'connecting' | 'watching' | 'syncing' | 'conflict' | 'paused' | 'error' | 'no_session';

interface SyncUiState { kind: SyncKind; conflicts?: string[]; message?: string }

interface State {
  configured: boolean;
  project?: string;
  host?: string;
  user?: string;
  remotePath?: string;
  sessionRunning: boolean;
  sync: SyncUiState;
}

const root = document.getElementById('app')!;
let currentState: State = {
  configured: false,
  sessionRunning: false,
  sync: { kind: 'no_session' },
};

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as { type: string; state?: State };
  if (msg.type === 'state' && msg.state) {
    currentState = msg.state;
    render();
  }
});

function render(): void {
  clear(root);

  if (!currentState.configured) {
    root.append(
      h('div', { className: 'header' }, h('h2', {}, 'Remote Claude')),
      h('p', { className: 'empty' }, 'No remote-claude.yml in this workspace yet.'),
      h('button', {
        className: 'primary',
        events: { click: () => vscode.postMessage({ type: 'openSetup' }) },
      }, 'Run Setup Wizard'),
    );
    return;
  }

  root.append(renderHeader(), renderActions(), renderSync(), renderFooter());
}

function renderHeader(): HTMLElement {
  return h('div', { className: 'header' },
    h('h2', {}, currentState.project ?? 'Remote Claude'),
    h('div', { className: 'subtitle' }, `${currentState.user}@${currentState.host}`),
    h('div', { className: 'subtitle' }, currentState.remotePath ?? ''),
  );
}

function renderActions(): HTMLElement {
  return h('div', { className: 'actions' },
    h('button', {
      className: 'primary',
      events: { click: () => vscode.postMessage({ type: 'openSession' }) },
    }, currentState.sessionRunning ? '⎈ Focus Claude session' : '⎈ Open Claude session'),
  );
}

function renderSync(): HTMLElement {
  const s = currentState.sync;
  const wrap = h('div', { className: 'sync-panel' });

  // Build status pill + description
  let pillText = '';
  let pillCls = '';
  let detail: HTMLElement | null = null;

  switch (s.kind) {
    case 'not_installed':
      pillText = '✗ Mutagen not installed';
      pillCls = 'error';
      detail = h('div', { className: 'sync-detail' },
        h('p', {}, 'Mutagen powers the bidirectional sync. Install it on your laptop:'),
        h('pre', { className: 'cmd' }, 'brew install mutagen-io/mutagen/mutagen'),
        h('p', { className: 'hint' }, 'Then click Restart sync below. Mutagen will deploy its agent on the Mac Mini automatically.'),
        h('button', {
          className: 'primary',
          events: { click: () => vscode.postMessage({ type: 'restartSync' }) },
        }, '↻ Restart sync'),
      );
      break;
    case 'no_session':
      pillText = '○ Sync not started';
      pillCls = 'idle';
      detail = h('button', {
        className: 'primary',
        events: { click: () => vscode.postMessage({ type: 'restartSync' }) },
      }, '⇄ Start sync');
      break;
    case 'connecting':
      pillText = '⟳ Connecting…';
      pillCls = 'syncing';
      break;
    case 'syncing':
      pillText = '⟳ Syncing…';
      pillCls = 'syncing';
      break;
    case 'watching':
      pillText = '✓ In sync';
      pillCls = 'clean';
      break;
    case 'paused':
      pillText = '⏸ Paused';
      pillCls = 'idle';
      detail = h('button', { events: { click: () => vscode.postMessage({ type: 'resumeSync' }) } }, '▶ Resume');
      break;
    case 'conflict': {
      pillText = `⚠ Conflict on ${s.conflicts?.length ?? 0} file(s)`;
      pillCls = 'warn';
      const list = h('ul', { className: 'conflict-list' });
      for (const f of (s.conflicts ?? []).slice(0, 8)) {
        list.append(h('li', {}, f));
      }
      detail = h('div', { className: 'sync-detail' },
        h('p', { className: 'hint' },
          'Both your laptop and the Mini changed the same file in the same window. ',
          'Laptop version wins; the Mini\'s version is preserved with a .conflict-N suffix next to the original.',
        ),
        list,
      );
      break;
    }
    case 'error':
      pillText = '✗ Sync error';
      pillCls = 'error';
      detail = h('div', { className: 'sync-detail' },
        h('pre', { className: 'cmd' }, s.message ?? 'unknown'),
        h('button', {
          className: 'primary',
          events: { click: () => vscode.postMessage({ type: 'restartSync' }) },
        }, '↻ Restart sync'),
      );
      break;
  }

  wrap.append(
    h('div', { className: 'sync-header' },
      h('span', { className: 'sync-title' }, 'Two-way sync'),
      h('span', { className: `sync-status ${pillCls}` }, pillText),
    ),
  );

  // Controls row (pause / flush) only when there's an active session
  if (s.kind === 'watching' || s.kind === 'syncing' || s.kind === 'connecting' || s.kind === 'conflict') {
    wrap.append(
      h('div', { className: 'sync-actions' },
        h('button', {
          events: { click: () => vscode.postMessage({ type: 'flushSync' }) },
        }, '⇄ Flush now'),
        h('button', {
          events: { click: () => vscode.postMessage({ type: 'pauseSync' }) },
        }, '⏸ Pause'),
      ),
    );
  }

  if (detail) wrap.append(detail);

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

void currentState;
vscode.postMessage({ type: 'ready' });
