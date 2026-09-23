/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NewAppBuilderPage from './page';

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
  };
  const translator = Object.assign((key: string) => strings[key] ?? key, { raw: () => ({}) });
  return { api: vi.fn(), push: vi.fn(), translate: translator };
});

vi.mock('next-intl', () => ({ useTranslations: () => translate }));
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

  it('shows a save-failed message when the API rejects the request', async () => {
    const user = userEvent.setup();
    const { ApiError } = await import('@/lib/api');
    api.mockRejectedValue(new ApiError(422, 'Could not save.', null));
    render(<NewAppBuilderPage />);

    await user.click(screen.getByRole('radio', { name: /Start from scratch/ }));
    await user.type(screen.getByLabelText('Name (Arabic)'), 'تطبيقي');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('Could not save.')).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });
});
