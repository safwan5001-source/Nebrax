/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NewAppBuilderPage from './page';

const TEMPLATES = [
  { key: 'blank', version: 1, vertical: null, name: { ar: 'فارغ', en: 'Blank' }, description: { ar: 'صفحة واحدة', en: 'One home page.' }, min_runtime: '1.0.0' },
  { key: 'catalog', version: 1, vertical: 'retail', name: { ar: 'متجر منتجات', en: 'Product store' }, description: { ar: 'منتجات حيّة', en: 'Live products + cart.' }, min_runtime: '1.0.0' },
];

/** api مزيَّف: الدليل يعيد القوالب، الإنشاء يعيد معرّفاً، وكل ما سواه يُسجَّل. */
function mockApi(calls: { path: string; options?: { method?: string; body?: unknown } }[] = []) {
  api.mockImplementation((path: string, options?: { method?: string; body?: unknown }) => {
    calls.push({ path, options });
    if (path === '/app-builder/templates') return Promise.resolve({ data: TEMPLATES });
    if (path === '/app-builder/apps') return Promise.resolve({ data: { id: 'app-42' } });
    return Promise.resolve({ data: {} });
  });
  return calls;
}

const { api, push, translate } = vi.hoisted(() => {
  const strings: Record<string, string> = {
    title: 'Create app',
    subtitle: 'Choose a starting point first, then name the app.',
    back: 'Back',
    pathSectionTitle: 'Starting point',
    nameSectionTitle: 'App name',
    storeDesignTitle: 'Use my store design',
    storeDesignDescription: 'Safe minimum shell today.',
    templateTitle: 'Choose a template',
    templateDescription: 'Safe minimum shell today.',
    scratchTitle: 'Start from scratch',
    scratchDescription: 'A blank app.',
    nameLabel: 'Name (Arabic)',
    namePlaceholder: 'App name',
    nameEnLabel: 'Name (English, optional)',
    nameEnPlaceholder: 'App name',
    create: 'Create',
    creating: 'Creating...',
    cancel: 'Cancel',
    nameRequired: 'Name is required.',
    pathRequired: 'Choose a starting point first.',
    saveFailed: 'Could not save.',
    templateSectionTitle: 'Template',
    templateRequired: 'Choose a template first.',
    templatesLoading: 'Loading templates…',
    templatesLoadFailed: 'Could not load templates.',
    templatesRetry: 'Retry',
    templatesEmpty: 'No templates are available.',
  };
  const translator = Object.assign((key: string) => strings[key] ?? key, { raw: () => ({}) });
  return { api: vi.fn(), push: vi.fn(), translate: translator };
});

vi.mock('next-intl', () => ({ useTranslations: () => translate, useLocale: () => 'en' }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
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

describe('NewAppBuilderPage', () => {
  afterEach(cleanup);

  beforeEach(() => {
    api.mockReset();
    push.mockReset();
  });

  it('keeps the create button disabled until a path is chosen', async () => {
    render(<NewAppBuilderPage />);

    // The name field is not even rendered before a path is chosen (path-first flow).
    expect(screen.queryByLabelText('Name (Arabic)')).toBeNull();
    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('reveals the name section only after a path is chosen, then creates the app and redirects', async () => {
    const user = userEvent.setup();
    api.mockResolvedValue({ data: { id: 'app-42' } });
    render(<NewAppBuilderPage />);

    expect(screen.queryByLabelText('Name (Arabic)')).toBeNull();

    await user.click(screen.getByRole('radio', { name: /Start from scratch/ }));
    expect(screen.getByLabelText('Name (Arabic)')).toBeTruthy();

    await user.type(screen.getByLabelText('Name (Arabic)'), 'تطبيقي');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(api).toHaveBeenCalledWith('/app-builder/apps', {
      method: 'POST',
      body: { name: 'تطبيقي', name_en: undefined, creation_source: 'scratch' },
    }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/app-builder/app-42'));
  });

  it('choosing the template path loads the server registry and requires a pick before Create is enabled', async () => {
    const user = userEvent.setup();
    mockApi();
    render(<NewAppBuilderPage />);

    await user.click(screen.getByRole('radio', { name: /Choose a template/ }));
    await user.type(screen.getByLabelText('Name (Arabic)'), 'تطبيقي');
    // Name is filled but no template chosen yet — Create stays disabled.
    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true);

    await user.click(await screen.findByRole('radio', { name: /Blank/ }));
    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(false);
    expect(api).toHaveBeenCalledWith('/app-builder/templates');
  });

  it('does not fetch templates for the other paths', async () => {
    const user = userEvent.setup();
    mockApi();
    render(<NewAppBuilderPage />);

    await user.click(screen.getByRole('radio', { name: /Start from scratch/ }));
    expect(api).not.toHaveBeenCalledWith('/app-builder/templates');
  });

  it('creating from a template sends template_key and lets the server seed the draft (no client draft write)', async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    render(<NewAppBuilderPage />);

    await user.click(screen.getByRole('radio', { name: /Choose a template/ }));
    await user.click(await screen.findByRole('radio', { name: /Product store/ }));
    await user.type(screen.getByLabelText('Name (Arabic)'), 'تطبيقي');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/app-builder/app-42'));

    const createCall = calls.find((c) => c.path === '/app-builder/apps');
    expect(createCall?.options?.body).toEqual({
      name: 'تطبيقي', name_en: undefined, creation_source: 'template', template_key: 'catalog',
    });
    expect(calls.some((c) => c.path.endsWith('/draft'))).toBe(false);
  });

  it('a non-template creation never sends template_key', async () => {
    const user = userEvent.setup();
    const calls = mockApi();
    render(<NewAppBuilderPage />);

    // اختر قالباً ثم غيّر المسار: لا يتسرّب المفتاح.
    await user.click(screen.getByRole('radio', { name: /Choose a template/ }));
    await user.click(await screen.findByRole('radio', { name: /Blank/ }));
    await user.click(screen.getByRole('radio', { name: /Start from scratch/ }));
    await user.type(screen.getByLabelText('Name (Arabic)'), 'تطبيقي');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(push).toHaveBeenCalled());
    const body = calls.find((c) => c.path === '/app-builder/apps')?.options?.body as Record<string, unknown>;
    expect('template_key' in body).toBe(false);
  });

  it('shows a visible error with retry when the registry cannot be loaded', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    api.mockImplementation((path: string) => {
      if (path === '/app-builder/templates') {
        attempts += 1;
        return attempts === 1 ? Promise.reject(new Error('down')) : Promise.resolve({ data: TEMPLATES });
      }
      return Promise.resolve({ data: {} });
    });
    render(<NewAppBuilderPage />);

    await user.click(screen.getByRole('radio', { name: /Choose a template/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('Could not load templates.');

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('radio', { name: /Blank/ })).toBeTruthy();
  });

  it('a server rejection of the creation is shown and does not navigate (no half-built app is hidden)', async () => {
    const user = userEvent.setup();
    const { ApiError } = await import('@/lib/api');
    api.mockImplementation((path: string) => {
      if (path === '/app-builder/templates') return Promise.resolve({ data: TEMPLATES });
      return Promise.reject(new ApiError(422, 'القالب غير معروف.', null));
    });
    render(<NewAppBuilderPage />);

    await user.click(screen.getByRole('radio', { name: /Choose a template/ }));
    await user.click(await screen.findByRole('radio', { name: /Blank/ }));
    await user.type(screen.getByLabelText('Name (Arabic)'), 'تطبيقي');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect((await screen.findByText('القالب غير معروف.'))).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });
});
