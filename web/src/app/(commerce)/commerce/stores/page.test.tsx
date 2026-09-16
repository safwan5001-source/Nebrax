// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));

const user = { current: { role: 'owner', permissions: undefined as string[] | undefined } };
vi.mock('@/lib/auth', () => ({ currentUser: () => user.current }));

vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => (key: string) => key }));

import CommerceStoresPage from './page';
import { CommerceStoreProvider } from '@/modules/commerce-workspace/store-context';
import { ToastProvider } from '@/components/ui/toast';

function renderPage() {
  return render(
    <ToastProvider>
      <CommerceStoreProvider>
        <CommerceStoresPage />
      </CommerceStoreProvider>
    </ToastProvider>,
  );
}

/**
 * COM-STORE-PROVISION-1 — frontend coverage: empty-state create action,
 * permission-gated visibility, successful-provisioning refresh, error
 * surfacing, and accidental-double-submit prevention. Not a redesign of the
 * whole Commerce Workspace — this page's own behaviour only.
 */
describe('Commerce stores page — explicit provisioning', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    user.current = { role: 'owner', permissions: undefined };
  });

  it('shows the explicit create action when there is no store yet, for an authorized user', async () => {
    apiMock.mockResolvedValueOnce({ data: { stores: [] } });
    renderPage();

    expect(await screen.findByText('No online store yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create online store' })).toBeTruthy();
  });

  it('hides the create action for a user without commerce.manage', async () => {
    user.current = { role: 'staff', permissions: ['products.view'] };
    apiMock.mockResolvedValueOnce({ data: { stores: [] } });
    renderPage();

    expect(await screen.findByText('No online store yet')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create online store' })).toBeNull();
    expect(screen.getByText(/do not have permission/i)).toBeTruthy();
  });

  it('provisions on click, refreshes from the server, and renders the created store', async () => {
    apiMock
      .mockResolvedValueOnce({ data: { stores: [] } }) // initial load
      .mockResolvedValueOnce({
        data: { store: { id: 's1', name: 'My Store', sales_channel_id: 'ch1', is_active: true, preview_url: 'https://my.store.test/' } },
        meta: { created: true },
      }) // POST provision
      .mockResolvedValueOnce({
        data: {
          stores: [
            { id: 's1', name: 'My Store', sales_channel_id: 'ch1', is_active: true, preview_url: 'https://my.store.test/' },
          ],
        },
      }); // refresh GET

    renderPage();
    const button = await screen.findByRole('button', { name: 'Create online store' });
    await userEvent.click(button);

    expect(await screen.findByText('My Store')).toBeTruthy();
    expect(screen.getByText('https://my.store.test/')).toBeTruthy();
    expect(apiMock).toHaveBeenNthCalledWith(2, '/commerce/workspace/storefronts', { method: 'POST', body: {} });
    expect(apiMock).toHaveBeenNthCalledWith(3, '/commerce/workspace/storefronts');
  });

  it('shows an error toast and keeps the empty state when provisioning fails', async () => {
    apiMock
      .mockResolvedValueOnce({ data: { stores: [] } })
      .mockRejectedValueOnce(new Error('forbidden'));

    renderPage();
    const button = await screen.findByRole('button', { name: 'Create online store' });
    await userEvent.click(button);

    expect(await screen.findByText('Could not create the online store. Please try again.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create online store' })).toBeTruthy();
  });

  it('disables the action while a request is in flight so a double click cannot fire twice', async () => {
    let resolvePost: (value: unknown) => void = () => {};
    apiMock
      .mockResolvedValueOnce({ data: { stores: [] } })
      .mockImplementationOnce(() => new Promise((resolve) => { resolvePost = resolve; }));

    renderPage();
    const button = await screen.findByRole('button', { name: 'Create online store' });
    await userEvent.click(button);
    await userEvent.click(button);

    expect(apiMock).toHaveBeenCalledTimes(2); // 1 initial load + exactly 1 provisioning call

    resolvePost({
      data: { store: { id: 's1', name: 'S', sales_channel_id: 'c', is_active: true, preview_url: null } },
    });
    await waitFor(() => expect(screen.queryByText('Creating…')).toBeNull());
  });
});
