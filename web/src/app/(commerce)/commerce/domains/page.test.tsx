// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));

vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => (key: string) => key }));

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

/**
 * STORE-ADMIN-ADOPT-1B-2 — frontend coverage: renders the authoritative
 * domains table for the store already selected by `CommerceStoreProvider`
 * (no store-selector UI of its own), the "no store yet" state, an empty
 * domain list, and a load failure — with no mutation control anywhere on
 * the page (that is 1B-3's territory).
 */
describe('Commerce domains page — read-only domain visibility', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
  });

  it('shows the no-store-yet state when the tenant has no storefront', async () => {
    apiMock.mockResolvedValueOnce({ data: { stores: [] } });
    renderPage();

    expect(await screen.findByText('No online store yet')).toBeTruthy();
  });

  it('resolves the storefront from the trusted store context and requests its nested domains path', async () => {
    apiMock
      .mockResolvedValueOnce({ data: { stores: [existingStore] } }) // store context load
      .mockResolvedValueOnce({
        data: {
          domains: [
            {
              id: 'd1',
              hostname: 's1.awj-commerce.test',
              type: 'awj_subdomain',
              is_primary: true,
              is_active: true,
              verification_status: 'verified',
            },
          ],
        },
      });

    renderPage();

    expect(await screen.findByText('s1.awj-commerce.test')).toBeTruthy();
    expect(apiMock).toHaveBeenNthCalledWith(2, '/commerce/workspace/storefronts/s1/domains');
  });

  it('renders hostname, type, primary and verification status for each domain', async () => {
    apiMock
      .mockResolvedValueOnce({ data: { stores: [existingStore] } })
      .mockResolvedValueOnce({
        data: {
          domains: [
            {
              id: 'd1',
              hostname: 's1.awj-commerce.test',
              type: 'awj_subdomain',
              is_primary: true,
              is_active: true,
              verification_status: 'verified',
            },
            {
              id: 'd2',
              hostname: 'shop.example.com',
              type: 'custom',
              is_primary: false,
              is_active: true,
              verification_status: 'pending',
            },
          ],
        },
      });

    renderPage();

    expect(await screen.findByText('s1.awj-commerce.test')).toBeTruthy();
    expect(screen.getByText('shop.example.com')).toBeTruthy();
    expect(screen.getByText('AWJ-managed')).toBeTruthy();
    expect(screen.getByText('Custom')).toBeTruthy();
    expect(screen.getByText('Verified')).toBeTruthy();
    expect(screen.getByText('Pending verification')).toBeTruthy();
  });

  it('shows a domains-specific empty state when the storefront has zero domain rows', async () => {
    apiMock
      .mockResolvedValueOnce({ data: { stores: [existingStore] } })
      .mockResolvedValueOnce({ data: { domains: [] } });

    renderPage();

    expect(await screen.findByText('No domain yet')).toBeTruthy();
  });

  it('shows an error state when the domains request fails, never fabricated data', async () => {
    apiMock
      .mockResolvedValueOnce({ data: { stores: [existingStore] } })
      .mockRejectedValueOnce(new Error('forbidden'));

    renderPage();

    expect(await screen.findByText('Could not load store domains. Please try again.')).toBeTruthy();
  });

  it('renders no add/verify/remove/primary-toggle control anywhere on the page', async () => {
    apiMock
      .mockResolvedValueOnce({ data: { stores: [existingStore] } })
      .mockResolvedValueOnce({
        data: {
          domains: [
            {
              id: 'd1',
              hostname: 's1.awj-commerce.test',
              type: 'awj_subdomain',
              is_primary: true,
              is_active: true,
              verification_status: 'verified',
            },
          ],
        },
      });

    renderPage();

    expect(await screen.findByText('s1.awj-commerce.test')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
