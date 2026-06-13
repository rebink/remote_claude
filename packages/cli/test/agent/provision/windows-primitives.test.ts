import { describe, it, expect } from 'vitest';
import {
  WRITE_AGENT_ENV_PS,
  REMOVE_AGENT_ENV_PS,
  buildAgentLauncherPs1,
  buildSchtasksCreate,
  buildSchtasksDelete,
  WINDOWS_TASK_NAME,
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
  it('runs patchwire-agent serve', () => {
    expect(ps1).toContain('patchwire-agent serve');
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
