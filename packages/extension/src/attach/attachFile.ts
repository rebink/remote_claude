export interface AttachDeps {
  /** Spawn the bundled CLI with args; resolve its parsed JSON stdout. */
  runCliJson: (args: string[]) => Promise<{ remotePath: string }>;
  /** Force a Mutagen sync flush so the staged file reaches the remote. */
  flushSync: () => Promise<void>;
  /** Type text into the active claude session terminal. Returns false if none is open. */
  sendToTerminal: (text: string) => boolean;
  /** Copy text to the clipboard (fallback when no terminal). */
  copyToClipboard: (text: string) => Promise<void>;
  /** Show a message to the developer. */
  notify: (message: string) => void;
}

/**
 * Stage a local file (or clipboard image) for the remote claude session:
 * CLI stages into .patchwire-inbox/ → flush sync → type the remote path into the
 * REPL (or copy it to the clipboard if no session terminal is open).
 */
export async function attachFile(
  localPath: string | null,
  deps: AttachDeps,
  opts: { clip?: boolean } = {},
): Promise<void> {
  try {
    const args = opts.clip
      ? ['push', '--clip', '--stage-only', '--json']
      : ['push', localPath!, '--stage-only', '--json'];
    const { remotePath } = await deps.runCliJson(args);
    await deps.flushSync();
    if (deps.sendToTerminal(remotePath)) return;
    await deps.copyToClipboard(remotePath);
    deps.notify(`Attachment synced — remote path copied to clipboard: ${remotePath}`);
  } catch (err) {
    deps.notify(`Attach failed: ${(err as Error).message}`);
  }
}
