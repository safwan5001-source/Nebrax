/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const pushMock = vi.fn();
const createMock = vi.fn();
const saveMock = vi.fn();
const deleteMock = vi.fn();

vi.mock('next-intl', () => ({
  useLocale: () => 'ar',
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('@/lib/auth', () => ({ currentUser: () => ({ role: 'admin', permissions: ['commerce.manage'] }) }));
vi.mock('@/lib/permissions', () => ({ hasPermission: () => true }));

vi.mock('@/modules/commerce-workspace/store-context', () => ({
  useCommerceStoreContext: () => ({
    selectedStoreId: 'store-1',
    viewStoreUrl: 'https://store.example.test',
  }),
}));

vi.mock('@/modules/commerce-workspace/presentation-versions', () => ({
  createPresentationVersion: (...args: unknown[]) => createMock(...args),
  savePresentationVersion: (...args: unknown[]) => saveMock(...args),
  deletePresentationVersion: (...args: unknown[]) => deleteMock(...args),
}));

import { DEFAULT_PRESENTATION_CONFIG } from '@/modules/store-experience-builder/presentation';
import CommerceThemesPage from './page';

describe('Theme Gallery draft handoff', () => {
  afterEach(() => {
    cleanup();
    pushMock.mockReset();
    createMock.mockReset();
    saveMock.mockReset();
    deleteMock.mockReset();
  });

  it('creates and saves an isolated draft Version before opening Store Experience', async () => {
    createMock.mockResolvedValue({
      ok: true,
      data: {
        id: 'version-1',
        storefrontId: 'store-1',
        name: 'أَوْج الحديث — Theme Gallery',
        state: 'draft',
        schemaVersion: 2,
        revision: 1,
        config: { ...DEFAULT_PRESENTATION_CONFIG, themePreset: 'navy', primaryColor: '#1e3a5f' },
      },
    });
    saveMock.mockResolvedValue({
      ok: true,
      data: {
        id: 'version-1',
        storefrontId: 'store-1',
        name: 'أَوْج الحديث — Theme Gallery',
        state: 'draft',
        schemaVersion: 2,
        revision: 2,
        config: DEFAULT_PRESENTATION_CONFIG,
      },
    });

    const user = userEvent.setup();
    render(<CommerceThemesPage />);

    await user.click(screen.getByRole('button', { name: 'استخدام الثيم' }));

    await waitFor(() => expect(createMock).toHaveBeenCalledWith(
      'store-1',
      'أَوْج الحديث — Theme Gallery',
    ));
    expect(saveMock).toHaveBeenCalledWith(
      'store-1',
      'version-1',
      expect.objectContaining({
        themePreset: 'awj-modern',
        primaryColor: '#12372a',
      }),
      1,
    );
    expect(pushMock).toHaveBeenCalledWith('/commerce/appearance?version=version-1');
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('cleans up a newly-created draft if applying the theme fails', async () => {
    createMock.mockResolvedValue({
      ok: true,
      data: {
        id: 'version-2',
        storefrontId: 'store-1',
        name: 'أَوْج الحديث — Theme Gallery',
        state: 'draft',
        schemaVersion: 2,
        revision: 1,
        config: DEFAULT_PRESENTATION_CONFIG,
      },
    });
    saveMock.mockResolvedValue({ ok: false, reason: 'conflict', message: 'stale' });
    deleteMock.mockResolvedValue(true);

    const user = userEvent.setup();
    render(<CommerceThemesPage />);
    await user.click(screen.getByRole('button', { name: 'استخدام الثيم' }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('store-1', 'version-2'));
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/لم يتغير المتجر الحي/);
  });

  it('does not expose apply actions for planned themes', () => {
    render(<CommerceThemesPage />);

    expect(screen.getByText('أَوْج ماركت')).toBeTruthy();
    expect(screen.getByText('بوتيك فلورال')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'استخدام الثيم' })).toHaveLength(1);
  });
});
