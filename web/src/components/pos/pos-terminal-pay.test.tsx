// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PosPayment } from './pos-payment';

const { api } = vi.hoisted(() => ({ api: vi.fn() }));

const translate = (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key);
vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => translate,
}));
vi.mock('@/lib/api', () => ({
  api,
  ApiError: class ApiError extends Error {
    status: number; body: unknown;
    constructor(message: string, status = 422, body: unknown = null) { super(message); this.status = status; this.body = body; }
  },
}));
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => async () => true }));

const bank = { id: 'card', name: 'Card', name_en: 'Card', settlement_type: 'bank' as const, is_active: true, is_default: true };
const cash = { id: 'cash', name: 'Cash', name_en: 'Cash', settlement_type: 'cash' as const, is_active: true, is_default: false };
const fakeTerminal = { id: 'term-1', name: 'Terminal A', code: null, provider: 'fake', simulated: true, pos_device_id: null, is_active: true, created_at: null };

function request(status: string, extra: Record<string, unknown> = {}) {
  return {
    id: 'req-1', pos_session_id: 'sess-1', pos_payment_terminal_id: 'term-1', payment_method_id: 'card', amount: '50.00', currency: 'SAR', status,
    approval_code: null, rrn: null, last4: null, failure_code: null, void_attempts: 0, last_void_error: null, consumed_payment_id: null,
    consumed_invoice_id: null, resolution_note: null, approved_at: null, consumed_at: null, voided_at: null, resolved_at: null,
    created_at: '2026-10-23T00:00:00Z', idempotent_replay: false, ...extra,
  };
}

function renderPayment(over: Record<string, unknown> = {}) {
  const onConfirm = vi.fn();
  const onBack = vi.fn();
  render(
    <PosPayment
      allowDeferredPayment={false}
      customerName="Walk-in"
      defaultPaymentMethodId="card"
      error={null}
      items={[]}
      onBack={onBack}
      onConfirm={onConfirm}
      paying={false}
      paymentMethods={[bank, cash]}
      paymentMethodsLoadError={null}
      paymentMethodsLoading={false}
      totalMinor={5000}
      terminalContext={{ sessionId: 'sess-1', posDeviceId: 'dev-1' }}
      {...over}
    />,
  );
  return { onConfirm, onBack };
}

function mockApi(handlers: { terminals?: unknown[]; providers?: unknown[]; create?: unknown; poll?: unknown[] }) {
  const polls = [...(handlers.poll ?? [])];
  api.mockImplementation(async (path: string, options?: { method?: string }) => {
    if (path === '/pos-payment-terminals') return { data: handlers.terminals ?? [fakeTerminal], meta: { providers: handlers.providers ?? [{ key: 'fake', simulated: true }] } };
    if (path === '/pos/terminal-requests' && options?.method === 'POST') return { data: handlers.create ?? request('sent') };
    if (path.startsWith('/pos/terminal-requests/') && !options?.method) return { data: polls.shift() ?? request('sent') };
    throw new Error(`unexpected ${path}`);
  });
}

describe('الدفع عبر جهاز البطاقة في شاشة الدفع', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', { randomUUID: () => 'attempt-key-1' });
    api.mockReset();
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('لا لوحة ولا طلبات شبكة بلا سياق جهاز (سلوك ما قبل H6-02 حرفياً)', () => {
    renderPayment({ terminalContext: undefined });
    expect(screen.queryByTestId('pos-terminal-panel')).toBeNull();
    expect(api).not.toHaveBeenCalled();
  });

  it('تعرض المحاكاة صراحةً وترسل المبلغ مع مفتاح idempotency ثم تنتظر العميل', async () => {
    mockApi({});
    renderPayment();
    fireEvent.click(screen.getByRole('button', { name: 'exact_amount' }));
    expect(await screen.findByTestId('pos-terminal-simulated')).toBeTruthy();

    fireEvent.click(await screen.findByTestId('pos-terminal-send'));
    await waitFor(() => expect(screen.getByTestId('pos-terminal-panel').getAttribute('data-status')).toBe('sent'));
    const post = api.mock.calls.find(([path, options]) => path === '/pos/terminal-requests' && options?.method === 'POST');
    expect(post?.[1].body).toEqual({
      pos_session_id: 'sess-1', pos_payment_terminal_id: 'term-1', payment_method_id: 'card', amount: 50, idempotency_key: 'attempt-key-1',
    });
    expect(screen.getByText('waiting_customer')).toBeTruthy();
    // المبلغ مقفل والخروج ممنوع والتأكيد معطّل ما دام الطلب معلّقاً.
    expect((screen.getByTestId('pos-confirm-payment') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'back_to_cart' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('بعد الموافقة يُرسل البيع terminal_request_id ولا يعرض RRN', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockApi({ poll: [request('approved', { approval_code: 'AP1234', last4: '4242', rrn: 'RRN-SECRET' })] });
    const { onConfirm } = renderPayment();
    fireEvent.click(screen.getByRole('button', { name: 'exact_amount' }));
    fireEvent.click(await screen.findByTestId('pos-terminal-send'));
    await waitFor(() => expect(screen.getByTestId('pos-terminal-panel').getAttribute('data-status')).toBe('sent'));

    await act(async () => { await vi.advanceTimersByTimeAsync(2600); });
    expect(await screen.findByTestId('pos-terminal-approved')).toBeTruthy();
    expect(screen.getByTestId('pos-terminal-approved').textContent).toContain('4242');
    expect(document.body.textContent).not.toContain('RRN-SECRET');
    expect(screen.getByTestId('pos-terminal-simulated')).toBeTruthy();

    fireEvent.click(screen.getByTestId('pos-confirm-payment'));
    expect(onConfirm).toHaveBeenCalledWith([{ payment_method_id: 'card', amount: 5000, terminal_request_id: 'req-1' }]);
  });

  it('وسيلة تشترط الجهاز: لا تأكيد بلا موافقة، ولا جهاز متاح = رسالة صريحة', async () => {
    mockApi({ terminals: [] });
    renderPayment({ paymentMethods: [{ ...bank, pos_terminal_required: true }, cash] });
    fireEvent.click(screen.getByRole('button', { name: 'exact_amount' }));
    expect(await screen.findByTestId('pos-terminal-required-unavailable')).toBeTruthy();
    expect((screen.getByTestId('pos-confirm-payment') as HTMLButtonElement).disabled).toBe(true);
  });

  it('وسيلة لا تشترط الجهاز تبقى تُؤكَّد يدوياً حتى مع وجود الجهاز (الافتراضي مطفأ)', async () => {
    mockApi({});
    const { onConfirm } = renderPayment();
    fireEvent.click(screen.getByRole('button', { name: 'exact_amount' }));
    await screen.findByTestId('pos-terminal-send');
    fireEvent.click(screen.getByTestId('pos-confirm-payment'));
    expect(onConfirm).toHaveBeenCalledWith([{ payment_method_id: 'card', amount: 5000 }]);
  });

  it('عملية تحتاج تعويضاً: تنبيه واضح، إعادة محاولة الإلغاء، وملخص تصعيد، ويمنع التأكيد والخروج', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockApi({ poll: [request('compensation_required', { last_void_error: 'void_failed', void_attempts: 1 })] });
    renderPayment();
    fireEvent.click(screen.getByRole('button', { name: 'exact_amount' }));
    fireEvent.click(await screen.findByTestId('pos-terminal-send'));
    await waitFor(() => expect(screen.getByTestId('pos-terminal-panel').getAttribute('data-status')).toBe('sent'));
    await act(async () => { await vi.advanceTimersByTimeAsync(2600); });

    expect(await screen.findByTestId('pos-terminal-compensation')).toBeTruthy();
    expect(screen.getByTestId('pos-terminal-retry-void')).toBeTruthy();
    expect(screen.getByText('copy_for_manager')).toBeTruthy();
    // لا زر «حل يدوي/تجاوز» في الواجهة (قرار المالك: الخيار A).
    expect(screen.queryByText(/resolve|override/i)).toBeNull();
    expect((screen.getByTestId('pos-confirm-payment') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'back_to_cart' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('طلب مرفوض يتيح إعادة المحاولة ويُفرج عن المبلغ والخروج', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockApi({ poll: [request('declined', { failure_code: 'declined' })] });
    renderPayment();
    fireEvent.click(screen.getByRole('button', { name: 'exact_amount' }));
    fireEvent.click(await screen.findByTestId('pos-terminal-send'));
    await waitFor(() => expect(screen.getByTestId('pos-terminal-panel').getAttribute('data-status')).toBe('sent'));
    await act(async () => { await vi.advanceTimersByTimeAsync(2600); });

    fireEvent.click(await screen.findByTestId('pos-terminal-retry'));
    expect(await screen.findByTestId('pos-terminal-send')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'back_to_cart' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
