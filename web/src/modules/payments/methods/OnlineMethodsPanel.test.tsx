// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OnlineMethodsPanel } from './OnlineMethodsPanel';
import type { OnlineMethod } from './contract';
import { renderIntl, TEST_LOCALES, TEST_MESSAGES } from '@/test-utils/intl';

const { api, toast, ApiErrorMock } = vi.hoisted(() => {
  class ApiErrorMock extends Error {
    status: number;
    body: unknown;
    constructor(status: number, message: string, body: unknown) {
      super(message);
      this.status = status;
      this.body = body;
    }
  }
  return { api: vi.fn(), toast: { success: vi.fn(), error: vi.fn() }, ApiErrorMock };
});

vi.mock('@/lib/api', () => ({ api, ApiError: ApiErrorMock }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => toast }));

function method(overrides: Partial<OnlineMethod> & Pick<OnlineMethod, 'key'>): OnlineMethod {
  return {
    status: 'disabled', reason: null, enabled: false, ready: false, customer_visible: false, connections: [], effective_gateway: null,
    multiple_eligible_gateways: false, default_gateway_selectable: false, usage: { invoices: true, store: true },
    ...overrides,
  };
}

const ready = { gateway_id: 'g1', gateway_name: 'ميسّر', provider: 'moyasar', environment: 'sandbox' as const, usable: true, requires_provider_setup: false, eligible: true };
const gw = { id: 'g1', name: 'ميسّر' };

function overview(rows: OnlineMethod[]) {
  api.mockImplementation((path: string, options?: { method?: string }) => {
    if (path === '/online-payment-methods') return Promise.resolve({ data: rows });
    return Promise.reject(new Error(`unexpected ${options?.method ?? 'GET'} ${path}`));
  });
}

beforeEach(() => {
  api.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});
afterEach(cleanup);

describe.each(TEST_LOCALES)('OnlineMethodsPanel (%s)', (locale) => {
  const m = TEST_MESSAGES[locale].onlinePaymentMethods;
  const mount = (canManage: boolean, onOpenGateways = vi.fn()) =>
    renderIntl(<OnlineMethodsPanel canManage={canManage} refreshKey={0} onOpenGateways={onOpenGateways} />, locale);
  const sw = (key: string) => within(screen.getByTestId(`pm-item-${key}`)).getByRole('switch') as HTMLButtonElement;

  it('shows each method with its server-computed status, and every switch works for a manager whether or not the gateway is ready (Beta)', async () => {
    overview([
      method({ key: 'mada', status: 'enabled', enabled: true, ready: true, customer_visible: true, connections: [ready], effective_gateway: gw }),
      method({ key: 'visa', status: 'disabled', ready: true, connections: [ready], effective_gateway: gw }),
      method({ key: 'apple_pay', status: 'needs_setup', reason: 'provider_setup_required', connections: [{ ...ready, requires_provider_setup: true, eligible: false }] }),
      method({ key: 'mastercard', status: 'unsupported', reason: 'no_gateway' }),
    ]);
    mount(true);

    expect(await screen.findByTestId('pm-list')).toBeTruthy();
    expect(screen.getByTestId('pm-status-mada').textContent).toBe(m.status.enabled);
    expect(screen.getByTestId('pm-status-visa').textContent).toBe(m.status.disabled);
    expect(screen.getByTestId('pm-status-apple_pay').textContent).toBe(m.status.needs_setup);
    expect(screen.getByTestId('pm-status-mastercard').textContent).toBe(m.status.unsupported);

    expect(sw('mada').getAttribute('aria-checked')).toBe('true');
    for (const key of ['mada', 'visa', 'apple_pay', 'mastercard']) expect(sw(key).disabled).toBe(false);
    // غير الجاهزة تشرح ما يلزم للتحصيل بدل منع التفعيل
    expect(within(screen.getByTestId('pm-item-apple_pay')).getByText(m.step.provider_setup)).toBeTruthy();
    expect(within(screen.getByTestId('pm-item-mastercard')).getByText(m.step.add_gateway)).toBeTruthy();
    expect(screen.getByTestId('pm-reason-mastercard').textContent).toBe(m.reasonDisabled);
    // لا قائمة اختيار بوابة: العرض قراءة فقط
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByTestId('pm-gateway-mada').textContent).toBe(m.autoGateway.replace('{name}', 'ميسّر'));
    expect(screen.getByTestId('pm-gateway-mastercard').textContent).toBe(m.noGateway);
    expect(screen.getByTestId('pm-store-mada').textContent).toBe(m.usageStoreCollectable);
    expect(screen.getByTestId('pm-store-visa').textContent).toBe(m.usageStoreOff);
  });

  it('an enabled method whose gateway is not ready is shown as enabled-but-not-collectable and explains that nothing is charged', async () => {
    overview([
      method({ key: 'visa', status: 'enabled_not_ready', reason: 'no_usable_gateway', enabled: true, customer_visible: true, connections: [{ ...ready, usable: false, eligible: false }] }),
    ]);
    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/online-payment-methods') return Promise.resolve({ data: [method({ key: 'visa', status: 'enabled_not_ready', reason: 'no_usable_gateway', enabled: true, customer_visible: true })] });
      if (path === '/online-payment-methods/visa' && options?.method === 'PUT') {
        return Promise.resolve({ data: method({ key: 'visa', status: 'needs_setup', reason: 'no_usable_gateway', enabled: false }) });
      }
      return Promise.reject(new Error(`unexpected ${options?.method ?? 'GET'} ${path}`));
    });
    mount(true);
    expect(await screen.findByTestId('pm-list')).toBeTruthy();
    expect(screen.getByTestId('pm-status-visa').textContent).toBe(m.status.enabled_not_ready);
    expect(sw('visa').getAttribute('aria-checked')).toBe('true');
    expect(sw('visa').disabled).toBe(false);
    expect(screen.getByTestId('pm-reason-visa').textContent).toBe(m.reasonEnabledNotReady);
    expect(screen.getByTestId('pm-store-visa').textContent).toBe(m.usageStoreNotCollectable);
    expect(within(screen.getByTestId('pm-item-visa')).getByText(m.step.activate_gateway)).toBeTruthy();
    await userEvent.click(sw('visa'));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/online-payment-methods/visa', expect.objectContaining({ method: 'PUT' })));
  });

  it('a viewer without payment_gateways.manage sees every switch disabled with the permission reason', async () => {
    overview([method({ key: 'mada', status: 'enabled', enabled: true, ready: true, connections: [ready] })]);
    mount(false);

    await screen.findByTestId('pm-list');
    expect(sw('mada').disabled).toBe(true);
    expect(screen.getByTestId('pm-reason-mada').textContent).toBe(m.blocked.no_permission);
  });

  it('enabling a method with no gateway at all is allowed: PUT enabled=true, then the row shows enabled-not-ready from the server response', async () => {
    const rows = [method({ key: 'mada', status: 'unsupported', reason: 'no_gateway' })];
    api.mockImplementation((path: string, options?: { method?: string; body?: unknown }) => {
      if (path === '/online-payment-methods') return Promise.resolve({ data: rows });
      if (path === '/online-payment-methods/mada' && options?.method === 'PUT') {
        return Promise.resolve({ data: { ...rows[0], status: 'enabled_not_ready', enabled: true, customer_visible: true } });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    mount(true);

    await userEvent.click(await screen.findByRole('switch'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(m.done.enabled));
    expect(api).toHaveBeenCalledWith('/online-payment-methods/mada', { method: 'PUT', body: { enabled: true } });
    expect(screen.getByTestId('pm-status-mada').textContent).toBe(m.status.enabled_not_ready);
  });

  it('toggling a ready method PUTs the new value, updates from the server response, and reports success', async () => {
    const rows = [method({ key: 'visa', status: 'disabled', ready: true, connections: [ready], effective_gateway: gw })];
    api.mockImplementation((path: string, options?: { method?: string; body?: unknown }) => {
      if (path === '/online-payment-methods') return Promise.resolve({ data: rows });
      if (path === '/online-payment-methods/visa' && options?.method === 'PUT') {
        return Promise.resolve({ data: { ...rows[0], status: 'enabled', enabled: true, customer_visible: true } });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    mount(true);

    await userEvent.click(within(await screen.findByTestId('pm-item-visa')).getByRole('switch'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(m.done.enabled));
    expect(api).toHaveBeenCalledWith('/online-payment-methods/visa', { method: 'PUT', body: { enabled: true } });
    expect(screen.getByTestId('pm-status-visa').textContent).toBe(m.status.enabled);
  });

  it('a server rejection shows the mapped message and re-reads the real state (no optimistic lie)', async () => {
    let reads = 0;
    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/online-payment-methods' && !options?.method) {
        reads += 1;
        return Promise.resolve({ data: [method({ key: 'visa', status: reads === 1 ? 'disabled' : 'enabled', enabled: reads !== 1, ready: true, connections: [ready] })] });
      }
      return Promise.reject(new ApiErrorMock(422, 'x', { error: { code: 'method.reason_too_long', message: 'raw server text' } }));
    });
    mount(true);

    await userEvent.click(within(await screen.findByTestId('pm-item-visa')).getByRole('switch'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(m.errors.reason_too_long));
    await waitFor(() => expect(screen.getByTestId('pm-status-visa').textContent).toBe(m.status.enabled));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('explains the multi-gateway limit and offers a path to the gateways tab for methods that cannot collect yet', async () => {
    const onOpen = vi.fn();
    overview([
      method({ key: 'mada', status: 'enabled', enabled: true, ready: true, connections: [ready, { ...ready, gateway_id: 'g2', gateway_name: 'ثانية' }], effective_gateway: gw, multiple_eligible_gateways: true }),
      method({ key: 'visa', status: 'needs_setup', reason: 'no_usable_gateway', connections: [{ ...ready, usable: false, eligible: false }] }),
    ]);
    mount(true, onOpen);

    expect((await screen.findByTestId('pm-multi-mada')).textContent).toBe(m.multiGateway);
    expect(screen.queryByTestId('pm-multi-visa')).toBeNull();
    expect(within(screen.getByTestId('pm-item-visa')).getByText(m.step.activate_gateway)).toBeTruthy();
    await userEvent.click(within(screen.getByTestId('pm-item-visa')).getByRole('button', { name: m.openGateways }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('shows an error with retry when loading fails, and the scope note separates it from cash/bank methods', async () => {
    api.mockRejectedValueOnce(new Error('down'));
    mount(true);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByTestId('pm-scope-note').textContent).toContain(m.scopeSeparate);
    expect(screen.getByRole('link', { name: m.scopeLink }).getAttribute('href')).toBe('/payment-methods');

    overview([method({ key: 'mada', status: 'enabled', enabled: true, ready: true, connections: [ready] })]);
    await userEvent.click(screen.getByRole('button', { name: m.retry }));
    expect(await screen.findByTestId('pm-list')).toBeTruthy();
  });
});
