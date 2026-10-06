// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));

import { CreateStoreDialog } from './create-store-dialog';

const onClose = vi.fn();
const onCreated = vi.fn().mockResolvedValue(undefined);

function renderDialog() {
  return render(<CreateStoreDialog open locale="en" onClose={onClose} onCreated={onCreated} />);
}

afterEach(() => {
  cleanup();
  apiMock.mockReset();
  onClose.mockReset();
  onCreated.mockReset();
  onCreated.mockResolvedValue(undefined);
});

describe('CreateStoreDialog — additional-store flow', () => {
  it('rejects an empty or whitespace-only name without calling the API', async () => {
    renderDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Create store' }));

    expect(await screen.findByText('Store name is required.')).toBeTruthy();
    expect(apiMock).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('posts only the explicit additional-store fields and closes after refresh callback succeeds', async () => {
    apiMock.mockResolvedValue({
      data: { store: { id: 's2', name: 'Gifts', sales_channel_id: 'c2', is_active: true, preview_url: null, default_locale: 'en' } },
    });
    renderDialog();

    await userEvent.type(screen.getByLabelText('Store name'), '  Gifts  ');
    await userEvent.selectOptions(screen.getByLabelText('Default language'), 'en');
    await userEvent.click(screen.getByRole('button', { name: 'Create store' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('s2'));
    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts/create', {
      method: 'POST',
      body: { name: 'Gifts', default_locale: 'en' },
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog open and shows an API error', async () => {
    apiMock.mockRejectedValue(new Error('forbidden'));
    renderDialog();

    await userEvent.type(screen.getByLabelText('Store name'), 'Gifts');
    await userEvent.click(screen.getByRole('button', { name: 'Create store' }));

    expect(await screen.findByText('Could not create the online store. Please try again.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
