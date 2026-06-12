export interface ClipboardCommand {
  cmd: string;
  args: string[];
  /** When true the command writes the PNG to stdout; the caller must redirect it to the file. */
  writesToStdout?: boolean;
}

/** Reject output paths that could break out of the quoted script context. */
function assertSafeOutPath(outPath: string): void {
  if (/[\r\n\0]/.test(outPath)) {
    throw new Error('clipboard output path must not contain newlines or null bytes');
  }
}

/** Ordered candidate commands to capture a clipboard image as PNG into `outPath` (or to stdout). */
export function clipboardImageCommands(platform: NodeJS.Platform, outPath: string): ClipboardCommand[] {
  assertSafeOutPath(outPath);
  if (platform === 'darwin') {
    // Escape for an AppleScript double-quoted string literal.
    const esc = outPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const script =
      `set p to (POSIX file "${esc}")\n` +
      `set d to the clipboard as «class PNGf»\n` +
      `set f to open for access p with write permission\n` +
      `write d to f\nclose access f`;
    return [
      { cmd: 'pngpaste', args: [outPath] },
      { cmd: 'osascript', args: ['-e', script] },
    ];
  }
  if (platform === 'win32') {
    // Escape for a PowerShell single-quoted string literal: '' is a literal quote;
    // $ and backtick are NOT special inside single quotes.
    const esc = outPath.replace(/'/g, "''");
    const ps =
      `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; ` +
      `$i=[System.Windows.Forms.Clipboard]::GetImage(); ` +
      `if($i){ $i.Save('${esc}',[System.Drawing.Imaging.ImageFormat]::Png) } else { exit 1 }`;
    return [{ cmd: 'powershell', args: ['-NoProfile', '-Command', ps] }];
  }
  return [
    { cmd: 'wl-paste', args: ['--type', 'image/png'], writesToStdout: true },
    { cmd: 'xclip', args: ['-selection', 'clipboard', '-t', 'image/png', '-o'], writesToStdout: true },
  ];
}
