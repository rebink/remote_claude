import { h, clear } from './h.ts';

declare const acquireVsCodeApi: () => { postMessage: (m: unknown) => void };
const vscode = acquireVsCodeApi();

interface WizardState {
  step: 1 | 2 | 3 | 4;
  host?: string;
  user?: string;
  sshPort?: number;
  keyPath?: string;
  gitUrl?: string;
  branch?: string;
  projectName?: string;
  localPath?: string;
  error?: string;
  busy?: boolean;
}

const root = document.getElementById('app')!;
let state: WizardState = { step: 1 };

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as { type: string; state?: Partial<WizardState> };
  if (msg.type === 'state' && msg.state) {
    state = { ...state, ...msg.state };
    render();
  }
});

function render(): void {
  clear(root);
  root.append(renderStepIndicator(), renderStep());
}

function renderStepIndicator(): HTMLElement {
  const labels = ['Pick host', 'Sign in', 'Project source', 'Verify'];
  const indicator = h('div', { className: 'step-indicator' });
  labels.forEach((l, i) => {
    const n = i + 1;
    const cls = n < state.step ? 'done' : n === state.step ? 'active' : '';
    indicator.append(h('span', { className: cls }, `${n}. ${l}`));
  });
  return indicator;
}

function renderStep(): HTMLElement {
  switch (state.step) {
    case 1: return renderStep1();
    case 2: return renderStep2();
    case 3: return renderStep3();
    case 4: return renderStep4();
  }
}

function renderStep1(): HTMLElement {
  // T30 fills this in with the real peer list + manual host fallback.
  return h('div', {},
    h('h1', {}, 'Step 1 — Pick your Mac Mini'),
    h('p', { className: 'note' }, 'Peer list arrives in M5.T30.'),
    h('div', { className: 'actions' },
      h('button', { events: { click: () => vscode.postMessage({ type: 'step1Submit', host: 'mac-mini.local', user: '', port: 22 }) } }, 'Next'),
    ),
  );
}

function renderStep2(): HTMLElement {
  // T31 fills this in with the password form.
  return h('div', {},
    h('h1', {}, 'Step 2 — Sign in to the Mac Mini'),
    h('p', { className: 'note' }, 'Password capture arrives in M5.T31.'),
    h('div', { className: 'actions' },
      h('button', { className: 'secondary', events: { click: () => vscode.postMessage({ type: 'back' }) } }, 'Back'),
      h('button', { events: { click: () => vscode.postMessage({ type: 'step2Submit' }) } }, 'Next'),
    ),
  );
}

function renderStep3(): HTMLElement {
  // T32 fills this in with the git URL form.
  return h('div', {},
    h('h1', {}, 'Step 3 — Project source'),
    h('p', { className: 'note' }, 'Clone arrives in M5.T32.'),
    h('div', { className: 'actions' },
      h('button', { className: 'secondary', events: { click: () => vscode.postMessage({ type: 'back' }) } }, 'Back'),
      h('button', { events: { click: () => vscode.postMessage({ type: 'step3Submit' }) } }, 'Next'),
    ),
  );
}

function renderStep4(): HTMLElement {
  // T33 fills this in with doctor output + finish.
  return h('div', {},
    h('h1', {}, 'Step 4 — Verify'),
    h('p', { className: 'note' }, 'Doctor checks arrive in M5.T33.'),
    h('div', { className: 'actions' },
      h('button', { className: 'secondary', events: { click: () => vscode.postMessage({ type: 'back' }) } }, 'Back'),
      h('button', { events: { click: () => vscode.postMessage({ type: 'step4Finish' }) } }, 'Finish'),
    ),
  );
}

render();
vscode.postMessage({ type: 'ready' });
