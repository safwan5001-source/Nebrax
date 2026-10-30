// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Membership } from './api';

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

function mockServer(rows: Membership[]) {
  apiMock.mockImplementation((path: string, options?: { method?: string }) => {
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

  it('declares partner linking unavailable with the exact blocker and renders no link control', async () => {
    mockServer([]);
    render(<BuyersSection />);
    const panel = await screen.findByTestId('deferred-capability');
    expect(panel.textContent).toContain('D-B3');
    expect(panel.querySelector('button, input, select, a')).toBeNull();
  });

  it('renders in Arabic', async () => {
    locale.current = 'ar';
    mockServer([membership()]);
    render(<BuyersSection />);
    expect((await screen.findAllByText('بانتظار المراجعة')).length).toBeGreaterThan(0);
  });
});
