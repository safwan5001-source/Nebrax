import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const locale = { current: 'ar' };
const loadMock = vi.fn();
const saveMock = vi.fn();
const publishMock = vi.fn();
const versionLoadMock = vi.fn();
const versionSaveMock = vi.fn();
const search = { value: '' };

vi.mock('next-intl', () => ({
  useLocale: () => locale.current,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search.value),
}));

vi.mock('@/modules/commerce-workspace/store-context', () => ({
  useCommerceStoreContext: () => ({
    catalog: {
      status: 'ready',
      stores: [{ id: 's1', name: 'متجر النور', salesChannelId: 'c1', isActive: true, previewUrl: null, defaultLocale: 'ar' }],
    },
    selectedStoreId: 's1',
    setSelectedStoreId: vi.fn(),
    viewStoreUrl: null,
    refresh: vi.fn(),
  }),
}));

vi.mock('@/lib/company', () => ({
  useCompany: () => ({
    name: 'شركة النور',
    cr_number: '7050247977',
    vat_number: null,
  }),
}));

vi.mock('@/modules/commerce-workspace/presentation', () => ({
  loadStorefrontPresentation: (...args: unknown[]) => loadMock(...args),
  saveStorefrontPresentation: (...args: unknown[]) => saveMock(...args),
  publishStorefrontPresentation: (...args: unknown[]) => publishMock(...args),
}));

vi.mock('@/modules/commerce-workspace/presentation-versions', () => ({
  loadStorefrontPresentationVersion: (...args: unknown[]) => versionLoadMock(...args),
  saveStorefrontPresentationVersion: (...args: unknown[]) => versionSaveMock(...args),
}));

import { DEFAULT_PRESENTATION_CONFIG } from '@/modules/store-experience-builder/presentation';
import CommerceAppearancePage from './page';

const draftRecord = {
  storefrontId: 's1',
  schemaVersion: 1,
  draft: DEFAULT_PRESENTATION_CONFIG,
  draftRevision: 0,
  published: null,
  publishedRevision: null,
  publishedAt: null,
};

describe('commerce appearance — STORE-BACKEND-1', () => {
  afterEach(() => {
    cleanup();
    locale.current = 'ar';
    loadMock.mockReset();
    saveMock.mockReset();
    publishMock.mockReset();
    versionLoadMock.mockReset();
    versionSaveMock.mockReset();
    search.value = '';
  });

  it('replaces the destination placeholder with the Experience Builder', async () => {
    loadMock.mockResolvedValue({ ok: true, data: draftRecord });
    render(<CommerceAppearancePage />);
    expect(screen.getByText('بناء تجربة المتجر')).toBeTruthy();
    expect(screen.getByLabelText('معاينة المتجر')).toBeTruthy();
    expect(screen.queryByText('هذه الشاشة جزء من مساحة العمل وستنمو لاحقاً دون تكرار وحدات أَوْج.')).toBeNull();
    await waitFor(() => expect(loadMock).toHaveBeenCalledWith('s1'));
  });

  it('opens an exact draft Version when the route carries a version query', async () => {
    search.value = 'version=v1';
    versionLoadMock.mockResolvedValue({
      ok: true,
      data: {
        id: 'v1',
        storefrontId: 's1',
        name: 'AWJ Modern — Theme Gallery',
        state: 'draft',
        schemaVersion: 2,
        revision: 1,
        config: DEFAULT_PRESENTATION_CONFIG,
      },
    });

    render(<CommerceAppearancePage />);

    await waitFor(() => expect(versionLoadMock).toHaveBeenCalledWith('s1', 'v1'));
    expect(loadMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'نشر' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('status').textContent).toMatch(/نسخة مسودة مستقلة/);
  });

  it('uses the live store name as the typographic identity fallback', async () => {
    loadMock.mockResolvedValue({ ok: true, data: draftRecord });
    render(<CommerceAppearancePage />);
    expect(screen.getAllByText('متجر النور').length).toBeGreaterThan(0);
    await waitFor(() => expect(loadMock).toHaveBeenCalled());
  });

  it('passes canonical company identity to the preview', async () => {
    loadMock.mockResolvedValue({ ok: true, data: draftRecord });
    render(<CommerceAppearancePage />);

    expect(await screen.findByText('السجل التجاري: 7050247977')).toBeTruthy();
  });

  it('reports save success only after the server confirms', async () => {
    loadMock.mockResolvedValue({ ok: true, data: draftRecord });
    saveMock.mockResolvedValue({
      ok: true,
      data: { ...draftRecord, draftRevision: 1 },
    });
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await waitFor(() => expect(loadMock).toHaveBeenCalledWith('s1'));
    await user.click(screen.getByRole('button', { name: 'حفظ المسودة' }));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(screen.getByRole('status').textContent).toMatch(/تم حفظ المسودة/);
    expect(screen.queryByText(/لم يُحفظ شيء/)).toBeNull();
  });

  it('reports publish success only after the server confirms', async () => {
    loadMock.mockResolvedValue({ ok: true, data: { ...draftRecord, draftRevision: 1 } });
    publishMock.mockResolvedValue({
      ok: true,
      data: {
        ...draftRecord,
        draftRevision: 1,
        published: DEFAULT_PRESENTATION_CONFIG,
        publishedRevision: 1,
        publishedAt: '2026-09-19T00:00:00.000Z',
      },
    });
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await waitFor(() => expect(loadMock).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: 'نشر' }));
    await waitFor(() => expect(publishMock).toHaveBeenCalledWith('s1', 1));
    expect(screen.getByRole('status').textContent).toMatch(/نُشر المظهر/);
    expect(screen.queryByText(/النشر غير مفعّل/)).toBeNull();
  });
});
