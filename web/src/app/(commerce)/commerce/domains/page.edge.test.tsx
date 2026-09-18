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
  edge: null,
};

const pendingCustom = {
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
  edge: { status: 'none', dns_instructions: { records: [] }, checked_at: null, ready_at: null, last_error: null },
};

function verifiedCustom(edge: Record<string, unknown>) {
  return {
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
    edge,
  };
}

const railwayRecords = [
  { type: 'CNAME', name: 'shop.example.com', value: 'g05ns7.up.railway.app' },
  { type: 'TXT', name: '_railway-verify.shop.example.com', value: 'railway-verify=token-from-backend-only' },
];

/**
 * CUSTOM-DOMAIN-EDGE-2 — frontend coverage for Activate / DNS instructions /
 * Check DNS / Check HTTPS / Ready. Ownership TXT stays distinct. Custom
 * HTTPS-ready still has no Make Primary.
 */
describe('Commerce domains page — EDGE-2 activation UX', () => {
  afterEach(() => {
    cleanup();
    apiMock.mockReset();
  });

  it('does not show Activate Domain while ownership is still pending', async () => {
    apiMock.mockResolvedValueOnce({ data: { stores: [existingStore] } }).mockResolvedValueOnce({
      data: { domains: [awjPrimary, pendingCustom] },
    });

    renderPage();

    await screen.findByText('shop.example.com');
    expect(screen.getByRole('button', { name: 'Verify Now' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Activate Domain' })).toBeNull();
    expect(screen.getByText('Ownership verification TXT')).toBeTruthy();
    expect(screen.getByText('_awj-verification.shop.example.com')).toBeTruthy();
    expect(screen.queryByText('HTTPS DNS records')).toBeNull();
  });

  it('shows Activate Domain for verified custom edge none, not Make Primary, not Ready', async () => {
    apiMock.mockResolvedValueOnce({ data: { stores: [existingStore] } }).mockResolvedValueOnce({
      data: { domains: [awjPrimary, verifiedCustom({ status: 'none', dns_instructions: { records: [] } })] },
    });

    renderPage();

    await screen.findByText('shop.example.com');
    expect(screen.getByText('Ownership verified')).toBeTruthy();
    expect(screen.getByText('Awaiting domain activation')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Activate Domain' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Make Primary' })).toBeNull();
    expect(screen.queryByText('HTTPS Ready')).toBeNull();
    expect(screen.queryByText('Ready')).toBeNull();
  });

  it('calls activate-edge with an empty body and replaces the row from the authoritative response', async () => {
    const activated = verifiedCustom({
      status: 'dns_required',
      dns_instructions: { records: railwayRecords },
      checked_at: '2026-01-02T00:00:00Z',
    });
    apiMock
      .mockResolvedValueOnce({ data: { stores: [existingStore] } })
      .mockResolvedValueOnce({
        data: { domains: [awjPrimary, verifiedCustom({ status: 'none', dns_instructions: { records: [] } })] },
      })
      .mockResolvedValueOnce({ data: { domain: activated } });

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Activate Domain' }));

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts/s1/domains/d2/activate-edge', {
        method: 'POST',
        body: {},
      }),
    );
    const body = apiMock.mock.calls.find((call) => String(call[0]).endsWith('/activate-edge'))?.[1]?.body;
    expect(body).toEqual({});
    expect(body).not.toHaveProperty('tenant_id');
    expect(body).not.toHaveProperty('edge_status');
    expect(body).not.toHaveProperty('edge_provider_id');
    expect(body).not.toHaveProperty('dns_instructions');

    expect(await screen.findByText('DNS configuration required')).toBeTruthy();
    expect(screen.getByText('HTTPS DNS records')).toBeTruthy();
    expect(screen.getByText('g05ns7.up.railway.app')).toBeTruthy();
    expect(screen.getByText('_railway-verify.shop.example.com')).toBeTruthy();
    expect(screen.getByText('railway-verify=token-from-backend-only')).toBeTruthy();
    expect(screen.getByText(/separate from the earlier AWJ ownership TXT/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Activate Domain' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Check DNS' })).toBeTruthy();
    expect(apiMock.mock.calls.filter((call) => call[0] === '/commerce/workspace/storefronts/s1/domains')).toHaveLength(1);
  });

  it('keeps the previous row when activate-edge fails', async () => {
    apiMock
      .mockResolvedValueOnce({ data: { stores: [existingStore] } })
      .mockResolvedValueOnce({
        data: { domains: [awjPrimary, verifiedCustom({ status: 'none', dns_instructions: { records: [] } })] },
      })
      .mockRejectedValueOnce(new FakeApiError(503, 'edge provider is not configured'));

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Activate Domain' }));

    await waitFor(() => expect(screen.getByText('The edge provider is unavailable right now — try again later.')).toBeTruthy());
    expect(screen.getByText('Awaiting domain activation')).toBeTruthy();
    expect(screen.queryByText('DNS configuration required')).toBeNull();
    expect(screen.getByRole('button', { name: 'Activate Domain' })).toBeTruthy();
  });

  it('disables Activate Domain while the request is in flight', async () => {
    let resolveActivate: (value: unknown) => void = () => undefined;
    apiMock
      .mockResolvedValueOnce({ data: { stores: [existingStore] } })
      .mockResolvedValueOnce({
        data: { domains: [awjPrimary, verifiedCustom({ status: 'none', dns_instructions: { records: [] } })] },
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveActivate = resolve;
          }),
      );

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Activate Domain' }));
    expect(await screen.findByRole('button', { name: 'Activating…' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Activating…' }));
    expect(apiMock.mock.calls.filter((call) => String(call[0]).endsWith('/activate-edge'))).toHaveLength(1);
    resolveActivate({
      data: {
        domain: verifiedCustom({ status: 'pending', dns_instructions: { records: [] } }),
      },
    });
    expect(await screen.findByText('Processing')).toBeTruthy();
  });

  it('renders pending without claiming DNS or TLS success', async () => {
    apiMock.mockResolvedValueOnce({ data: { stores: [existingStore] } }).mockResolvedValueOnce({
      data: { domains: [awjPrimary, verifiedCustom({ status: 'pending', dns_instructions: { records: [] } })] },
    });

    renderPage();

    await screen.findByText('Processing');
    expect(screen.queryByText('HTTPS Ready')).toBeNull();
    expect(screen.queryByText('DNS configuration required')).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('calls refresh-edge from Check DNS and preserves exact backend records', async () => {
    apiMock
      .mockResolvedValueOnce({ data: { stores: [existingStore] } })
      .mockResolvedValueOnce({
        data: {
          domains: [
            awjPrimary,
            verifiedCustom({
              status: 'dns_required',
              dns_instructions: { records: railwayRecords },
            }),
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          domain: verifiedCustom({
            status: 'tls_pending',
            dns_instructions: { records: railwayRecords },
          }),
        },
      });

    renderPage();

    expect(await screen.findByText('g05ns7.up.railway.app')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Check DNS' }));

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts/s1/domains/d2/refresh-edge', {
        method: 'POST',
        body: {},
      }),
    );
    expect(await screen.findByText('Securing HTTPS')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check HTTPS' })).toBeTruthy();
    expect(screen.getByText('g05ns7.up.railway.app')).toBeTruthy();
  });

  it('shows HTTPS Ready with ready_at and still no Make Primary for a custom domain', async () => {
    apiMock.mockResolvedValueOnce({ data: { stores: [existingStore] } }).mockResolvedValueOnce({
      data: {
        domains: [
          awjPrimary,
          verifiedCustom({
            status: 'ready',
            dns_instructions: { records: railwayRecords },
            ready_at: '2026-01-03T00:00:00Z',
            checked_at: '2026-01-03T00:00:00Z',
          }),
        ],
      },
    });

    renderPage();

    await screen.findByText('HTTPS Ready');
    expect(screen.getByText(/2026-01-03T00:00:00Z/)).toBeTruthy();
    expect(screen.getByText('Ownership verified')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Make Primary' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Activate Domain' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy();
  });

  it('shows last_error on failed activation and offers Retry without inventing DNS records', async () => {
    apiMock.mockResolvedValueOnce({ data: { stores: [existingStore] } }).mockResolvedValueOnce({
      data: {
        domains: [
          awjPrimary,
          verifiedCustom({
            status: 'failed',
            dns_instructions: { records: [] },
            last_error: 'تعذر إكمال التفعيل لدى مزوّد الحافة.',
          }),
        ],
      },
    });

    renderPage();

    await screen.findByText('Activation failed');
    expect(screen.getByText('تعذر إكمال التفعيل لدى مزوّد الحافة.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Activate Domain' })).toBeTruthy();
    expect(screen.queryByText('HTTPS DNS records')).toBeNull();
  });

  it('copies the exact backend DNS name and value', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    apiMock.mockResolvedValueOnce({ data: { stores: [existingStore] } }).mockResolvedValueOnce({
      data: {
        domains: [
          awjPrimary,
          verifiedCustom({
            status: 'dns_required',
            dns_instructions: { records: railwayRecords },
          }),
        ],
      },
    });

    renderPage();

    await screen.findByText('g05ns7.up.railway.app');
    fireEvent.click(screen.getAllByRole('button', { name: 'Copy value' })[0]);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('g05ns7.up.railway.app'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Copy name' })[0]);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('shop.example.com'));
  });

  it('renders long DNS values without inventing extra records', async () => {
    const longValue = `${'x'.repeat(180)}.up.railway.app`;
    apiMock.mockResolvedValueOnce({ data: { stores: [existingStore] } }).mockResolvedValueOnce({
      data: {
        domains: [
          awjPrimary,
          verifiedCustom({
            status: 'dns_required',
            dns_instructions: {
              records: [{ type: 'CNAME', name: 'shop.example.com', value: longValue }],
            },
          }),
        ],
      },
    });

    renderPage();

    expect(await screen.findByText(longValue)).toBeTruthy();
    expect(screen.getAllByText('CNAME')).toHaveLength(1);
  });
});
