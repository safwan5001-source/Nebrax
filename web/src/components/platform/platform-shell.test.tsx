/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activePlatformNav, PlatformShell, PLATFORM_NAV } from './platform-shell';

const replace = vi.fn();
let pathname = '/platform';
let authenticated = true;
const logout = vi.fn(async () => {});

const messages: Record<string, string> = {
  brand: 'لوحة المنصة',
  navLabel: 'تنقل',
  overview: 'نظرة عامة',
  tenants: 'المؤسسات',
  prices: 'الأسعار',
  integrations: 'التكاملات',
  documentOperations: 'عمليات المستندات',
  skipToContent: 'تخطٍ إلى المحتوى',
  openMenu: 'فتح القائمة',
  closeMenu: 'إغلاق القائمة',
  breadcrumbLabel: 'المسار',
  logout: 'خروج',
  signingOut: 'جارٍ الخروج…',
};

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: { name?: string }) =>
    key === 'signedInAs' ? `مسجل: ${values?.name}` : (messages[key] ?? key),
  useLocale: () => 'ar',
}));
vi.mock('next/navigation', () => ({ usePathname: () => pathname, useRouter: () => ({ replace, refresh: vi.fn() }) }));
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }));
vi.mock('@/lib/platform-auth', () => ({
  isPlatformAuthenticated: () => authenticated,
  currentPlatformAdministrator: () => ({ id: '1', name: 'مدير المنصة', email: 'a@b.c' }),
  platformLogout: () => logout(),
}));

beforeEach(() => {
  pathname = '/platform';
  authenticated = true;
  replace.mockClear();
  logout.mockClear();
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  document.documentElement.className = '';
});

function renderShell() {
  return render(
    <PlatformShell>
      <main>محتوى</main>
    </PlatformShell>
  );
}

describe('active destination', () => {
  it('matches exactly for the overview and by segment prefix for the rest', () => {
    expect(activePlatformNav('/platform')?.key).toBe('overview');
    expect(activePlatformNav('/platform/tenants')?.key).toBe('tenants');
    expect(activePlatformNav('/platform/tenants/abc-123')?.key).toBe('tenants');
    expect(activePlatformNav('/platform/tenants/')?.key).toBe('tenants');
    expect(activePlatformNav('/platform/prices')?.key).toBe('prices');
    expect(activePlatformNav('/platform/tenantsx')).toBeNull();
    expect(activePlatformNav('/platform/login')).toBeNull();
  });

  it('declares exactly the five existing destinations', () => {
    expect(PLATFORM_NAV.map((item) => item.href)).toEqual([
      '/platform',
      '/platform/tenants',
      '/platform/prices',
      '/platform/integrations',
      '/platform/document-operations',
    ]);
  });
});

describe('PlatformShell', () => {
  it('renders five links with aria-current on the matching one only, tenant detail marks Tenants', () => {
    pathname = '/platform/tenants/abc';
    renderShell();
    const links = screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/platform'));
    expect(links).toHaveLength(5);
    const current = links.filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]?.getAttribute('href')).toBe('/platform/tenants');
  });

  it('keeps the page content inside a focusable skip target without nesting a second main', () => {
    const { container } = renderShell();
    const target = container.querySelector('#platform-content');
    expect(target?.tagName).toBe('DIV');
    expect(target?.getAttribute('tabindex')).toBe('-1');
    expect(container.querySelectorAll('main')).toHaveLength(1);
    expect(screen.getByText('تخطٍ إلى المحتوى').getAttribute('href')).toBe('#platform-content');
  });

  it('redirects to the platform login and renders no console when unauthenticated', async () => {
    authenticated = false;
    renderShell();
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/platform/login'));
    expect(screen.queryByText('محتوى')).toBeNull();
    expect(screen.queryByRole('link', { name: 'المؤسسات' })).toBeNull();
  });

  it('menu button exposes aria-expanded/aria-controls; drawer is inert while closed', () => {
    const { container } = renderShell();
    const menu = screen.getByRole('button', { name: 'فتح القائمة' });
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    expect(menu.getAttribute('aria-controls')).toBe('platform-nav');
    expect(container.querySelector('#platform-nav')?.hasAttribute('inert')).toBe(true);

    fireEvent.click(menu);
    expect(menu.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('#platform-nav')?.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'إغلاق القائمة' }));
    expect(document.documentElement.classList.contains('overflow-hidden')).toBe(true);
  });

  it('is not inert at the desktop breakpoint, where the sidebar is permanently visible', () => {
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    const { container } = renderShell();
    expect(container.querySelector('#platform-nav')?.hasAttribute('inert')).toBe(false);
  });

  it('Escape closes, returns focus to the menu button and unlocks scroll', () => {
    renderShell();
    const menu = screen.getByRole('button', { name: 'فتح القائمة' });
    fireEvent.click(menu);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(menu);
    expect(document.documentElement.classList.contains('overflow-hidden')).toBe(false);
  });

  it('close button and scrim both close the drawer', () => {
    const { container } = renderShell();
    const menu = screen.getByRole('button', { name: 'فتح القائمة' });
    fireEvent.click(menu);
    fireEvent.click(screen.getByRole('button', { name: 'إغلاق القائمة' }));
    expect(menu.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(menu);
    fireEvent.click(container.querySelector('[aria-hidden="true"].fixed.inset-0') as Element);
    expect(menu.getAttribute('aria-expanded')).toBe('false');
  });

  it('choosing a link closes the drawer', () => {
    renderShell();
    const menu = screen.getByRole('button', { name: 'فتح القائمة' });
    fireEvent.click(menu);
    fireEvent.click(screen.getByRole('link', { name: /المؤسسات/ }));
    expect(menu.getAttribute('aria-expanded')).toBe('false');
  });

  it('logout calls the existing platformLogout then returns to the platform login', async () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: /خروج/ }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/platform/login'));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('shows static breadcrumbs: brand only on overview, brand / section elsewhere', () => {
    pathname = '/platform/prices';
    const { container } = renderShell();
    const crumbs = container.querySelectorAll('nav[aria-label="المسار"] li');
    expect(crumbs).toHaveLength(2);
    expect(crumbs[1]?.textContent).toContain('الأسعار');
  });

  it('keeps the new shell controls at 44px (h-11 / min-h-11)', () => {
    const { container } = renderShell();
    for (const name of ['فتح القائمة', 'إغلاق القائمة']) {
      expect(screen.getByRole('button', { name }).className).toContain('h-11');
    }
    expect(screen.getByRole('button', { name: /خروج/ }).className).toContain('h-11');
    container.querySelectorAll('#platform-nav a').forEach((a) => expect(a.className).toContain('min-h-11'));
  });
});
