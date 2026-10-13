/* @vitest-environment jsdom */
import * as React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { CommercialOperationsCard } from './commercial-operations-card';
import { PlatformShell, PLATFORM_NAV } from './platform-shell';

// H15-09: text enlarged to 200% (the real browser run is described in the report; jsdom has no layout, so these
// tests pin the class contracts that produce it and the behaviour that must not change).
const { platformApi } = vi.hoisted(() => ({ platformApi: vi.fn() }));
const replace = vi.fn();
vi.mock('@/lib/platform-api', () => ({ platformApi }));
vi.mock('@/lib/api', () => ({ ApiError: class ApiError extends Error {} }));
vi.mock('next/navigation', () => ({ usePathname: () => '/platform', useRouter: () => ({ replace, refresh: vi.fn() }) }));
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }));
vi.mock('@/lib/platform-auth', () => ({
  isPlatformAuthenticated: () => true,
  currentPlatformAdministrator: () => ({ id: '1', name: 'Platform Administrator', email: 'a@b.c' }),
  platformLogout: vi.fn(async () => {}),
}));

const cache = new Map<string, (key: string, values?: Record<string, string | number>) => string>();
function translator(namespace: string) {
  const hit = cache.get(namespace);
  if (hit) return hit;
  const fn = (key: string, values?: Record<string, string | number>) => {
    let node: unknown = en;
    for (const part of `${namespace}.${key}`.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
    if (typeof node !== 'string') return key;
    return node.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? ''));
  };
  cache.set(namespace, fn);
  return fn;
}
vi.mock('next-intl', () => ({ useTranslations: (namespace: string) => translator(namespace), useLocale: () => 'en' }));

beforeEach(() => {
  platformApi.mockReset();
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  document.documentElement.className = '';
});

const classes = (node: Element) => node.className.split(/\s+/).filter(Boolean);
const renderShell = () => render(<PlatformShell><main>content</main></PlatformShell>);

describe('platform header at enlarged text (H15-09)', () => {
  it('keeps the right-hand controls in one wrapper that can wrap, in the same order, inside the header', () => {
    const { container } = renderShell();
    const header = container.querySelector('header')!;
    const signOut = screen.getByRole('button', { name: en.platform.logout });
    const cluster = signOut.parentElement!;
    expect(cluster.parentElement).toBe(header);
    const c = classes(cluster);
    expect(c).toEqual(expect.arrayContaining(['flex', 'flex-wrap', 'items-center', 'justify-end']));
    // min-w-0 would let the wrapper shrink below its widest control and let Sign out spill out of it
    expect(c).not.toContain('min-w-0');
    // order: language, theme, administrator name, Sign out
    const kinds = [...cluster.children].map((child) => (child.tagName === 'BUTTON' ? 'button:' + (child.textContent || '').trim() : child.tagName === 'SPAN' ? 'name' : 'group'));
    expect(kinds).toEqual(['group', 'name', 'button:' + en.platform.logout]);
    expect(cluster.children[0].querySelectorAll('button')).toHaveLength(2);
    // the header keeps its sticky one-row look
    expect(classes(header)).toEqual(expect.arrayContaining(['sticky', 'top-0', 'z-20', 'flex', 'min-h-14', 'items-center', 'border-b']));
  });

  it('Sign out keeps its full label and look: no truncation, no hiding, 44px target, focus ring', () => {
    renderShell();
    const signOut = screen.getByRole('button', { name: en.platform.logout });
    const c = classes(signOut);
    expect(signOut.textContent).toContain(en.platform.logout);
    expect(c).toEqual(expect.arrayContaining(['h-11', 'px-3', 'shrink-0', 'focus-visible:ring-2', 'focus-visible:ring-primary']));
    for (const forbidden of ['truncate', 'overflow-hidden', 'text-ellipsis', 'sr-only', 'hidden']) expect(c).not.toContain(forbidden);
    expect(signOut.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('the language and theme group stays together and cannot be squeezed under 44px', () => {
    renderShell();
    const group = screen.getByRole('button', { name: en.platform.logout }).parentElement!.firstElementChild!;
    expect(classes(group)).toEqual(expect.arrayContaining(['flex', 'shrink-0', 'items-center']));
    for (const button of group.querySelectorAll('button')) expect(classes(button)).toContain('h-11');
  });

  it('keyboard: Tab reaches the header controls in order and Sign out is operable; navigation is unchanged', async () => {
    const user = userEvent.setup();
    const { container } = renderShell();
    const header = container.querySelector('header')!;
    const signOut = screen.getByRole('button', { name: en.platform.logout });
    const order: Element[] = [];
    document.body.focus();
    for (let i = 0; i < 12; i += 1) {
      await user.tab();
      if (header.contains(document.activeElement)) order.push(document.activeElement!);
      if (document.activeElement === signOut) break;
    }
    expect(document.activeElement).toBe(signOut);
    const names = order.map((node) => node.getAttribute('aria-label') ?? (node.textContent || '').trim());
    expect(names.at(-1)).toBe(en.platform.logout);
    expect(names.length).toBeGreaterThanOrEqual(3); // menu button, language, theme, then Sign out
    // the destinations and their order are the same five as before
    const links = screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.startsWith('/platform'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual(PLATFORM_NAV.map((item) => item.href));
    expect(links).toHaveLength(5);
  });
});

describe('commercial products at enlarged text (H15-09)', () => {
  const applications = {
    applications: [{
      key: 'fuel_stations.core', group: 'operations', maturity: 'built', mandatory: false, dependencies: [], enabled: false, status: 'suspended', changed_at: null, reason: 'x',
      commercial: { availability: 'addon', source_count: 1, source_types: ['addon'], trial_until: null, cancels_at: null, expired: false },
      effective_access: 'full', dependency_status: 'not_applicable',
    }],
    commercial_summary: { current_plan: null, included_products: [], active_addons: [], trials: [], legacy_entitlements: [], ended_assignments: [] },
  };
  const catalog = { products: [{ id: 'p', code: 'fuel-stations', name: 'Fuel Stations', versions: [{ id: 'v', version: 1, published_at: '2026-08-01T00:00:00Z', retired_at: null, capabilities: ['fuel_stations.core'] }] }], plans: [] };
  beforeEach(() => {
    platformApi.mockImplementation(async (p: string) => {
      if (p.endsWith('/commercial-applications')) return { data: applications };
      if (p === '/platform/commercial-catalog') return { data: catalog };
      if (p.endsWith('/commercial-assignments')) return { data: [] };
      throw new Error(`unexpected ${p}`);
    });
  });

  it('the wide table keeps its original badges; the narrow cards use badges that can wrap', async () => {
    const { container } = render(<CommercialOperationsCard tenantId="t1" />);
    await screen.findAllByText('Fuel Stations');
    await waitFor(() => expect(container.querySelector('article')).not.toBeNull());
    const tableBadges = [...container.querySelectorAll('table td span.inline-flex')];
    const cardBadges = [...container.querySelectorAll('article span.inline-flex')];
    expect(tableBadges.length).toBeGreaterThan(0);
    expect(cardBadges.length).toBeGreaterThan(0);
    for (const badge of tableBadges) expect(classes(badge)).toContain('whitespace-nowrap');
    for (const badge of cardBadges) {
      expect(classes(badge)).toEqual(expect.arrayContaining(['whitespace-normal', 'max-w-full', 'shrink-0']));
      expect(classes(badge)).not.toContain('whitespace-nowrap');
    }
  });

  it('the product card header lets its text shrink and break instead of pushing the badge out', async () => {
    const { container } = render(<CommercialOperationsCard tenantId="t1" />);
    await screen.findAllByText('Fuel Stations');
    await waitFor(() => expect(container.querySelector('article')).not.toBeNull());
    const header = container.querySelector('article > div')!;
    expect(classes(header)).toEqual(expect.arrayContaining(['flex', 'items-start', 'justify-between', 'gap-3']));
    expect(classes(header)).not.toContain('flex-wrap'); // no row reflow at 100%
    expect(classes(header.firstElementChild!)).toEqual(expect.arrayContaining(['min-w-0', 'break-words']));
  });

  it('retry and assign buttons can wrap their labels and keep their size', async () => {
    platformApi.mockImplementation(async () => { throw new Error('x'); });
    render(<CommercialOperationsCard tenantId="t1" />);
    const retry = await screen.findByRole('button', { name: new RegExp(en.platformTenants.retry) });
    expect(classes(retry)).toEqual(expect.arrayContaining(['h-auto', 'min-h-8', 'whitespace-normal', 'max-w-full', 'shrink-0']));
    expect(classes(retry)).not.toContain('h-8');
  });
});

describe('platform sources keep the contract (H15-09)', () => {
  const root = path.resolve(__dirname, '../..');
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [full] : [];
  });
  const files = [...walk(path.join(root, 'components/platform')), ...walk(path.join(root, 'app/platform'))];
  const read = (file: string) => fs.readFileSync(file, 'utf8');

  it('every Badge on a platform screen opts in to wrapping', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const match of read(file).matchAll(/<Badge\b[^>]*>/g)) if (!/\bwrap\b/.test(match[0])) offenders.push(`${path.relative(root, file)}: ${match[0].slice(0, 60)}`);
    }
    expect(files.length).toBeGreaterThan(10);
    expect(offenders).toEqual([]);
  });

  it('no platform screen hard-codes a non-wrapping label other than the price amount', () => {
    const withNowrap = files.filter((file) => read(file).includes('whitespace-nowrap')).map((file) => path.relative(root, file).replaceAll(path.sep, '/'));
    expect(withNowrap).toEqual(['app/platform/(console)/prices/page.tsx']);
  });

  it('the AI provider cards reflow by text size, and application names and keys can break', () => {
    expect(read(path.join(root, 'app/platform/(console)/integrations/page.tsx'))).toContain('xl:grid-cols-[repeat(auto-fit,minmax(min(100%,19rem),1fr))]');
    for (const name of ['global-application-controls-card.tsx', 'application-override-card.tsx']) {
      const source = read(path.join(root, 'components/platform', name));
      expect(source).toMatch(/break-words font-medium text-text">\{tApps/);
      expect(source).toMatch(/font-mono text-xs text-muted break-words|text-xs text-muted break-words/);
    }
  });
});
