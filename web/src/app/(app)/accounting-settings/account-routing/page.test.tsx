// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AccountRoutingPage from './page';

const { api, currentUser, translate, toastSuccess, toastError } = vi.hoisted(() => {
  const strings: Record<string, string> = {
    forbidden: 'Forbidden',
    forbiddenHint: 'Forbidden hint',
    accountRoutingTitle: 'Account Routing',
    accountRoutingSubtitle: 'Subtitle',
    backToAccountingSettings: 'Back',
    routingViewOnly: 'View only',
    loadFailed: 'Load failed',
    routingSaved: 'Saved',
    routingSaveFailed: 'Save failed',
    routingSelectAccount: 'Select an account…',
    routingStateDefault: 'Default',
    routingStateCustom: 'Custom',
    routingStateInvalid: 'Invalid',
    routingStateUnmapped: 'Unmapped',
    routingResetAction: 'Reset',
    routingResetConfirm: 'Confirm reset?',
    routingResetDone: 'Reset done',
    routingResetFailed: 'Reset failed',
  };
  const translator = (key: string) => strings[key] ?? key;
  return {
    api: vi.fn(),
    currentUser: vi.fn(),
    translate: translator,
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
  };
});

vi.mock('next-intl', () => ({ useTranslations: () => translate, useLocale: () => 'en' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/lib/auth', () => ({ currentUser }));
vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: toastSuccess, error: toastError }) }));
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

const routingData = {
  roles: [
    {
      key: 'sales_revenue',
      label_ar: 'إيرادات المبيعات',
      label_en: 'Sales Revenue',
      description_ar: 'وصف',
      description_en: 'Description',
      domain: 'sales',
      legacy_code: '4110',
      configurable: true,
      mapping: { state: 'mapped', account: { id: 'acc-1', code: '4110', name: 'اسم', name_en: 'Name', is_active: true, is_group: false }, is_default: true },
    },
    {
      key: 'cogs',
      label_ar: 'تكلفة البضاعة',
      label_en: 'COGS',
      description_ar: 'وصف',
      description_en: 'Description',
      domain: 'inventory',
      legacy_code: '5110',
      configurable: true,
      mapping: { state: 'invalid', account: null, is_default: false },
    },
  ],
  domains: {
    sales: { label_ar: 'المبيعات', label_en: 'Sales' },
    inventory: { label_ar: 'المخزون', label_en: 'Inventory' },
  },
  eligible_accounts: [
    { id: 'acc-1', code: '4110', name: 'اسم', name_en: 'Name', type: 'revenue' },
    { id: 'acc-2', code: '4199', name: 'اسم مخصص', name_en: 'Custom name', type: 'revenue' },
  ],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AccountRoutingPage', () => {
  it('shows a forbidden state without accounting_settings.view', async () => {
    currentUser.mockReturnValue({ role: 'staff', permissions: ['invoices.view'] });

    render(<AccountRoutingPage />);

    await waitFor(() => screen.getByText('Forbidden'));
    expect(api).not.toHaveBeenCalled();
  });

  it('renders role groups with default and invalid states for a viewer', async () => {
    currentUser.mockReturnValue({ role: 'owner', permissions: undefined });
    api.mockResolvedValueOnce({ data: routingData });

    render(<AccountRoutingPage />);

    await waitFor(() => screen.getByText('Sales Revenue'));
    expect(screen.getByText('Default')).not.toBeNull();
    expect(screen.getByText('Invalid')).not.toBeNull();
  });

  it('shows the view-only notice and disables controls without manage permission', async () => {
    currentUser.mockReturnValue({ role: 'custom_viewer', permissions: ['accounting_settings.view'] });
    api.mockResolvedValueOnce({ data: routingData });

    render(<AccountRoutingPage />);

    await waitFor(() => screen.getByText('View only'));
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    expect(selects.length).toBeGreaterThan(0);
    selects.forEach((select) => expect(select.disabled).toBe(true));
  });

  it('saves a new mapping by calling PUT with the selected account id', async () => {
    currentUser.mockReturnValue({ role: 'owner', permissions: undefined });
    api.mockResolvedValueOnce({ data: routingData });
    api.mockResolvedValueOnce({
      data: { ...routingData.roles[0], mapping: { state: 'mapped', account: routingData.eligible_accounts[1], is_default: false } },
    });

    render(<AccountRoutingPage />);

    await waitFor(() => screen.getByText('Sales Revenue'));
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];

    fireEvent.change(selects[0], { target: { value: 'acc-2' } });

    await waitFor(() =>
      expect(api).toHaveBeenLastCalledWith('/accounting-settings/account-routing/sales_revenue', {
        method: 'PUT',
        body: { account_id: 'acc-2' },
      })
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Saved'));
  });
});
