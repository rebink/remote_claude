import { h, clear } from './h.ts';
import { initialState, reduce, type ProvisionUiState } from './provision-state.ts';
import { startProvision, sendConsent, onProvEvent, onProvEnd, type ProvisionArgs, saveHost, listHosts, deleteHost } from './ipc.ts';
import { buildHostRecord, type HostRecord } from './host-record.ts';
import { recordToFormValues, hostBadge } from './inventory.ts';

let state: ProvisionUiState = initialState();
let lastArgs: ProvisionArgs | undefined;
let view: 'wizard' | 'hosts' = 'wizard';
let hosts: HostRecord[] = [];

const root = document.getElementById('app')!;

function field(name: string, initial: string) {
  return h('label', {}, `${name}: `, h('input', { id: `f-${name}`, value: initial }));
}
function val(name: string) { return (document.getElementById(`f-${name}`) as HTMLInputElement).value; }

async function refreshHosts() {
  try { hosts = await listHosts(); } catch (e) { console.error('listHosts failed', e); hosts = []; }
  render();
}

function renderHosts() {
  if (!hosts.length) { root.append(h('p', { className: 'empty' }, 'No hosts yet. Provision one from the Provision tab.')); return; }
  root.append(h('ul', { className: 'hosts' },
    ...hosts.map((r) => {
      const b = hostBadge(r);
      return h('li', { className: 'host-card' },
        h('span', { className: `badge ${b.cls}` }, b.text),
        h('span', { className: 'host-label' }, r.label),
        h('span', { className: 'host-meta' }, `${r.lastStatus} · ${r.lastProvisionedAt}`),
        h('button', { events: { click: () => rerun(r) } }, 'Re-run'),
        h('button', { events: { click: () => removeHost(r.id) } }, 'Remove'),
      );
    })));
}

function rerun(r: HostRecord) {
  const f = recordToFormValues(r);
  view = 'wizard';
  render();
  for (const k of Object.keys(f) as (keyof typeof f)[]) {
    const el = document.getElementById(`f-${k}`) as HTMLInputElement | null;
    if (el) el.value = f[k];
  }
}

async function removeHost(id: string) {
  try { await deleteHost(id); } catch (e) { console.error('deleteHost failed', e); }
  await refreshHosts();
}

function render() {
  clear(root);
  const nav = h('div', { className: 'nav' },
    h('button', { className: view === 'wizard' ? 'active' : '', events: { click: () => { view = 'wizard'; render(); } } }, 'Provision'),
    h('button', { className: view === 'hosts' ? 'active' : '', events: { click: () => { view = 'hosts'; refreshHosts(); } } }, 'Hosts'),
  );
  root.append(nav);
  if (view === 'hosts') { renderHosts(); return; }
  const nodes: (Node | string | null)[] = [
    h('h2', {}, 'Patchwire — provision a host'),
    field('host', '127.0.0.1'), field('user', 'admin'), field('port', '22'),
    field('keyPath', '~/.ssh/pw_validate'), field('agentPort', '7878'),
    h('button', { events: { click: onStart } }, 'Provision'),
  ];
  if (state.phase === 'preview' && state.awaitingConsent) {
    nodes.push(h('div', {},
      h('p', {}, `Plan: ${state.steps.map((s) => s.id).join(', ')}` + (state.elevation.length ? ` (elevation: ${state.elevation.join(', ')})` : '')),
      h('button', { events: { click: () => sendConsent(true) } }, 'Approve'),
      h('button', { events: { click: () => sendConsent(false) } }, 'Cancel')));
  }
  nodes.push(
    state.steps.length
      ? h('ul', { className: 'steps' },
          ...state.steps.map((s) => {
            const st = state.stepStatus[s.id];
            const icon = !st ? '·' : st.status === 'ok' ? '✓' : st.status === 'degraded' ? '⚠' : st.status === 'failed' ? '✗' : '…';
            return h('li', { className: `step step-${st?.status ?? 'pending'}` }, `${icon} ${s.id}${st?.detail ? ` — ${st.detail}` : ''}`);
          }))
      : null,
    state.phase === 'done'
      ? h('p', { className: `result result-${state.result?.status}` },
          `Result: ${state.result?.status}` +
          (state.result?.failedStep ? ` (failed at ${state.result.failedStep})` : '') +
          (state.result?.health ? ` · agent ${state.result.health.agent}` : ''))
      : null,
  );
  root.append(...nodes.filter((n): n is Node | string => n !== null));
}

async function onStart() {
  state = initialState(); render();
  const args: ProvisionArgs = {
    host: val('host'), user: val('user'), port: Number(val('port')),
    keyPath: val('keyPath'), agentPort: Number(val('agentPort')),
    token: crypto.randomUUID().replace(/-/g, ''),
  };
  lastArgs = args;
  await startProvision(args);
}
onProvEvent(async (line) => {
  state = reduce(state, line);
  render();
  if (state.phase === 'done' && state.result?.status === 'completed' && lastArgs) {
    const rec = buildHostRecord(lastArgs, state.result, crypto.randomUUID(), new Date().toISOString());
    try { await saveHost(rec); } catch (e) { console.error('saveHost failed', e); }
  }
});
onProvEnd(() => { if (state.phase !== 'done') { state.phase = 'done'; render(); } });
render();
