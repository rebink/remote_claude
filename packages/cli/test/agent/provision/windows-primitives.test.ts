import { describe, it, expect } from 'vitest';
import {
  WRITE_AGENT_ENV_PS,
  REMOVE_AGENT_ENV_PS,
  buildAgentLauncherPs1,
  buildSchtasksCreate,
  buildSchtasksDelete,
  WINDOWS_TASK_NAME,
  buildWindowsBinaryInstallPs,
  WINDOWS_BIN_VERSION_CMD,
  REMOVE_WINDOWS_BIN_PS,
  WINDOWS_AGENT_INSTALL_PS,
  WINDOWS_AGENT_UNINSTALL_PS,
} from '../../../src/agent/provision/windows-primitives.ts';

describe('WRITE_AGENT_ENV_PS', () => {
  it('contains powershell -NoProfile -Command', () => {
    expect(WRITE_AGENT_ENV_PS).toContain('powershell -NoProfile -Command');
  });
  it('contains Join-Path', () => {
    expect(WRITE_AGENT_ENV_PS).toContain('Join-Path');
  });
  it('contains agent.env', () => {
    expect(WRITE_AGENT_ENV_PS).toContain('agent.env');
  });
  it('reads stdin via [Console]::In.ReadToEnd()', () => {
    expect(WRITE_AGENT_ENV_PS).toContain('[Console]::In.ReadToEnd()');
  });
  it('signals success with PW_ENV_OK', () => {
    expect(WRITE_AGENT_ENV_PS).toContain('PW_ENV_OK');
  });
});

describe('REMOVE_AGENT_ENV_PS', () => {
  it('contains Remove-Item', () => {
    expect(REMOVE_AGENT_ENV_PS).toContain('Remove-Item');
  });
  it('contains agent.env', () => {
    expect(REMOVE_AGENT_ENV_PS).toContain('agent.env');
  });
});

describe('buildAgentLauncherPs1', () => {
  const ps1 = buildAgentLauncherPs1();

  it('handles export VAR=val lines', () => {
    expect(ps1).toContain('export');
  });
  it('invokes serve via the absolute installed .exe path (not a bare binary name)', () => {
    expect(ps1).toContain('.patchwire\\bin\\patchwire-agent.exe');
    expect(ps1).toContain('serve');
    expect(ps1).not.toContain('& patchwire-agent serve');
  });
  it('uses Join-Path to resolve the absolute exe path', () => {
    expect(ps1).toContain('Join-Path');
    expect(ps1).toContain('.patchwire\\bin\\patchwire-agent.exe');
  });
  it('references $env:USERPROFILE', () => {
    expect(ps1).toContain('$env:USERPROFILE');
  });
  it('uses Set-Item to set env vars', () => {
    expect(ps1).toContain('Set-Item');
  });
  it('uses CRLF line endings', () => {
    expect(ps1).toContain('\r\n');
  });
});

describe('WINDOWS_AGENT_INSTALL_PS', () => {
  it('references the absolute .exe path', () => {
    expect(WINDOWS_AGENT_INSTALL_PS).toContain('.patchwire\\bin\\patchwire-agent.exe');
  });
  it('uses Join-Path', () => {
    expect(WINDOWS_AGENT_INSTALL_PS).toContain('Join-Path');
  });
  it('passes the install verb', () => {
    expect(WINDOWS_AGENT_INSTALL_PS).toContain('install');
  });
  it('does not use a bare binary name', () => {
    expect(WINDOWS_AGENT_INSTALL_PS).not.toMatch(/& patchwire-agent(?!\.exe)/);
  });
});

describe('WINDOWS_AGENT_UNINSTALL_PS', () => {
  it('references the absolute .exe path', () => {
    expect(WINDOWS_AGENT_UNINSTALL_PS).toContain('.patchwire\\bin\\patchwire-agent.exe');
  });
  it('uses Join-Path', () => {
    expect(WINDOWS_AGENT_UNINSTALL_PS).toContain('Join-Path');
  });
  it('passes the uninstall verb', () => {
    expect(WINDOWS_AGENT_UNINSTALL_PS).toContain('uninstall');
  });
  it('does not use a bare binary name', () => {
    expect(WINDOWS_AGENT_UNINSTALL_PS).not.toMatch(/& patchwire-agent(?!\.exe)/);
  });
});

describe('buildSchtasksCreate', () => {
  const launcher = 'C:\\Users\\u\\.patchwire\\bin\\agent-launcher.ps1';
  const cmd = buildSchtasksCreate(launcher);

  it('contains /SC ONLOGON', () => {
    expect(cmd).toContain('/SC ONLOGON');
  });
  it('contains /TN PatchwireAgent', () => {
    expect(cmd).toContain(`/TN ${WINDOWS_TASK_NAME}`);
  });
  it('uses -File to launch via PowerShell', () => {
    expect(cmd).toContain('-File');
  });
  it('includes the launcher path', () => {
    expect(cmd).toContain(launcher);
  });
});

describe('buildSchtasksDelete', () => {
  const cmd = buildSchtasksDelete();

  it('contains /Delete', () => {
    expect(cmd).toContain('/Delete');
  });
  it('contains /TN PatchwireAgent', () => {
    expect(cmd).toContain(`/TN ${WINDOWS_TASK_NAME}`);
  });
});

describe('buildWindowsBinaryInstallPs', () => {
  const SHA = 'a'.repeat(64);
  const ps = buildWindowsBinaryInstallPs(SHA);

  it('contains [Convert]::FromBase64String', () => {
    expect(ps).toContain('[Convert]::FromBase64String');
  });
  it('contains [IO.File]::WriteAllBytes', () => {
    expect(ps).toContain('[IO.File]::WriteAllBytes');
  });
  it('contains Get-FileHash', () => {
    expect(ps).toContain('Get-FileHash');
  });
  it('embeds the sha256 digest', () => {
    expect(ps).toContain(`'${SHA}'`);
  });
  it('signals success with PW_BIN_OK', () => {
    expect(ps).toContain('PW_BIN_OK');
  });
  it('throws on invalid sha256', () => {
    expect(() => buildWindowsBinaryInstallPs('xyz')).toThrow(/invalid artifact sha256/);
  });
});

describe('WINDOWS_BIN_VERSION_CMD', () => {
  it('contains --version', () => {
    expect(WINDOWS_BIN_VERSION_CMD).toContain('--version');
  });
  it('references patchwire-agent.exe', () => {
    expect(WINDOWS_BIN_VERSION_CMD).toContain('patchwire-agent.exe');
  });
});

describe('REMOVE_WINDOWS_BIN_PS', () => {
  it('contains Remove-Item', () => {
    expect(REMOVE_WINDOWS_BIN_PS).toContain('Remove-Item');
  });
  it('references patchwire-agent.exe', () => {
    expect(REMOVE_WINDOWS_BIN_PS).toContain('patchwire-agent.exe');
  });
});
