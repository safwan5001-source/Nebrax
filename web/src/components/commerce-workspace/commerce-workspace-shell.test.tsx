// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));

import { CommerceWorkspaceShell } from './commerce-workspace-shell';
import { CommerceStoreProvider } from '@/modules/commerce-workspace/store-context';

const locale = { current: 'en' };

vi.mock('next-intl', () => ({
  useLocale: () => locale.current,
  useTranslations: () => (key: string) => key,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/commerce',
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('@/lib/company', () => ({ useCompany: () => ({ name: 'Acme', logo: null }) }));
vi.mock('@/components/layout/company-logo-mark', () => ({ CompanyLogoMark: () => <span>logo</span> }));
vi.mock('@/components/layout/lang-toggle', () => ({ LangToggle: () => <button type="button">lang</button> }));
vi.mock('@/components/layout/theme-toggle', () => ({ ThemeToggle: () => <button type="button">theme</button> }));

function renderShell() {
  return render(
    <CommerceStoreProvider>
      <CommerceWorkspaceShell>
        <div>body</div>
      </CommerceWorkspaceShell>
    </CommerceStoreProvider>,
  );
}

describe('Commerce workspace shell header', () => {
  afterEach(() => {
    cleanup();
    locale.current = 'en';
    apiMock.mockReset();
  });

  it('keeps View Store disabled and navigation working when the tenant has no stores', async () => {
    apiMock.mockResolvedValue({ data: { stores: [] } });
    renderShell();

    await waitFor(() => expect(screen.getByText('No store is available to select')).toBeTruthy());
    expect(screen.getByText('E-commerce')).toBeTruthy();
    expect(screen.getByText('View store')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'View store' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveProperty('href', expect.stringContaining('/commerce'));
    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts');
  });

  it('renders Arabic workspace chrome', async () => {
    apiMock.mockResolvedValue({ data: { stores: [] } });
    locale.current = 'ar';
    renderShell();

    await waitFor(() => expect(screen.getByText('لا يوجد متجر يمكن اختياره')).toBeTruthy());
    expect(screen.getByText('التجارة الإلكترونية')).toBeTruthy();
    expect(screen.getByText('عرض المتجر')).toBeTruthy();
  });

  it('opens View Store only at the server-authorized URL for the selected store', async () => {
    apiMock.mockResolvedValue({
      data: {
        stores: [
          {
            id: 'store-a',
            name: 'Downtown',
            sales_channel_id: 'ch-a',
            is_active: true,
            preview_url: 'https://downtown.example/',
          },
        ],
      },
    });
    renderShell();

    await waitFor(() => expect(screen.getByText('Downtown')).toBeTruthy());
    const viewStore = screen.getByRole('link', { name: 'View store' });
    expect(viewStore).toHaveProperty('href', 'https://downtown.example/');
    expect(screen.queryByText('Store list is not available yet')).toBeNull();
  });

  it('keeps View Store disabled when the selected store has no authorized domain', async () => {
    apiMock.mockResolvedValue({
      data: {
        stores: [
          {
            id: 'store-a',
            name: 'Pending domain',
            sales_channel_id: 'ch-a',
            is_active: true,
            preview_url: null,
          },
        ],
      },
    });
    renderShell();

    await waitFor(() => expect(screen.getByText('Pending domain')).toBeTruthy());
    expect(screen.queryByRole('link', { name: 'View store' })).toBeNull();
    expect(screen.getByText('View store')).toBeTruthy();
  });

  it('does not invent a preview link when the admin list fails', async () => {
    apiMock.mockRejectedValue(new Error('network'));
    renderShell();

    await waitFor(() => expect(screen.getByText('Store list is not available yet')).toBeTruthy());
    expect(screen.queryByRole('link', { name: 'View store' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Stores' })).toHaveProperty('href', expect.stringContaining('/commerce/stores'));
  });
});
