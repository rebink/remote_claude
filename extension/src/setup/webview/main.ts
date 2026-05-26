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
  workspaceFolder?: string;
  error?: string;
  busy?: boolean;
}

const root = document.getElementById('app')!;
let state: WizardState = { step: 1 };

let selectedHost = '';
let userValue = '';
let portValue = 22;

interface Step2Result { ok: boolean; code?: string; stderr?: string }
let step2Result: Step2Result | undefined;
let pwValue = '';

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
    h('h1', {}, 'Step 2 — Sign in to the Mac Mini'),
    h('p', { className: 'note' }, "We use your password once to install an SSH key, then discard it. You won't be asked again."),
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
        h('p', {}, "REMOTE HOST IDENTIFICATION HAS CHANGED. The Mac Mini's SSH key is different from what we have stored."),
        h('p', { className: 'note' }, "This is sometimes legitimate (key rotated) and sometimes a sign of a man-in-the-middle. Trust the new key only if you're sure."),
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
  const container = h('div', {});

  let localPathValue = state.localPath ?? state.workspaceFolder ?? '';
  let projectNameValue = state.projectName ?? (localPathValue ? basename(localPathValue) : '');

  const localPathInput = h('input', { type: 'text', value: localPathValue }) as HTMLInputElement;
  const projectNameInput = h('input', { type: 'text', value: projectNameValue }) as HTMLInputElement;
  const submitBtn = h('button', { className: 'primary' }, 'Push & continue →');
  const progressEl = h('div', { className: 'progress' }, '');

  localPathInput.addEventListener('input', () => {
    localPathValue = localPathInput.value;
    if (!projectNameInput.dataset.userEdited) {
      const b = basename(localPathValue);
      projectNameInput.value = b;
      projectNameValue = b;
    }
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
    h('p', { className: 'warn-banner' },
      'The Mac Mini copy stays isolated from git — no remotes, no pushes, no leaked identity. ' +
      'You commit only on the laptop with your own git identity.',
    ),
    progressEl,
  );

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
