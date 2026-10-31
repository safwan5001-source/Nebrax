// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const locale = vi.hoisted(() => ({ current: 'en' }));
vi.mock('next-intl', () => {
  const t = Object.assign((key: string) => key, { rich: (key: string) => key });
  return { useLocale: () => locale.current, useTranslations: () => t };
});
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const can = vi.hoisted(() => ({ allowed: new Set<string>() }));
vi.mock('@/lib/use-can', () => ({ useCan: () => ({ hydrated: true, can: (p: string) => can.allowed.has(p) }) }));
// readiness must NOT matter: quotations are available even when wholesale is dark
vi.mock('../../channel-context', () => ({
  useWholesaleChannel: () => ({ readiness: 'deployment_off', store: { id: 's1', name: 'Store' }, channelId: 'c1' }),
}));

const apiFns = vi.hoisted(() => ({ loadQuotesOverview: vi.fn() }));
vi.mock('./api', async () => ({ ...(await vi.importActual<object>('./api')), ...apiFns }));

import { QuotationsSection } from './quotations-section';

const q = (id: string, status: string, partner: string, total = '115.00') => ({
  id, number: `QT-${id}`, partner_id: partner, status, quote_date: '2026-03-01', valid_until: '2026-04-01', total,
});
const overview = (over = {}) => ({
  quotes: [q('1', 'draft', 'c1'), q('2', 'sent', 'c2', '2300.50'), q('3', 'converted', 'c1')],
  customers: { c1: 'Al Noor Trading', c2: 'Beta Foods' },
  ...over,
});

beforeEach(() => {
  locale.current = 'en';
  can.allowed = new Set(['invoices.view', 'invoices.manage', 'partners.view']);
  apiFns.loadQuotesOverview.mockReset().mockResolvedValue(overview());
});
afterEach(cleanup);

describe('QuotationsSection', () => {
  it('lists quotes with customer, status and total, and says quotes are not channel-scoped', async () => {
    render(<QuotationsSection />);
    await waitFor(() => expect(screen.getAllByText('QT-1').length).toBeGreaterThan(0));
    expect(apiFns.loadQuotesOverview).toHaveBeenCalledWith(true);
    expect(screen.getAllByText('Al Noor Trading').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2,300\.50/).length).toBeGreaterThan(0);
    expect(screen.getByText(/no sales-channel field/)).toBeTruthy();
  });

  it('deep-links into the existing quote screens instead of re-implementing the workflow', async () => {
    render(<QuotationsSection />);
    await waitFor(() => screen.getAllByText('QT-1'));
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/quotes/1');
    expect(hrefs).toContain('/quotes/new');
    expect(hrefs).toContain('/quotes');
    // no write controls of its own
    expect(screen.queryByRole('button', { name: /issue|revise|convert/i })).toBeNull();
  });

  it('counts come from the loaded quotes, per status', async () => {
    render(<QuotationsSection />);
    await waitFor(() => screen.getAllByText('QT-1'));
    const cards = screen.getAllByTestId('stat-card').map((c) => c.textContent);
    expect(cards.find((c) => c?.includes('All quotes'))).toContain('3');
    expect(cards.find((c) => c?.startsWith('Draft'))).toContain('1');
    expect(cards.find((c) => c?.startsWith('Accepted'))).toContain('0');
  });

  it('filters by status and by search on the loaded list', async () => {
    render(<QuotationsSection />);
    await waitFor(() => screen.getAllByText('QT-1'));
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'sent' } });
    expect(screen.queryByText('QT-1')).toBeNull();
    expect(screen.getAllByText('QT-2').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Search by quote number or customer name'), { target: { value: 'zzz' } });
    expect(screen.getByText('No matching results')).toBeTruthy();
  });

  it('hides "new quotation" without invoices.manage and omits customer names without partners.view', async () => {
    can.allowed = new Set(['invoices.view']);
    apiFns.loadQuotesOverview.mockResolvedValue(overview({ customers: null }));
    render(<QuotationsSection />);
    await waitFor(() => screen.getAllByText('QT-1'));
    expect(apiFns.loadQuotesOverview).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('link', { name: /New quotation/ })).toBeNull();
    expect(screen.getByText(/Customer names are not shown/)).toBeTruthy();
    expect(screen.queryByText('Al Noor Trading')).toBeNull();
  });

  it('is denied without invoices.view and sends no request', () => {
    can.allowed = new Set();
    render(<QuotationsSection />);
    expect(screen.getByText('You do not have access to this section')).toBeTruthy();
    expect(apiFns.loadQuotesOverview).not.toHaveBeenCalled();
  });

  it('pages the visible rows 25 at a time', async () => {
    apiFns.loadQuotesOverview.mockResolvedValue(overview({ quotes: Array.from({ length: 30 }, (_, i) => q(String(i + 1), 'draft', 'c1')) }));
    render(<QuotationsSection />);
    await waitFor(() => screen.getAllByText('QT-1'));
    expect(screen.queryByText('QT-30')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(screen.getAllByText('QT-30').length).toBeGreaterThan(0);
  });

  it('shows empty, error-with-retry and forbidden states', async () => {
    apiFns.loadQuotesOverview.mockResolvedValueOnce(overview({ quotes: [] }));
    const { unmount } = render(<QuotationsSection />);
    await waitFor(() => screen.getByText('No quotations'));
    unmount();

    apiFns.loadQuotesOverview.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 500 })).mockResolvedValue(overview());
    render(<QuotationsSection />);
    await waitFor(() => screen.getByRole('alert'));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => screen.getAllByText('QT-1'));
  });

  it('shows the permission state on a server 403', async () => {
    apiFns.loadQuotesOverview.mockRejectedValue(Object.assign(new Error('x'), { status: 403 }));
    render(<QuotationsSection />);
    await waitFor(() => screen.getByText('You do not have access to this section'));
  });

  it('renders Arabic', async () => {
    locale.current = 'ar';
    render(<QuotationsSection />);
    await waitFor(() => screen.getAllByText('QT-1'));
    expect(screen.getByText('أحدث عروض الأسعار')).toBeTruthy();
  });
});
