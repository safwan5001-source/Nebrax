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
    default_gateway_id: null, multiple_eligible_gateways: false, default_gateway_selectable: false,
    usage: { invoices: true, store: true, pos: false }, usage_supported: { invoices: true, store: true, pos: false },
    ...overrides,
  };
}

const ready = { gateway_id: 'g1', gateway_name: 'ميسّر', provider: 'moyasar', environment: 'sandbox' as const, usable: true, requires_provider_setup: false, eligible: true };
const second = { ...ready, gateway_id: 'g2', gateway_name: 'ثانية', environment: 'live' as const };
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
  const openManage = async (key: string) => {
    await userEvent.click(await screen.findByTestId(`pm-manage-${key}`));
    return screen.findByTestId('pm-manage');
  };

  it('each row is compact — brand, status, a show switch and a Manage button — and every switch works for a manager whether or not the gateway is ready (Beta)', async () => {
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
    for (const key of ['mada', 'visa', 'apple_pay', 'mastercard']) {
      expect(sw(key).disabled).toBe(false);
      expect(within(screen.getByTestId(`pm-item-${key}`)).getAllByRole('button').filter((b) => b.getAttribute('role') !== 'switch')).toHaveLength(1);
      expect(screen.getByTestId(`pm-manage-${key}`).textContent).toContain(m.manage.open);
    }
    // لا تفاصيل داخل الصف: لا قائمة اتصالات ولا خطوات؛ كلها داخل «إدارة»
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByText(m.step.provider_setup)).toBeNull();
  });

  it('an enabled method whose gateway is not ready has no repeated warning under the row (status badge only) and can still be switched off', async () => {
    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/online-payment-methods') return Promise.resolve({ data: [method({ key: 'visa', status: 'enabled_not_ready', reason: 'no_usable_gateway', enabled: true, customer_visible: true })] });
      if (path === '/online-payment-methods/visa' && options?.method === 'PUT') return Promise.resolve({ data: method({ key: 'visa', status: 'needs_setup', reason: 'no_usable_gateway', enabled: false }) });
      return Promise.reject(new Error(`unexpected ${options?.method ?? 'GET'} ${path}`));
    });
    mount(true);
    expect(await screen.findByTestId('pm-list')).toBeTruthy();
    expect(screen.getByTestId('pm-status-visa').textContent).toBe(m.status.enabled_not_ready);
    expect(screen.queryByTestId('pm-hint-visa')).toBeNull();
    expect(screen.getByTestId('pm-item-visa').textContent).not.toContain(m.hintNotReady);
    expect(sw('visa').getAttribute('aria-checked')).toBe('true');
    await userEvent.click(sw('visa'));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/online-payment-methods/visa', { method: 'PUT', body: { enabled: false } }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(m.done.disabled));
  });

  it('a viewer without payment_gateways.manage sees disabled switches, can open Manage read-only, and has no save', async () => {
    overview([method({ key: 'mada', status: 'enabled', enabled: true, ready: true, connections: [ready], effective_gateway: gw })]);
    mount(false);

    await screen.findByTestId('pm-list');
    expect(sw('mada').disabled).toBe(true);
    const sheet = await openManage('mada');
    expect(within(sheet).getByTestId('pm-manage-readonly').textContent).toBe(m.blocked.no_permission);
    expect(within(sheet).queryByTestId('pm-manage-save')).toBeNull();
    expect((within(sheet).getByRole('combobox') as HTMLSelectElement).disabled).toBe(true);
    for (const id of ['pm-use-invoices', 'pm-use-store']) expect((within(within(sheet).getByTestId(id)).getByRole('switch') as HTMLButtonElement).disabled).toBe(true);
  });

  it('enabling a method with no gateway at all is allowed: PUT enabled=true, then the row shows enabled-not-ready from the server response', async () => {
    const rows = [method({ key: 'mada', status: 'unsupported', reason: 'no_gateway' })];
    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/online-payment-methods') return Promise.resolve({ data: rows });
      if (path === '/online-payment-methods/mada' && options?.method === 'PUT') return Promise.resolve({ data: { ...rows[0], status: 'enabled_not_ready', enabled: true, customer_visible: true } });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    mount(true);

    await userEvent.click(await screen.findByRole('switch'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(m.done.enabled));
    expect(api).toHaveBeenCalledWith('/online-payment-methods/mada', { method: 'PUT', body: { enabled: true } });
    expect(screen.getByTestId('pm-status-mada').textContent).toBe(m.status.enabled_not_ready);
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

  it('Manage shows readiness, the next step with a path to the gateways tab, the connections, and POS as unavailable (no fake switch)', async () => {
    const onOpen = vi.fn();
    overview([method({ key: 'visa', status: 'needs_setup', reason: 'no_usable_gateway', connections: [{ ...ready, usable: false, eligible: false }] })]);
    mount(true, onOpen);

    const sheet = await openManage('visa');
    expect(within(sheet).getByTestId('pm-manage-status').textContent).toBe(m.status.needs_setup);
    expect(within(sheet).getByTestId('pm-reason').textContent).toBe(m.reasonDisabled);
    expect(within(sheet).getByText(m.step.activate_gateway)).toBeTruthy();
    const pos = within(sheet).getByTestId('pm-use-pos');
    expect(within(pos).queryByRole('switch')).toBeNull();
    expect(pos.textContent).toContain(m.manage.usage.posUnavailable);
    await userEvent.click(within(sheet).getByRole('button', { name: m.openGateways }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId('pm-manage')).toBeNull());
  });

  it('Manage saves only what changed: default gateway and usage go in one PUT, and the row updates from the server response', async () => {
    const row = method({ key: 'mada', status: 'enabled', enabled: true, ready: true, connections: [ready, second], effective_gateway: gw });
    api.mockImplementation((path: string, options?: { method?: string; body?: unknown }) => {
      if (path === '/online-payment-methods') return Promise.resolve({ data: [row] });
      if (path === '/online-payment-methods/mada' && options?.method === 'PUT') {
        return Promise.resolve({ data: { ...row, default_gateway_id: 'g2', effective_gateway: { id: 'g2', name: 'ثانية' }, usage: { invoices: true, store: false, pos: false } } });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    mount(true);

    const sheet = await openManage('mada');
    const save = within(sheet).getByTestId('pm-manage-save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);   // لا تغيير ⇒ لا حفظ
    const select = within(sheet).getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['', 'g1', 'g2']);
    await userEvent.selectOptions(select, 'g2');
    await userEvent.click(within(within(sheet).getByTestId('pm-use-store')).getByRole('switch'));
    expect(save.disabled).toBe(false);
    await userEvent.click(save);

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(m.done.saved));
    expect(api).toHaveBeenCalledWith('/online-payment-methods/mada', { method: 'PUT', body: { default_gateway_id: 'g2', use_in_store: false } });
    await waitFor(() => expect(screen.queryByTestId('pm-manage')).toBeNull());
    // إعادة الفتح تعرض ما حُفظ فعلاً
    const again = await openManage('mada');
    expect((within(again).getByRole('combobox') as HTMLSelectElement).value).toBe('g2');
    expect(within(within(again).getByTestId('pm-use-store')).getByRole('switch').getAttribute('aria-checked')).toBe('false');
    expect(within(within(again).getByTestId('pm-use-invoices')).getByRole('switch').getAttribute('aria-checked')).toBe('true');
  });

  it('a rejected default gateway keeps the sheet open, maps the server code, and re-reads the real state', async () => {
    const row = method({ key: 'mada', status: 'enabled', enabled: true, ready: true, connections: [ready, second], effective_gateway: gw });
    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/online-payment-methods' && !options?.method) return Promise.resolve({ data: [row] });
      return Promise.reject(new ApiErrorMock(422, 'x', { error: { code: 'method.default_gateway_invalid', message: 'raw' } }));
    });
    mount(true);

    const sheet = await openManage('mada');
    await userEvent.selectOptions(within(sheet).getByRole('combobox'), 'g2');
    await userEvent.click(within(sheet).getByTestId('pm-manage-save'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(m.errors.default_gateway_invalid));
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByTestId('pm-manage')).toBeTruthy();
  });

  it('without any connection Manage explains there is no gateway instead of showing an empty selector', async () => {
    overview([method({ key: 'mastercard', status: 'unsupported', reason: 'no_gateway' })]);
    mount(true);

    const sheet = await openManage('mastercard');
    expect(within(sheet).getByTestId('pm-no-connection').textContent).toBe(m.manage.gateway.none);
    expect(within(sheet).queryByRole('combobox')).toBeNull();
    expect(within(sheet).getByText(m.step.add_gateway)).toBeTruthy();
  });

  it('shows an error with retry when loading fails, and the one-line scope note links to cash/bank methods', async () => {
    api.mockRejectedValueOnce(new Error('down'));
    mount(true);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByTestId('pm-scope-note').textContent).toContain(m.scope);
    expect(screen.getByTestId('pm-scope-note').querySelectorAll('p')).toHaveLength(1);
    expect(screen.getByRole('link', { name: m.scopeLink }).getAttribute('href')).toBe('/payment-methods');

    overview([method({ key: 'mada', status: 'enabled', enabled: true, ready: true, connections: [ready] })]);
    await userEvent.click(screen.getByRole('button', { name: m.retry }));
    expect(await screen.findByTestId('pm-list')).toBeTruthy();
  });
});
