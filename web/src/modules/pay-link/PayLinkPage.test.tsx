// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl, TEST_LOCALES } from '@/test-utils/intl';
import { PayLinkPage } from './PayLinkPage';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const TOKEN = 'A'.repeat(43);
const assign = vi.fn();

function route(handlers: Record<string, (init?: RequestInit) => Response>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^.*\/pay\/v1\/[^/]+/, '') || '/';
    const handler = handlers[`${init?.method ?? 'GET'} ${path}`];
    if (!handler) throw new Error(`unrouted ${init?.method ?? 'GET'} ${path}`);
    return handler(init);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
const ok = (data: unknown, status = 200) => () => new Response(JSON.stringify({ data }), { status });
const fail = (status: number, code: string) => () => new Response(JSON.stringify({ error: { code, message: 'x' } }), { status });
const openView = (extra: Record<string, unknown> = {}) => ({
  status: 'open', merchant: 'شركة الاختبار', invoice_number: 'INV-2026-00001', currency: 'SAR', amount_due_minor: 115000, allow_partial: false, expires_at: null, ...extra,
});
const noPayment = ok({ request_status: 'open', payment: 'none' });

beforeEach(() => {
  sessionStorage.clear();
  assign.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe.each(TEST_LOCALES)('PayLinkPage (%s)', (locale) => {
  it('shows the merchant, invoice and the amount due, and redirects to the provider on pay', async () => {
    route({
      'GET /': ok(openView()),
      'GET /status': noPayment,
      'POST /attempts': ok({ capture_status: 'pending_customer', amount_minor: 115000, currency: 'SAR', checkout_url: 'https://pay.provider.test/i/1', expires_at: null }, 201),
    });
    renderIntl(<PayLinkPage token={TOKEN} navigate={assign} />, locale);

    expect(await screen.findByText('شركة الاختبار')).toBeTruthy();
    expect(screen.getByTestId('pay-amount-due').textContent).toBe('1,150.00 ⃁');
    expect(screen.getByText('INV-2026-00001')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull(); // لا حقول بطاقة ولا مبلغ لرابط غير جزئي

    fireEvent.click(screen.getByRole('button', { name: /1,150\.00/ }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://pay.provider.test/i/1'));
  });

  it('never redirects to a non-https checkout url', async () => {
    route({
      'GET /': ok(openView()), 'GET /status': noPayment,
      'POST /attempts': ok({ capture_status: 'pending_customer', amount_minor: 115000, currency: 'SAR', checkout_url: 'javascript:alert(1)', expires_at: null }, 201),
    });
    renderIntl(<PayLinkPage token={TOKEN} navigate={assign} />, locale);
    fireEvent.click(await screen.findByRole('button', { name: /1,150\.00/ }));
    expect((await screen.findByRole('alert')).textContent).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });

  it('reuses the same idempotency key across clicks for the same amount', async () => {
    const keys: string[] = [];
    route({
      'GET /': ok(openView()), 'GET /status': noPayment,
      'POST /attempts': (init) => {
        keys.push((init?.headers as Record<string, string>)['Idempotency-Key']);
        return fail(503, 'payment_unavailable')();
      },
    });
    renderIntl(<PayLinkPage token={TOKEN} navigate={assign} />, locale);
    const button = await screen.findByRole('button', { name: /1,150\.00/ });
    fireEvent.click(button);
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: /1,150\.00/ }));
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[0]).toBe(keys[1]);
  });

  it('validates a partial amount and sends the exact halalas', async () => {
    let body = '';
    route({
      'GET /': ok(openView({ allow_partial: true })), 'GET /status': noPayment,
      'POST /attempts': (init) => {
        body = String(init?.body);
        return new Response(JSON.stringify({ data: { capture_status: 'pending_customer', amount_minor: 50050, currency: 'SAR', checkout_url: 'https://pay.provider.test/i/2', expires_at: null } }), { status: 201 });
      },
    });
    renderIntl(<PayLinkPage token={TOKEN} navigate={assign} />, locale);
    const input = await screen.findByRole('textbox');

    fireEvent.change(input, { target: { value: '2000' } });
    expect(screen.getByRole('alert')).toBeTruthy(); // أكبر من المستحق
    expect((screen.getByRole('button', { name: /\u20C1|SAR|ريال/ }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(input, { target: { value: '500.5' } });
    fireEvent.click(screen.getByRole('button', { name: /500\.50/ }));
    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(body).toBe('{"amount_minor":50050}');
  });

  it('shows the paid state when the status is already paid', async () => {
    route({ 'GET /': ok(openView()), 'GET /status': ok({ request_status: 'completed', payment: 'paid' }) });
    renderIntl(<PayLinkPage token={TOKEN} navigate={assign} />, locale);
    expect(await screen.findByRole('heading', { name: locale === 'ar' ? 'تم استلام دفعتك' : 'Payment received' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /1,150/ })).toBeNull();
  });

  it('shows the processing state and disables paying again while a payment is pending', async () => {
    route({ 'GET /': ok(openView()), 'GET /status': ok({ request_status: 'open', payment: 'pending' }) });
    renderIntl(<PayLinkPage token={TOKEN} navigate={assign} />, locale);
    expect(await screen.findByRole('status')).toBeTruthy();
    expect((screen.getByRole('button', { name: /1,150\.00/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it.each([['cancelled'], ['expired'], ['unavailable'], ['completed']])('shows only the %s state, no amount and no pay button', async (status) => {
    route({ 'GET /': ok({ status }), 'GET /status': noPayment });
    renderIntl(<PayLinkPage token={TOKEN} navigate={assign} />, locale);
    await screen.findByRole('heading', { level: 2 });
    expect(screen.queryByTestId('pay-amount-due')).toBeNull();
    expect(screen.queryByRole('button', { name: /pay|ادفع/i })).toBeNull();
  });

  it('shows the uniform invalid-link state on 404 and a retry on a temporary error', async () => {
    route({ 'GET /': fail(404, 'link_not_found') });
    const first = renderIntl(<PayLinkPage token={TOKEN} navigate={assign} />, locale);
    expect(await screen.findByRole('heading', { name: locale === 'ar' ? 'رابط الدفع غير صالح' : 'Invalid payment link' })).toBeTruthy();
    first.unmount();

    route({ 'GET /': fail(503, 'unknown') });
    renderIntl(<PayLinkPage token={TOKEN} navigate={assign} />, locale);
    fireEvent.click(await screen.findByRole('button', { name: locale === 'ar' ? 'إعادة المحاولة' : 'Try again' }));
  });

  it('polls the status while pending and switches to paid', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let polls = 0;
    route({
      'GET /': ok(openView()),
      'GET /status': () => {
        polls += 1;
        return new Response(JSON.stringify({ data: { request_status: polls > 2 ? 'completed' : 'open', payment: polls > 2 ? 'paid' : 'pending' } }), { status: 200 });
      },
    });
    renderIntl(<PayLinkPage token={TOKEN} navigate={assign} />, locale);
    await screen.findByRole('status');
    await vi.advanceTimersByTimeAsync(9000);
    expect(await screen.findByRole('heading', { name: locale === 'ar' ? 'تم استلام دفعتك' : 'Payment received' })).toBeTruthy();
  });
});
