/* @vitest-environment jsdom */
import * as React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import { applicationLabel, applicationMessageKey } from './application-label';
import { ApplicationOverrideCard } from './application-override-card';
import { GlobalApplicationControlsCard } from './global-application-controls-card';

// H15-06: the two application names that had no translation, the safe fallback for any unknown key, and proof that the
// technical keys, statuses and permissions are untouched. Real message files; the API client is mocked.
const { platformApi } = vi.hoisted(() => ({ platformApi: vi.fn() }));
let locale: 'en' | 'ar' = 'en';

const cache = new Map<string, ((key: string, values?: Record<string, string | number>) => string) & { has: (key: string) => boolean }>();
/** Like next-intl: stable per locale+namespace, with `has`, dotted namespaces and dotted keys. */
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
    if (typeof node !== 'string') return `${namespace}.${key}`; // what next-intl renders for a missing message
    return node.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? ''));
  }, { has: (key: string) => typeof resolve(key) === 'string' });
  cache.set(cacheKey, fn);
  return fn;
}
vi.mock('next-intl', () => ({ useTranslations: (namespace: string) => translator(namespace), useLocale: () => locale }));
vi.mock('@/lib/platform-api', () => ({ platformApi }));
vi.mock('@/lib/api', () => ({ ApiError: class ApiError extends Error { status = 0; } }));

const UNKNOWN = 'zz_new.capability_with_a_very_long_technical_name_that_has_no_translation_yet';
const globalApp = (key: string, over: Record<string, unknown> = {}) => ({
  key, group: 'sales', maturity: 'built', mandatory: false, access: 'commercial', protected_status: null,
  global_commercial: { granted: 1, inherit: 2, denied: 0 }, global_operational: { enabled: 1, disabled: 0, suspended: 0 },
  can_grant_all_tenants: true, can_revert_all_tenants: false, can_show_all_tenants: true, can_hide_all_tenants: true, ...over,
});
const overrideApp = (key: string, over: Record<string, unknown> = {}) => ({
  key, group: 'sales', maturity: 'built', mandatory: false, access: 'commercial', commercial_mode: 'inherit', override_grant_id: null,
  operational_status: 'enabled', effective_access: 'full', can_grant: true, can_revert: false, can_show: true, can_hide: true,
  skip_reasons: { grant: [], revert: [], show: [], hide: [] }, ...over,
});
const KEYS = ['document_center.core', 'commerce.app_builder', 'commerce.storefront', UNKNOWN];

beforeEach(() => {
  locale = 'en';
  platformApi.mockReset();
  platformApi.mockImplementation(async (p: string) => {
    if (p === '/platform/application-overrides/global/summary') return { data: { tenant_count: 45, applications: KEYS.map((k) => globalApp(k, k === 'commerce.app_builder' ? { can_grant_all_tenants: false } : {})) } };
    if (p.endsWith('/application-overrides/summary')) return { data: { applications: KEYS.map((k) => overrideApp(k, k === 'commerce.app_builder' ? { can_grant: false, commercial_mode: 'denied' } : {})) } };
    if (p === '/platform/application-overrides/global/preview') return { data: { request_id: 'r1', confirmation_token: 'c1', operation: 'grant_all_tenants', application_key: 'document_center.core', layer: 'commercial', scope: { mode: 'all', total_tenants: 45, tenant_ids: null }, counts: { eligible_tenants: 45, will_apply: 45, skipped: 0, failed: 0 }, skip_reasons: {}, sample_tenants: [], protections: { mandatory: false, dependencies: [], maturity: 'built', coming_soon_blocked: false, retired_blocked: false } } };
    if (p.endsWith('/preview')) return { data: { action: 'show', application_key: 'document_center.core', outcome: 'applied', skip_reasons: [] } };
    throw new Error(`unexpected ${p}`);
  });
});
afterEach(cleanup);

const approved = {
  en: { document_center_core: en.nav.documentCenter, commerce_app_builder: en.nav.appBuilder },
  ar: { document_center_core: ar.nav.documentCenter, commerce_app_builder: ar.nav.appBuilder },
} as const;

describe('approved names for the two applications (H15-06)', () => {
  it('document_center.core is "Document Center" / «مركز المستندات», the wording the navigation already uses', () => {
    expect(en.applications.keys.document_center_core).toBe('Document Center');
    expect(ar.applications.keys.document_center_core).toBe('مركز المستندات');
    expect(en.applications.keys.document_center_core).toBe(en.nav.documentCenter);
    expect(ar.applications.keys.document_center_core).toBe(ar.nav.documentCenter);
  });

  it('commerce.app_builder is "App Builder" / «صانع التطبيقات», the wording the navigation already uses', () => {
    expect(en.applications.keys.commerce_app_builder).toBe('App Builder');
    expect(ar.applications.keys.commerce_app_builder).toBe('صانع التطبيقات');
    expect(en.applications.keys.commerce_app_builder).toBe(en.nav.appBuilder);
    expect(ar.applications.keys.commerce_app_builder).toBe(ar.nav.appBuilder);
  });

  const catalogPath = path.resolve(__dirname, '../../../../app/Support/ApplicationCatalog.php');
  it.skipIf(!fs.existsSync(catalogPath))('every application in the backend catalogue has a name in both languages (so a new key cannot ship untranslated)', () => {
    const source = fs.readFileSync(catalogPath, 'utf8');
    const keys = [...source.matchAll(/^\s{8}'([a-z_]+\.[a-z_]+)' => \[\n\s+'group'/gm)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThanOrEqual(45);
    for (const lang of [en, ar]) {
      const messages = lang.applications.keys as Record<string, string>;
      const missing = keys.filter((key) => typeof messages[key.replaceAll('.', '_')] !== 'string' || messages[key.replaceAll('.', '_')].trim() === '');
      expect(missing).toEqual([]);
    }
  });
});

describe('the label helper (H15-06)', () => {
  it('maps the technical key to its message key without touching the technical key', () => {
    expect(applicationMessageKey('document_center.core')).toBe('keys.document_center_core');
    expect(applicationMessageKey('fuel_stations.core')).toBe('keys.fuel_stations_core');
  });

  it('returns the translated name when there is one and the technical key itself when there is not', () => {
    const t = translator('applications');
    expect(applicationLabel(t, 'document_center.core')).toBe('Document Center');
    expect(applicationLabel(t, UNKNOWN)).toBe(UNKNOWN);
    expect(applicationLabel(t, UNKNOWN)).not.toContain('applications.keys');
  });

  it('still works with a translator that has no `has` (older test doubles)', () => {
    expect(applicationLabel(((key: string) => `T(${key})`) as never, 'a.b')).toBe('T(keys.a_b)');
  });
});

describe('platform screens show the names, never raw message paths (H15-06)', () => {
  for (const lang of ['en', 'ar'] as const) {
    it(`global controls (${lang}): translated names, technical keys kept, unknown key falls back safely`, async () => {
      locale = lang;
      const { container } = render(<GlobalApplicationControlsCard />);
      await waitFor(() => expect(container.querySelectorAll('tbody tr').length).toBe(4));
      const text = container.textContent ?? '';
      expect(text).toContain(approved[lang].document_center_core);
      expect(text).toContain(approved[lang].commerce_app_builder);
      expect(text).not.toContain('applications.keys');
      // the technical keys stay visible, left-to-right, and may wrap
      const keyLines = [...container.querySelectorAll('tbody td div.font-mono')];
      expect(keyLines.map((n) => n.textContent)).toEqual(KEYS);
      for (const n of keyLines) {
        expect(n.getAttribute('dir')).toBe('ltr');
        expect(n.className).toContain('break-words');
      }
      // names wrap too (the H15-09 behaviour is kept), and the fallback is the technical key, not a message path
      const names = [...container.querySelectorAll('tbody td div.font-medium')];
      expect(names.map((n) => n.textContent)).toEqual([approved[lang].document_center_core, approved[lang].commerce_app_builder, translator('applications')('keys.commerce_storefront'), UNKNOWN]);
      for (const n of names) expect(n.className).toContain('break-words');
    });

    it(`tenant overrides (${lang}): translated names and the same fallback`, async () => {
      locale = lang;
      const { container } = render(<ApplicationOverrideCard tenantId="t1" />);
      await waitFor(() => expect(container.querySelectorAll('tbody tr').length).toBe(4));
      const text = container.textContent ?? '';
      expect(text).toContain(approved[lang].document_center_core);
      expect(text).toContain(approved[lang].commerce_app_builder);
      expect(text).not.toContain('applications.keys');
      const names = [...container.querySelectorAll('tbody td div.font-medium')].map((n) => n.textContent);
      expect(names).toEqual([approved[lang].document_center_core, approved[lang].commerce_app_builder, translator('applications')('keys.commerce_storefront'), UNKNOWN]);
    });
  }

  it('search finds the applications by their translated names and by their technical keys', async () => {
    locale = 'ar';
    const { container } = render(<GlobalApplicationControlsCard />);
    await waitFor(() => expect(container.querySelectorAll('tbody tr').length).toBe(4));
    const search = screen.getByPlaceholderText(ar.platform.globalApplicationControls.search);
    fireEvent.change(search, { target: { value: 'مركز المستندات' } });
    expect(container.querySelectorAll('tbody tr').length).toBe(1);
    fireEvent.change(search, { target: { value: 'commerce.app_builder' } });
    expect(container.querySelectorAll('tbody tr').length).toBe(1);
  });
});

describe('what is sent and what is allowed is unchanged (H15-06)', () => {
  it('the global preview request carries the technical key, not the display name', async () => {
    const { container } = render(<GlobalApplicationControlsCard />);
    await waitFor(() => expect(container.querySelectorAll('tbody tr').length).toBe(4));
    const row = [...container.querySelectorAll('tbody tr')].find((tr) => tr.textContent?.includes('document_center.core'))!;
    const grant = row.querySelector('button[title]')!;
    expect((grant as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(grant);
    await waitFor(() => expect(platformApi.mock.calls.some(([p]) => p === '/platform/application-overrides/global/preview')).toBe(true));
    const call = platformApi.mock.calls.find(([p]) => p === '/platform/application-overrides/global/preview')!;
    expect(call[1].body.application_key).toBe('document_center.core');
    expect(JSON.stringify(call[1].body)).not.toContain('Document Center');
  });

  it('permissions and status follow the API flags exactly: the app that cannot be granted stays disabled', async () => {
    const { container } = render(<GlobalApplicationControlsCard />);
    await waitFor(() => expect(container.querySelectorAll('tbody tr').length).toBe(4));
    const rows = [...container.querySelectorAll('tbody tr')];
    const grantOf = (key: string) => (rows.find((tr) => tr.textContent?.includes(key))!.querySelector('button[title]') as HTMLButtonElement).disabled;
    expect(grantOf('document_center.core')).toBe(false);
    expect(grantOf('commerce.app_builder')).toBe(true);
    expect(grantOf('commerce.storefront')).toBe(false);
  });

  it('the tenant override request carries the technical key and the disabled flags are respected', async () => {
    const { container } = render(<ApplicationOverrideCard tenantId="t1" />);
    await waitFor(() => expect(container.querySelectorAll('tbody tr').length).toBe(4));
    const rows = [...container.querySelectorAll('tbody tr')];
    const builder = rows.find((tr) => tr.textContent?.includes('commerce.app_builder'))!;
    const buttons = [...builder.querySelectorAll('button')] as HTMLButtonElement[];
    expect(buttons.some((b) => b.title === en.platform.applicationOverrides.grant && b.disabled)).toBe(true);
    const doc = rows.find((tr) => tr.textContent?.includes('document_center.core'))!;
    const show = [...doc.querySelectorAll('button')].find((b) => (b as HTMLButtonElement).title === en.platform.applicationOverrides.show) as HTMLButtonElement;
    fireEvent.click(show);
    await waitFor(() => expect(platformApi.mock.calls.some(([p]) => String(p).endsWith('/preview'))).toBe(true));
    const call = platformApi.mock.calls.find(([p]) => String(p).endsWith('/preview'))!;
    expect(call[1].body).toEqual({ action: 'show', application_key: 'document_center.core' });
  });
});

describe('H15-09 layout rules are kept (H15-06)', () => {
  const root = path.resolve(__dirname, '../..');
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

  it('every application name on a platform screen goes through the shared helper', () => {
    for (const rel of ['components/platform/global-application-controls-card.tsx', 'components/platform/application-override-card.tsx']) {
      const source = read(rel);
      expect(source).not.toContain('catalogKeyLabel');
      expect(source).not.toMatch(/tApps\(`keys\./);
      expect(source).toContain('applicationLabel(tApps');
    }
  });

  it('names and keys keep their wrapping classes, the mobile card header can shrink, and the badges still wrap', () => {
    const global = read('components/platform/global-application-controls-card.tsx');
    expect(global).toMatch(/<div className="min-w-0">\s*<div className="break-words font-medium text-text">/);
    expect(global).toContain('font-mono text-xs text-muted break-words');
    expect(global).not.toMatch(/<Badge (?!wrap)/);
    const override = read('components/platform/application-override-card.tsx');
    expect(override).toContain('max-w-[min(20rem,70vw)] break-words font-medium text-text');
    expect(override).toContain('max-w-[min(20rem,70vw)] text-xs text-muted break-words');
    expect(override).toContain('<td className="break-words px-3 py-2">');
  });
});
