/* @vitest-environment jsdom */
import * as React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import { CardTitle } from '@/components/ui/card';
import PlatformIntegrationsPage from '@/app/platform/(console)/integrations/page';
import PlatformTenantsPage from '@/app/platform/(console)/tenants/page';
import PlatformTenantDetailPage from '@/app/platform/(console)/tenants/[id]/page';

// H15-11: the heading outline of the three /platform pages that axe flagged with `heading-order`.
// Real pages, real cards and the real message files; only the network client and the router are mocked.
const { platformApi } = vi.hoisted(() => ({ platformApi: vi.fn() }));
let locale: 'en' | 'ar' = 'en';

const cache = new Map<string, ((key: string, values?: Record<string, string | number>) => string) & { has: (k: string) => boolean; rich: (k: string) => string }>();
/** Stable per (locale, namespace) like next-intl's; resolves dotted namespaces and dotted keys. */
function translator(namespace: string) {
  const cacheKey = `${locale}:${namespace}`;
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const resolve = (key: string): unknown => {
    let node: unknown = locale === 'ar' ? ar : en;
    for (const part of `${namespace}.${key}`.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
    return node;
  };
  const fn = Object.assign((key: string, values?: Record<string, string | number>) => {
    const node = resolve(key);
    if (typeof node !== 'string') return key;
    return node.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? ''));
  }, { has: (key: string) => typeof resolve(key) === 'string', rich: (key: string) => String(resolve(key) ?? key) });
  cache.set(cacheKey, fn);
  return fn;
}
vi.mock('next-intl', () => ({ useTranslations: (namespace: string) => translator(namespace), useLocale: () => locale }));
const router = { replace: vi.fn(), push: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router, useParams: () => ({ id: 'tenant-1' }), usePathname: () => '/platform' }));
vi.mock('@/lib/platform-auth', () => ({ isPlatformAuthenticated: () => true }));
vi.mock('@/lib/platform-api', () => ({ platformApi }));
vi.mock('@/lib/api', () => ({ ApiError: class ApiError extends Error {} }));

const appRow = (key: string) => ({
  key, group: 'operations', maturity: 'built', mandatory: false, access: 'commercial', commercial_mode: 'inherit', override_grant_id: null,
  operational_status: 'enabled', effective_access: 'full', can_grant: true, can_revert: false, can_show: true, can_hide: true,
  skip_reasons: { grant: [], revert: [], show: [], hide: [] },
});
const globalRow = (key: string) => ({
  key, group: 'operations', maturity: 'built', mandatory: false, access: 'commercial', protected_status: null,
  global_commercial: { granted: 1, inherit: 2, denied: 0 }, global_operational: { enabled: 1, disabled: 0, suspended: 0 },
  can_grant_all_tenants: true, can_revert_all_tenants: false, can_show_all_tenants: true, can_hide_all_tenants: true,
});
const tenant = {
  id: 'tenant-1', name: 'Reference Co', slug: 'reference-co', account_number: 1000000, support_number: 1000,
  plan: 'pro', is_active: true, trial_ends_at: '2026-12-31', subscription_ends_at: '2027-06-30', created_at: '2026-08-23',
  users_count: 9, active_users_count: 7, contact: { name: 'Owner', email: 'owner@reference.test', phone: '+966500000000' }, subscriptions: [],
};
const provider = { enabled: false, model: '', allow_document_sending: false, connection_timeout_seconds: 15, processing_timeout_seconds: 90, max_attempts: 2, last_test_status: 'not_tested', last_tested_at: null };
const integrations = {
  integrations: [
    { key: 'document_storage', provider: 'r2', enabled: true, configured: true, configured_at: null, configuration: { endpoint: 'https://a.example', bucket: 'docs', region: 'auto', access_key_id_masked: '••••A', secret_access_key_masked: '••••B' } },
    { key: 'malware_scanner', provider: 'clamav_tcp', enabled: false, configured: true, configured_at: null, configuration: { host: 'scan.internal', port: 3310, timeout_seconds: 10 } },
    { key: 'document_processing', provider: 'redis', enabled: false, configured: false, configured_at: null, configuration: {} },
    { key: 'document_ai', provider: null, enabled: false, configured: true, configured_at: null, configuration: { providers: { openai: provider, anthropic: provider, google_gemini: provider } } },
  ],
  runtime: { processing_mode: 'async', queue_connection: 'redis', queue_configured: true, worker_required: true, worker_status: 'online', worker_last_seen_at: null },
};

beforeEach(() => {
  locale = 'en';
  platformApi.mockReset();
  platformApi.mockImplementation(async (p: string) => {
    if (p.startsWith('/platform/tenants?')) return { data: [{ id: 'tenant-1', name: 'Reference Co', slug: 'r', account_number: 1000000, support_number: 1000, plan: 'pro', is_active: true, trial_ends_at: null, users_count: 3, contact: null }], pagination: { current_page: 1, last_page: 1, per_page: 25, total: 1 } };
    if (p === '/platform/tenants/tenant-1') return { data: tenant };
    if (p === '/platform/application-overrides/global/summary') return { data: { tenant_count: 1, applications: [globalRow('fuel_stations.core')] } };
    if (p.endsWith('/application-overrides/summary')) return { data: { applications: [appRow('fuel_stations.core')] } };
    if (p.endsWith('/commercial-applications')) return { data: { applications: [{ key: 'fuel_stations.core', group: 'operations', maturity: 'built', mandatory: false, dependencies: [], enabled: true, status: 'enabled', changed_at: null, reason: null, commercial: { availability: 'addon', source_count: 1, source_types: ['addon'], trial_until: null, cancels_at: null, expired: false }, effective_access: 'full', dependency_status: 'not_applicable' }], commercial_summary: { current_plan: null, included_products: [], active_addons: [], trials: [], legacy_entitlements: [], ended_assignments: [] } } };
    if (p === '/platform/commercial-catalog') return { data: { products: [{ id: 'fp', code: 'fuel-stations', name: 'Fuel Stations', versions: [{ id: 'fv', version: 1, published_at: '2026-08-01T00:00:00Z', retired_at: null, capabilities: ['fuel_stations.core'] }] }], plans: [] } };
    if (p.endsWith('/commercial-assignments')) return { data: [] };
    if (p === '/platform/integrations') return { data: integrations };
    if (p === '/platform/document-file-scan-exceptions') return { data: [] };
    return { data: [] };
  });
});
afterEach(cleanup);

type Heading = { level: number; text: string };
const outline = (root: ParentNode = document): Heading[] =>
  [...root.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => ({ level: Number(h.tagName[1]), text: (h.textContent ?? '').replace(/\s+/g, ' ').trim() }));
/** What axe's `heading-order` checks: the first heading may be any level here (we require h1), every later one may go at most one level deeper. */
const skips = (list: Heading[]) => list.filter((h, i) => i > 0 && h.level > list[i - 1].level + 1).map((h) => `${h.text} (h${h.level} after h${list[list.indexOf(h) - 1].level})`);
const labels = (ns: string, ...keys: string[]) => keys.map((k) => {
  let node: unknown = locale === 'ar' ? ar : en;
  for (const part of `${ns}.${k}`.split('.')) node = (node as Record<string, unknown>)[part];
  return String(node);
});

async function renderTenants() {
  render(<PlatformTenantsPage />);
  await screen.findAllByText('Reference Co');
  await waitFor(() => expect(outline().some((h) => h.text === labels('platformTenants', 'listTitle')[0])).toBe(true));
}
async function renderDetail() {
  render(<PlatformTenantDetailPage />);
  await screen.findByRole('heading', { level: 1, name: 'Reference Co' });
  await screen.findByRole('heading', { name: labels('platform.applicationOverrides', 'title')[0] });
  await screen.findByRole('heading', { name: labels('platformTenants', 'subscriptionApplications')[0] });
}
async function renderIntegrations() {
  render(<PlatformIntegrationsPage />);
  await screen.findByRole('heading', { name: labels('platformIntegrations', 'storageTitle')[0] });
}

for (const lang of ['en', 'ar'] as const) {
  describe(`heading outline on /platform pages (${lang}) — H15-11`, () => {
    beforeEach(() => { locale = lang; });

    it('tenants: one h1, the global controls and the tenant list are both h2, no skipped level', async () => {
      await renderTenants();
      const list = outline();
      expect(list.filter((h) => h.level === 1)).toHaveLength(1);
      expect(list[0].level).toBe(1);
      const global = list.find((h) => h.text.includes(labels('platform.globalApplicationControls', 'title')[0]));
      const tenants = list.find((h) => h.text === labels('platformTenants', 'listTitle')[0]);
      expect(global?.level).toBe(2);
      expect(tenants?.level).toBe(2);
      expect(skips(list)).toEqual([]);
    });

    it('tenant detail: one h1, every card title is h2, commercial sub-sections are h3 and product rows h4, no skipped level', async () => {
      await renderDetail();
      const list = outline();
      expect(list.filter((h) => h.level === 1)).toHaveLength(1);
      expect(skips(list)).toEqual([]);
      const level = (key: string) => list.find((h) => h.text.startsWith(labels('platformTenants', key)[0]))?.level;
      for (const key of ['detailTitle', 'changePlan', 'trialManagement', 'contractManagement', 'subscriptionHistory', 'subscriptionApplications']) {
        expect(level(key), key).toBe(2);
      }
      expect(list.find((h) => h.text.startsWith(labels('platform.applicationOverrides', 'title')[0]))?.level).toBe(2);
      expect(level('applicationProducts')).toBe(3);
      expect(level('commercialHistory')).toBe(3);
      expect(list.some((h) => h.level === 4)).toBe(true);
    });

    it('integrations: one h1, the runtime status card is h2 beside the other sections, no skipped level', async () => {
      await renderIntegrations();
      const list = outline();
      expect(list.filter((h) => h.level === 1)).toHaveLength(1);
      expect(list.find((h) => h.text === labels('platformIntegrations', 'runtimeTitle')[0])?.level).toBe(2);
      expect(list.find((h) => h.text === labels('platformIntegrations', 'coreTitle')[0])?.level).toBe(2);
      expect(skips(list)).toEqual([]);
    });

    it('every section is still present, in the same order, with the same text', async () => {
      await renderDetail();
      const texts = outline().map((h) => h.text);
      const expectedOrder = ['detailTitle', 'changePlan', 'trialManagement', 'contractManagement', 'subscriptionHistory', 'subscriptionApplications']
        .map((k) => texts.findIndex((x) => x.startsWith(labels('platformTenants', k)[0])));
      expect(expectedOrder.every((i) => i >= 0)).toBe(true);
      expect([...expectedOrder].sort((a, b) => a - b)).toEqual(expectedOrder);
    });
  });
}

describe('CardTitle heading level is opt-in and visually neutral (H15-11)', () => {
  it('stays an h3 for every existing consumer', () => {
    render(<CardTitle>Legacy</CardTitle>);
    expect(screen.getByRole('heading', { level: 3, name: 'Legacy' })).toBeTruthy();
  });

  it('renders the requested level with exactly the same classes, id and marker attribute', () => {
    const { rerender } = render(<CardTitle id="t" className="flex">Same</CardTitle>);
    const before = screen.getByRole('heading');
    const classes = before.className;
    rerender(<CardTitle as="h2" id="t" className="flex">Same</CardTitle>);
    const after = screen.getByRole('heading', { level: 2 });
    expect(after.className).toBe(classes);
    expect(after.id).toBe('t');
    expect(after.hasAttribute('data-awj-card-title')).toBe(true);
  });
});

describe('keyboard navigation is not affected by the heading change (H15-11)', () => {
  it('headings are not tab stops and the tab order of the tenants page is unchanged by their level', async () => {
    await renderTenants();
    const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')];
    expect(headings.every((h) => !h.hasAttribute('tabindex'))).toBe(true);
    const user = userEvent.setup();
    const visited: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      await user.tab();
      const active = document.activeElement as HTMLElement;
      expect(/^H[1-6]$/.test(active.tagName)).toBe(false);
      visited.push(active.tagName.toLowerCase());
    }
    const focusable = [...document.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex="0"]')];
    // the first stops follow DOM order of real controls
    expect(visited[0]).toBe(focusable[0].tagName.toLowerCase());
  });
});

describe('source guard: page-level CardTitles declare their level (H15-11)', () => {
  const root = path.resolve(__dirname, '../..');
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
  const titles = (src: string) => [...src.matchAll(/<CardTitle\b[^>]*>/g)].map((m) => m[0]);

  it('tenant detail page and its cards use h2 on every CardTitle', () => {
    for (const rel of [
      'app/platform/(console)/tenants/[id]/page.tsx',
      'components/platform/contract-management-card.tsx',
      'components/platform/commercial-operations-card.tsx',
      'components/platform/application-override-card.tsx',
    ]) {
      const found = titles(read(rel));
      expect(found.length, rel).toBeGreaterThan(0);
      for (const tag of found) expect(tag, `${rel}: ${tag}`).toContain('as="h2"');
    }
  });

  it('the tenants global-controls card and the integrations runtime card use h2', () => {
    for (const tag of titles(read('components/platform/global-application-controls-card.tsx'))) expect(tag).toContain('as="h2"');
    expect(read('app/platform/(console)/integrations/page.tsx')).toMatch(/<CardTitle as="h2">\{t\('runtimeTitle'\)\}/);
  });

  it('no heading is hidden or replaced by a non-semantic element to satisfy axe', () => {
    const detail = read('app/platform/(console)/tenants/[id]/page.tsx');
    expect(detail).not.toMatch(/role="presentation"|aria-hidden="true"[^>]*data-awj-card-title/);
    expect(read('components/ui/card.tsx')).toMatch(/Tag = 'h3'/);
  });
});
