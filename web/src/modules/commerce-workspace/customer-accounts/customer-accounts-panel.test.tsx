// @vitest-environment jsdom
import * as React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const locale = vi.hoisted(() => ({ current: 'en' }));
vi.mock('next-intl', () => {
  const t = (key: string) => key;
  return { useLocale: () => locale.current, useTranslations: () => t };
});

const can = vi.hoisted(() => ({ allowed: new Set<string>(), hydrated: true }));
vi.mock('@/lib/use-can', () => ({ useCan: () => ({ hydrated: can.hydrated, can: (p: string) => can.allowed.has(p) }) }));

const stores = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
  select: vi.fn(),
}));
vi.mock('../store-context', () => ({ useCommerceStoreContext: () => stores.value }));

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));

import { ToastProvider } from '@/components/ui/toast';
import { deriveStatus, isCustomerAccountSettings, type CustomerAccountSettings } from './api';
import { CustomerAccountsScreen, saveErrorKey } from './customer-accounts-panel';
import { customerAccountsMessages } from './messages';

const STORE_A = { id: 's-a', name: 'Rose Boutique', salesChannelId: 'ch-a', isActive: true, previewUrl: null, defaultLocale: 'ar', businessVertical: 'general', recommendedCapabilities: [] };
const STORE_B = { id: 's-b', name: 'Tulip Outlet', salesChannelId: 'ch-b', isActive: true, previewUrl: null, defaultLocale: 'ar', businessVertical: 'general', recommendedCapabilities: [] };

const settings = (over: Partial<CustomerAccountSettings> = {}): CustomerAccountSettings => ({
  id: 'ch-a',
  name: 'Rose Boutique web',
  type: 'web',
  customer_accounts_enabled: false,
  customer_accounts_deployment_enabled: true,
  recent_changes: [],
  ...over,
});

function setStores(list: unknown[], selectedStoreId: string | null, status = 'ready') {
  stores.value = {
    catalog: { status: 'ready', stores: list },
    selectedStoreId,
    setSelectedStoreId: stores.select,
    storeContextStatus: status,
    viewStoreUrl: null,
    refresh: vi.fn(),
  };
}

const apiError = (status: number, body: Record<string, unknown> = {}) => Object.assign(new Error('x'), { status, body });
const mount = () => render(<ToastProvider><CustomerAccountsScreen /></ToastProvider>);
const toggle = () => screen.getByRole('switch');
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const puts = () => apiMock.mock.calls.filter((call) => (call[1] as { method?: string } | undefined)?.method === 'PUT');

describe('CustomerAccountsScreen', () => {
  beforeEach(() => {
    locale.current = 'en';
    can.allowed = new Set(['commerce.channel_settings.manage']);
    can.hydrated = true;
    stores.select.mockReset();
    apiMock.mockReset();
    setStores([STORE_A, STORE_B], 's-a');
  });
  afterEach(cleanup);

  it('reads the persisted state of the SELECTED store’s channel and names the store', async () => {
    apiMock.mockResolvedValue({ data: settings({ customer_accounts_enabled: true }) });
    mount();
    await screen.findByTestId('customer-accounts-card');
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith('/commerce/channels/ch-a/pricing-settings');
    expect(screen.getByTestId('selected-store').textContent).toBe('Rose Boutique');
    expect(screen.getByTestId('accounts-status').textContent).toBe('Enabled');
    expect(screen.getByTestId('status-body').textContent).toContain('Registration and sign-in are available');
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('shows the disabled state and states that guest checkout remains available', async () => {
    apiMock.mockResolvedValue({ data: settings({ customer_accounts_enabled: false }) });
    mount();
    await screen.findByTestId('customer-accounts-card');
    expect(screen.getByTestId('accounts-status').textContent).toBe('Disabled');
    const body = screen.getByTestId('status-body').textContent ?? '';
    expect(body).toContain('New registration and customer sign-in are unavailable');
    expect(body).toContain('Guest checkout remains available');
    expect(toggle().getAttribute('aria-checked')).toBe('false');
  });

  it('shows Arabic copy in RTL locale', async () => {
    locale.current = 'ar';
    apiMock.mockResolvedValue({ data: settings() });
    mount();
    await screen.findByTestId('customer-accounts-card');
    expect(screen.getByRole('heading', { name: 'حسابات العملاء' })).toBeTruthy();
    expect(screen.getByText('السماح بإنشاء حسابات العملاء')).toBeTruthy();
    expect(screen.getByText('السماح للمتسوقين بإنشاء حساب وتسجيل الدخول وإدارة عناوينهم ومتابعة طلباتهم.')).toBeTruthy();
    expect(screen.getByTestId('status-body').textContent).toContain('الشراء كضيف يبقى متاحاً');
  });

  it('a toggle is only a draft: nothing is sent until Save, and Discard restores the persisted value', async () => {
    apiMock.mockResolvedValue({ data: settings() });
    mount();
    await screen.findByTestId('customer-accounts-card');
    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    // The status reflects what is PERSISTED, not the draft.
    expect(screen.getByTestId('accounts-status').textContent).toBe('Disabled');
    expect(puts()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByText('Unsaved changes')).toBeNull();
    expect(puts()).toHaveLength(0);
  });

  it('toggling back to the persisted value clears the unsaved state', async () => {
    apiMock.mockResolvedValue({ data: settings() });
    mount();
    await screen.findByTestId('customer-accounts-card');
    fireEvent.click(toggle());
    fireEvent.click(toggle());
    expect(screen.queryByText('Unsaved changes')).toBeNull();
  });

  it('Save sends exactly {customer_accounts_enabled} to the selected channel and reports success only after the API confirms', async () => {
    const write = deferred<{ data: CustomerAccountSettings }>();
    apiMock.mockImplementation((_path: string, options?: { method?: string }) =>
      options?.method === 'PUT' ? write.promise : Promise.resolve({ data: settings() }),
    );
    mount();
    await screen.findByTestId('customer-accounts-card');
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]).toEqual(['/commerce/channels/ch-a/pricing-settings', { method: 'PUT', body: { customer_accounts_enabled: true } }]);
    expect(JSON.stringify(puts())).not.toContain('tenant');
    // In flight: no success message, status still the persisted (old) one, controls locked.
    expect(screen.queryByText('Customer accounts setting saved')).toBeNull();
    expect(screen.getByTestId('accounts-status').textContent).toBe('Disabled');
    expect((toggle() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Saving…' }).getAttribute('aria-busy')).toBe('true');

    write.resolve({ data: settings({ customer_accounts_enabled: true, recent_changes: [{ at: '2026-11-01T10:00:00Z', actor: { id: 'u1', name: 'Sara' }, changes: { customer_accounts_enabled: { from: false, to: true } } }] }) });
    await screen.findByText('Customer accounts setting saved');
    expect(screen.getByTestId('accounts-status').textContent).toBe('Enabled');
    expect(screen.queryByText('Unsaved changes')).toBeNull();
    expect(screen.getByTestId('last-change').textContent).toContain('by Sara');
    expect(screen.getByTestId('last-change').textContent).toContain('Disabled → Enabled');
  });

  it('a failed save keeps the persisted state, keeps the draft, and never claims success', async () => {
    apiMock.mockImplementation((_path: string, options?: { method?: string }) =>
      options?.method === 'PUT' ? Promise.reject(apiError(500, {})) : Promise.resolve({ data: settings() }),
    );
    mount();
    await screen.findByTestId('customer-accounts-card');
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not save the setting. Try again.');
    expect(screen.queryByText('Customer accounts setting saved')).toBeNull();
    expect(screen.getByTestId('accounts-status').textContent).toBe('Disabled');
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('does not report success when the server echoes a different value than the one requested', async () => {
    apiMock.mockImplementation((_path: string, options?: { method?: string }) =>
      Promise.resolve({ data: settings({ customer_accounts_enabled: false }) }),
    );
    mount();
    await screen.findByTestId('customer-accounts-card');
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toBe('The server did not confirm the change. Try again.');
    expect(screen.queryByText('Customer accounts setting saved')).toBeNull();
    expect(screen.getByTestId('accounts-status').textContent).toBe('Disabled');
  });

  it('does not report success when the server echoes another channel', async () => {
    apiMock.mockImplementation((_path: string, options?: { method?: string }) =>
      Promise.resolve({ data: options?.method === 'PUT' ? settings({ id: 'ch-other', customer_accounts_enabled: true }) : settings() }),
    );
    mount();
    await screen.findByTestId('customer-accounts-card');
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toBe('The server did not confirm the change. Try again.');
    expect(screen.getByTestId('accounts-status').textContent).toBe('Disabled');
  });

  it('409 deployment gate: shows the gate message, re-reads the real state and stops offering the switch', async () => {
    let gateClosed = false;
    apiMock.mockImplementation((_path: string, options?: { method?: string }) => {
      if (options?.method === 'PUT') {
        gateClosed = true;
        return Promise.reject(apiError(409, { reason: 'customer_accounts_deployment_disabled' }));
      }
      return Promise.resolve({ data: settings({ customer_accounts_deployment_enabled: !gateClosed }) });
    });
    mount();
    await screen.findByTestId('customer-accounts-card');
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The deployment switch is closed');
    expect(screen.queryByText('Customer accounts setting saved')).toBeNull();
    await waitFor(() => expect(screen.getByText('Closed')).toBeTruthy());
    expect(screen.getByTestId('accounts-status').textContent).toBe('Disabled');
  });

  it('with the deployment gate closed and the channel off, the switch cannot be turned on and nothing is sent', async () => {
    apiMock.mockResolvedValue({ data: settings({ customer_accounts_deployment_enabled: false }) });
    mount();
    await screen.findByTestId('customer-accounts-card');
    expect((toggle() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Cannot be enabled while the deployment switch is closed.')).toBeTruthy();
    expect(screen.getByTestId('status-body').textContent).toContain('cannot be turned on until the deployment-wide switch is opened');
    expect(puts()).toHaveLength(0);
  });

  it('enabled on the channel but gate closed is NOT shown as active, and can still be turned off', async () => {
    apiMock.mockResolvedValue({ data: settings({ customer_accounts_enabled: true, customer_accounts_deployment_enabled: false }) });
    mount();
    await screen.findByTestId('customer-accounts-card');
    expect(screen.getByTestId('accounts-status').textContent).toBe('Enabled on the channel — not available to shoppers');
    expect((toggle() as HTMLButtonElement).disabled).toBe(false);
  });

  it('turning off explains the consequences before saving', async () => {
    apiMock.mockResolvedValue({ data: settings({ customer_accounts_enabled: true }) });
    mount();
    await screen.findByTestId('customer-accounts-card');
    fireEvent.click(toggle());
    expect(screen.getByText(/cannot create new accounts or sign in/)).toBeTruthy();
    expect(screen.getByText(/Guest checkout stays available/)).toBeTruthy();
  });

  it('permission denied (no commerce.channel_settings.manage): shows the denied state and sends no request', () => {
    can.allowed = new Set();
    mount();
    expect(screen.getByText('You do not have access to this screen')).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('sends nothing before the session is hydrated', () => {
    can.hydrated = false;
    mount();
    expect(screen.queryByText('You do not have access to this screen')).toBeNull();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('a 403 on read shows the denied state, not an error with retry', async () => {
    apiMock.mockRejectedValue(apiError(403));
    mount();
    expect(await screen.findByText('You do not have access to this screen')).toBeTruthy();
  });

  it('a 403 on save shows the permission message and keeps the draft', async () => {
    apiMock.mockImplementation((_path: string, options?: { method?: string }) =>
      options?.method === 'PUT' ? Promise.reject(apiError(403)) : Promise.resolve({ data: settings() }),
    );
    mount();
    await screen.findByTestId('customer-accounts-card');
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toBe('You do not have permission to change this setting.');
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
  });

  it('a load failure offers retry and never shows a switch', async () => {
    apiMock.mockRejectedValueOnce(apiError(500)).mockResolvedValueOnce({ data: settings() });
    mount();
    expect(await screen.findByText('Could not load the customer accounts settings.')).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /retry|nebrax|try/i }));
    await screen.findByTestId('customer-accounts-card');
  });

  it('a malformed payload is never read as enabled', async () => {
    apiMock.mockResolvedValue({ data: { id: 'ch-a', customer_accounts_enabled: 'yes' } });
    mount();
    expect(await screen.findByText('Could not load the customer accounts settings.')).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('a store without a sales channel shows an explanation and sends nothing', () => {
    setStores([{ ...STORE_A, salesChannelId: null }], 's-a');
    mount();
    expect(screen.getByText('This store has no sales channel')).toBeTruthy();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('switching store loads the other channel and never carries a draft across stores', async () => {
    apiMock.mockImplementation((path: string) =>
      Promise.resolve({ data: path.includes('ch-b') ? settings({ id: 'ch-b', name: 'Tulip web', customer_accounts_enabled: true }) : settings() }),
    );
    const view = mount();
    await screen.findByTestId('customer-accounts-card');
    fireEvent.click(toggle()); // unsaved draft on store A
    expect(screen.getByText('Unsaved changes')).toBeTruthy();

    setStores([STORE_A, STORE_B], 's-b');
    view.rerender(<ToastProvider><CustomerAccountsScreen /></ToastProvider>);
    await waitFor(() => expect(screen.getByTestId('selected-store').textContent).toBe('Tulip Outlet'));
    expect(apiMock).toHaveBeenLastCalledWith('/commerce/channels/ch-b/pricing-settings');
    await waitFor(() => expect(screen.getByTestId('accounts-status').textContent).toBe('Enabled'));
    expect(screen.queryByText('Unsaved changes')).toBeNull();
    expect(puts()).toHaveLength(0);
  });

  it('a requested store the tenant cannot access resolves to the selection screen without any request', () => {
    setStores([STORE_A, STORE_B], null, 'invalid');
    mount();
    expect(apiMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('switch')).toBeNull();
  });
});

describe('saveErrorKey / deriveStatus / payload guard', () => {
  it('maps server reasons and statuses to safe messages', () => {
    expect(saveErrorKey(apiError(409, { reason: 'customer_accounts_deployment_disabled' }))).toBe('error.customer_accounts_deployment_disabled');
    expect(saveErrorKey(apiError(422, { reason: 'channel_not_web' }))).toBe('error.channel_not_web');
    expect(saveErrorKey(apiError(403))).toBe('error.forbidden');
    expect(saveErrorKey(apiError(404))).toBe('error.not_found');
    expect(saveErrorKey(apiError(500))).toBe('error.generic');
    expect(saveErrorKey(new Error('offline'))).toBe('error.generic');
  });

  it('derives the effective status from channel flag AND deployment gate', () => {
    expect(deriveStatus({ customer_accounts_enabled: true, customer_accounts_deployment_enabled: true })).toBe('active');
    expect(deriveStatus({ customer_accounts_enabled: false, customer_accounts_deployment_enabled: true })).toBe('inactive');
    expect(deriveStatus({ customer_accounts_enabled: true, customer_accounts_deployment_enabled: false })).toBe('gated_on');
    expect(deriveStatus({ customer_accounts_enabled: false, customer_accounts_deployment_enabled: false })).toBe('gated_off');
  });

  it('accepts only a well-formed settings payload', () => {
    expect(isCustomerAccountSettings(settings())).toBe(true);
    expect(isCustomerAccountSettings({ id: 'x' })).toBe(false);
    expect(isCustomerAccountSettings(null)).toBe(false);
    expect(isCustomerAccountSettings({ id: 'x', customer_accounts_enabled: 1, customer_accounts_deployment_enabled: true })).toBe(false);
  });
});

describe('messages and layout guards', () => {
  it('has identical, non-empty ar/en keys', () => {
    const { ar, en } = customerAccountsMessages.messages;
    expect(Object.keys(en).sort()).toEqual(Object.keys(ar).sort());
    for (const dict of [ar, en] as Record<string, string>[]) {
      for (const [key, value] of Object.entries(dict)) expect(value.trim(), key).not.toBe('');
    }
  });

  it('uses logical (RTL-safe) spacing and alignment only, and a stacked-then-row mobile layout', () => {
    const source = readFileSync(join(__dirname, 'customer-accounts-panel.tsx'), 'utf8');
    expect(source).not.toMatch(/\b(?:ml|mr|pl|pr|left|right)-\S+|text-(?:left|right)|rounded-(?:l|r)\b/);
    expect(source).toContain('flex-col');
    expect(source).toContain('sm:flex-row');
    expect(source).toContain('min-h-11'); // 44px touch target around the switch
  });

  it('touches no wholesale control, tenant or accounting path', () => {
    const files = ['api.ts', 'customer-accounts-panel.tsx'].map((name) => readFileSync(join(__dirname, name), 'utf8')).join('\n');
    expect(files).not.toMatch(/wholesale_membership_enabled|default_price_list_id|tenant_id|localStorage/);
  });
});

