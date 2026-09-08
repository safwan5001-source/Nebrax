// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AccountingSettingsPage from './page';

/**
 * ACC-6 P2-1: بطاقة «أقفال الفترات» في مركز إعدادات المحاسبة يجب أن تُحكَم
 * بصلاحيتها الخاصة (`accounting_period_locks.view`) لا بصلاحية الصفحة العامة
 * (`accounting_settings.view`) وحدها — وإلا رأى صاحب `accounting_settings.view`
 * فقط رابطاً ينتهي به عند صفحة «ممنوع» بعد نقرة لا تُفيد.
 */
const { currentUser, translate } = vi.hoisted(() => {
  const strings: Record<string, string> = {
    title: 'Accounting Settings',
    hubSubtitle: 'Subtitle',
    groupSetup: 'Setup',
    forbidden: 'Forbidden',
    forbiddenHint: 'Forbidden hint',
    c_accountRouting_t: 'Account Routing',
    c_accountRouting_d: 'Account routing description',
    c_costCenters_t: 'Cost Centers',
    c_costCenters_d: 'Cost centers description',
    c_fiscalPeriods_t: 'Fiscal Periods',
    c_fiscalPeriods_d: 'Fiscal periods description',
    c_periodLocks_t: 'Period Locks',
    c_periodLocks_d: 'Period locks description',
  };
  const navStrings: Record<string, string> = { soon: 'Soon' };
  const translator = (namespace: string) => (key: string) =>
    (namespace === 'nav' ? navStrings[key] : strings[key]) ?? key;
  return { currentUser: vi.fn(), translate: translator };
});

vi.mock('next-intl', () => ({ useTranslations: (namespace: string) => translate(namespace) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/lib/auth', () => ({ currentUser }));
vi.mock('lucide-react', () => {
  const iconStub = () => <span />;
  return new Proxy({ __esModule: true } as Record<string | symbol, unknown>, {
    get: (target, name) =>
      typeof name === 'symbol' || name === 'then' || name === '__esModule'
        ? Reflect.get(target, name)
        : iconStub,
    has: () => true,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AccountingSettingsPage — period locks card visibility', () => {
  it('hides the Period Locks card for a viewer with accounting_settings.view but not accounting_period_locks.view', async () => {
    currentUser.mockReturnValue({ role: 'custom_role', permissions: ['accounting_settings.view'] });

    render(<AccountingSettingsPage />);

    await waitFor(() => screen.getByText('Account Routing'));
    expect(screen.queryByText('Period Locks')).toBeNull();
  });

  it('shows the Period Locks card as a real link when both permissions are granted', async () => {
    currentUser.mockReturnValue({
      role: 'custom_role',
      permissions: ['accounting_settings.view', 'accounting_period_locks.view'],
    });

    render(<AccountingSettingsPage />);

    await waitFor(() => screen.getByText('Period Locks'));
    const link = screen.getByText('Period Locks').closest('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/accounting-settings/period-locks');
  });

  it('shows the Period Locks card for owner/admin via the wildcard fallback', async () => {
    currentUser.mockReturnValue({ role: 'owner', permissions: undefined });

    render(<AccountingSettingsPage />);

    await waitFor(() => screen.getByText('Period Locks'));
    expect(screen.getByText('Period Locks').closest('a')?.getAttribute('href')).toBe('/accounting-settings/period-locks');
  });

  it('still shows the page forbidden state without accounting_settings.view, regardless of accounting_period_locks.view', async () => {
    currentUser.mockReturnValue({ role: 'custom_role', permissions: ['accounting_period_locks.view'] });

    render(<AccountingSettingsPage />);

    await waitFor(() => screen.getByText('Forbidden'));
    expect(screen.queryByText('Period Locks')).toBeNull();
  });
});
