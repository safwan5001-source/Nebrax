// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
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

const pendingCustomDomain = {
  id: 'd2',
  hostname: 'shop.example.com',
  type: 'custom',
  is_primary: false,
  is_active: true,
  verification_status: 'pending',
  verification: {
    method: 'dns_txt',
    record_name: '_awj-verification.shop.example.com',
    record_value: 'awj-domain-verification=abc123',
    verified_at: null,
  },
};

/**
 * STORE-ADMIN-ADOPT-1B-3A — frontend coverage for a `commerce.manage`
 * principal: the Add Custom Domain action, DNS TXT instructions rendered
 * from the authoritative backend response, and the Verify Now flow that
 * never optimistically marks a domain verified.
 */
describe('Commerce domains page — commerce.manage actions', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
  });

  it('renders the Add Custom Domain action for a commerce.manage principal', async () => {
    apiMock
      .mockResolvedValueOnce({ data: { stores: [existingStore] } })
      .mockResolvedValueOnce({ data: { domains: [] } });

    renderPage();

    expect(await screen.findByText('Add Custom Domain')).toBeTruthy();
  });

  it('opens the dialog, submits only the hostname, and refreshes the authoritative list on success', async () => {
    apiMock
      .mockResolvedValueOnce({ data: { stores: [existingStore] } }) // store context
      .mockResolvedValueOnce({ data: { domains: [] } }) // initial domains load
      .mockResolvedValueOnce({ data: { domain: pendingCustomDomain } }) // POST add
      .mockResolvedValueOnce({ data: { domains: [pendingCustomDomain] } }); // reload after add

    renderPage();

    const addButton = await screen.findByText('Add Custom Domain');
    fireEvent.click(addButton);

    const input = await screen.findByLabelText('Domain name');
    fireEvent.change(input, { target: { value: 'shop.example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts/s1/domains', {
        method: 'POST',
        body: { hostname: 'shop.example.com' },
      }),
    );

    expect(await screen.findByText('shop.example.com')).toBeTruthy();
    // DNS instructions rendered from the authoritative backend payload only.
    expect(screen.getByText('_awj-verification.shop.example.com')).toBeTruthy();
    expect(screen.getByText('awj-domain-verification=abc123')).toBeTruthy();
  });

  it('renders Disconnect for a pending custom domain and still no Make Primary', async () => {
    apiMock
      .mockResolvedValueOnce({ data: { stores: [existingStore] } })
      .mockResolvedValueOnce({ data: { domains: [pendingCustomDomain] } });

    renderPage();

    await screen.findByText('shop.example.com');
    expect(screen.queryByRole('button', { name: 'Make Primary' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
  });

  it('shows Verify Now for a pending custom domain and calls the backend on click, without optimistic verification', async () => {
    apiMock
      .mockResolvedValueOnce({ data: { stores: [existingStore] } })
      .mockResolvedValueOnce({ data: { domains: [pendingCustomDomain] } })
      .mockResolvedValueOnce({
        data: {
          domain: {
            ...pendingCustomDomain,
            verification_status: 'verified',
            verification: { ...pendingCustomDomain.verification, verified_at: '2026-01-01T00:00:00Z' },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          domains: [
            {
              ...pendingCustomDomain,
              verification_status: 'verified',
              verification: { ...pendingCustomDomain.verification, verified_at: '2026-01-01T00:00:00Z' },
            },
          ],
        },
      });

    renderPage();

    await screen.findByText('shop.example.com');
    // Not optimistically verified before the click.
    expect(screen.getByText('Pending verification')).toBeTruthy();

    fireEvent.click(screen.getByText('Verify Now'));

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts/s1/domains/d2/verify', {
        method: 'POST',
        body: {},
      }),
    );

    // "Verified" appears both as the status badge and the success toast —
    // assert at least one rendering rather than a single unique match.
    await waitFor(() => expect(screen.getAllByText('Verified').length).toBeGreaterThan(0));
  });

  it('does not show Verify Now for an already-verified domain', async () => {
    apiMock.mockResolvedValueOnce({ data: { stores: [existingStore] } }).mockResolvedValueOnce({
      data: {
        domains: [
          {
            id: 'd1',
            hostname: 's1.awj-commerce.test',
            type: 'awj_subdomain',
            is_primary: true,
            is_active: true,
            verification_status: 'verified',
            verification: null,
          },
        ],
      },
    });

    renderPage();

    await screen.findByText('s1.awj-commerce.test');
    expect(screen.queryByText('Verify Now')).toBeNull();
  });

  it('disables the submit action while an add request is pending, preventing a double click', async () => {
    let resolveAdd: (value: unknown) => void = () => {};
    apiMock
      .mockResolvedValueOnce({ data: { stores: [existingStore] } })
      .mockResolvedValueOnce({ data: { domains: [] } })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveAdd = resolve;
          }),
      );

    renderPage();

    fireEvent.click(await screen.findByText('Add Custom Domain'));
    const input = await screen.findByLabelText('Domain name');
    fireEvent.change(input, { target: { value: 'shop.example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('Adding…')).toBeTruthy();
    const submitButton = screen.getByText('Adding…').closest('button');
    expect(submitButton).toHaveProperty('disabled', true);

    resolveAdd({ data: { domain: pendingCustomDomain } });
  });
});
