// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { renderIntl } from '@/test-utils/intl';
import NotFound from './not-found';

const nav = vi.hoisted(() => ({ pathname: '/no-such-page' as string | null }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));

afterEach(() => {
  cleanup();
  nav.pathname = '/no-such-page';
});

describe('404 page (ERP-UX-023)', () => {
  it.each([
    ['en', 'Page not found', 'Back to the dashboard'],
    ['ar', 'الصفحة غير موجودة', 'العودة إلى لوحة التحكم'],
  ] as const)('has a main landmark, a localized h1 and a way back in %s', (locale, title, back) => {
    renderIntl(<NotFound />, locale);
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy();
    expect(screen.getByRole('link', { name: back }).getAttribute('href')).toBe('/dashboard');
  });

  it.each([
    ['en', 'Back to the platform console'],
    ['ar', 'العودة إلى لوحة المنصة'],
  ] as const)('sends unknown /platform URLs back to the platform console in %s', (locale, back) => {
    nav.pathname = '/platform/no-such-page';
    renderIntl(<NotFound />, locale);
    expect(screen.getByRole('link', { name: back }).getAttribute('href')).toBe('/platform');
  });

  it('does not treat a look-alike prefix as the platform', () => {
    nav.pathname = '/platforms';
    renderIntl(<NotFound />, 'en');
    expect(screen.getByRole('link', { name: 'Back to the dashboard' }).getAttribute('href')).toBe('/dashboard');
  });
});
