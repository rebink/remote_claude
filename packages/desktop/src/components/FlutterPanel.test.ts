import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';

const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));

import FlutterPanel from './FlutterPanel.svelte';

listenMock.mockResolvedValue(() => {});

describe('FlutterPanel', () => {
  it('shows a detached pill and a URI input initially', () => {
    const { getByText, getByPlaceholderText } = render(FlutterPanel, { props: { projectDir: '/p' } });
    expect(getByText(/detached/i)).toBeTruthy();
    expect(getByPlaceholderText(/Dart VM Service/i)).toBeTruthy();
  });

  it('disables Attach when the URI field is empty', () => {
    const { getByRole } = render(FlutterPanel, { props: { projectDir: '/p' } });
    const btn = getByRole('button', { name: /attach/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
