import { describe, it, expect, vi } from 'vitest';
import { wireServices } from './wiring.ts';

function fakeController() {
  let running = false;
  return {
    start: vi.fn(() => { running = true; }),
    discover: vi.fn(),
    bind: vi.fn(),
    isRunning: () => running,
    die: () => { running = false; },
  };
}

function fakeTreeView() {
  let visCb: (e: { visible: boolean }) => void = () => {};
  return { view: { onDidChangeVisibility: (cb: (e: { visible: boolean }) => void) => { visCb = cb; return { dispose() {} }; } }, fire: (visible: boolean) => visCb({ visible }) };
}

describe('wireServices', () => {
  it('on first visibility: starts, discovers, and auto-rebinds persisted ids', () => {
    const controller = fakeController();
    const tv = fakeTreeView();
    wireServices({ controller, treeView: tv.view, boundIds: () => new Set(['docker:db:5432']), hasConfig: true });
    tv.fire(true);
    expect(controller.start).toHaveBeenCalledTimes(1);
    expect(controller.discover).toHaveBeenCalledTimes(1);
    expect(controller.bind).toHaveBeenCalledWith('docker:db:5432');
  });

  it('does nothing when there is no patchwire.yml', () => {
    const controller = fakeController();
    const tv = fakeTreeView();
    wireServices({ controller, treeView: tv.view, boundIds: () => new Set(), hasConfig: false });
    tv.fire(true);
    expect(controller.start).not.toHaveBeenCalled();
  });

  it('does not restart while the session is already running', () => {
    const controller = fakeController();
    const tv = fakeTreeView();
    wireServices({ controller, treeView: tv.view, boundIds: () => new Set(), hasConfig: true });
    tv.fire(true);
    tv.fire(false);
    tv.fire(true);
    expect(controller.start).toHaveBeenCalledTimes(1);
  });

  it('restarts when the view is revealed after the session died', () => {
    const controller = fakeController();
    const tv = fakeTreeView();
    wireServices({ controller, treeView: tv.view, boundIds: () => new Set(), hasConfig: true });
    tv.fire(true);
    controller.die();
    tv.fire(true);
    expect(controller.start).toHaveBeenCalledTimes(2);
  });
});
