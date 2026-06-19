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

/** Start the session lazily the first time the Services view becomes visible. */
export function wireServices(deps: WireServicesDeps): { dispose(): void } {
  let started = false;
  return deps.treeView.onDidChangeVisibility((e) => {
    if (!e.visible || started || !deps.hasConfig) return;
    started = true;
    deps.controller.start();
    deps.controller.discover();
    for (const id of deps.boundIds()) deps.controller.bind(id);
  });
}
