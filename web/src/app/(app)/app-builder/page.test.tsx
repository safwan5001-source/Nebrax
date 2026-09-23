/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppBuilderPage from './page';

const { api, currentUser, translate } = vi.hoisted(() => {
  const strings: Record<string, string> = {
    title: 'AWJ Apps',
    subtitle: 'Manage your app experiences',
    noAccess: 'No access',
    loadFailed: 'Could not load apps.',
    createAction: 'Create app',
    emptyTitle: 'No apps yet',
    emptyDescription: 'Create your first app.',
    createdAt: 'Created {date}',
    unpublished: 'Not published yet',
    latestVersion: 'Latest published version: {version}',
    'creationSource.store_design': 'From store design',
    'creationSource.template': 'From template',
    'creationSource.scratch': 'From scratch',
    loading: 'Loading…',
    retry: 'Try again',
  };
  const translator = Object.assign(
    (key: string, values?: Record<string, unknown>) =>
      (strings[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(values?.[name] ?? '')),
    { raw: () => ({}) }
  );
  return { api: vi.fn(), currentUser: vi.fn(), translate: translator };
});

vi.mock('next-intl', () => ({ useTranslations: () => translate, useLocale: () => 'en' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock('@/lib/auth', () => ({ currentUser }));
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

const app = (overrides = {}) => ({
  id: 'app-1',
  name: 'متجري',
  name_en: 'My App',
  creation_source: 'scratch' as const,
  latest_published_version: null,
  created_at: '2026-09-20T00:00:00Z',
  updated_at: '2026-09-20T00:00:00Z',
  ...overrides,
});

describe('AppBuilderPage', () => {
  afterEach(cleanup);

  beforeEach(() => {
    api.mockReset();
    currentUser.mockReturnValue({ role: 'admin' });
  });

  it('shows a no-access message when the user lacks apps_builder.view', async () => {
    currentUser.mockReturnValue({ role: 'staff', permissions: [] });
    render(<AppBuilderPage />);
    expect(await screen.findByText('No access')).toBeTruthy();
    expect(api).not.toHaveBeenCalled();
  });

  it('shows an empty state with a create action when there are no apps', async () => {
    api.mockResolvedValue({ data: [] });
    render(<AppBuilderPage />);
    expect(await screen.findByText('No apps yet')).toBeTruthy();
    const links = screen.getAllByRole('link', { name: 'Create app' });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0].getAttribute('href')).toBe('/app-builder/new');
  });

  it('renders an app card with its creation source and unpublished badge', async () => {
    api.mockResolvedValue({ data: [app()] });
    render(<AppBuilderPage />);
    expect(await screen.findByText('My App')).toBeTruthy();
    expect(screen.getByText('From scratch')).toBeTruthy();
    expect(screen.getByText('Not published yet')).toBeTruthy();
  });

  it('renders the latest published version badge when the app has one', async () => {
    api.mockResolvedValue({ data: [app({ latest_published_version: 3 })] });
    render(<AppBuilderPage />);
    expect(await screen.findByText('Latest published version: 3')).toBeTruthy();
  });

  it('shows an error state and retries on demand', async () => {
    const { ApiError } = await import('@/lib/api');
    api.mockRejectedValueOnce(new ApiError(500, 'Could not load apps.', null));
    api.mockResolvedValueOnce({ data: [app()] });
    render(<AppBuilderPage />);
    expect(await screen.findByText('Could not load apps.')).toBeTruthy();
    screen.getByRole('button', { name: 'Try again' }).click();
    await waitFor(() => expect(screen.getByText('My App')).toBeTruthy());
  });
});
