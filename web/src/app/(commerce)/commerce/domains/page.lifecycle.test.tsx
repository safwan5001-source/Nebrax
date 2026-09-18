// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
class FakeApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
vi.mock('@/lib/api', () => ({
  api: (...args: unknown[]) => apiMock(...args),
  hasApiStatus: (error: unknown, status: number) => (error as { status?: number })?.status === status,
}));

vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => (key: string) => key }));
vi.mock('@/lib/auth', () => ({ currentUser: () => ({ role: 'owner', permissions: ['*'] }) }));

import CommerceDomainsPage from './page';
import { CommerceStoreProvider } from '@/modules/commerce-workspace/store-context';
import { ToastProvider } from '@/components/ui/toast';

function renderPage() {
  return render(
    <ToastProvider>
      <CommerceStoreProvider>
        <CommerceDomainsPage />
      </CommerceStoreProvider>
    </ToastProvider>,
  );
}

const existingStore = {
  id: 's1',
  name: 'My Store',
  sales_channel_id: 'ch1',
  is_active: true,
  preview_url: 'https://my.store.test/',
  default_locale: 'ar',
};

const awjPrimary = {
  id: 'd1',
  hostname: 's1.awj-commerce.test',
  type: 'awj_subdomain',
  is_primary: true,
  is_active: true,
  verification_status: 'verified',
  verification: null,
};

const awjSecondary = {
  id: 'd1b',
  hostname: 's1-alt.awj-commerce.test',
  type: 'awj_subdomain',
  is_primary: false,
  is_active: true,
  verification_status: 'verified',
  verification: null,
};

const verifiedCustom = {
  id: 'd2',
  hostname: 'shop.example.com',
  type: 'custom',
  is_primary: false,
  is_active: true,
  verification_status: 'verified',
  verification: {
    method: 'dns_txt',
    record_name: '_awj-verification.shop.example.com',
    record_value: 'awj-domain-verification=abc123',
    verified_at: '2026-01-01T00:00:00Z',
  },
};

/**
 * STORE-ADMIN-ADOPT-1B-3B — frontend coverage for Make Primary (AWJ-managed
 * only) and Disconnect (custom only): confirmation, no optimistic delete,
 * authoritative refresh, and verified-ownership vs activation wording.
 */
describe('Commerce domains page — safe domain lifecycle', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
  });

  it('shows Make Primary for an eligible AWJ-managed domain and not for a verified custom domain', async () => {
    apiMock.mockResolvedValueOnce({ data: { stores: [existingStore] } }).mockResolvedValueOnce({
      data: { domains: [awjPrimary, awjSecondary, verifiedCustom] },
    });

    renderPage();

    await screen.findByText('s1-alt.awj-commerce.test');
    expect(screen.getByRole('button', { name: 'Make Primary' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Verify Now' })).toBeNull();
  });

  it('does not show Disconnect on an AWJ-managed domain', async () => {
    apiMock.mockResolvedValueOnce({ data: { stores: [existingStore] } }).mockResolvedValueOnce({
      data: { domains: [awjPrimary] },
    });

    renderPage();

    await screen.findByText('s1.awj-commerce.test');
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Make Primary' })).toBeNull();
  });

  it('renders ownership-verified vs awaiting-activation wording for a verified custom domain, not Ready', async () => {
    apiMock.mockResolvedValueOnce({ data: { stores: [existingStore] } }).mockResolvedValueOnce({
      data: { domains: [awjPrimary, verifiedCustom] },
    });

    renderPage();

    await screen.findByText('shop.example.com');
    expect(screen.getByText('Ownership verified')).toBeTruthy();
    expect(screen.getByText('Awaiting domain activation')).toBeTruthy();
    expect(screen.queryByText('Ready')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Make Primary' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
  });

  it('requires confirmation before disconnect and does not remove the row until the API succeeds', async () => {
    apiMock
      .mockResolvedValueOnce({ data: { stores: [existingStore] } })
      .mockResolvedValueOnce({ data: { domains: [awjPrimary, verifiedCustom] } });

    renderPage();

    await screen.findByText('shop.example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));

    expect(await screen.findByText('Disconnect custom domain')).toBeTruthy();
    expect(screen.getAllByText('shop.example.com').length).toBeGreaterThan(1);
    expect(apiMock).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Disconnect custom domain')).toBeNull());
    expect(screen.getByText('shop.example.com')).toBeTruthy();
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it('refreshes the authoritative list after a successful disconnect and does not delete locally first', async () => {
    apiMock
      .mockResolvedValueOnce({ data: { stores: [existingStore] } })
      .mockResolvedValueOnce({ data: { domains: [awjPrimary, verifiedCustom] } })
      .mockResolvedValueOnce({ data: { disconnected: true } })
      .mockResolvedValueOnce({ data: { domains: [awjPrimary] } });

    renderPage();

    await screen.findByText('shop.example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect domain' }));

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts/s1/domains/d2', {
        method: 'DELETE',
      }),
    );

    await waitFor(() => expect(screen.queryByText('shop.example.com')).toBeNull());
    expect(screen.getByText('s1.awj-commerce.test')).toBeTruthy();
    expect(apiMock).toHaveBeenNthCalledWith(4, '/commerce/workspace/storefronts/s1/domains');
  });

  it('leaves the row unchanged when disconnect fails', async () => {
    apiMock
      .mockResolvedValueOnce({ data: { stores: [existingStore] } })
      .mockResolvedValueOnce({ data: { domains: [awjPrimary, verifiedCustom] } })
      .mockRejectedValueOnce(new FakeApiError(500, 'boom'));

    renderPage();

    await screen.findByText('shop.example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect domain' }));

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts/s1/domains/d2', {
        method: 'DELETE',
      }),
    );

    expect(screen.getAllByText('shop.example.com').length).toBeGreaterThan(0);
    expect(apiMock).toHaveBeenCalledTimes(3);
  });

  it('calls make-primary for an eligible AWJ domain and refreshes from the API', async () => {
    apiMock
      .mockResolvedValueOnce({ data: { stores: [existingStore] } })
      .mockResolvedValueOnce({ data: { domains: [awjPrimary, awjSecondary] } })
      .mockResolvedValueOnce({
        data: { domain: { ...awjSecondary, is_primary: true } },
      })
      .mockResolvedValueOnce({
        data: {
          domains: [
            { ...awjSecondary, is_primary: true },
            { ...awjPrimary, is_primary: false },
          ],
        },
      });

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Make Primary' }));

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts/s1/domains/d1b/make-primary', {
        method: 'POST',
        body: {},
      }),
    );

    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(4));
  });
});
