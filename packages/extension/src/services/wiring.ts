export interface WireableController {
  start(): void;
  discover(): void;
  bind(id: string): void;
  isRunning(): boolean;
}

export interface VisibilityView {
  onDidChangeVisibility(cb: (e: { visible: boolean }) => void): { dispose(): void };
}

export interface WireServicesDeps {
  controller: WireableController;
  treeView: VisibilityView;
  boundIds: () => Set<string>;
  hasConfig: boolean;
}

/**
 * Start the session when the Services view becomes visible. If a prior session
 * died (controller no longer running), reopening the view restarts it.
 */
export function wireServices(deps: WireServicesDeps): { dispose(): void } {
  return deps.treeView.onDidChangeVisibility((e) => {
    if (!e.visible || !deps.hasConfig || deps.controller.isRunning()) return;
    deps.controller.start();
    deps.controller.discover();
    for (const id of deps.boundIds()) deps.controller.bind(id);
  });
}
