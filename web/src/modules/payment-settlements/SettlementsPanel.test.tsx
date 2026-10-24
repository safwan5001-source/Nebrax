// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl, TEST_LOCALES, TEST_MESSAGES, type TestLocale } from '@/test-utils/intl';
import { ApiError } from '@/lib/api';
import { SettlementsPanel } from './SettlementsPanel';
import { RecordSettlementDialog } from './RecordSettlementDialog';
import type { GatewayConnection } from '@/modules/payments/gateways/contract';

const state = vi.hoisted(() => ({ perms: new Set<string>() }));
const apiMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), api: apiMock }));
vi.mock('@/lib/use-can', () => ({
  useCan: () => ({ can: (p: string) => state.perms.has(p), hydrated: true }),
  useCurrentUser: () => ({ id: 'u-admin', name: 'x', email: 'x@x', role: 'admin', tenant_id: 't' }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn(), ...toastMock }) }));

const settlement = (over: Record<string, unknown> = {}) => ({
  id: 's1', payment_gateway_id: 'g1', gateway_name: 'ميسّر', provider_settlement_ref: 'SET-001', settlement_date: '2026-10-23', status: 'posted', currency: 'SAR',
  gross_amount: 115000, net_bank_amount: 111000, provider_fee_ex_tax: 4000, provider_fee_tax: 0, provider_deductions: 0, provider_credits: 0, refunds_total: 0,
  unreconciled_minor: null, journal_entry_id: 'j1234567-0000', posted_at: '2026-10-23T09:00:00Z', ...over,
});
const gateway = (over: Partial<GatewayConnection> = {}): GatewayConnection => ({
  id: 'g1', provider: 'moyasar', name: 'ميسّر', name_en: 'Moyasar', environment: 'sandbox', status: 'active', is_usable: true, merchant_reference: null, publishable_key: null,
  has_secret_key: true, has_webhook_secret: true, has_extra_credentials: false, credential_version: 1, previous_secret_valid_until: null, verified_at: null, activated_at: null,
  deactivated_at: null, created_at: null, ...over,
});
const preview = (over: Record<string, unknown> = {}) => ({
  gross: 115000, refunds_total: 0, net_bank_amount: 111000, provider_fee_ex_tax: 4000, provider_fee_tax: 0, provider_deductions: 0, provider_credits: 0,
  adjustments_deductions: 0, adjustments_credits: 0, difference: 0, reconciled: true, postable: true, saveable_as_unreconciled: false, replay: false, existing_status: null,
  blockers: [], ...over,
});
const banks = { data: [{ id: 'b1', name: 'الراجحي', type: 'bank', is_active: true, is_main: true }, { id: 'c1', name: 'الصندوق', type: 'cash', is_active: true, is_main: true }] };
const payments = { data: [{ payment_id: 'p1', number: 'PAY-1', date: '2026-10-20', amount: 115000, settled: 0, remaining: 115000, partner_id: null }], meta: { page: 1, per_page: 100, has_more: false } };
const refunds = { data: [{ refund_id: 'r1', number: 'PRF-1', amount: 10000, deducted: 0, remaining: 10000, partner_id: null, currency: 'SAR', accounting_date: '2026-10-22' }], meta: { page: 1, per_page: 100, has_more: false } };

function route(handlers: Record<string, (body?: unknown) => unknown>) {
  apiMock.mockImplementation(async (path: string, options?: { method?: string; body?: unknown }) => {
    const key = `${options?.method ?? 'GET'} ${path.split('?')[0]}`;
    const handler = handlers[key];
    if (!handler) throw new Error(`unrouted ${key}`);
    const result = await handler(options?.body);
    if (result instanceof Error) throw result;
    return result;
  });
}
const base = () => ({
  'GET /payment-gateways': () => ({ data: [gateway()] }),
  'GET /cash-bank-accounts': () => banks,
  'GET /payment-gateways/g1/unsettled-payments': () => payments,
  'GET /payment-gateways/g1/unsettled-refunds': () => refunds,
  'GET /payment-gateway-adjustments': () => ({ data: [], meta: { total: 0, page: 1, per_page: 100, last_page: 1 } }),
});

beforeEach(() => {
  state.perms = new Set(['payments.view', 'payment_settlements.manage']);
  apiMock.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
});
afterEach(cleanup);

describe.each(TEST_LOCALES)('SettlementsPanel (%s)', (locale) => {
  const m = (k: string) => (TEST_MESSAGES[locale as TestLocale].paymentSettlements as Record<string, string>)[k];

  it('lists posted and unreconciled settlements, with the signed difference on drafts', async () => {
    route({
      ...base(),
      'GET /payment-gateway-settlements': () => ({
        data: [settlement(), settlement({ id: 's2', provider_settlement_ref: 'SET-002', status: 'unreconciled', unreconciled_minor: -500, journal_entry_id: null, posted_at: null })],
        meta: { total: 2, page: 1, per_page: 25, last_page: 1 },
      }),
    });
    renderIntl(<SettlementsPanel refreshKey={0} onChanged={vi.fn()} />, locale as TestLocale);
    await screen.findAllByText('SET-001');
    expect(screen.getAllByText(m('status_posted')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(m('status_unreconciled')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/−.*5/).length).toBeGreaterThan(0);
  });

  it('hides the record button without payment_settlements.manage', async () => {
    state.perms = new Set(['payments.view']);
    route({ ...base(), 'GET /payment-gateway-settlements': () => ({ data: [settlement()], meta: { total: 1, page: 1, per_page: 25, last_page: 1 } }) });
    renderIntl(<SettlementsPanel refreshKey={0} onChanged={vi.fn()} />, locale as TestLocale);
    await screen.findAllByText('SET-001');
    expect(screen.queryByRole('button', { name: m('record_open') })).toBeNull();
  });

  it('shows a server load failure instead of an empty list', async () => {
    route({ ...base(), 'GET /payment-gateway-settlements': () => new ApiError(500, 'x', null) });
    renderIntl(<SettlementsPanel refreshKey={0} onChanged={vi.fn()} />, locale as TestLocale);
    await screen.findAllByText(m('load_failed'));
  });
});

describe.each(TEST_LOCALES)('RecordSettlementDialog (%s)', (locale) => {
  const m = (k: string) => (TEST_MESSAGES[locale as TestLocale].paymentSettlements as Record<string, string>)[k];
  const open = (gateways: GatewayConnection[] = [gateway()], onDone = vi.fn()) => renderIntl(<RecordSettlementDialog gateways={gateways} onClose={vi.fn()} onDone={onDone} />, locale as TestLocale);

  async function fillBasics() {
    fireEvent.change(await screen.findByLabelText(m('field_gateway')), { target: { value: 'g1' } });
    const dialog = screen.getByRole('dialog');
    await within(dialog).findByText('PAY-1');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'PAY-1' }));
    fireEvent.change(screen.getByLabelText(m('field_ref')), { target: { value: 'SET-NEW' } });
    fireEvent.change(screen.getByLabelText(m('field_net')), { target: { value: '1110' } });
    fireEvent.change(screen.getByLabelText(m('field_fee')), { target: { value: '40' } });
  }

  it('posts when the server preview is reconciled and reports a posted toast', async () => {
    const onDone = vi.fn();
    route({
      ...base(),
      'POST /payment-gateway-settlements/preview': () => ({ data: preview() }),
      'POST /payment-gateway-settlements': () => ({ data: { ...settlement({ provider_settlement_ref: 'SET-NEW' }), items: [], lines: [] } }),
    });
    open([gateway()], onDone);
    await fillBasics();
    const post = await screen.findByRole('button', { name: m('submit_post') });
    await waitFor(() => expect((post as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(post);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(toastMock.success).toHaveBeenCalledWith(m('done_posted'));
    const call = apiMock.mock.calls.find((c) => c[0] === '/payment-gateway-settlements' && c[1]?.method === 'POST')!;
    expect(call[1].body).toMatchObject({
      payment_gateway_id: 'g1', cash_bank_account_id: 'b1', provider_settlement_ref: 'SET-NEW', net_bank_amount: 111000, provider_fee_ex_tax: 4000,
      items: [{ payment_id: 'p1', gross_amount: 115000 }],
    });
    expect(call[1].body).not.toHaveProperty('provider_fee_tax');
  });

  it('offers "save as unreconciled" with an explanation when the difference is unexplained', async () => {
    route({
      ...base(),
      'POST /payment-gateway-settlements/preview': () => ({ data: preview({ difference: 500, reconciled: false, postable: false, saveable_as_unreconciled: true, blockers: [{ code: 'unreconciled_difference', message: 'diff' }] }) }),
      'POST /payment-gateway-settlements': () => ({ data: { ...settlement({ status: 'unreconciled', unreconciled_minor: 500 }), items: [], lines: [] } }),
    });
    const onDone = vi.fn();
    open([gateway()], onDone);
    await fillBasics();
    const save = await screen.findByRole('button', { name: m('submit_unreconciled') });
    expect(screen.queryByRole('button', { name: m('submit_post') })).toBeNull();
    expect(screen.getByText(m('unreconciled_explain'))).toBeTruthy();
    await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(save);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(toastMock.success).toHaveBeenCalledWith(m('done_unreconciled'));
  });

  it('disables the action when the preview is neither postable nor saveable, and names the blocker', async () => {
    route({
      ...base(),
      'POST /payment-gateway-settlements/preview': () => ({ data: preview({ postable: false, reconciled: false, difference: 500, blockers: [{ code: 'period_locked', message: 'locked' }] }) }),
    });
    open();
    await fillBasics();
    await screen.findByText(m('error_period_locked'));
    const button = screen.getByRole('button', { name: m('submit_post') }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('hides the fee-tax inputs for the default policy and for input_vat without the recorded opinion', async () => {
    route({ ...base(), 'POST /payment-gateway-settlements/preview': () => ({ data: preview() }) });
    open([gateway({ fee_tax_policy: 'input_vat', fee_tax_opinion_recorded: false })]);
    fireEvent.change(await screen.findByLabelText(m('field_gateway')), { target: { value: 'g1' } });
    await screen.findByText(m('fee_tax_closed'));
    expect(screen.queryByLabelText(m('field_fee_tax'))).toBeNull();
    expect(screen.queryByLabelText(m('field_fee_tax_ref'))).toBeNull();
  });

  it('shows the fee-tax inputs and sends them only for input_vat with the recorded opinion', async () => {
    route({ ...base(), 'POST /payment-gateway-settlements/preview': () => ({ data: preview({ provider_fee_tax: 600 }) }) });
    open([gateway({ fee_tax_policy: 'input_vat', fee_tax_opinion_recorded: true })]);
    await fillBasics();
    fireEvent.change(await screen.findByLabelText(m('field_fee_tax')), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText(m('field_fee_tax_ref')), { target: { value: 'INV-77' } });
    await waitFor(() => {
      const last = [...apiMock.mock.calls].reverse().find((c) => c[0] === '/payment-gateway-settlements/preview');
      expect(last?.[1].body).toMatchObject({ provider_fee_tax: 600, fee_tax_invoice_ref: 'INV-77' });
    });
  });

  it('lists refunds only for a user who can view payment refunds', async () => {
    route({ ...base(), 'POST /payment-gateway-settlements/preview': () => ({ data: preview() }) });
    const { unmount } = open();
    fireEvent.change(await screen.findByLabelText(m('field_gateway')), { target: { value: 'g1' } });
    await screen.findByText('PAY-1');
    expect(screen.queryByTestId('rs-refunds')).toBeNull();
    expect(apiMock.mock.calls.some((c) => String(c[0]).includes('unsettled-refunds'))).toBe(false);
    unmount();
    cleanup();

    state.perms = new Set(['payments.view', 'payment_settlements.manage', 'payment_refunds.view']);
    open();
    fireEvent.change(await screen.findByLabelText(m('field_gateway')), { target: { value: 'g1' } });
    await screen.findByText('PRF-1');
    expect(screen.getByTestId('rs-refunds')).toBeTruthy();
  });

  it('ignores a stale preview that resolves after a newer one', async () => {
    let releaseFirst: (v: unknown) => void = () => {};
    let calls = 0;
    route({
      ...base(),
      'POST /payment-gateway-settlements/preview': () => {
        calls += 1;
        if (calls === 1) return new Promise((resolve) => { releaseFirst = resolve; });
        return { data: preview({ postable: false, reconciled: false, saveable_as_unreconciled: true, difference: 700 }) };
      },
    });
    open();
    await fillBasics();
    await waitFor(() => expect(calls).toBe(1));
    fireEvent.change(screen.getByLabelText(m('field_net')), { target: { value: '1100' } });
    await screen.findByRole('button', { name: m('submit_unreconciled') });
    await act(async () => { releaseFirst({ data: preview() }); });
    expect(screen.getByRole('button', { name: m('submit_unreconciled') })).toBeTruthy();
    expect(screen.queryByRole('button', { name: m('submit_post') })).toBeNull();
  });

  it('translates a server rejection by its stable code and keeps the dialog open', async () => {
    route({
      ...base(),
      'POST /payment-gateway-settlements/preview': () => ({ data: preview() }),
      'POST /payment-gateway-settlements': () => new ApiError(422, 'x', { error: { code: 'fee_tax_invoice_reused', message: 'dup' } }),
    });
    const onDone = vi.fn();
    open([gateway()], onDone);
    await fillBasics();
    const post = await screen.findByRole('button', { name: m('submit_post') });
    await waitFor(() => expect((post as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(post);
    await screen.findByText(m('error_fee_tax_invoice_reused'));
    expect(onDone).not.toHaveBeenCalled();
  });
});
