// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const locale = vi.hoisted(() => ({ current: 'en' }));
vi.mock('next-intl', () => {
  const t = (key: string) => key;
  return { useLocale: () => locale.current, useTranslations: () => t };
});
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const can = vi.hoisted(() => ({ allowed: new Set<string>() }));
vi.mock('@/lib/use-can', () => ({ useCan: () => ({ hydrated: true, can: (p: string) => can.allowed.has(p) }) }));
vi.mock('../../channel-context', () => ({ useWholesaleChannel: () => ({ readiness: 'deployment_off', channelId: 'c1', store: { id: 's1', name: 'S' } }) }));

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));

import { CREDIT_SAMPLE_SIZE, mapCreditSample } from './api';
import { PaymentsSection } from './payments-section';

const methods = {
  data: [
    { id: 'm1', name: 'Cash', settlement_type: 'cash', cash_bank_account_name: 'Main treasury', available_online: true, is_active: true, is_default: true },
    { id: 'm2', name: 'Bank transfer', settlement_type: 'bank', cash_bank_account_name: 'Main bank', available_online: false, is_active: false, is_default: false },
  ],
};
const online = {
  data: [
    { key: 'mada', status: 'enabled', enabled: true, ready: true, customer_visible: true, effective_gateway: { id: 'g1', name: 'Gateway One' } },
    { key: 'apple_pay', status: 'needs_setup', enabled: false, ready: false, customer_visible: false, effective_gateway: null },
  ],
};
const partner = (over: Record<string, unknown>) => ({ id: 'p', name: 'P', code: null, credit_limit: null, credit_period: null, is_active: true, ...over });
const partners = {
  data: [
    partner({ id: 'p1', name: 'No terms' }),
    partner({ id: 'p2', name: 'Small Co', credit_limit: '500.00', credit_period: 15 }),
    partner({ id: 'p3', name: 'Big Co', credit_limit: '25000.00', credit_period: 60 }),
  ],
};

function route(over: Record<string, unknown> = {}) {
  apiMock.mockImplementation(async (path: string) => {
    if (path in over) {
      const value = over[path];
      if (value instanceof Error) throw value;
      return value;
    }
    if (path === '/payment-methods') return methods;
    if (path === '/online-payment-methods') return online;
    if (path.startsWith('/partners')) return partners;
    throw new Error(`unexpected ${path}`);
  });
}

describe('PaymentsSection', () => {
  beforeEach(() => {
    locale.current = 'en';
    can.allowed = new Set(['payments.view', 'partners.view']);
    apiMock.mockReset();
    route();
  });
  afterEach(cleanup);

  it('sends no request without payments.view', () => {
    can.allowed = new Set(['partners.view']);
    render(<PaymentsSection />);
    expect(screen.getByText('You do not have access to this section')).toBeTruthy();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('reads the three endpoints (read-only) and shows methods with their settlement and account', async () => {
    render(<PaymentsSection />);
    await waitFor(() => expect(screen.getAllByText('Bank transfer').length).toBeGreaterThan(0));
    const paths = apiMock.mock.calls.map((call) => call[0] as string);
    expect(paths).toContain('/payment-methods');
    expect(paths).toContain('/online-payment-methods');
    expect(paths).toContain(`/partners?type=customer&per_page=${CREDIT_SAMPLE_SIZE}`);
    expect(apiMock.mock.calls.every((call) => call[1] === undefined)).toBe(true); // GET only
    expect(JSON.stringify(apiMock.mock.calls)).not.toContain('tenant');
    expect(screen.getAllByText('Main treasury').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Default').length).toBeGreaterThan(0);
  });

  it('shows online method readiness from the server and the effective gateway', async () => {
    render(<PaymentsSection />);
    await waitFor(() => expect(screen.getAllByTestId('online-method')).toHaveLength(2));
    const [mada, apple] = screen.getAllByTestId('online-method');
    expect(within(mada).getByText('mada')).toBeTruthy();
    expect(within(mada).getByText('Enabled and ready')).toBeTruthy();
    expect(within(mada).getByText('Gateway One')).toBeTruthy();
    expect(within(apple).getByText('Needs setup')).toBeTruthy();
    expect(within(apple).getByText('No gateway')).toBeTruthy();
  });

  it('links to Finance settings and the AWJ customer screen instead of managing here', async () => {
    render(<PaymentsSection />);
    await waitFor(() => expect(screen.getAllByText('Big Co').length).toBeGreaterThan(0));
    expect(screen.getByRole('link', { name: /Manage payment methods/ }).getAttribute('href')).toBe('/finance-settings/payments');
    expect(screen.getAllByRole('link', { name: /Big Co/ })[0].getAttribute('href')).toBe('/partners/p3');
    expect(screen.getByRole('link', { name: 'All customers in AWJ' }).getAttribute('href')).toBe('/partners');
  });

  it('lists only customers with credit terms, biggest limit first, as a bounded sample', async () => {
    render(<PaymentsSection />);
    await waitFor(() => expect(screen.getByTestId('credit-sample')).toBeTruthy());
    expect(screen.getByTestId('credit-sample').textContent).toContain('Checked the latest 3 customers. 2 of them');
    expect(screen.getByTestId('credit-sample').textContent).not.toContain('cap');
    expect(screen.queryByText('No terms')).toBeNull();
    const names = screen.getAllByRole('link', { name: /Open customer card/ }).map((a) => a.textContent);
    expect(names.indexOf('Big Co')).toBeLessThan(names.indexOf('Small Co'));
    expect(screen.getAllByText(/25,000\.00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('60 days').length).toBeGreaterThan(0);
  });

  it('warns that a full sample may be incomplete (no server-side credit filter or total)', async () => {
    const many = { data: Array.from({ length: CREDIT_SAMPLE_SIZE }, (_, i) => partner({ id: `x${i}`, name: `C${i}`, credit_limit: '1.00' })) };
    route({ [`/partners?type=customer&per_page=${CREDIT_SAMPLE_SIZE}`]: many });
    render(<PaymentsSection />);
    await waitFor(() => expect(screen.getByTestId('credit-sample').textContent).toMatch(/reached the screen’s cap \(100\)/));
  });

  it('never implies credit is enforced: states it is not evaluated on wholesale orders and the link is unavailable', async () => {
    render(<PaymentsSection />);
    await waitFor(() => expect(screen.getAllByText('Big Co').length).toBeGreaterThan(0));
    const panels = screen.getAllByTestId('deferred-capability');
    expect(panels).toHaveLength(2);
    expect(panels[0].textContent).toContain('Credit is not evaluated on wholesale orders');
    expect(panels[0].textContent).toMatch(/D-P1 \/ B4/);
    expect(panels[1].textContent).toContain('no staff API to create this link');
    expect(panels[1].textContent).toContain('D-B3');
    for (const panel of panels) expect(panel.querySelector('input,button,select')).toBeNull();
  });

  it('does not request customers without partners.view and says why', async () => {
    can.allowed = new Set(['payments.view']);
    render(<PaymentsSection />);
    await waitFor(() => expect(screen.getAllByText('Bank transfer').length).toBeGreaterThan(0));
    expect(apiMock.mock.calls.some((call) => String(call[0]).startsWith('/partners'))).toBe(false);
    expect(screen.getByText('You cannot view customers')).toBeTruthy();
  });

  it('isolates failures: a failing credit list does not blank the methods', async () => {
    route({ [`/partners?type=customer&per_page=${CREDIT_SAMPLE_SIZE}`]: Object.assign(new Error('x'), { status: 500 }) });
    render(<PaymentsSection />);
    await waitFor(() => expect(screen.getByText('Could not load the data.')).toBeTruthy());
    expect(screen.getAllByText('Bank transfer').length).toBeGreaterThan(0);
  });

  it('renders in Arabic with the Arabic section heading', async () => {
    locale.current = 'ar';
    render(<PaymentsSection />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('المدفوعات والائتمان');
    await waitFor(() => expect(screen.getAllByText('Bank transfer').length).toBeGreaterThan(0));
    expect(screen.getByText('الائتمان لا يُقيَّم عند طلب الجملة')).toBeTruthy();
  });
});

describe('mapCreditSample', () => {
  it('keeps zero limits (a recorded value) and drops customers with neither field', () => {
    const sample = mapCreditSample({ data: [partner({ id: 'a', name: 'Zero', credit_limit: '0.00' }), partner({ id: 'b', name: 'None' })] });
    expect(sample.withTerms.map((p) => p.name)).toEqual(['Zero']);
    expect(sample.inspected).toBe(2);
    expect(sample.truncated).toBe(false);
  });
});
