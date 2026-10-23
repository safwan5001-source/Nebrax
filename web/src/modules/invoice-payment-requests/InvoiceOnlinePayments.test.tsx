// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl, TEST_LOCALES } from '@/test-utils/intl';
import { InvoiceOnlinePayments } from './InvoiceOnlinePayments';

const state = vi.hoisted(() => ({ perms: new Set<string>(), demo: false }));
const apiMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), api: apiMock }));
vi.mock('@/lib/use-can', () => ({ useCan: () => ({ can: (p: string) => state.perms.has(p), hydrated: true }) }));
vi.mock('@/lib/demo', async (orig) => ({ ...(await orig<typeof import('@/lib/demo')>()), isDemo: () => state.demo }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn(), success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => async () => true }));

const gateway = { id: 'g1', provider: 'moyasar', name: 'ميسّر', name_en: 'Moyasar', environment: 'sandbox', status: 'active', is_usable: true, verified_at: '2026-10-23T00:00:00Z' };
const request = (over: Record<string, unknown> = {}) => ({
  id: 'r1', invoice_id: 'inv', payment_gateway_id: 'g1', status: 'open', allow_partial: false, link_issued: false, currency: 'SAR',
  expires_at: null, cancelled_at: null, created_at: '2026-10-23T09:00:00Z', latest_attempt: null, ...over,
});

function route(handlers: Record<string, (body?: unknown) => unknown>) {
  apiMock.mockImplementation(async (path: string, options?: { method?: string; body?: unknown }) => {
    const key = `${options?.method ?? 'GET'} ${path}`;
    const handler = handlers[key];
    if (!handler) throw new Error(`unrouted ${key}`);
    const result = handler(options?.body);
    if (result instanceof Error) throw result;
    return result;
  });
}

beforeEach(() => {
  state.perms = new Set(['payments.view', 'payments.manage']);
  state.demo = false;
  apiMock.mockReset();
});
afterEach(cleanup);

describe.each(TEST_LOCALES)('InvoiceOnlinePayments (%s)', (locale) => {
  const ui = (props: Partial<React.ComponentProps<typeof InvoiceOnlinePayments>> = {}) =>
    renderIntl(<InvoiceOnlinePayments invoiceId="inv" invoicePosted fullyPaid={false} {...props} />, locale);

  it('renders nothing for a draft invoice, without read permission, or in demo mode (and makes no calls)', () => {
    route({});
    ui({ invoicePosted: false });
    state.perms = new Set();
    ui();
    state.demo = true;
    state.perms = new Set(['payments.view']);
    const { container } = ui();
    expect(container.textContent).toBe('');
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('hides the section for an organization with no usable connection and no requests', async () => {
    route({ 'GET /invoices/inv/payment-requests': () => ({ data: [] }), 'GET /payment-gateways': () => ({ data: [{ ...gateway, verified_at: null }] }) });
    const { container } = ui();
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(container.textContent).toBe(''));
  });

  it('lists requests with status, last-payment phase and flags', async () => {
    route({
      'GET /invoices/inv/payment-requests': () => ({
        data: [
          request({ id: 'r1', status: 'completed', allow_partial: true, latest_attempt: { id: 'a', capture_status: 'captured', amount_minor: 100, captured_minor: 120, posting_status: 'posted', checkout_url: null, review_reasons: ['overpayment'] } }),
          request({ id: 'r2', status: 'cancelled' }),
        ],
      }),
      'GET /payment-gateways': () => ({ data: [gateway] }),
    });
    ui();
    const rows = await screen.findAllByTestId('online-request-row');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText(locale === 'ar' ? 'مدفوع ومرحَّل' : 'Paid and posted')).toBeTruthy();
    expect(within(rows[0]).getByText(locale === 'ar' ? 'فائض غير مخصص' : 'Unallocated excess')).toBeTruthy();
    expect(within(rows[0]).getByText(locale === 'ar' ? 'يسمح بدفع جزئي' : 'Partial allowed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: locale === 'ar' ? 'إلغاء الطلب' : 'Cancel request' })).toBeNull(); // لا إجراء على المغلقة
  });

  it('creates a request with the chosen connection, partial flag and expiry, then issues the link once and shows it with copy', async () => {
    let created: unknown;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    route({
      'GET /invoices/inv/payment-requests': () => ({ data: [] }),
      'GET /payment-gateways': () => ({ data: [gateway] }),
      'POST /invoices/inv/payment-requests': (body) => { created = body; return { data: request() }; },
      'POST /payment-requests/r1/link': () => ({ data: { token: 'T'.repeat(43), path: '/pay/x' } }),
    });
    ui();
    fireEvent.click(await screen.findByRole('button', { name: locale === 'ar' ? 'طلب دفع جديد' : 'New payment request' }));
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.change(screen.getByLabelText(locale === 'ar' ? 'مدة صلاحية الرابط' : 'Link validity'), { target: { value: 'd3' } });
    fireEvent.click(screen.getByRole('button', { name: locale === 'ar' ? 'إنشاء الطلب' : 'Create request' }));

    await waitFor(() => expect(created).toEqual({ payment_gateway_id: 'g1', allow_partial: true, expires_in_minutes: 4320 }));
    const field = (await screen.findByRole('textbox', { name: locale === 'ar' ? 'رابط الدفع' : 'Payment link' })) as HTMLInputElement;
    expect(field.value).toBe(`${window.location.origin}/pay/${'T'.repeat(43)}`);
    fireEvent.click(screen.getByRole('button', { name: locale === 'ar' ? 'نسخ الرابط' : 'Copy link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(field.value));
    expect(await screen.findByText(locale === 'ar' ? 'تم النسخ' : 'Copied')).toBeTruthy();
  });

  it('omits the expiry when "no expiry" is chosen and shows a translated server error', async () => {
    let body: Record<string, unknown> = {};
    route({
      'GET /invoices/inv/payment-requests': () => ({ data: [] }),
      'GET /payment-gateways': () => ({ data: [gateway] }),
      'POST /invoices/inv/payment-requests': (b) => {
        body = b as Record<string, unknown>;
        return Object.assign(new Error('x'), { status: 409, body: { error: { code: 'open_request_exists' } } });
      },
    });
    const apiModule = await import('@/lib/api');
    // الخطأ يجب أن يكون ApiError ليُستخرج رمزه.
    const original = apiMock.getMockImplementation()!;
    apiMock.mockImplementation(async (path: string, options?: { method?: string; body?: unknown }) => {
      try {
        return await original(path, options);
      } catch (e) {
        const err = e as { status?: number; body?: unknown };
        if (err.status) throw new apiModule.ApiError(err.status, 'x', err.body);
        throw e;
      }
    });
    ui();
    fireEvent.click(await screen.findByRole('button', { name: locale === 'ar' ? 'طلب دفع جديد' : 'New payment request' }));
    fireEvent.change(screen.getByLabelText(locale === 'ar' ? 'مدة صلاحية الرابط' : 'Link validity'), { target: { value: 'none' } });
    fireEvent.click(screen.getByRole('button', { name: locale === 'ar' ? 'إنشاء الطلب' : 'Create request' }));

    expect((await screen.findByRole('alert')).textContent).toContain(locale === 'ar' ? 'يوجد طلب دفع مفتوح' : 'An open payment request already exists');
    expect(body).toEqual({ payment_gateway_id: 'g1', allow_partial: false });
  });

  it('shows issue-link and cancel only to managers, and a viewer sees the list read-only', async () => {
    route({
      'GET /invoices/inv/payment-requests': () => ({ data: [request()] }),
      'GET /payment-gateways': () => ({ data: [gateway] }),
    });
    state.perms = new Set(['payments.view']);
    ui();
    await screen.findByTestId('online-request-row');
    expect(screen.queryByRole('button', { name: locale === 'ar' ? 'إصدار الرابط' : 'Issue link' })).toBeNull();
    expect(screen.queryByRole('button', { name: locale === 'ar' ? 'طلب دفع جديد' : 'New payment request' })).toBeNull();
    expect(apiMock).not.toHaveBeenCalledWith('/payment-gateways');
  });

  it('cancels an open request after confirmation and reloads', async () => {
    let cancelled = false;
    route({
      'GET /invoices/inv/payment-requests': () => ({ data: [request({ link_issued: true })] }),
      'GET /payment-gateways': () => ({ data: [gateway] }),
      'POST /payment-requests/r1/cancel': () => { cancelled = true; return { data: request({ status: 'cancelled' }) }; },
    });
    ui();
    expect(await screen.findByText(locale === 'ar' ? 'أُصدر الرابط' : 'Link issued')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: locale === 'ar' ? 'إلغاء الطلب' : 'Cancel request' }));
    await waitFor(() => expect(cancelled).toBe(true));
  });
});
