// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Membership, PartnerLinkState } from './api';

const locale = vi.hoisted(() => ({ current: 'en' }));
vi.mock('next-intl', () => {
  const t = (key: string) => key;
  t.rich = (key: string) => key;
  return { useLocale: () => locale.current, useTranslations: () => t };
});

const can = vi.hoisted(() => ({ allowed: new Set(['commerce.wholesale.manage']) }));
vi.mock('@/lib/use-can', () => ({ useCan: () => ({ hydrated: true, can: (p: string) => can.allowed.has(p) }) }));
vi.mock('../../channel-context', () => ({ useWholesaleChannel: () => ({ channelId: 'ch1', readiness: 'active' }) }));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => toast }));

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));

import { BuyersSection } from './buyers-section';

const membership = (over: Partial<Membership> = {}): Membership => ({
  id: 'm1',
  sales_channel_id: 'ch1',
  status: 'pending',
  applied_at: '2026-10-20T10:00:00+03:00',
  decided_at: null,
  decided_by: null,
  decision_note: null,
  customer: { id: 'u1', display_name: 'Najd Trading', email: 'buyer@najd.test', phone: '0500000009' },
  ...over,
});

const totals: Record<string, number> = { pending: 3, approved: 7, rejected: 1, suspended: 2 };

const NOT_LINKED: PartnerLinkState = {
  active: null,
  history: [],
  effective_price_list: { source: 'channel', price_list: { id: 'pl-ch', name: 'Channel list', is_active: true }, partner_list: null, channel_list: { id: 'pl-ch', name: 'Channel list', is_active: true } },
};
const LINKED: PartnerLinkState = {
  active: { id: 'l1', status: 'active', link_method: 'staff_verified_claim', partner: { id: 'p1', code: 'C-100', name: 'Horizon Co' }, linked_at: '2026-10-22T09:00:00+03:00', linked_by: { id: 'u9', name: 'Owner' }, revoked_at: null, revoked_by: null },
  history: [{ id: 'l1', status: 'active', link_method: 'staff_verified_claim', partner: { id: 'p1', code: 'C-100', name: 'Horizon Co' }, linked_at: '2026-10-22T09:00:00+03:00', linked_by: { id: 'u9', name: 'Owner' }, revoked_at: null, revoked_by: null }],
  effective_price_list: { source: 'partner', price_list: { id: 'pl-pt', name: 'Horizon list', is_active: true }, partner_list: { id: 'pl-pt', name: 'Horizon list', is_active: true }, channel_list: { id: 'pl-ch', name: 'Channel list', is_active: true } },
};
const PARTNERS = [{ id: 'p1', code: 'C-100', name: 'Horizon Co', name_en: null, phone: '0500000001', email: null, has_price_list: true }];

function mockServer(rows: Membership[], link: PartnerLinkState = NOT_LINKED) {
  apiMock.mockImplementation((path: string, options?: { method?: string }) => {
    if (path.includes('/partners/eligible')) return Promise.resolve({ data: PARTNERS });
    if (path.endsWith('/partner-link')) {
      if (options?.method === 'PUT') return Promise.resolve({ data: LINKED });
      if (options?.method === 'DELETE') return Promise.resolve({ data: NOT_LINKED });
      return Promise.resolve({ data: link });
    }
    if (options?.method === 'POST') return Promise.resolve({ data: membership({ status: 'approved', decided_at: '2026-10-21T10:00:00+03:00' }) });
    const params = new URL(path, 'http://x').searchParams;
    const perPage = Number(params.get('per_page'));
    if (perPage === 1) return Promise.resolve({ data: [], meta: { page: 1, per_page: 1, total: totals[params.get('status') ?? ''] ?? 0, last_page: 1 } });
    return Promise.resolve({ data: rows, meta: { page: 1, per_page: 25, total: rows.length, last_page: 1 } });
  });
}
const listCalls = () => apiMock.mock.calls.filter((c) => new URL(c[0], 'http://x').searchParams.get('per_page') === '25');

describe('BuyersSection', () => {
  beforeEach(() => {
    locale.current = 'en';
    can.allowed = new Set(['commerce.wholesale.manage']);
    apiMock.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
  });
  afterEach(cleanup);

  it('opens on the pending queue and shows real per-status counts', async () => {
    mockServer([membership()]);
    render(<BuyersSection />);
    await waitFor(() => expect(screen.getAllByText('Najd Trading').length).toBeGreaterThan(0));
    expect(new URL(listCalls()[0][0], 'http://x').searchParams.get('status')).toBe('pending');
    const tab = await screen.findByRole('tab', { name: /Pending review/ });
    await waitFor(() => expect(tab.textContent).toContain('3'));
    expect(screen.getByRole('tab', { name: /Approved/ }).textContent).toContain('7');
    expect(screen.getByRole('tab', { name: /Suspended/ }).textContent).toContain('2');
  });

  it('switches the status filter server-side and resets to page 1', async () => {
    mockServer([membership({ status: 'approved' })]);
    render(<BuyersSection />);
    await screen.findAllByText('Najd Trading');
    fireEvent.click(screen.getByRole('tab', { name: /Approved/ }));
    await waitFor(() => expect(listCalls().some((c) => new URL(c[0], 'http://x').searchParams.get('status') === 'approved')).toBe(true));
    fireEvent.click(screen.getByRole('tab', { name: /All/ }));
    await waitFor(() => expect(listCalls().some((c) => !new URL(c[0], 'http://x').searchParams.has('status'))).toBe(true));
  });

  it('offers only approve/reject for a pending buyer and approves with a confirmed note', async () => {
    mockServer([membership()]);
    render(<BuyersSection />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Details' }))[0]);
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Reject' })).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: 'Suspend' })).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Decision note/), { target: { value: 'Verified CR' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Buyer approved.'));
    const post = apiMock.mock.calls.find((c) => c[1]?.method === 'POST')!;
    expect(post[0]).toBe('/commerce/wholesale/memberships/m1/approve');
    expect(post[1].body).toEqual({ note: 'Verified CR' });
    expect(JSON.stringify(post)).not.toContain('tenant');
  });

  it('offers only suspend for an approved buyer and nothing for a rejected one', async () => {
    mockServer([membership({ status: 'approved' })]);
    const { unmount } = render(<BuyersSection />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Details' }))[0]);
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('button', { name: 'Suspend' })).toBeTruthy();
    expect(within(sheet).queryByRole('button', { name: 'Approve' })).toBeNull();
    unmount();
    cleanup();
    mockServer([membership({ status: 'rejected', decided_at: '2026-10-21T10:00:00+03:00', decision_note: 'Incomplete CR' })]);
    render(<BuyersSection />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Details' }))[0]);
    const rejectedSheet = await screen.findByRole('dialog');
    expect(within(rejectedSheet).getByText('Incomplete CR')).toBeTruthy();
    expect(within(rejectedSheet).queryAllByRole('button').filter((b) => /Approve|Reject|Suspend|Reinstate/.test(b.textContent ?? ''))).toHaveLength(0);
  });

  it('shows a friendly conflict message and refreshes when another user already decided', async () => {
    mockServer([membership()]);
    render(<BuyersSection />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Details' }))[0]);
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog');
    const before = apiMock.mock.calls.length;
    apiMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (options?.method === 'POST') return Promise.reject(Object.assign(new Error('x'), { status: 409, body: { reason: 'invalid_transition' } }));
      return Promise.resolve({ data: [], meta: { page: 1, per_page: 25, total: 0, last_page: 1 } });
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    await within(dialog).findByText(/already changed by another user/);
    expect(toast.error).toHaveBeenCalled();
    await waitFor(() => expect(apiMock.mock.calls.length).toBeGreaterThan(before + 1));
  });

  it('shows the permission wall state from the server and an honest empty state', async () => {
    apiMock.mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
    render(<BuyersSection />);
    expect(await screen.findByText('You do not have access to this section')).toBeTruthy();
    cleanup();
    mockServer([]);
    render(<BuyersSection />);
    expect(await screen.findByText('No applications with this status')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /All/ }));
    expect(await screen.findByText('No membership applications')).toBeTruthy();
  });

  describe('partner linking (Batch M)', () => {
    const open = async (rows: Membership[], link?: PartnerLinkState) => {
      mockServer(rows, link);
      render(<BuyersSection />);
      fireEvent.click((await screen.findAllByRole('button', { name: 'Details' }))[0]);
    };
    const writes = () => apiMock.mock.calls.filter((c) => (c[1] as { method?: string } | undefined)?.method && (c[1] as { method: string }).method !== 'GET');

    it('shows the effective price list and links a searched customer sending only a partner id', async () => {
      can.allowed = new Set(['commerce.wholesale.manage', 'customer_access.manage']);
      await open([membership({ status: 'approved' })]);
      expect((await screen.findByTestId('effective-price-list')).textContent).toContain('Channel list');
      fireEvent.change(await screen.findByLabelText('Find a customer'), { target: { value: 'hor' } });
      fireEvent.click(await screen.findByRole('button', { name: 'Link' }));
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Buyer linked to the customer.'));
      const put = writes().find((c) => (c[1] as { method: string }).method === 'PUT')!;
      expect(put[0]).toContain('/memberships/m1/partner-link');
      expect((put[1] as { body: unknown }).body).toEqual({ partner_id: 'p1' }); // never a tenant, price list or actor
      expect((await screen.findByTestId('effective-price-list')).textContent).toContain('Horizon list');
      expect(screen.getAllByText('Horizon Co').length).toBeGreaterThan(0);
    });

    it('unlinks only after an explicit confirmation and shows the audit trail', async () => {
      can.allowed = new Set(['commerce.wholesale.manage', 'customer_access.manage']);
      await open([membership({ status: 'approved', partner_link: { partner_id: 'p1', partner_name: 'Horizon Co', partner_code: 'C-100' } })], LINKED);
      expect(await screen.findByText('Link history')).toBeTruthy();
      expect(screen.getAllByText(/by Owner/).length).toBeGreaterThan(0);
      fireEvent.click(await screen.findByRole('button', { name: 'Unlink' }));
      expect(writes()).toHaveLength(0);
      fireEvent.click(await screen.findByRole('button', { name: 'Confirm' }));
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Buyer unlinked.'));
      expect(writes().map((c) => (c[1] as { method: string }).method)).toEqual(['DELETE']);
    });

    it('offers no link controls without BOTH permissions and says why', async () => {
      can.allowed = new Set(['commerce.wholesale.manage']);
      await open([membership({ status: 'approved' })]);
      expect(await screen.findByText(/needs both the wholesale-management and customer-access permissions/)).toBeTruthy();
      expect(screen.queryByLabelText('Find a customer')).toBeNull();
    });

    it('does not render the panel for a pending buyer', async () => {
      can.allowed = new Set(['commerce.wholesale.manage', 'customer_access.manage']);
      await open([membership({ status: 'pending' })]);
      await screen.findByText('Buyer details').catch(() => undefined);
      expect(screen.queryByText('Link buyer to an AWJ customer')).toBeNull();
    });

    it('maps a server refusal to a friendly message and keeps the state', async () => {
      can.allowed = new Set(['commerce.wholesale.manage', 'customer_access.manage']);
      await open([membership({ status: 'approved' })]);
      apiMock.mockImplementationOnce(() => Promise.resolve({ data: PARTNERS })); // search results
      fireEvent.change(await screen.findByLabelText('Find a customer'), { target: { value: 'hor' } });
      const button = await screen.findByRole('button', { name: 'Link' });
      apiMock.mockImplementation(() => Promise.reject(Object.assign(new Error('x'), { status: 409, body: { reason: 'already_linked' } })));
      fireEvent.click(button);
      expect(await screen.findByText(/already has an active link to another customer/)).toBeTruthy();
      expect(toast.error).toHaveBeenCalled();
    });
  });

  it('renders in Arabic', async () => {
    locale.current = 'ar';
    mockServer([membership()]);
    render(<BuyersSection />);
    expect((await screen.findAllByText('بانتظار المراجعة')).length).toBeGreaterThan(0);
  });
});
