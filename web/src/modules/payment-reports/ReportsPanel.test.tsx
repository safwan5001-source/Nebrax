// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl, TEST_LOCALES, TEST_MESSAGES, type TestLocale } from '@/test-utils/intl';
import { ApiError } from '@/lib/api';
import { ReportsPanel } from './ReportsPanel';

const apiMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), api: apiMock }));

const recon = (over: Record<string, unknown> = {}) => ({
  status: 'reconciled', mapping_state: 'mapped', ledger_balance: 95000, expected_balance: 95000, difference: 0,
  accounts: [{ account_id: 'a1', code: '1170', name: 'مستحقات بوابات الدفع', is_active: true, sources: ['current', 'system_default'], balance: 95000 }],
  documents: { captures: 115000, settled_gross: 0, refunds: 20000, deducted_refunds: 0, capture_count: 1, refund_count: 1, unsettled_captures: 115000, unsettled_refunds: 20000 },
  checks: [
    { key: 'captures', document: 115000, ledger: 115000, difference: 0 }, { key: 'refunds', document: 20000, ledger: 20000, difference: 0 },
    { key: 'settlements', document: 0, ledger: 0, difference: 0 }, { key: 'other', document: 0, ledger: 0, difference: 0 },
  ],
  other_sources: [],
  per_gateway: [{ payment_gateway_id: 'g1', gateway_name: 'ميسّر', unsettled_captures: 115000, unsettled_refunds: 20000, expected_balance: 95000 }],
  not_checked: ['per_branch_ledger', 'as_of_date', 'provider_statement', 'adjustment_reserve_accounts'],
  ...over,
});
const diffs = (over: Record<string, unknown> = {}) => ({
  rows: [
    { id: 's1', payment_gateway_id: 'g1', gateway_name: 'ميسّر', provider_settlement_ref: 'DIFF-A', settlement_date: '2026-10-13', age_days: 10, currency: 'SAR', gross_amount: 115000, net_bank_amount: 110500, unreconciled_minor: -500 },
    { id: 's2', payment_gateway_id: 'g1', gateway_name: 'ميسّر', provider_settlement_ref: 'DIFF-B', settlement_date: '2026-10-23', age_days: 0, currency: 'SAR', gross_amount: 115000, net_bank_amount: 111300, unreconciled_minor: 300 },
  ],
  has_more: false,
  totals: { count: 2, net_minor: -200, positive_minor: 300, negative_minor: -500, oldest_settlement_date: '2026-10-13' },
  ...over,
});
const aging = (over: Record<string, unknown> = {}) => ({
  as_of: '2026-10-23', bucket_days: [7, 30, 60], scope: 'company',
  rows: [
    { branch_id: 'b1', branch_name: 'الرئيسي', captures: { count: 2, total: 230000, buckets: [115000, 115000, 0, 0] }, refunds: { count: 1, total: 15000, buckets: [0, 0, 15000, 0] }, net: { total: 215000, buckets: [115000, 115000, -15000, 0] } },
    { branch_id: null, branch_name: null, captures: { count: 1, total: 115000, buckets: [0, 0, 0, 115000] }, refunds: { count: 0, total: 0, buckets: [0, 0, 0, 0] }, net: { total: 115000, buckets: [0, 0, 0, 115000] } },
  ],
  totals: {
    captures: { total: 345000, buckets: [115000, 115000, 0, 115000] }, refunds: { total: 15000, buckets: [0, 0, 15000, 0] }, net: { total: 330000, buckets: [115000, 115000, -15000, 115000] },
  },
  ...over,
});

function route(handlers: Record<string, () => unknown>) {
  apiMock.mockImplementation(async (path: string) => {
    const key = path.split('?')[0];
    const handler = handlers[path] ?? handlers[key];
    if (!handler) throw new Error(`unrouted ${path}`);
    const result = handler();
    if (result instanceof Error) throw result;
    return result;
  });
}
const gateways = { data: [{ id: 'g1', provider: 'moyasar', name: 'ميسّر', name_en: 'Moyasar', environment: 'sandbox', status: 'active' }] };
const branches = { data: [{ id: 'b1', code: '1', name: 'الرئيسي', is_main: true, is_active: true }, { id: 'b2', code: '2', name: 'فرع الشرق', is_main: false, is_active: true }] };

beforeEach(() => { apiMock.mockReset(); });
afterEach(cleanup);

describe.each(TEST_LOCALES)('ReportsPanel (%s)', (locale) => {
  const m = (k: string) => (TEST_MESSAGES[locale as TestLocale].paymentReports as Record<string, string>)[k];
  const goTab = (key: string) => fireEvent.click(screen.getAllByRole('tab').find((t) => t.textContent === m(key))!);

  it('shows the reconciled status, the three balances and the source checks', async () => {
    route({ '/payment-reports/clearing-reconciliation': () => ({ data: recon() }) });
    renderIntl(<ReportsPanel />, locale as TestLocale);
    await screen.findByText(m('recon_status_reconciled'));
    expect(screen.getAllByText(/950\.00/).length).toBeGreaterThan(0);
    expect(screen.getByText(m('check_captures'))).toBeTruthy();
    expect(screen.getByText(m('check_other'))).toBeTruthy();
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.getByText(m('not_checked_provider_statement'))).toBeTruthy();
  });

  it('highlights a difference and never hides activity from other sources', async () => {
    route({
      '/payment-reports/clearing-reconciliation': () => ({
        data: recon({
          status: 'difference', ledger_balance: 102000, difference: 7000,
          checks: [
            { key: 'captures', document: 115000, ledger: 115000, difference: 0 }, { key: 'refunds', document: 20000, ledger: 20000, difference: 0 },
            { key: 'settlements', document: 0, ledger: 0, difference: 0 }, { key: 'other', document: 0, ledger: 7000, difference: 7000 },
          ],
          other_sources: [{ source_type: null, debit: 7000, credit: 0 }],
        }),
      }),
    });
    const { container } = renderIntl(<ReportsPanel />, locale as TestLocale);
    await screen.findByText(m('recon_status_difference'));
    expect(screen.getByText(m('recon_other_note'))).toBeTruthy();
    const flagged = container.querySelectorAll('tr[data-difference="true"]');
    expect(flagged).toHaveLength(1);
    expect(within(flagged[0] as HTMLElement).getByText(m('check_other'))).toBeTruthy();
    expect(screen.getAllByText(/\+70\.00/).length).toBeGreaterThan(0);
  });

  it('explains company-wide reconciliation for a branch-restricted user instead of a generic error', async () => {
    route({ '/payment-reports/clearing-reconciliation': () => new ApiError(403, 'x', { error: { code: 'branch_scope_forbidden', message: 'x' } }) });
    renderIntl(<ReportsPanel />, locale as TestLocale);
    await screen.findByText(m('branch_scope_title'));
    expect(screen.queryByText(m('load_failed'))).toBeNull();
  });

  it('shows a retryable error for a server failure and the unresolved state without an account', async () => {
    route({ '/payment-reports/clearing-reconciliation': () => new ApiError(500, 'x', null) });
    renderIntl(<ReportsPanel />, locale as TestLocale);
    await screen.findByText(m('load_failed'));
    expect(screen.getByRole('button', { name: m('retry') })).toBeTruthy();
    cleanup();
    route({ '/payment-reports/clearing-reconciliation': () => ({ data: recon({ status: 'unresolved', mapping_state: 'unmapped', accounts: [], checks: [] }) }) });
    renderIntl(<ReportsPanel />, locale as TestLocale);
    await screen.findByText(m('recon_unresolved_title'));
    expect(screen.getByText(m('recon_unmapped'))).toBeTruthy();
  });

  it('lists differences with signed amounts, totals and a gateway filter', async () => {
    route({
      '/payment-reports/clearing-reconciliation': () => ({ data: recon() }),
      '/payment-gateways': () => gateways,
      '/payment-reports/settlement-differences': () => ({ data: diffs() }),
      '/payment-reports/settlement-differences?payment_gateway_id=g1': () => ({ data: diffs({ rows: [], totals: { count: 0, net_minor: 0, positive_minor: 0, negative_minor: 0, oldest_settlement_date: null } }) }),
    });
    renderIntl(<ReportsPanel />, locale as TestLocale);
    await screen.findByText(m('recon_status_reconciled'));
    goTab('tab_differences');
    await screen.findAllByText('DIFF-A');
    expect(screen.getAllByText(/−.*5\.00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\+.*3\.00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('2026-10-13').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText(m('filter_gateway')), { target: { value: 'g1' } });
    await waitFor(() => expect(apiMock.mock.calls.some((c) => c[0] === '/payment-reports/settlement-differences?payment_gateway_id=g1')).toBe(true));
    await screen.findByText(m('differences_empty'));
  });

  it('renders the aging table with a totals row, the unassigned-branch label and the branch filter', async () => {
    route({
      '/payment-reports/clearing-reconciliation': () => ({ data: recon() }),
      '/branches': () => branches,
      '/payment-reports/clearing-aging': () => ({ data: aging() }),
      '/payment-reports/clearing-aging?branch_id%5B%5D=b2': () => ({ data: aging({ rows: [], totals: { captures: { total: 0, buckets: [0, 0, 0, 0] }, refunds: { total: 0, buckets: [0, 0, 0, 0] }, net: { total: 0, buckets: [0, 0, 0, 0] } } }) }),
    });
    renderIntl(<ReportsPanel />, locale as TestLocale);
    await screen.findByText(m('recon_status_reconciled'));
    goTab('tab_aging');
    await screen.findByText('الرئيسي', { selector: 'td' });
    expect(screen.getByText(m('branch_unassigned'))).toBeTruthy();
    const totals = screen.getByTestId('aging-totals');
    expect(within(totals).getByText(m('totals_row'))).toBeTruthy();
    expect(within(totals).getAllByText(/3,450\.00/).length).toBeGreaterThan(0);
    expect(within(totals).getAllByText(/−.*150\.00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Over 60 days|أكثر من 60 يوماً/)).toHaveLength(3);

    fireEvent.click(screen.getByLabelText('فرع الشرق'));
    await waitFor(() => expect(apiMock.mock.calls.some((c) => c[0] === '/payment-reports/clearing-aging?branch_id%5B%5D=b2')).toBe(true));
    await screen.findByText(m('aging_empty'));
  });
});
