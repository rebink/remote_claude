import { describe, it, expect, vi } from 'vitest';
import { wireServices } from './wiring.ts';

describe('wireServices', () => {
  it('on first view visibility: starts the controller, discovers, and auto-rebinds persisted ids', () => {
    const controller = { start: vi.fn(), discover: vi.fn(), bind: vi.fn(), isRunning: () => false };
    let visCb: (e: { visible: boolean }) => void = () => {};
    const treeView = { onDidChangeVisibility: (cb: (e: { visible: boolean }) => void) => { visCb = cb; return { dispose() {} }; } };
    wireServices({ controller, treeView, boundIds: () => new Set(['docker:db:5432']), hasConfig: true });

    visCb({ visible: true });
    expect(controller.start).toHaveBeenCalledTimes(1);
    expect(controller.discover).toHaveBeenCalledTimes(1);
    expect(controller.bind).toHaveBeenCalledWith('docker:db:5432');
  });

  it('does nothing when there is no patchwire.yml', () => {
    const controller = { start: vi.fn(), discover: vi.fn(), bind: vi.fn(), isRunning: () => false };
    let visCb: (e: { visible: boolean }) => void = () => {};
    const treeView = { onDidChangeVisibility: (cb: (e: { visible: boolean }) => void) => { visCb = cb; return { dispose() {} }; } };
    wireServices({ controller, treeView, boundIds: () => new Set(), hasConfig: false });
    visCb({ visible: true });
    expect(controller.start).not.toHaveBeenCalled();
  });

  it('starts only once across repeated visibility events', () => {
    const controller = { start: vi.fn(), discover: vi.fn(), bind: vi.fn(), isRunning: () => false };
    let visCb: (e: { visible: boolean }) => void = () => {};
    const treeView = { onDidChangeVisibility: (cb: (e: { visible: boolean }) => void) => { visCb = cb; return { dispose() {} }; } };
    wireServices({ controller, treeView, boundIds: () => new Set(), hasConfig: true });
    visCb({ visible: true });
    visCb({ visible: false });
    visCb({ visible: true });
    expect(controller.start).toHaveBeenCalledTimes(1);
  });
});
