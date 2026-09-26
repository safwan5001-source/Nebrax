/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppBuilderVersionsPage from './page';

const { api, push, translate } = vi.hoisted(() => {
  const strings: Record<string, string> = {
    'versions.title': 'Published versions',
    'versions.loadFailed': 'Could not load versions.',
    'versions.empty': 'No version published yet.',
    'versions.versionLabel': 'Version {version}',
    'versions.publishedByLabel': 'Published by {name}',
    'versions.noNote': 'No note',
    'versions.restoreAction': 'Restore to draft',
    'versions.restoreConfirmTitle': 'Restore this version to the draft?',
    'versions.restoreConfirmBody': 'This replaces your current draft with version {version}.',
    'versions.restoring': 'Restoring…',
    'versions.restoreSuccessTitle': 'Draft restored',
    'versions.restoreErrorTitle': 'Could not restore this version',
    'detail.back': 'Back to apps',
    cancel: 'Cancel',
    loading: 'Loading…',
    retry: 'Try again',
  };
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
  return { api: vi.fn(), push: vi.fn(), translate: translator };
});

vi.mock('next-intl', () => ({ useTranslations: (ns: string) => translate(ns), useLocale: () => 'en' }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'app-1' }), useRouter: () => ({ push }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api };
});
const { toastFns } = vi.hoisted(() => ({ toastFns: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => toastFns }));
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
  id: 'app-1', name: 'متجري', name_en: 'My App', creation_source: 'scratch' as const,
  latest_published_version: null, created_at: '2026-09-20T00:00:00Z', updated_at: '2026-09-20T00:00:00Z',
};

const versionsData = [
  {
    id: 'v2', builder_app_id: 'app-1', version: 2, schema_version: '1.0.0', note: 'Second release',
    published_by: 'u1', published_by_name: 'Owner', published_at: '2026-09-22T00:00:00Z',
  },
  {
    id: 'v1', builder_app_id: 'app-1', version: 1, schema_version: '1.0.0', note: null,
    published_by: 'u1', published_by_name: 'Owner', published_at: '2026-09-20T00:00:00Z',
  },
];

const versionOneSchema = {
  schemaVersion: '1.0.0', minRuntimeVersion: '1.0.0',
  navigation: { initialPageId: 'home' },
  pages: { home: { type: 'Page', id: 'home-root', children: [] } },
};

function mockApi(options?: { publishedByName?: string | null }) {
  api.mockImplementation((path?: string, init?: { method?: string; body?: unknown }) => {
    if (!path) return Promise.resolve({ data: null });
    if (path.endsWith('/versions/1')) {
      return Promise.resolve({ data: { ...versionsData[1], schema: versionOneSchema } });
    }
    if (path.endsWith('/versions')) return Promise.resolve({ data: versionsData });
    if (path.endsWith('/draft') && init?.method === 'PUT') return Promise.resolve({ data: { id: 'draft-1', schema: versionOneSchema, revision: 1 } });
    if (path.includes('/app-builder/apps/')) return Promise.resolve({ data: appData });
    return Promise.reject(new Error(`unexpected path: ${path}`));
  });
}

describe('AppBuilderVersionsPage', () => {
  afterEach(cleanup);
  beforeEach(() => {
    api.mockReset();
    push.mockReset();
    toastFns.success.mockReset();
    toastFns.error.mockReset();
  });

  it('loads and renders every published version with its note and publisher', async () => {
    mockApi();
    render(<AppBuilderVersionsPage />);

    expect(await screen.findByText('Version 2')).toBeTruthy();
    expect(screen.getByText('Version 1')).toBeTruthy();
    expect(screen.getByText('Second release')).toBeTruthy();
    expect(screen.getByText('No note')).toBeTruthy();
    expect(screen.getAllByText('Published by Owner').length).toBe(2);
  });

  it('shows the empty state when no version has been published yet', async () => {
    api.mockImplementation((path?: string) => {
      if (path?.endsWith('/versions')) return Promise.resolve({ data: [] });
      if (path?.includes('/app-builder/apps/')) return Promise.resolve({ data: appData });
      return Promise.resolve({ data: null });
    });
    render(<AppBuilderVersionsPage />);

    expect(await screen.findByText('No version published yet.')).toBeTruthy();
  });

  it('restoring a version fetches its full schema, writes it to the draft, and redirects to the builder', async () => {
    mockApi();
    render(<AppBuilderVersionsPage />);
    await screen.findByText('Version 2');

    const [restoreV1] = screen.getAllByText('Restore to draft').slice(-1);
    await userEvent.setup().click(restoreV1);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Restore this version to the draft?')).toBeTruthy();

    const confirmButton = within(dialog).getAllByRole('button', { name: 'Restore to draft' })[0];
    await userEvent.setup().click(confirmButton);

    await waitFor(() => expect(push).toHaveBeenCalledWith('/app-builder/app-1/builder'));
    expect(toastFns.success).toHaveBeenCalledWith('Draft restored');

    const putCall = api.mock.calls.find((call) => call[0] === '/app-builder/apps/app-1/draft' && call[1]?.method === 'PUT');
    expect(putCall?.[1]?.body).toEqual({ schema: versionOneSchema });
  });

  it('shows an error state when the app fails to load', async () => {
    const { ApiError } = await import('@/lib/api');
    api.mockRejectedValue(new ApiError(404, 'Could not load versions.', null));

    render(<AppBuilderVersionsPage />);

    expect(await screen.findByText('Could not load versions.')).toBeTruthy();
  });
});
