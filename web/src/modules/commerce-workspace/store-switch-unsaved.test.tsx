// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: (...args: unknown[]) => apiMock(...args),
}));

import { useUnsavedGuard } from './flowers-admin/use-unsaved-guard';
import { CommerceStoreProvider, useCommerceStoreContext } from './store-context';

afterEach(() => {
  cleanup();
  apiMock.mockReset();
  vi.restoreAllMocks();
});

const store = (id: string, name: string) => ({ id, name, sales_channel_id: `c-${id}`, is_active: true, business_vertical: 'flowers_gifts' });

function Screen({ dirty }: { dirty: boolean }) {
  const { selectedStoreId, setSelectedStoreId } = useCommerceStoreContext();
  useUnsavedGuard(dirty);

  return (
    <div>
      <p data-testid="selected">{selectedStoreId}</p>
      <button type="button" onClick={() => setSelectedStoreId('s2')}>switch</button>
    </div>
  );
}

async function open(dirty: boolean) {
  apiMock.mockResolvedValue({ data: { stores: [store('s1', 'الأول'), store('s2', 'الثاني')] } });
  render(<CommerceStoreProvider><Screen dirty={dirty} /></CommerceStoreProvider>);
  await waitFor(() => expect(screen.getByTestId('selected').textContent).toBe('s1'));
}

describe('switching store with an unsaved draft', () => {
  it('keeps the current store and the draft when the merchant declines', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await open(true);
    await userEvent.click(screen.getByRole('button', { name: 'switch' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('selected').textContent).toBe('s1');
  });

  it('switches after the merchant confirms discarding', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await open(true);
    await userEvent.click(screen.getByRole('button', { name: 'switch' }));
    expect(screen.getByTestId('selected').textContent).toBe('s2');
  });

  it('never asks when there is nothing unsaved', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await open(false);
    await userEvent.click(screen.getByRole('button', { name: 'switch' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByTestId('selected').textContent).toBe('s2');
  });
});
