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

/**
 * STORE-ADMIN-ADOPT-1B-1 — coverage for the per-store settings action: opens
 * pre-populated with current values, permission-gated, calls the trusted
 * Commerce Workspace mutation, refreshes the authoritative list on success,
 * and keeps validation/server errors visible instead of a false success.
 */
describe('Commerce stores page — store identity settings', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    user.current = { role: 'owner', permissions: undefined };
  });

  const existingStore = {
    id: 's1',
    name: 'My Store',
    sales_channel_id: 'ch1',
    is_active: true,
    preview_url: 'https://my.store.test/',
    default_locale: 'ar',
  };

  it('shows the settings action for an authorized user with an existing store', async () => {
    apiMock.mockResolvedValueOnce({ data: { stores: [existingStore] } });
    renderPage();

    expect(await screen.findByText('My Store')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Store settings' })).toBeTruthy();
  });

  it('hides the settings action for a user without commerce.manage', async () => {
    user.current = { role: 'staff', permissions: ['products.view'] };
    apiMock.mockResolvedValueOnce({ data: { stores: [existingStore] } });
    renderPage();

    expect(await screen.findByText('My Store')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Store settings' })).toBeNull();
  });

  it('opens pre-populated with the current store name and locale', async () => {
    apiMock.mockResolvedValueOnce({ data: { stores: [existingStore] } });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Store settings' }));

    const nameInput = screen.getByLabelText('Store name') as HTMLInputElement;
    expect(nameInput.value).toBe('My Store');
    const localeSelect = screen.getByLabelText('Default language') as HTMLSelectElement;
    expect(localeSelect.value).toBe('ar');
  });

  it('allows switching the default language between Arabic and English', async () => {
    apiMock.mockResolvedValueOnce({ data: { stores: [existingStore] } });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Store settings' }));
    const localeSelect = screen.getByLabelText('Default language') as HTMLSelectElement;
    await userEvent.selectOptions(localeSelect, 'en');

    expect(localeSelect.value).toBe('en');
  });

  it('saves via the trusted client, refreshes the list, and closes only after confirmed success', async () => {
    apiMock
      .mockResolvedValueOnce({ data: { stores: [existingStore] } }) // initial load
      .mockResolvedValueOnce({
        data: { store: { ...existingStore, name: 'Renamed Store', default_locale: 'en' } },
      }) // PUT update
      .mockResolvedValueOnce({
        data: { stores: [{ ...existingStore, name: 'Renamed Store', default_locale: 'en' }] },
      }); // refresh GET

    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Store settings' }));

    const nameInput = screen.getByLabelText('Store name');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Renamed Store');
    await userEvent.selectOptions(screen.getByLabelText('Default language'), 'en');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Renamed Store')).toBeTruthy();
    expect(apiMock).toHaveBeenNthCalledWith(2, '/commerce/workspace/storefronts/s1', {
      method: 'PUT',
      body: { name: 'Renamed Store', default_locale: 'en' },
    });
    expect(apiMock).toHaveBeenNthCalledWith(3, '/commerce/workspace/storefronts');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps a validation error visible and does not close or falsely show success', async () => {
    apiMock.mockResolvedValueOnce({ data: { stores: [existingStore] } });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Store settings' }));
    const nameInput = screen.getByLabelText('Store name');
    await userEvent.clear(nameInput);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Store name is required.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(apiMock).toHaveBeenCalledTimes(1); // only the initial load — no request fired
  });

  it('keeps a server error visible and does not close or falsely show success', async () => {
    apiMock
      .mockResolvedValueOnce({ data: { stores: [existingStore] } })
      .mockRejectedValueOnce(new Error('forbidden'));

    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Store settings' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Could not save store settings. Please try again.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('prevents a duplicate submission while saving is in flight', async () => {
    let resolvePut: (value: unknown) => void = () => {};
    apiMock
      .mockResolvedValueOnce({ data: { stores: [existingStore] } })
      .mockImplementationOnce(() => new Promise((resolve) => { resolvePut = resolve; }));

    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Store settings' }));
    const saveButton = screen.getByRole('button', { name: 'Save' });
    await userEvent.click(saveButton);
    await userEvent.click(saveButton);

    expect(apiMock).toHaveBeenCalledTimes(2); // 1 initial load + exactly 1 PUT call

    resolvePut({ data: { store: existingStore } });
    await waitFor(() => expect(screen.queryByText('Saving…')).toBeNull());
  });
});

/**
 * STORE-ADMIN-LIFECYCLE-1 — Activate/Deactivate on `/commerce/stores`:
 * truthful badge, confirmation before deactivate, storefront-id POSTs (never
 * domain edge URLs), permission gating, and settings remaining on inactive rows.
 */
describe('Commerce stores page — store lifecycle', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
    user.current = { role: 'owner', permissions: undefined };
  });

  const activeStore = {
    id: 's1',
    name: 'My Store',
    sales_channel_id: 'ch1',
    is_active: true,
    preview_url: 'https://my.store.test/',
    default_locale: 'ar',
  };

  const inactiveStore = {
    ...activeStore,
    is_active: false,
    preview_url: null,
  };

  it('shows an Inactive badge when the catalog says the store is inactive', async () => {
    apiMock.mockResolvedValueOnce({ data: { stores: [inactiveStore] } });
    renderPage();

    expect(await screen.findByText('My Store')).toBeTruthy();
    expect(screen.getByText('Inactive')).toBeTruthy();
    expect(screen.queryByText('Active')).toBeNull();
  });

  it('keeps store settings available on an inactive row', async () => {
    apiMock.mockResolvedValueOnce({ data: { stores: [inactiveStore] } });
    renderPage();

    expect(await screen.findByRole('button', { name: 'Store settings' })).toBeTruthy();
  });

  it('hides activate and deactivate actions for a user without commerce.manage', async () => {
    user.current = { role: 'staff', permissions: ['products.view'] };
    apiMock.mockResolvedValueOnce({ data: { stores: [activeStore] } });
    renderPage();

    expect(await screen.findByText('My Store')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Deactivate store' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Activate store' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Store settings' })).toBeNull();
  });

  it('opens a confirmation dialog before deactivating and only then posts deactivate', async () => {
    apiMock
      .mockResolvedValueOnce({ data: { stores: [activeStore] } })
      .mockResolvedValueOnce({ data: { store: inactiveStore } })
      .mockResolvedValueOnce({ data: { stores: [inactiveStore] } });

    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Deactivate store' }));

    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog', { name: 'Deactivate store' })).toBeTruthy();
    expect(screen.getByText(/Buyers will no longer be able to browse this store/i)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Confirm deactivation' }));

    expect(await screen.findByText('Inactive')).toBeTruthy();
    expect(apiMock).toHaveBeenNthCalledWith(2, '/commerce/workspace/storefronts/s1/deactivate', {
      method: 'POST',
      body: {},
    });
    expect(String(apiMock.mock.calls[1][0])).not.toContain('domains');
    expect(String(apiMock.mock.calls[1][0])).not.toContain('activate-edge');
    expect(apiMock).toHaveBeenNthCalledWith(3, '/commerce/workspace/storefronts');
  });

  it('activates an inactive store with a direct POST and no domain edge URL', async () => {
    apiMock
      .mockResolvedValueOnce({ data: { stores: [inactiveStore] } })
      .mockResolvedValueOnce({ data: { store: activeStore } })
      .mockResolvedValueOnce({ data: { stores: [activeStore] } });

    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Activate store' }));

    expect(await screen.findByText('Active')).toBeTruthy();
    expect(apiMock).toHaveBeenNthCalledWith(2, '/commerce/workspace/storefronts/s1/activate', {
      method: 'POST',
      body: {},
    });
    expect(String(apiMock.mock.calls[1][0])).not.toContain('domains');
    expect(String(apiMock.mock.calls[1][0])).not.toContain('activate-edge');
    expect(screen.queryByRole('dialog', { name: 'Deactivate store' })).toBeNull();
  });

  it('keeps the deactivate dialog open and does not refresh on failure', async () => {
    apiMock
      .mockResolvedValueOnce({ data: { stores: [activeStore] } })
      .mockRejectedValueOnce(new Error('forbidden'));

    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Deactivate store' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm deactivation' }));

    expect(await screen.findByText('Could not deactivate the store. Please try again.')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Deactivate store' })).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('prevents a duplicate activate while a request is in flight', async () => {
    let resolvePost: (value: unknown) => void = () => {};
    apiMock
      .mockResolvedValueOnce({ data: { stores: [inactiveStore] } })
      .mockImplementationOnce(() => new Promise((resolve) => { resolvePost = resolve; }));

    renderPage();
    const button = await screen.findByRole('button', { name: 'Activate store' });
    await userEvent.click(button);
    await userEvent.click(button);

    expect(apiMock).toHaveBeenCalledTimes(2);

    resolvePost({ data: { store: activeStore } });
    await waitFor(() => expect(screen.queryByText('Activating…')).toBeNull());
  });
});
