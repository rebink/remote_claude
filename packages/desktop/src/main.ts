import { h, clear } from './h.ts';
import { initialState, reduce, type ProvisionUiState } from './provision-state.ts';
import { startProvision, sendConsent, onProvEvent, onProvEnd, type ProvisionArgs, saveHost, listHosts, deleteHost, hostHealth, hostUninstall, hostLogs, type HostArgs } from './ipc.ts';
import { buildHostRecord, type HostRecord } from './host-record.ts';
import { recordToFormValues, hostBadge } from './inventory.ts';
import { parseHostHealth } from './host-health.ts';
import { parseHostLogs, formatLogEntry, type LogEntry } from './host-logs.ts';

let state: ProvisionUiState = initialState();
let lastArgs: ProvisionArgs | undefined;
let view: 'wizard' | 'hosts' | 'logs' = 'wizard';
let hosts: HostRecord[] = [];
const liveHealth: Record<string, { text: string; cls: string }> = {};
let logHost: HostRecord | undefined;
let logState: { loading: boolean; error?: string; entries: LogEntry[] } = { loading: false, entries: [] };

function hostArgsOf(r: HostRecord): HostArgs {
  return { host: r.host, user: r.user, port: r.port, keyPath: r.keyPath, agentPort: r.agentPort };
}

async function checkHost(r: HostRecord) {
  liveHealth[r.id] = { text: 'checking…', cls: 'badge-warn' };
  render();
  try { liveHealth[r.id] = parseHostHealth(await hostHealth(hostArgsOf(r))); }
  catch (e) { liveHealth[r.id] = { text: 'error', cls: 'badge-failed' }; console.error('hostHealth failed', e); }
  render();
}

async function uninstallHost(r: HostRecord) {
  if (!confirm(`Uninstall the agent on ${r.label}? This stops + removes it on the remote.`)) return;
  liveHealth[r.id] = { text: 'uninstalling…', cls: 'badge-warn' };
  render();
  try {
    const res = JSON.parse(await hostUninstall(hostArgsOf(r))) as { ok?: boolean; detail?: string };
    liveHealth[r.id] = res.ok ? { text: 'uninstalled', cls: 'badge-failed' } : { text: 'uninstall failed', cls: 'badge-failed' };
  } catch (e) { liveHealth[r.id] = { text: 'error', cls: 'badge-failed' }; console.error('hostUninstall failed', e); }
  render();
}

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
      const live = liveHealth[r.id];
      const b = live ?? hostBadge(r);
      return h('li', { className: 'host-card' },
        h('span', { className: `badge ${b.cls}` }, b.text),
        h('span', { className: 'host-label' }, r.label),
        h('span', { className: 'host-meta' }, `${r.lastStatus} · ${r.lastProvisionedAt}`),
        h('button', { events: { click: () => checkHost(r) } }, 'Check'),
        h('button', { events: { click: () => openLogs(r) } }, 'Logs'),
        h('button', { events: { click: () => rerun(r) } }, 'Re-run'),
        h('button', { events: { click: () => removeHost(r.id) } }, 'Remove'),
        h('button', { className: 'danger', events: { click: () => uninstallHost(r) } }, 'Uninstall'),
      );
    })));
}

async function openLogs(r: HostRecord) {
  logHost = r;
  logState = { loading: true, entries: [] };
  view = 'logs';
  render();
  try {
    const res = parseHostLogs(await hostLogs(hostArgsOf(r), 100));
    logState = res.ok ? { loading: false, entries: res.entries } : { loading: false, error: res.detail ?? 'failed to fetch logs', entries: [] };
  } catch (e) {
    logState = { loading: false, error: String(e), entries: [] };
  }
  render();
}
function renderLogs() {
  const nodes: (Node | string)[] = [
    h('button', { events: { click: () => { view = 'hosts'; render(); } } }, '← Back to hosts'),
    h('h3', {}, `Logs — ${logHost?.label ?? ''}`),
  ];
  if (logState.loading) nodes.push(h('p', {}, 'Loading…'));
  if (logState.error) nodes.push(h('p', { className: 'result-rolled-back' }, logState.error));
  if (!logState.loading && !logState.error && !logState.entries.length) nodes.push(h('p', { className: 'empty' }, 'No log entries.'));
  if (logState.entries.length) nodes.push(h('pre', { className: 'logview' }, logState.entries.map(formatLogEntry).join('\n')));
  root.append(...nodes);
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
  if (view === 'logs') { renderLogs(); return; }
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
