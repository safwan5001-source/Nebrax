// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl, TEST_LOCALES } from '@/test-utils/intl';
import { ApiError } from '@/lib/api';
import { RefundsPanel } from './RefundsPanel';
import { RequestRefundDialog } from './RequestRefundDialog';
import { ResolveExternalDialog } from './ResolveExternalDialog';

const state = vi.hoisted(() => ({ perms: new Set<string>(), userId: 'u-admin' }));
const apiMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), api: apiMock }));
vi.mock('@/lib/use-can', () => ({
  useCan: () => ({ can: (p: string) => state.perms.has(p), hydrated: true }),
  useCurrentUser: () => ({ id: state.userId, name: 'x', email: 'x@x', role: 'admin', tenant_id: 't' }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn(), ...toastMock }) }));

const row = (over: Record<string, unknown> = {}) => ({
  id: 'r1', number: 'PRF-2026-00001', status: 'requested', amount_minor: 40000, currency: 'SAR', partner_id: 'p1', partner_name: 'عميل', payment_attempt_id: 'a1',
  requested_by: { id: 'u-owner', name: 'المالك' }, requested_at: '2026-10-23T09:00:00Z', approved_by: null, approved_at: null, reject_reason: null, cancel_reason: null,
  confirmed_at: null, provider_refunded_at: null, provider_refund_ref: null, failure_code: null, retry_count: 0, excess_minor: 0, posting_status: null,
  accounting_date: null, posted_at: null, journal_entry_id: null, blocked_reason: null, ...over,
});
const meta = (total: number) => ({ total, page: 1, per_page: 25, last_page: 1 });

function route(handlers: Record<string, (body?: unknown) => unknown>) {
  apiMock.mockImplementation(async (path: string, options?: { method?: string; body?: unknown }) => {
    const key = `${options?.method ?? 'GET'} ${path.split('?')[0]}`;
    const handler = handlers[`${key}${path.includes('?') ? path.slice(path.indexOf('?')) : ''}`] ?? handlers[key];
    if (!handler) throw new Error(`unrouted ${key}`);
    const result = handler(options?.body);
    if (result instanceof Error) throw result;
    return result;
  });
}

beforeEach(() => {
  state.perms = new Set(['payment_refunds.view']);
  state.userId = 'u-admin';
  apiMock.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
});
afterEach(cleanup);

describe.each(TEST_LOCALES)('RefundsPanel (%s)', (locale) => {
  const ui = (onChanged = vi.fn()) => renderIntl(<RefundsPanel refreshKey={0} onChanged={onChanged} />, locale);

  it('lists refunds read-only for a viewer without decision permissions', async () => {
    route({ 'GET /payment-refunds': () => ({ data: [row()], meta: meta(1) }) });
    ui();
    await screen.findAllByText('PRF-2026-00001');
    expect(screen.queryByRole('button', { name: /اعتماد|Approve/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /رفض|Reject/ })).toBeNull();
  });

  it('shows approve & reject to an independent approver but never to the requester', async () => {
    state.perms = new Set(['payment_refunds.view', 'payment_refunds.approve']);
    route({ 'GET /payment-refunds': () => ({ data: [row()], meta: meta(1) }) });
    ui();
    await screen.findAllByText('PRF-2026-00001');
    expect(screen.getAllByRole('button', { name: /اعتماد وإرسال|Approve & send/ }).length).toBeGreaterThan(0);
    cleanup();

    state.userId = 'u-owner';   // الطالب نفسه
    ui();
    await screen.findAllByText('PRF-2026-00001');
    expect(screen.queryByRole('button', { name: /اعتماد وإرسال|Approve & send/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^رفض$|^Reject$/ })).toBeNull();
  });

  it('approves with an immediate send and reloads', async () => {
    state.perms = new Set(['payment_refunds.view', 'payment_refunds.approve']);
    const onChanged = vi.fn();
    let list = [row()];
    route({
      'GET /payment-refunds': () => ({ data: list, meta: meta(list.length) }),
      'POST /payment-refunds/r1/approve': () => { list = [row({ status: 'confirmed', posting_status: 'posted' })]; return { data: list[0], meta: { submit_error: null } }; },
    });
    ui(onChanged);
    fireEvent.click((await screen.findAllByRole('button', { name: /اعتماد وإرسال|Approve & send/ }))[0]);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/payment-refunds/r1/approve', { method: 'POST', body: { submit: true } }));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('translates a server rejection by its stable code', async () => {
    state.perms = new Set(['payment_refunds.view', 'payment_refunds.approve']);
    route({
      'GET /payment-refunds': () => ({ data: [row()], meta: meta(1) }),
      'POST /payment-refunds/r1/approve': () => new ApiError(409, 'x', 'self_approval'),
    });
    ui();
    fireEvent.click((await screen.findAllByRole('button', { name: /اعتماد وإرسال|Approve & send/ }))[0]);
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
  });

  it('requires a reason of at least five characters to reject, then posts it', async () => {
    state.perms = new Set(['payment_refunds.view', 'payment_refunds.approve']);
    route({
      'GET /payment-refunds': () => ({ data: [row()], meta: meta(1) }),
      'POST /payment-refunds/r1/reject': () => ({ data: row({ status: 'rejected' }) }),
    });
    ui();
    fireEvent.click((await screen.findAllByRole('button', { name: /^رفض$|^Reject$/ }))[0]);
    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getAllByRole('button').find((b) => /رفض الطلب|Reject request/.test(b.textContent ?? ''))!;
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'مبلغ غير مبرَّر' } });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/payment-refunds/r1/reject', { method: 'POST', body: { reason: 'مبلغ غير مبرَّر' } }));
  });

  it('offers the human decision only for unknown refunds with the resolve permission, and repost only for blocked ones', async () => {
    state.perms = new Set(['payment_refunds.view', 'payment_refunds.resolve_unknown', 'payments.resolve_blocked']);
    route({
      'GET /payment-refunds': () => ({
        data: [row({ id: 'u1', status: 'unknown', number: 'PRF-U' }), row({ id: 'b1', status: 'confirmed', posting_status: 'blocked_period', number: 'PRF-B' }), row({ id: 'p1', status: 'confirmed', posting_status: 'posted', number: 'PRF-P' })],
        meta: meta(3),
      }),
    });
    ui();
    await screen.findAllByText('PRF-U');
    expect(screen.getAllByRole('button', { name: /هذا استردادنا|It is ours/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /لم يُطبَّق|Not applied/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /إعادة الترحيل|Repost/ }).length).toBeGreaterThan(0);
  });

  it('asks the server for the attention scope and keeps the status filter to the all tab', async () => {
    route({
      'GET /payment-refunds?page=1&per_page=25': () => ({ data: [row({ number: 'PRF-OK', status: 'confirmed', posting_status: 'posted' })], meta: meta(1) }),
      'GET /payment-refunds?page=1&per_page=25&scope=attention': () => ({ data: [row({ id: 'u1', number: 'PRF-U', status: 'unknown' })], meta: meta(1) }),
    });
    ui();
    await screen.findAllByText('PRF-OK');
    fireEvent.click(screen.getByRole('tab', { name: /تحتاج تدخلاً|Needs attention/ }));
    await waitFor(() => expect(screen.queryByText('PRF-OK')).toBeNull());
    expect(screen.getAllByText('PRF-U').length).toBeGreaterThan(0);
    expect(apiMock).toHaveBeenCalledWith('/payment-refunds?page=1&per_page=25&scope=attention');
  });

  it('never reports success when approval worked but sending failed, or the refund ended unknown', async () => {
    state.perms = new Set(['payment_refunds.view', 'payment_refunds.approve']);
    route({
      'GET /payment-refunds': () => ({ data: [row()], meta: meta(1) }),
      'POST /payment-refunds/r1/approve': () => ({ data: row({ status: 'approved' }), meta: { submit_error: { code: 'provider_unavailable', message: 'x' } } }),
    });
    ui();
    fireEvent.click((await screen.findAllByRole('button', { name: /اعتماد وإرسال|Approve & send/ }))[0]);
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(1));
    expect(toastMock.success).not.toHaveBeenCalled();

    cleanup();
    toastMock.error.mockReset();
    route({
      'GET /payment-refunds': () => ({ data: [row()], meta: meta(1) }),
      'POST /payment-refunds/r1/approve': () => ({ data: row({ status: 'unknown' }), meta: { submit_error: null } }),
    });
    ui();
    fireEvent.click((await screen.findAllByRole('button', { name: /اعتماد وإرسال|Approve & send/ }))[0]);
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledTimes(1));
    expect(toastMock.success).not.toHaveBeenCalled();
  });
});

describe.each(TEST_LOCALES)('RequestRefundDialog (%s)', (locale) => {
  const ctx = (over: Record<string, unknown> = {}) => ({
    payment_attempt_id: 'a1', currency: 'SAR', captured_minor: 115000, refunded_minor: 0, refundable_minor: 115000, eligible: true, blocker: null,
    unrecognized_refund_at: null, unrecognized_refund_minor: null,
    sources: [{ source_type: 'credit_note', id: 'n1', number: 'CN-1', date: '2026-10-01', total: 115000, refunded: 0, refundable: 115000 }], ...over,
  });

  it('suggests the allocation, caps the amount and sends a stable idempotency key', async () => {
    route({
      'GET /payment-attempts/a1/refund-context': () => ({ data: ctx() }),
      'POST /payment-refunds': () => ({ data: row() }),
    });
    const onDone = vi.fn();
    renderIntl(<RequestRefundDialog attemptId="a1" onClose={vi.fn()} onDone={onDone} />, locale);
    const input = await screen.findByLabelText(/مبلغ الاسترداد|Refund amount/);
    const submit = screen.getAllByRole('button').find((b) => /إرسال الطلب للاعتماد|Send for approval/.test(b.textContent ?? ''))! as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(input, { target: { value: '1200' } });   // أكبر من الحد
    expect(submit.disabled).toBe(true);
    fireEvent.change(input, { target: { value: '400' } });
    expect(submit.disabled).toBe(false);
    expect(screen.getByText('CN-1')).toBeTruthy();

    fireEvent.click(submit);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const call = apiMock.mock.calls.find((c) => c[0] === '/payment-refunds')!;
    expect(call[1].body).toMatchObject({ payment_attempt_id: 'a1', amount_minor: 40000, allocations: [{ source_type: 'credit_note', source_id: 'n1', amount_minor: 40000 }] });
    expect(call[1].body.idempotency_key).toMatch(/^refund-/);
  });

  it('explains the blocker instead of offering a form when the payment is not refundable', async () => {
    route({ 'GET /payment-attempts/a1/refund-context': () => ({ data: ctx({ eligible: false, blocker: { code: 'capture_not_posted', message: 'x' }, sources: [] }) }) });
    renderIntl(<RequestRefundDialog attemptId="a1" onClose={vi.fn()} onDone={vi.fn()} />, locale);
    await screen.findByRole('alert');
    expect(screen.queryByLabelText(/مبلغ الاسترداد|Refund amount/)).toBeNull();
  });

  it('shows a calm message when there is no commercial correction to allocate to', async () => {
    route({ 'GET /payment-attempts/a1/refund-context': () => ({ data: ctx({ sources: [] }) }) });
    renderIntl(<RequestRefundDialog attemptId="a1" onClose={vi.fn()} onDone={vi.fn()} />, locale);
    await screen.findByText(/لا يوجد إشعار دائن|no open credit note/i);
  });
});

describe.each(TEST_LOCALES)('ResolveExternalDialog (%s)', (locale) => {
  it('posts the reason to the attempt endpoint', async () => {
    route({ 'POST /payment-attempts/a1/resolve-external-refund': () => ({ data: { payment_attempt_id: 'a1', refunded_minor: 20000, unrecognized_refund_at: null } }) });
    const onDone = vi.fn();
    renderIntl(<ResolveExternalDialog attemptId="a1" onClose={vi.fn()} onDone={onDone} />, locale);
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'راجعنا الاسترداد الخارجي' } });
    fireEvent.click(screen.getAllByRole('button').find((b) => /حسم وإلغاء المعلَّق|Resolve & cancel pending/.test(b.textContent ?? ''))!);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(apiMock).toHaveBeenCalledWith('/payment-attempts/a1/resolve-external-refund', { method: 'POST', body: { reason: 'راجعنا الاسترداد الخارجي' } });
  });
});
