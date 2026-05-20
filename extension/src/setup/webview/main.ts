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

interface Peer { hostname: string; host: string; online: boolean; lastSeen: string }
let peers: Peer[] | undefined = undefined;
let peersRequested = false;
let manualMode = false;
let selectedHost = '';
let userValue = '';
let portValue = 22;

interface Step2Result { ok: boolean; code?: string; stderr?: string }
let step2Result: Step2Result | undefined;
let pwValue = '';

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as { type: string; state?: Partial<WizardState>; peers?: Peer[]; result?: Step2Result };
  if (msg.type === 'state' && msg.state) {
    state = { ...state, ...msg.state };
    render();
  } else if (msg.type === 'step1Peers' && msg.peers) {
    peers = msg.peers;
    // Default selection: first online peer
    if (!selectedHost) {
      const firstOnline = peers.find((p) => p.online);
      if (firstOnline) selectedHost = firstOnline.host;
    }
    render();
  } else if (msg.type === 'step2Result' && msg.result) {
    step2Result = msg.result;
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
  if (!peersRequested) {
    peersRequested = true;
    vscode.postMessage({ type: 'step1ListPeers' });
  }

  const container = h('div', {},
    h('h1', {}, 'Step 1 — Pick your Mac Mini'),
  );

  if (peers === undefined) {
    container.append(h('p', { className: 'note' }, h('span', { className: 'spinner' }, '⟳'), ' Loading Tailscale peers…'));
    return container;
  }

  const peerList = h('div', { className: 'peer-list form-row' });
  if (peers.length === 0) {
    peerList.append(h('p', { className: 'note' }, 'No Tailscale peers detected. Enter the host manually below.'));
  } else {
    // Online peers first
    const sorted = [...peers].sort((a, b) => (a.online === b.online ? 0 : a.online ? -1 : 1));
    for (const p of sorted) {
      const radio = h('input', { type: 'radio', name: 'peer', checked: !manualMode && p.host === selectedHost }) as HTMLInputElement;
      radio.addEventListener('change', () => {
        manualMode = false;
        selectedHost = p.host;
        render();
      });
      peerList.append(h('label', {},
        radio,
        h('span', {}, `${p.online ? '●' : '○'} `),
        h('span', {}, `${p.hostname}  `),
        h('span', { className: 'note', style: { fontSize: '11px' } as unknown as CSSStyleDeclaration }, p.host),
      ));
    }
  }

  // Manual entry option
  const manualRadio = h('input', { type: 'radio', name: 'peer', checked: manualMode }) as HTMLInputElement;
  manualRadio.addEventListener('change', () => { manualMode = true; render(); });
  peerList.append(h('label', {}, manualRadio, h('span', {}, ' Enter host manually')));
  container.append(peerList);

  if (manualMode) {
    const manualHostInput = h('input', { type: 'text', placeholder: 'mac-mini.local or 192.168.1.10', value: selectedHost }) as HTMLInputElement;
    manualHostInput.addEventListener('input', () => { selectedHost = manualHostInput.value; });
    container.append(h('div', { className: 'form-row' },
      h('label', {}, 'Host'),
      manualHostInput,
    ));
  }

  // SSH user input
  const userInput = h('input', { type: 'text', placeholder: 'rebin', value: userValue }) as HTMLInputElement;
  userInput.addEventListener('input', () => { userValue = userInput.value; });
  container.append(h('div', { className: 'form-row' },
    h('label', {}, 'SSH username'),
    userInput,
  ));

  // SSH port input
  const portInput = h('input', { type: 'text', placeholder: '22', value: String(portValue) }) as HTMLInputElement;
  portInput.addEventListener('input', () => { portValue = Number(portInput.value) || 22; });
  container.append(h('div', { className: 'form-row' },
    h('label', {}, 'SSH port'),
    portInput,
  ));

  if (state.error) container.append(h('p', { className: 'error' }, state.error));

  container.append(h('div', { className: 'actions' },
    h('button', {
      events: { click: () => {
        vscode.postMessage({ type: 'step1Submit', host: selectedHost, user: userValue, port: portValue });
      } },
    }, 'Next'),
  ));

  return container;
}

function renderStep2(): HTMLElement {
  const container = h('div', {},
    h('h1', {}, 'Step 2 — Sign in to the Mac Mini'),
    h('p', { className: 'note' }, 'We use your password once to install an SSH key, then discard it. You won’t be asked again.'),
  );

  // Username (pre-filled from step 1; allow editing for typos)
  const userInput = h('input', { type: 'text', placeholder: 'rebin', value: state.user ?? '' }) as HTMLInputElement;
  userInput.addEventListener('input', () => { state.user = userInput.value; });
  container.append(h('div', { className: 'form-row' },
    h('label', {}, 'SSH username'),
    userInput,
  ));

  // Password (single-shot)
  const pwInput = h('input', { type: 'password', placeholder: '••••••••••', value: pwValue }) as HTMLInputElement;
  pwInput.addEventListener('input', () => { pwValue = pwInput.value; });
  container.append(h('div', { className: 'form-row' },
    h('label', {}, 'Password (one-time)'),
    pwInput,
  ));

  // Render result-driven error / host-key-mismatch dialog
  if (step2Result && !step2Result.ok) {
    const code = step2Result.code ?? 'unknown';
    if (code === 'auth_failed') {
      container.append(h('p', { className: 'error' }, 'Authentication failed. Check the password and try again.'));
    } else if (code === 'unreachable') {
      container.append(h('p', { className: 'error' }, 'Host unreachable. Check Tailscale and try again.'));
    } else if (code === 'host_key_mismatch') {
      container.append(h('div', { className: 'error' },
        h('p', {}, 'REMOTE HOST IDENTIFICATION HAS CHANGED. The Mac Mini’s SSH key is different from what we have stored.'),
        h('p', { className: 'note' }, 'This is sometimes legitimate (key rotated) and sometimes a sign of a man-in-the-middle. Trust the new key only if you’re sure.'),
        step2Result.stderr ? h('pre', { className: 'note' }, step2Result.stderr) : null,
        h('div', { className: 'actions' },
          h('button', { className: 'secondary',
            events: { click: () => {
              vscode.postMessage({ type: 'step2Submit', user: state.user, password: pwValue, trustNewKey: true });
            }}}, 'Trust new key'),
        ),
      ));
    } else {
      container.append(h('p', { className: 'error' }, step2Result.stderr ?? 'Setup failed. Check the output channel for details.'));
    }
  }

  if (state.error) container.append(h('p', { className: 'error' }, state.error));
  if (state.busy) container.append(h('p', { className: 'note' }, h('span', { className: 'spinner' }, '⟳'), ' Installing SSH key…'));

  container.append(h('div', { className: 'actions' },
    h('button', { className: 'secondary', events: { click: () => vscode.postMessage({ type: 'back' }) } }, 'Back'),
    h('button', {
      disabled: state.busy,
      events: { click: () => {
        if (!pwValue || !state.user) return;
        step2Result = undefined;  // clear previous result on retry
        vscode.postMessage({ type: 'step2Submit', user: state.user, password: pwValue });
      }},
    }, 'Install key & continue'),
  ));

  return container;
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
