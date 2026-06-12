export interface ClipboardCommand {
  cmd: string;
  args: string[];
  /** When true the command writes the PNG to stdout; the caller must redirect it to the file. */
  writesToStdout?: boolean;
}

/** Ordered candidate commands to capture a clipboard image as PNG into `outPath` (or to stdout). */
export function clipboardImageCommands(platform: NodeJS.Platform, outPath: string): ClipboardCommand[] {
  if (platform === 'darwin') {
    const script =
      `set p to (POSIX file "${outPath}")\n` +
      `set d to the clipboard as «class PNGf»\n` +
      `set f to open for access p with write permission\n` +
      `write d to f\nclose access f`;
    return [
      { cmd: 'pngpaste', args: [outPath] },
      { cmd: 'osascript', args: ['-e', script] },
    ];
  }
  if (platform === 'win32') {
    const ps =
      `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; ` +
      `$i=[System.Windows.Forms.Clipboard]::GetImage(); ` +
      `if($i){ $i.Save('${outPath}',[System.Drawing.Imaging.ImageFormat]::Png) } else { exit 1 }`;
    return [{ cmd: 'powershell', args: ['-NoProfile', '-Command', ps] }];
  }
  return [
    { cmd: 'wl-paste', args: ['--type', 'image/png'], writesToStdout: true },
    { cmd: 'xclip', args: ['-selection', 'clipboard', '-t', 'image/png', '-o'], writesToStdout: true },
  ];
}
