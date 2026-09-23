/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppBuilderDetailPage from './page';

const { api, translate } = vi.hoisted(() => {
  const strings: Record<string, string> = {
    'detail.back': 'Back to apps',
    'detail.loadFailed': 'Could not load app.',
    'detail.overviewTitle': 'Overview',
    'detail.createdLabel': 'Created',
    'detail.sourceLabel': 'Starting point',
    'detail.versionsTitle': 'Published versions',
    'detail.versionsEmpty': 'No version published yet.',
    'detail.versionRow': 'Version {version} — {date}',
    'detail.builderComingSoonTitle': 'Visual editing workspace',
    'detail.builderComingSoon': 'The visual experience builder screen is coming in a later task.',
    'creationSource.store_design': 'From store design',
    'creationSource.template': 'From template',
    'creationSource.scratch': 'From scratch',
    loading: 'Loading…',
    retry: 'Try again',
  };
  // مثيلٌ واحد مستقرّ لكل نطاق — لا دالّة جديدة عند كل استدعاء، وإلا كسر
  // استقرار مرجع `t` الذي يعتمد عليه `useCallback`/`useEffect` في الصفحة
  // الحقيقية (نفس نمط `next-intl` الفعلي)، فيسبّب حلقة إعادة رسم لا نهائية
  // في الاختبار وحده (الصفحة الحقيقية سليمة — `next-intl` الحقيقي مستقرّ).
  const cache = new Map<string, ReturnType<typeof buildTranslator>>();
  function buildTranslator(namespace: string) {
    return Object.assign(
      (key: string, values?: Record<string, unknown>) => {
        const full = namespace ? `${namespace}.${key}`.replace(/^appBuilder\./, '') : key;
        const text = strings[full] ?? strings[key] ?? key;
        return text.replace(/\{(\w+)\}/g, (_, name) => String(values?.[name] ?? ''));
      },
      { raw: () => ({}) }
    );
  }
  const translator = (namespace: string) => {
    if (!cache.has(namespace)) cache.set(namespace, buildTranslator(namespace));
    return cache.get(namespace)!;
  };
  return { api: vi.fn(), translate: translator };
});

vi.mock('next-intl', () => ({ useTranslations: (ns: string) => translate(ns), useLocale: () => 'en' }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'app-1' }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api };
});
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

const appData = {
  id: 'app-1',
  name: 'متجري',
  name_en: 'My App',
  creation_source: 'scratch' as const,
  latest_published_version: null,
  created_at: '2026-09-20T00:00:00Z',
  updated_at: '2026-09-20T00:00:00Z',
};

describe('AppBuilderDetailPage', () => {
  afterEach(cleanup);

  beforeEach(() => {
    api.mockReset();
  });

  it('loads and renders the app name, creation source, and empty versions state', async () => {
    api.mockImplementation((path: string) => {
      if (path.endsWith('/versions')) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: appData });
    });

    render(<AppBuilderDetailPage />);

    expect(await screen.findByText('My App')).toBeTruthy();
    expect(screen.getByText('From scratch')).toBeTruthy();
    // DetailPage renders section content twice (mobile accordion + desktop grid, toggled by CSS
    // classes jsdom doesn't apply) — assert presence via getAllByText, not a single-match query.
    expect(screen.getAllByText('No version published yet.').length).toBeGreaterThan(0);
    expect(screen.getAllByText('The visual experience builder screen is coming in a later task.').length).toBeGreaterThan(0);
  });

  it('renders published versions when present', async () => {
    api.mockImplementation((path: string) => {
      if (path.endsWith('/versions')) {
        return Promise.resolve({
          data: [{ id: 'v1', builder_app_id: 'app-1', version: 1, schema_version: '1.0.0', note: null, published_at: '2026-09-21T00:00:00Z' }],
        });
      }
      return Promise.resolve({ data: appData });
    });

    render(<AppBuilderDetailPage />);

    expect((await screen.findAllByText(/Version 1/)).length).toBeGreaterThan(0);
  });

  it('shows an error state when the app fails to load', async () => {
    const { ApiError } = await import('@/lib/api');
    api.mockRejectedValue(new ApiError(404, 'Could not load app.', null));

    render(<AppBuilderDetailPage />);

    expect(await screen.findByText('Could not load app.')).toBeTruthy();
  });
});
