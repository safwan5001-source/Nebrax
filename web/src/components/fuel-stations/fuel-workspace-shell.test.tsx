// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderIntl } from '@/test-utils/intl';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/fuel-stations' }));
vi.mock('@/lib/company', () => ({ useCompany: () => ({ name: 'Acme', logo: null }) }));
vi.mock('@/lib/branch', () => ({
  useBranches: () => ({ branches: [], active: null, activeId: null, setActiveBranchId: () => {} }),
}));
vi.mock('@/components/layout/branch-scope', () => ({ BranchScope: () => null }));
vi.mock('@/components/layout/company-logo-mark', () => ({ CompanyLogoMark: () => <span>logo</span> }));
vi.mock('@/components/layout/lang-toggle', () => ({ LangToggle: () => <button type="button">lang</button> }));
vi.mock('@/components/layout/theme-toggle', () => ({ ThemeToggle: () => <button type="button">theme</button> }));
vi.mock('./fuel-workspace-nav', () => ({ FuelWorkspaceNav: () => <nav aria-label="fuel" /> }));

import { FuelWorkspaceShell } from './fuel-workspace-shell';

afterEach(cleanup);

describe('Fuel workspace shell (ERP-UX-012)', () => {
  it.each([
    ['en', 'Back to AWJ'],
    ['ar', 'العودة إلى أَوْج'],
  ] as const)('names the back-to-dashboard link in %s without relying on the hidden text', (locale, name) => {
    renderIntl(<FuelWorkspaceShell><div>body</div></FuelWorkspaceShell>, locale);
    const back = screen.getByRole('link', { name });
    expect(back.getAttribute('href')).toBe('/dashboard');
    expect(back.getAttribute('aria-label')).toBe(name);
  });
});
