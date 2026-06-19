import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';

const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));

import ServicesPanel from './ServicesPanel.svelte';

listenMock.mockResolvedValue(() => {});
invokeMock.mockResolvedValue(undefined);

const project = { id: 'p1', name: 'demo', branch: 'main', localPath: '/p', remotePath: '/r', host: 'h', user: 'u', lastStatus: 'unknown', syncPaused: false, connectionId: 'c1', boundServiceIds: [] };

describe('ServicesPanel', () => {
  it('starts a services session on mount', async () => {
    render(ServicesPanel, { props: { project } });
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('start_services', expect.objectContaining({ projectDir: '/p' }));
    });
  });

  it('renders an empty hint when no candidates', () => {
    const { getByTestId } = render(ServicesPanel, { props: { project } });
    expect(getByTestId('services-empty')).toBeTruthy();
  });
});
