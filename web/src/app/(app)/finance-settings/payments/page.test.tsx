// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PaymentGatewaysPage from './page';
import { renderIntl, TEST_LOCALES, TEST_MESSAGES } from '@/test-utils/intl';
import type { GatewayConnection } from '@/modules/payments/gateways/contract';

const { api, perms, confirm, toast, ApiErrorMock } = vi.hoisted(() => {
  class ApiErrorMock extends Error {
    status: number;
    body: unknown;
    constructor(status: number, message: string, body: unknown) {
      super(message);
      this.status = status;
      this.body = body;
    }
  }
  return {
    api: vi.fn(),
    perms: { current: [] as string[] },
    confirm: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn() },
    ApiErrorMock,
  };
});

vi.mock('@/lib/api', () => ({ api, ApiError: ApiErrorMock }));
vi.mock('@/lib/use-can', () => ({
  useCan: () => ({ hydrated: true, can: (p: string) => perms.current.includes('*') || perms.current.includes(p) }),
}));
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => confirm }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => toast }));
const { demo } = vi.hoisted(() => ({ demo: { on: false } }));
vi.mock('@/lib/demo', () => ({ isDemo: () => demo.on }));

function conn(overrides: Partial<GatewayConnection> = {}): GatewayConnection {
  return {
    id: 'g1', provider: 'custom', name: 'الاتصال الأول', name_en: 'First', environment: 'sandbox', status: 'draft', is_usable: false,
    merchant_reference: null, publishable_key: null, has_secret_key: true, has_webhook_secret: false, has_extra_credentials: false,
    credential_version: 1, previous_secret_valid_until: null, verified_at: null, activated_at: null, deactivated_at: null, created_at: null,
    ...overrides,
  };
}

function listReturns(rows: GatewayConnection[]) {
  api.mockImplementation((path: string, options?: { method?: string }) => {
    if (path === '/payment-gateways' && (options?.method ?? 'GET') === 'GET') return Promise.resolve({ data: rows });
    return Promise.reject(new Error(`unexpected ${options?.method ?? 'GET'} ${path}`));
  });
}

beforeEach(() => {
  api.mockReset();
  demo.on = false;
  confirm.mockReset().mockResolvedValue(true);
  toast.success.mockReset();
  toast.error.mockReset();
});
afterEach(cleanup);

describe.each(TEST_LOCALES)('PaymentGatewaysPage (%s)', (locale) => {
  const m = TEST_MESSAGES[locale].paymentGateways;

  it('without payments.view it shows the denial and never calls the API', async () => {
    perms.current = [];
    renderIntl(<PaymentGatewaysPage />, locale);

    expect(await screen.findByTestId('pg-denied')).toBeTruthy();
    expect(screen.getByTestId('pg-denied').textContent).toBe(m.denied);
    expect(api).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: m.add })).toBeNull();
  });

  it('a read-only viewer sees the connections and saved indicators but no action and no secret', async () => {
    perms.current = ['payments.view'];
    listReturns([conn({ status: 'active', has_webhook_secret: true })]);
    renderIntl(<PaymentGatewaysPage />, locale);

    const item = await screen.findByTestId('pg-item-g1');
    expect(within(item).getByText(m.status.active)).toBeTruthy();
    expect(within(item).getAllByText(m.fields.saved).length).toBe(2);
    expect(within(item).queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: m.add })).toBeNull();
    expect(document.body.textContent).not.toMatch(/sk_|whsec_/);
    expect(api).toHaveBeenCalledTimes(1); // السجل (events) يتطلب الإدارة: لا طلب
  });

  it('shows the empty state with an add action for a manager and without one for a viewer', async () => {
    perms.current = ['payments.view', 'payment_gateways.manage'];
    listReturns([]);
    const { unmount } = renderIntl(<PaymentGatewaysPage />, locale);
    const empty = await screen.findByTestId('pg-empty');
    expect(within(empty).getByRole('button', { name: m.add })).toBeTruthy();
    unmount();

    perms.current = ['payments.view'];
    renderIntl(<PaymentGatewaysPage />, locale);
    expect(within(await screen.findByTestId('pg-empty')).queryByRole('button')).toBeNull();
  });

  it('shows a load error with a retry that reloads', async () => {
    perms.current = ['payments.view'];
    api.mockRejectedValueOnce(new ApiErrorMock(500, 'boom', { message: 'boom' }));
    api.mockResolvedValueOnce({ data: [conn()] });
    renderIntl(<PaymentGatewaysPage />, locale);

    const user = userEvent.setup();
    expect((await screen.findByRole('alert')).textContent).toContain('boom');
    await user.click(screen.getByRole('button', { name: m.retry }));
    expect(await screen.findByTestId('pg-item-g1')).toBeTruthy();
  });

  it('disables activation of an unverified real provider with the stated reason, but not a custom link', async () => {
    perms.current = ['payments.view', 'payment_gateways.manage'];
    listReturns([conn({ id: 'real', provider: 'stripe', name: 'Stripe' }), conn({ id: 'manual', provider: 'custom', name: 'يدوي' })]);
    renderIntl(<PaymentGatewaysPage />, locale);

    const real = await screen.findByTestId('pg-item-real');
    expect((within(real).getByRole('button', { name: m.actions.activate }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(real).getByText(m.activationBlocked)).toBeTruthy();
    const manual = screen.getByTestId('pg-item-manual');
    expect((within(manual).getByRole('button', { name: m.actions.activate }) as HTMLButtonElement).disabled).toBe(false);
    expect(within(manual).queryByText(m.activationBlocked)).toBeNull();
  });

  it('activates after confirmation and reflects the returned state', async () => {
    perms.current = ['payments.view', 'payment_gateways.manage'];
    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/payment-gateways') return Promise.resolve({ data: [conn()] });
      if (path === '/payment-gateways/g1/activate' && options?.method === 'POST') return Promise.resolve({ data: conn({ status: 'active', is_usable: true }) });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    renderIntl(<PaymentGatewaysPage />, locale);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: m.actions.activate }));
    await waitFor(() => expect(within(screen.getByTestId('pg-item-g1')).getByText(m.status.active)).toBeTruthy());
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith(m.done.activate);
  });

  it('does nothing when the confirmation is declined', async () => {
    perms.current = ['payments.view', 'payment_gateways.manage'];
    confirm.mockResolvedValue(false);
    listReturns([conn({ status: 'active' })]);
    renderIntl(<PaymentGatewaysPage />, locale);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: m.actions.suspend }));
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('translates a stable server error code into the localized message', async () => {
    perms.current = ['payments.view', 'payment_gateways.manage'];
    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (options?.method === 'DELETE') {
        return Promise.reject(new ApiErrorMock(422, 'x', { error: { code: 'gateway.has_references', message: 'server text' } }));
      }
      return Promise.resolve({ data: [conn()] });
    });
    renderIntl(<PaymentGatewaysPage />, locale);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: m.actions.delete }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(m.errors.gateway_has_references));
    expect(screen.getByTestId('pg-item-g1')).toBeTruthy();
  });

  it('the add wizard needs a name, shows a review with secrets masked, and posts only the entered secrets', async () => {
    perms.current = ['payments.view', 'payment_gateways.manage'];
    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/payment-gateways' && options?.method === 'POST') return Promise.resolve({ data: conn({ id: 'new', name: 'جديد' }) });
      return Promise.resolve({ data: [] });
    });
    renderIntl(<PaymentGatewaysPage />, locale);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: m.add, hidden: false }));
    await user.click(screen.getByRole('button', { name: m.form.next }));
    expect(screen.getByRole('alert').textContent).toBe(m.form.nameRequired);

    await user.type(screen.getByLabelText(m.form.name), 'جديد');
    await user.click(screen.getByRole('button', { name: m.form.next }));
    const secret = screen.getByLabelText(m.form.secretKey) as HTMLInputElement;
    expect(secret.type).toBe('password');
    await user.type(secret, 'sk_test_value');
    await user.click(screen.getByRole('button', { name: m.form.next }));

    const review = screen.getByTestId('pg-review');
    expect(review.textContent).not.toContain('sk_test_value');
    expect(review.textContent).toContain(m.form.provided);
    await user.click(screen.getByRole('button', { name: m.form.saveDraft }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(m.done.create));
    const post = api.mock.calls.find((call) => call[1]?.method === 'POST');
    expect(post?.[1].body).toMatchObject({ provider: 'custom', name: 'جديد', secret_key: 'sk_test_value' });
    expect(post?.[1].body).not.toHaveProperty('webhook_secret');
    expect(await screen.findByTestId('pg-item-new')).toBeTruthy();
  });

  it('revoking collects the reason the server requires and posts it', async () => {
    perms.current = ['payments.view', 'payment_gateways.manage'];
    api.mockImplementation((path: string, options?: { method?: string; body?: Record<string, unknown> }) => {
      if (path === '/payment-gateways/g1/revoke' && options?.method === 'POST') return Promise.resolve({ data: conn({ status: 'revoked' }) });
      return Promise.resolve({ data: [conn({ status: 'active' })] });
    });
    renderIntl(<PaymentGatewaysPage />, locale);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: m.actions.revoke }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: m.revoke.submit }));
    expect(within(dialog).getByRole('alert').textContent).toBe(m.revoke.reasonRequired);
    expect(api.mock.calls.some((call) => call[1]?.method === 'POST')).toBe(false);

    await user.type(within(dialog).getByLabelText(m.revoke.reason), 'أُغلق الحساب لدى المزوّد');
    await user.click(within(dialog).getByRole('button', { name: m.revoke.submit }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(m.done.revoke));
    const post = api.mock.calls.find((call) => call[1]?.method === 'POST');
    expect(post?.[1].body).toEqual({ reason: 'أُغلق الحساب لدى المزوّد' });
    expect(within(screen.getByTestId('pg-item-g1')).getByText(m.status.revoked)).toBeTruthy();
  });

  it('locks the environment once the connection has left draft and does not send it', async () => {
    perms.current = ['payments.view', 'payment_gateways.manage'];
    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/payment-gateways/g1' && options?.method === 'PUT') return Promise.resolve({ data: conn({ status: 'active', name: 'معدّل' }) });
      return Promise.resolve({ data: [conn({ status: 'active' })] });
    });
    renderIntl(<PaymentGatewaysPage />, locale);

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: m.actions.edit }));
    const env = screen.getByLabelText(m.form.environment) as HTMLSelectElement;
    expect(env.disabled).toBe(true);
    expect(screen.getByText(m.form.environmentLocked)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: m.form.saveEdit }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(m.done.edit));
    const put = api.mock.calls.find((call) => call[1]?.method === 'PUT');
    expect(put?.[1].body).not.toHaveProperty('environment');
  });

  it('in preview mode every mutation control is hidden and a note says why', async () => {
    perms.current = ['*'];
    demo.on = true;
    api.mockResolvedValue({ data: [] });
    renderIntl(<PaymentGatewaysPage />, locale);

    expect(await screen.findByTestId('pg-demo')).toBeTruthy();
    expect(screen.queryByRole('button', { name: m.add })).toBeNull();
    expect(within(await screen.findByTestId('pg-empty')).queryByRole('button')).toBeNull();
  });
});
