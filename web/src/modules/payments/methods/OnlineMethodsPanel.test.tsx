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
    status: 'disabled', reason: null, enabled: false, customer_visible: false, connections: [], effective_gateway: null,
    multiple_eligible_gateways: false, default_gateway_selectable: false, usage: { invoices: true, store: false },
    ...overrides,
  };
}

const ready = { gateway_id: 'g1', gateway_name: 'ميسّر', provider: 'moyasar', environment: 'sandbox' as const, usable: true, requires_provider_setup: false, eligible: true };

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

  it('shows each method with its server-computed status and never offers a switch for needs_setup/unsupported', async () => {
    overview([
      method({ key: 'mada', status: 'enabled', enabled: true, customer_visible: true, connections: [ready], effective_gateway: { id: 'g1', name: 'ميسّر' } }),
      method({ key: 'visa', status: 'disabled', connections: [ready], effective_gateway: { id: 'g1', name: 'ميسّر' } }),
      method({ key: 'apple_pay', status: 'needs_setup', reason: 'provider_setup_required', connections: [{ ...ready, requires_provider_setup: true, eligible: false }] }),
      method({ key: 'mastercard', status: 'unsupported' }),
    ]);
    mount(true);

    expect(await screen.findByTestId('pm-list')).toBeTruthy();
    expect(screen.getByTestId('pm-status-mada').textContent).toBe(m.status.enabled);
    expect(screen.getByTestId('pm-status-visa').textContent).toBe(m.status.disabled);
    expect(screen.getByTestId('pm-status-apple_pay').textContent).toBe(m.status.needs_setup);
    expect(screen.getByTestId('pm-status-mastercard').textContent).toBe(m.status.unsupported);

    const sw = (key: string) => within(screen.getByTestId(`pm-item-${key}`)).getByRole('switch') as HTMLButtonElement;
    expect(sw('mada').getAttribute('aria-checked')).toBe('true');
    expect(sw('mada').disabled).toBe(false);
    expect(sw('visa').disabled).toBe(false);
    expect(sw('apple_pay').disabled).toBe(true);
    expect(sw('mastercard').disabled).toBe(true);
    expect(screen.getByTestId('pm-reason-apple_pay').textContent).toBe(m.blocked.needs_setup);
    expect(screen.getByTestId('pm-reason-mastercard').textContent).toBe(m.blocked.unsupported);
    expect(within(screen.getByTestId('pm-item-apple_pay')).getByText(m.step.provider_setup)).toBeTruthy();
    // لا يوجد قائمة اختيار بوابة: العرض قراءة فقط
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByTestId('pm-gateway-mada').textContent).toBe(m.autoGateway.replace('{name}', 'ميسّر'));
    expect(screen.getByTestId('pm-gateway-mastercard').textContent).toBe(m.noGateway);
    expect(screen.getByTestId('pm-store-mada').textContent).toBe(m.usageStoreUnavailable);
  });

  it('a method saved as enabled but no longer ready can still be switched off and explains why it is hidden', async () => {
    overview([
      method({ key: 'visa', status: 'needs_setup', reason: 'no_usable_gateway', enabled: true, connections: [{ ...ready, usable: false, eligible: false }] }),
    ]);
    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/online-payment-methods') return Promise.resolve({ data: [method({ key: 'visa', status: 'needs_setup', reason: 'no_usable_gateway', enabled: true })] });
      if (path === '/online-payment-methods/visa' && options?.method === 'PUT') {
        return Promise.resolve({ data: method({ key: 'visa', status: 'needs_setup', reason: 'no_usable_gateway', enabled: false }) });
      }
      return Promise.reject(new Error(`unexpected ${options?.method ?? 'GET'} ${path}`));
    });
    mount(true);
    expect(await screen.findByTestId('pm-list')).toBeTruthy();
    const sw = within(screen.getByTestId('pm-item-visa')).getByRole('switch') as HTMLButtonElement;
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.disabled).toBe(false);
    expect(screen.getByTestId('pm-reason-visa').textContent).toBe(m.storedNotReady);
    await userEvent.click(sw);
    await waitFor(() => expect(api).toHaveBeenCalledWith('/online-payment-methods/visa', expect.objectContaining({ method: 'PUT' })));
  });

  it('a viewer without payment_gateways.manage sees every switch disabled with the permission reason', async () => {
    overview([method({ key: 'mada', status: 'enabled', enabled: true, connections: [ready] })]);
    mount(false);

    await screen.findByTestId('pm-list');
    expect((within(screen.getByTestId('pm-item-mada')).getByRole('switch') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('pm-reason-mada').textContent).toBe(m.blocked.no_permission);
  });

  it('toggling PUTs the new value, updates from the server response, and reports success', async () => {
    const rows = [method({ key: 'visa', status: 'disabled', connections: [ready], effective_gateway: { id: 'g1', name: 'ميسّر' } })];
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
        return Promise.resolve({ data: [method({ key: 'visa', status: reads === 1 ? 'disabled' : 'needs_setup', reason: 'no_usable_gateway', connections: [ready] })] });
      }
      return Promise.reject(new ApiErrorMock(422, 'x', { error: { code: 'method.needs_setup', message: 'raw server text' } }));
    });
    mount(true);

    await userEvent.click(within(await screen.findByTestId('pm-item-visa')).getByRole('switch'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(m.errors.needs_setup));
    await waitFor(() => expect(screen.getByTestId('pm-status-visa').textContent).toBe(m.status.needs_setup));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('explains the multi-gateway limit and offers a path to the gateways tab for incomplete methods', async () => {
    const onOpen = vi.fn();
    overview([
      method({ key: 'mada', status: 'enabled', enabled: true, connections: [ready, { ...ready, gateway_id: 'g2', gateway_name: 'ثانية' }], effective_gateway: { id: 'g1', name: 'ميسّر' }, multiple_eligible_gateways: true }),
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

    overview([method({ key: 'mada', status: 'enabled', enabled: true, connections: [ready] })]);
    await userEvent.click(screen.getByRole('button', { name: m.retry }));
    expect(await screen.findByTestId('pm-list')).toBeTruthy();
  });
});
