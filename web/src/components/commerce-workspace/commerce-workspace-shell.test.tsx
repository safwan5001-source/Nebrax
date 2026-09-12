// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('Commerce workspace shell header', () => {
  afterEach(() => {
    cleanup();
    locale.current = 'en';
  });

  it('shows the store selector and View Store foundations in an unavailable state', () => {
    render(
      <CommerceStoreProvider>
        <CommerceWorkspaceShell>
          <div>body</div>
        </CommerceWorkspaceShell>
      </CommerceStoreProvider>,
    );

    expect(screen.getByText('E-commerce')).toBeTruthy();
    expect(screen.getByText('Store list is not available yet')).toBeTruthy();
    expect(screen.getByText('View store')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'View store' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveProperty('href', expect.stringContaining('/commerce'));
  });

  it('renders Arabic workspace chrome', () => {
    locale.current = 'ar';
    render(
      <CommerceStoreProvider>
        <CommerceWorkspaceShell>
          <div>body</div>
        </CommerceWorkspaceShell>
      </CommerceStoreProvider>,
    );

    expect(screen.getByText('التجارة الإلكترونية')).toBeTruthy();
    expect(screen.getByText('عرض المتجر')).toBeTruthy();
    expect(screen.getByText('قائمة المتاجر غير متاحة بعد')).toBeTruthy();
  });
});
