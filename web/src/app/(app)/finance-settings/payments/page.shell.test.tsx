// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PaymentSettingsPage from './page';
import { renderIntl, TEST_LOCALES, TEST_MESSAGES } from '@/test-utils/intl';

const { api, perms, search } = vi.hoisted(() => ({
  api: vi.fn(),
  perms: { current: [] as string[] },
  search: { tab: null as string | null },
}));

vi.mock('@/lib/api', () => ({ api, ApiError: class extends Error {}, resolveApiUrl: (p: string) => p }));
vi.mock('@/lib/use-can', () => ({
  useCan: () => ({ hydrated: true, can: (p: string) => perms.current.includes('*') || perms.current.includes(p) }),
}));
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/lib/demo', () => ({ isDemo: () => false }));
vi.mock('next/navigation', () => ({ useSearchParams: () => ({ get: (k: string) => (k === 'tab' ? search.tab : null) }) }));

function respond(gatewayRows: unknown[] = [], methodRows: unknown[] = []) {
  api.mockImplementation((path: string) => {
    if (path === '/payment-gateways') return Promise.resolve({ data: gatewayRows });
    if (path === '/online-payment-methods') return Promise.resolve({ data: methodRows });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

beforeEach(() => {
  api.mockReset();
  search.tab = null;
  window.history.replaceState(null, '', '/finance-settings/payments');
});
afterEach(cleanup);

describe.each(TEST_LOCALES)('PaymentSettingsPage shell (%s)', (locale) => {
  const tp = TEST_MESSAGES[locale].paymentSettings;
  const m = TEST_MESSAGES[locale].onlinePaymentMethods;

  it('opens on the payment-methods tab by default and loads only that tab’s data', async () => {
    perms.current = ['payments.view'];
    respond();
    renderIntl(<PaymentSettingsPage />, locale);

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([tp.tabMethods, tp.tabGateways]);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    await screen.findByTestId('pm-empty');
    expect(api).toHaveBeenCalledWith('/online-payment-methods');
    expect(api).not.toHaveBeenCalledWith('/payment-gateways');
  });

  it('?tab=gateways opens the gateways tab; switching syncs the URL and a keyboard arrow moves between tabs', async () => {
    perms.current = ['payments.view'];
    search.tab = 'gateways';
    respond();
    renderIntl(<PaymentSettingsPage />, locale);

    await screen.findByTestId('pg-empty');
    await userEvent.click(screen.getByRole('tab', { name: tp.tabMethods }));
    await screen.findByTestId('pm-empty');
    expect(new URL(window.location.href).searchParams.get('tab')).toBe('methods');

    screen.getByRole('tab', { name: tp.tabMethods }).focus();
    await userEvent.keyboard('{ArrowLeft}');
    await waitFor(() => expect(screen.getByRole('tab', { name: tp.tabGateways }).getAttribute('aria-selected')).toBe('true'));
  });

  it('without payments.view neither tab loads anything and the denial is shown', async () => {
    perms.current = [];
    renderIntl(<PaymentSettingsPage />, locale);

    expect(await screen.findByTestId('pg-denied')).toBeTruthy();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(api).not.toHaveBeenCalled();
  });

  it('the methods tab reads computed readiness fresh from the server when opened (no cached copy of gateway state)', async () => {
    perms.current = ['payments.view', 'payment_gateways.manage'];
    search.tab = 'gateways';
    respond([]);
    renderIntl(<PaymentSettingsPage />, locale);

    await screen.findByTestId('pg-empty');
    // لا تغيير بعد ⇒ لم تُقرأ الوسائل بعد
    expect(api).not.toHaveBeenCalledWith('/online-payment-methods');
    await userEvent.click(screen.getByRole('tab', { name: tp.tabMethods }));
    expect(await screen.findByTestId('pm-empty')).toBeTruthy();
    expect(within(screen.getByTestId('pm-empty')).getByText(m.empty)).toBeTruthy();
  });
});
