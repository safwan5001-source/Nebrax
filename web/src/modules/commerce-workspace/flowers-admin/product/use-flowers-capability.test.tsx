// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: (...args: unknown[]) => apiMock(...args),
}));

import { useFlowersCapability } from './use-flowers-capability';

afterEach(() => {
  cleanup();
  apiMock.mockReset();
});

const store = (vertical: string) => ({ id: 's1', name: 'x', sales_channel_id: 'c', is_active: true, business_vertical: vertical });

describe('useFlowersCapability', () => {
  it('is enabled only when the tenant has a Flowers & Gifts store', async () => {
    apiMock.mockResolvedValue({ data: { stores: [store('general'), store('flowers_gifts')] } });
    const { result } = renderHook(() => useFlowersCapability());
    expect(result.current).toBe('loading');
    await waitFor(() => expect(result.current).toBe('enabled'));
  });

  it('stays disabled for general stores, no stores, failures and when switched off (no request)', async () => {
    apiMock.mockResolvedValue({ data: { stores: [store('general')] } });
    const general = renderHook(() => useFlowersCapability());
    await waitFor(() => expect(general.result.current).toBe('disabled'));

    apiMock.mockRejectedValue(new Error('x'));
    const failing = renderHook(() => useFlowersCapability());
    await waitFor(() => expect(failing.result.current).toBe('disabled'));

    apiMock.mockReset();
    const off = renderHook(() => useFlowersCapability(false));
    await waitFor(() => expect(off.result.current).toBe('disabled'));
    expect(apiMock).not.toHaveBeenCalled();
  });
});
