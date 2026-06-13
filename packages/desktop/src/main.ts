import { h, clear } from './h.ts';
import { initialState, reduce, type ProvisionUiState } from './provision-state.ts';
import { startProvision, sendConsent, onProvEvent, type ProvisionArgs } from './ipc.ts';
let state: ProvisionUiState = initialState();
const root = document.getElementById('app')!;
function field(name: string, initial: string) {
  return h('label', {}, `${name}: `, h('input', { id: `f-${name}`, value: initial }));
}
function val(name: string) { return (document.getElementById(`f-${name}`) as HTMLInputElement).value; }
function render() {
  clear(root);
  const nodes: (Node | string)[] = [
    h('h2', {}, 'Patchwire — provision a host'),
    field('host', '127.0.0.1'), field('user', 'admin'), field('port', '22'),
    field('keyPath', `${'$'}HOME/.ssh/pw_validate`), field('agentPort', '7878'),
    h('button', { events: { click: onStart } }, 'Provision'),
  ];
  if (state.phase === 'preview' && state.awaitingConsent) {
    nodes.push(h('div', {},
      h('p', {}, `Plan: ${state.steps.map((s) => s.id).join(', ')}` + (state.elevation.length ? ` (elevation: ${state.elevation.join(', ')})` : '')),
      h('button', { events: { click: () => sendConsent(true) } }, 'Approve'),
      h('button', { events: { click: () => sendConsent(false) } }, 'Cancel')));
  }
  nodes.push(h('pre', { className: 'log' }, state.events.map((e) => JSON.stringify(e)).join('\n')));
  if (state.phase === 'done') {
    nodes.push(h('p', {}, `Result: ${state.result?.status} · agent ${state.result?.health?.agent ?? '?'}`));
  }
  root.append(...nodes);
}
async function onStart() {
  state = initialState(); render();
  const args: ProvisionArgs = {
    host: val('host'), user: val('user'), port: Number(val('port')),
    keyPath: val('keyPath'), agentPort: Number(val('agentPort')),
    token: crypto.randomUUID().replace(/-/g, ''),
  };
  await startProvision(args);
}
onProvEvent((line) => { state = reduce(state, line); render(); });
render();
