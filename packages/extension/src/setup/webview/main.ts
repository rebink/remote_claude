import { h, clear } from './h.ts';
import { PROJECT_TYPES, PROJECT_TYPE_LABELS, type ProjectType } from '../syncTemplates.ts';

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
  workspaceFolder?: string;
  error?: string;
  busy?: boolean;
}

const root = document.getElementById('app')!;
let state: WizardState = { step: 1 };
let provisionStatus = '';

let selectedHost = '';
let userValue = '';
let portValue = 22;

let selectedType: ProjectType = 'common';
let typeUserEdited = false;

interface Step2Result { ok: boolean; code?: string; stderr?: string }
let step2Result: Step2Result | undefined;

interface Step3Result { ok: boolean; where?: 'local' | 'remote'; stderr?: string }
let step3Result: Step3Result | undefined;

interface Step4Result { ok: boolean; stdout: string; stderr: string }
let step4Result: Step4Result | undefined;
let step4Requested = false;

window.addEventListener('message', (event: MessageEvent) => {
  const msg = event.data as {
    type: string;
    state?: Partial<WizardState>;
    result?: Step2Result | Step3Result | Step4Result;
    projectType?: string;
  };
  if (msg.type === 'state' && msg.state) {
    state = { ...state, ...msg.state };
    render();
  } else if (msg.type === 'step2Result' && msg.result) {
    step2Result = msg.result as Step2Result;
    render();
  } else if (msg.type === 'step3Result' && msg.result) {
    step3Result = msg.result as Step3Result;
    render();
  } else if (msg.type === 'step3Event' && (msg as { event?: unknown }).event) {
    const evt = ((msg as unknown) as { event: { type: string; [k: string]: unknown } }).event;
    const progressEl = document.querySelector('.progress') as HTMLElement | null;
    if (progressEl) {
      if (evt.type === 'step' && evt.status === 'start') {
        progressEl.textContent = `→ ${evt.name}…`;
      } else if (evt.type === 'progress' && evt.stage === 'rsync') {
        const pct = evt.pct as number;
        const cur = (evt.current as string | undefined) ?? '';
        const files = evt.files as number;
        progressEl.textContent = `Pushing files… ${files} files (rsync ${pct}% — ${cur})`;
      } else if (evt.type === 'step' && evt.status === 'ok') {
        progressEl.textContent = `✓ ${evt.name}`;
      } else if (evt.type === 'step' && evt.status === 'fail') {
        progressEl.textContent = `✗ ${evt.name}: ${(evt.code as string) ?? 'failed'}`;
      }
    }
  } else if (msg.type === 'step4Result' && msg.result) {
    step4Result = msg.result as Step4Result;
    render();
  } else if (msg.type === 'provisionStatus' && typeof (msg as unknown as { text?: string }).text === 'string') {
    provisionStatus = (msg as unknown as { text: string }).text;
    render();
  } else if (msg.type === 'detectedProjectType' && msg.projectType) {
    // Only re-render when the detected type actually changes. render() calls
    // requestDetect() again, so without this guard the reply→render→detect loop
    // would round-trip (and re-read project files on the host) forever.
    if (!typeUserEdited && msg.projectType !== selectedType) {
      selectedType = msg.projectType as ProjectType;
      render();
    }
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
  // Manual entry only — Tailscale peer auto-detection removed per user request
  const container = h('div', {},
    h('h1', {}, 'Step 1 — Connect to your Mac Mini'),
    h('p', { className: 'note' }, 'Enter the SSH details for your remote Mac Mini.'),
  );

  // Host (IP or hostname)
  const hostInput = h('input', { type: 'text', placeholder: '192.168.1.10 or mac-mini.local', value: selectedHost }) as HTMLInputElement;
  hostInput.addEventListener('input', () => { selectedHost = hostInput.value; });
  container.append(h('div', { className: 'form-row' },
    h('label', {}, 'Host (IP or hostname)'),
    hostInput,
  ));

  // SSH user
  const userInput = h('input', { type: 'text', placeholder: 'admin', value: userValue }) as HTMLInputElement;
  userInput.addEventListener('input', () => { userValue = userInput.value; });
  container.append(h('div', { className: 'form-row' },
    h('label', {}, 'SSH username'),
    userInput,
  ));

  // SSH port
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
    h('h1', {}, 'Step 2 — Install your SSH key'),
    h('p', { className: 'note' }, 'We add a per-project SSH key to the remote so future connections need no password. You type your password once, in the terminal.'),
  );

  const userInput = h('input', { type: 'text', placeholder: 'rebin', value: state.user ?? '' }) as HTMLInputElement;
  userInput.addEventListener('input', () => { state.user = userInput.value; });
  container.append(h('div', { className: 'form-row' },
    h('label', {}, 'SSH username'),
    userInput,
  ));

  container.append(h('ol', { className: 'note' },
    h('li', {}, 'Click "Open terminal & install key".'),
    h('li', {}, 'In the terminal, enter your remote password when prompted (and type "yes" if asked to trust the host).'),
    h('li', {}, 'When it finishes, click "Verify & continue".'),
  ));

  if (step2Result && !step2Result.ok) {
    container.append(h('p', { className: 'error' },
      step2Result.stderr
        ? `Not connected yet: ${step2Result.stderr}`
        : 'Not connected yet. Finish the steps in the terminal, then click Verify. If you saw "REMOTE HOST IDENTIFICATION HAS CHANGED", run: ssh-keygen -R <host>',
    ));
  }
  if (state.error) container.append(h('p', { className: 'error' }, state.error));
  if (state.busy) container.append(h('p', { className: 'note' }, h('span', { className: 'spinner' }, '⟳'), ' Verifying…'));

  container.append(h('div', { className: 'actions' },
    h('button', { className: 'secondary', events: { click: () => vscode.postMessage({ type: 'back' }) } }, 'Back'),
    h('button', {
      className: 'secondary',
      events: { click: () => {
        if (!state.user) return;
        step2Result = undefined;
        vscode.postMessage({ type: 'openKeyInstallTerminal', user: state.user });
      } },
    }, 'Open terminal & install key'),
    h('button', {
      disabled: state.busy,
      events: { click: () => {
        if (!state.user) return;
        step2Result = undefined;
        vscode.postMessage({ type: 'verifyKey', user: state.user });
      } },
    }, 'Verify & continue'),
  ));

  return container;
}

function renderStep3(): HTMLElement {
  const container = h('div', {});

  let localPathValue = state.localPath ?? state.workspaceFolder ?? '';
  let projectNameValue = state.projectName ?? (localPathValue ? basename(localPathValue) : '');

  const localPathInput = h('input', { type: 'text', value: localPathValue }) as HTMLInputElement;
  const projectNameInput = h('input', { type: 'text', value: projectNameValue }) as HTMLInputElement;
  const submitBtn = h('button', { className: 'primary' }, 'Push & continue →');
  const progressEl = h('div', { className: 'progress' }, '');

  const typeSelect = h('select', {}) as HTMLSelectElement;
  for (const t of PROJECT_TYPES) {
    typeSelect.append(h('option', { value: t }, PROJECT_TYPE_LABELS[t]));
  }
  typeSelect.value = selectedType;
  typeSelect.addEventListener('change', () => {
    typeUserEdited = true;
    selectedType = typeSelect.value as ProjectType;
  });

  const requestDetect = () => {
    if (localPathValue) vscode.postMessage({ type: 'detectProjectType', localPath: localPathValue });
  };

  localPathInput.addEventListener('input', () => {
    localPathValue = localPathInput.value;
    if (!projectNameInput.dataset.userEdited) {
      const b = basename(localPathValue);
      projectNameInput.value = b;
      projectNameValue = b;
    }
    requestDetect();
  });
  projectNameInput.addEventListener('input', () => {
    projectNameInput.dataset.userEdited = '1';
    projectNameValue = projectNameInput.value;
  });

  container.append(
    h('h2', {}, 'Step 3 — Push your project to the Mac Mini'),
    h('div', { className: 'form-row' },
      h('label', {}, 'Local folder'),
      localPathInput,
      h('p', { className: 'hint' }, 'Defaults to your current VS Code workspace folder.'),
    ),
    h('div', { className: 'form-row' },
      h('label', {}, 'Project name (folder on the Mac Mini)'),
      projectNameInput,
      h('p', { className: 'hint' }, `Will be created at ~/workspace/<name>`),
    ),
    h('div', { className: 'form-row' },
      h('label', {}, 'Sync profile (what to skip when syncing)'),
      typeSelect,
      h('p', { className: 'hint' }, 'Auto-detected from your project; change it if needed. Skips build caches, dependencies, etc.'),
    ),
    h('p', { className: 'warn-banner' },
      'The Mac Mini copy stays isolated from git — no remotes, no pushes, no leaked identity. ' +
      'You commit only on the laptop with your own git identity.',
    ),
    progressEl,
  );

  requestDetect();

  if (state.error) {
    container.append(h('p', { className: 'error' }, state.error));
  }
  if (step3Result && !step3Result.ok) {
    container.append(
      h('div', { className: 'error-block' },
        h('p', {}, 'Push failed:'),
        h('pre', { className: 'note', style: { whiteSpace: 'pre-wrap' } as unknown as CSSStyleDeclaration }, step3Result.stderr ?? ''),
      ),
    );
  }

  if (provisionStatus) {
    container.append(h('p', { className: 'note' }, provisionStatus));
  }

  container.append(
    h('div', { className: 'actions' },
      h('button', { onclick: () => vscode.postMessage({ type: 'back', to: 2 }) }, 'Back'),
      submitBtn,
    ),
  );

  submitBtn.addEventListener('click', () => {
    if (!localPathValue || !projectNameValue) return;
    step3Result = undefined;
    progressEl.textContent = 'Starting…';
    vscode.postMessage({
      type: 'step3Submit',
      localPath: localPathValue,
      projectName: projectNameValue,
      projectType: selectedType,
    });
  });

  return container;
}

function basename(p: string): string {
  const norm = p.replace(/\/+$/, '');
  const i = norm.lastIndexOf('/');
  return i === -1 ? norm : norm.slice(i + 1);
}

function renderStep4(): HTMLElement {
  // Trigger doctor once on first render of step 4.
  if (!step4Requested) {
    step4Requested = true;
    vscode.postMessage({ type: 'step4Run' });
  }

  const container = h('div', {},
    h('h1', {}, 'Step 4 — Verify'),
  );

  if (state.busy || !step4Result) {
    container.append(h('p', { className: 'note' }, h('span', { className: 'spinner' }, '⟳'), ' Running checks…'));
    return container;
  }

  // Render doctor stdout line-by-line (preserves any check/X marks the CLI emits).
  const lines = step4Result.stdout.split('\n').filter(Boolean);
  const list = h('div', { className: 'form-row' });
  for (const line of lines) {
    list.append(h('div', {
      style: {
        fontFamily: 'var(--vscode-editor-font-family)',
        fontSize: '12px',
        padding: '2px 0',
      } as unknown as CSSStyleDeclaration,
    }, line));
  }
  container.append(list);

  if (!step4Result.ok) {
    container.append(h('div', { className: 'error' },
      h('p', {}, 'Doctor reported issues.'),
      h('pre', { className: 'note', style: { whiteSpace: 'pre-wrap' } as unknown as CSSStyleDeclaration }, step4Result.stderr || ''),
      h('div', { className: 'actions' },
        h('button', { className: 'secondary',
          events: { click: () => {
            step4Result = undefined;
            step4Requested = false;
            render();   // will re-trigger doctor
          }},
        }, 'Retry'),
      ),
    ));
  } else {
    container.append(h('p', {
      className: 'note',
      style: { color: 'var(--vscode-charts-green)' } as unknown as CSSStyleDeclaration,
    }, '✓ All checks passed.'));
    container.append(h('div', { className: 'actions' },
      h('button', { className: 'secondary', events: { click: () => vscode.postMessage({ type: 'back' }) } }, 'Back'),
      h('button', { events: { click: () => vscode.postMessage({ type: 'step4Finish' }) } }, 'Finish'),
    ));
  }

  return container;
}

render();
vscode.postMessage({ type: 'ready' });
