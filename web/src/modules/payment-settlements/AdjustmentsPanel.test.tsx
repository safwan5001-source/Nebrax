// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl, TEST_LOCALES, TEST_MESSAGES, type TestLocale } from '@/test-utils/intl';
import { ApiError } from '@/lib/api';
import { AdjustmentsPanel } from './AdjustmentsPanel';

const state = vi.hoisted(() => ({ perms: new Set<string>(), userId: 'u-admin' }));
const apiMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), api: apiMock }));
vi.mock('@/lib/use-can', () => ({
  useCan: () => ({ can: (p: string) => state.perms.has(p), hydrated: true }),
  useCurrentUser: () => ({ id: state.userId, name: 'x', email: 'x@x', role: 'admin', tenant_id: 't' }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn(), ...toastMock }) }));

const adj = (over: Record<string, unknown> = {}) => ({
  id: 'a1', payment_gateway_id: 'g1', kind: 'reserve_hold', amount_minor: 25000, currency: 'SAR', status: 'requested', reason: 'احتجاز بقرار المزوّد', evidence_ref: 'EV-100',
  provider_event_ref: null, requested_by: { id: 'u-owner', name: 'المالك' }, requested_at: '2026-10-23T09:00:00Z', approved_by: null, approved_at: null, rejected_by: null,
  reject_reason: null, cancelled_by: null, cancel_reason: null, settlement_id: null, ...over,
});
const meta = (total: number) => ({ total, page: 1, per_page: 25, last_page: 1 });
const gateways = { data: [{ id: 'g1', provider: 'moyasar', name: 'ميسّر', name_en: 'Moyasar', environment: 'sandbox', status: 'active' }] };

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

beforeEach(() => {
  state.perms = new Set(['payments.view']);
  state.userId = 'u-admin';
  apiMock.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
});
afterEach(cleanup);

describe.each(TEST_LOCALES)('AdjustmentsPanel (%s)', (locale) => {
  const m = (k: string) => (TEST_MESSAGES[locale as TestLocale].paymentAdjustments as Record<string, string>)[k];
  const ui = () => renderIntl(<AdjustmentsPanel refreshKey={0} onChanged={vi.fn()} />, locale as TestLocale);
  const listRoutes = (rows: unknown[]) => ({
    'GET /payment-gateways': () => gateways,
    'GET /payment-gateway-adjustments': () => ({ data: rows, meta: meta(rows.length) }),
    'GET /payment-gateways/g1/reserve-balance': () => ({ data: { held_minor: 40000, releasable_minor: 15000 } }),
  });

  it('is read-only for a viewer: no approve, reject, cancel or request buttons', async () => {
    route(listRoutes([adj()]));
    ui();
    await screen.findAllByText('EV-100');
    for (const k of ['action_approve', 'action_reject', 'action_cancel', 'request_open']) expect(screen.queryByRole('button', { name: m(k) })).toBeNull();
  });

  it('shows approve & reject to an independent approver but never to the requester', async () => {
    state.perms = new Set(['payments.view', 'payment_settlements.approve_adjustment']);
    route(listRoutes([adj()]));
    ui();
    await screen.findAllByText('EV-100');
    expect(screen.getAllByRole('button', { name: m('action_approve') }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: m('action_reject') }).length).toBeGreaterThan(0);
    cleanup();

    state.userId = 'u-owner';   // الطالب نفسه
    ui();
    await screen.findAllByText('EV-100');
    expect(screen.queryByRole('button', { name: m('action_approve') })).toBeNull();
    expect(screen.queryByRole('button', { name: m('action_reject') })).toBeNull();
    expect(screen.getAllByRole('button', { name: m('action_cancel') }).length).toBeGreaterThan(0);   // الطالب يلغي طلبه
  });

  it('approves without a reason and reloads', async () => {
    state.perms = new Set(['payments.view', 'payment_settlements.approve_adjustment']);
    route({ ...listRoutes([adj()]), 'POST /payment-gateway-adjustments/a1/approve': () => ({ data: adj({ status: 'approved' }) }) });
    ui();
    fireEvent.click((await screen.findAllByRole('button', { name: m('action_approve') }))[0]);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/payment-gateway-adjustments/a1/approve', { method: 'POST' }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith(m('done_approve')));
  });

  it('translates a server rejection by its stable code', async () => {
    state.perms = new Set(['payments.view', 'payment_settlements.approve_adjustment']);
    route({ ...listRoutes([adj()]), 'POST /payment-gateway-adjustments/a1/approve': () => new ApiError(409, 'x', { error: { code: 'self_approval', message: 'x' } }) });
    ui();
    fireEvent.click((await screen.findAllByRole('button', { name: m('action_approve') }))[0]);
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith(m('error_self_approval')));
  });

  it('requires a reason of at least five characters to reject', async () => {
    state.perms = new Set(['payments.view', 'payment_settlements.approve_adjustment']);
    route({ ...listRoutes([adj()]), 'POST /payment-gateway-adjustments/a1/reject': () => ({ data: adj({ status: 'rejected' }) }) });
    ui();
    fireEvent.click((await screen.findAllByRole('button', { name: m('action_reject') }))[0]);
    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: m('dialog_reject_submit') }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'abc' } });
    expect(submit.disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'الدليل غير كافٍ' } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/payment-gateway-adjustments/a1/reject', { method: 'POST', body: { reason: 'الدليل غير كافٍ' } }));
  });

  it('shows the held and releasable reserve for the selected connection only', async () => {
    route(listRoutes([adj({ status: 'approved' })]));
    ui();
    await screen.findAllByText('EV-100');
    expect(screen.queryByTestId('pa-reserve')).toBeNull();
    fireEvent.change(screen.getByLabelText(m('filter_gateway')), { target: { value: 'g1' } });
    const card = await screen.findByTestId('pa-reserve');
    await waitFor(() => expect(within(card).getAllByText(/400|٤٠٠/).length).toBeGreaterThan(0));
    expect(within(card).getAllByText(/150|١٥٠/).length).toBeGreaterThan(0);
  });

  it('validates a request: kind, amount, evidence (≥3) and reason (≥5) are all required', async () => {
    state.perms = new Set(['payments.view', 'payment_settlements.adjust']);
    route({ ...listRoutes([]), 'POST /payment-gateway-adjustments': () => ({ data: adj() }) });
    ui();
    fireEvent.click(await screen.findByRole('button', { name: m('request_open') }));
    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getByRole('button', { name: m('request_submit') }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText(m('field_gateway')), { target: { value: 'g1' } });
    fireEvent.change(within(dialog).getByLabelText(m('col_kind')), { target: { value: 'adjustment_debit' } });
    fireEvent.change(within(dialog).getByLabelText(m('col_amount')), { target: { value: '250.50' } });
    fireEvent.change(within(dialog).getByLabelText(m('col_evidence')), { target: { value: 'ab' } });
    fireEvent.change(within(dialog).getByLabelText(m('reason')), { target: { value: 'غرامة نزاع من المزوّد' } });
    expect(submit.disabled).toBe(true);   // الدليل أقصر من ٣
    fireEvent.change(within(dialog).getByLabelText(m('col_evidence')), { target: { value: 'EV-9' } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/payment-gateway-adjustments', {
      method: 'POST', body: { payment_gateway_id: 'g1', kind: 'adjustment_debit', amount_minor: 25050, reason: 'غرامة نزاع من المزوّد', evidence_ref: 'EV-9' },
    }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith(m('request_done')));
  });
});
