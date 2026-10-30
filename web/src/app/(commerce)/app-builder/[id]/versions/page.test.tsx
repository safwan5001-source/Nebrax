/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import AppBuilderVersionsPage from './page';

const { api, push, translate, currentUser } = vi.hoisted(() => {
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
    'versions.restoreConflictTitle': 'The draft changed during the restore',
    'versions.restoreConflictBody': 'Nothing was written. Try again.',
    'versions.restoreLocalBackupWarning': 'You have unsaved local changes that the restore will discard.',
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
  return { api: vi.fn(), push: vi.fn(), translate: translator, currentUser: vi.fn() };
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
vi.mock('@/lib/auth', () => ({ currentUser }));
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

let ApiErrorCtor: typeof import('@/lib/api').ApiError;
function mockApi(options?: { publishedByName?: string | null; putConflict?: boolean }) {
  api.mockImplementation((path?: string, init?: { method?: string; body?: unknown }) => {
    if (!path) return Promise.resolve({ data: null });
    if (path.endsWith('/versions/1')) {
      return Promise.resolve({ data: { ...versionsData[1], schema: versionOneSchema } });
    }
    if (path.endsWith('/versions')) return Promise.resolve({ data: versionsData });
    if (path.endsWith('/draft') && init?.method === 'PUT') {
      if (options?.putConflict) return Promise.reject(new ApiErrorCtor(409, 'conflict', { reason: 'draft_conflict', current_revision: 8, base_revision: 7, updated_by: 'u2', updated_at: '2026-09-23T00:00:00Z' }));
      return Promise.resolve({ data: { id: 'draft-1', schema: versionOneSchema, revision: 8 } });
    }
    if (path.endsWith('/draft')) return Promise.resolve({ data: { id: 'draft-1', builder_app_id: 'app-1', schema: versionOneSchema, revision: 7, updated_at: null } });
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
    currentUser.mockReturnValue({ id: 'u1', role: 'owner' });
    window.localStorage.clear();
  });
  beforeAll(async () => {
    ApiErrorCtor = (await import('@/lib/api')).ApiError;
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
    // AD-01: الاستعادة تجلب أحدث revision أولاً ثم تكتب بأساسه (لا كتابة فوق دون أساس).
    expect(putCall?.[1]?.body).toEqual({ schema: versionOneSchema, base_revision: 7 });
    const calls = api.mock.calls.map((call) => `${call[1]?.method ?? 'GET'} ${call[0]}`);
    expect(calls.indexOf('GET /app-builder/apps/app-1/draft')).toBeLessThan(calls.indexOf('PUT /app-builder/apps/app-1/draft'));
  });

  it('a restore that races a newer draft save is rejected with a clear error and does not redirect', async () => {
    mockApi({ putConflict: true });
    render(<AppBuilderVersionsPage />);
    await screen.findByText('Version 2');

    await userEvent.setup().click(screen.getAllByText('Restore to draft').slice(-1)[0]);
    const dialog = await screen.findByRole('dialog');
    await userEvent.setup().click(within(dialog).getAllByRole('button', { name: 'Restore to draft' })[0]);

    await waitFor(() => expect(toastFns.error).toHaveBeenCalledWith('The draft changed during the restore', 'Nothing was written. Try again.'));
    expect(push).not.toHaveBeenCalled();
    expect(toastFns.success).not.toHaveBeenCalled();
  });

  it('a successful restore discards the local unsaved backup, and the dialog warns about it beforehand', async () => {
    window.localStorage.setItem('awj.appBuilder.draftBackup.v1.u1.app-1', JSON.stringify({ v: 1, appId: 'app-1', userId: 'u1', schema: versionOneSchema, baseRevision: 3, savedAt: '2026-09-22T00:00:00Z' }));
    mockApi();
    render(<AppBuilderVersionsPage />);
    await screen.findByText('Version 2');

    await userEvent.setup().click(screen.getAllByText('Restore to draft').slice(-1)[0]);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('You have unsaved local changes that the restore will discard.')).toBeTruthy();
    await userEvent.setup().click(within(dialog).getAllByRole('button', { name: 'Restore to draft' })[0]);

    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(window.localStorage.getItem('awj.appBuilder.draftBackup.v1.u1.app-1')).toBeNull();
  });

  it('a user without the manage permission does not see the restore action', async () => {
    currentUser.mockReturnValue({ id: 'u9', role: 'staff', permissions: ['apps_builder.view'] });
    mockApi();
    render(<AppBuilderVersionsPage />);
    await screen.findByText('Version 2');

    expect(screen.queryAllByText('Restore to draft').length).toBe(0);
  });

  it('shows an error state when the app fails to load', async () => {
    const { ApiError } = await import('@/lib/api');
    api.mockRejectedValue(new ApiError(404, 'Could not load versions.', null));

    render(<AppBuilderVersionsPage />);

    expect(await screen.findByText('Could not load versions.')).toBeTruthy();
  });
});
