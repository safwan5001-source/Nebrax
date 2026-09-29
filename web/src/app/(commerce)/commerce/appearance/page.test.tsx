import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const locale = { current: 'ar' };
const listMock = vi.fn();
const showMock = vi.fn();
const saveMock = vi.fn();

vi.mock('next-intl', () => ({
  useLocale: () => locale.current,
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

vi.mock('@/modules/commerce-workspace/presentation-versions', () => ({
  listPresentationVersions: (...args: unknown[]) => listMock(...args),
  showPresentationVersion: (...args: unknown[]) => showMock(...args),
  createPresentationVersion: vi.fn(),
  savePresentationVersion: (...args: unknown[]) => saveMock(...args),
  renamePresentationVersion: vi.fn(),
  deletePresentationVersion: vi.fn(),
}));

import { DEFAULT_PRESENTATION_CONFIG } from '@/modules/store-experience-builder/presentation';
import CommerceAppearancePage from './page';

const versionSummary = {
  id: 'v1',
  storefrontId: 's1',
  name: 'التصميم الحالي',
  state: 'draft' as const,
  schemaVersion: 1,
  revision: 0,
  scheduledFor: null,
  lastPublishedAt: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

const versionDetail = { ...versionSummary, config: DEFAULT_PRESENTATION_CONFIG };

describe('commerce appearance — STORE-BACKEND-1 / CUST-H1-2', () => {
  afterEach(() => {
    cleanup();
    locale.current = 'ar';
    listMock.mockReset();
    showMock.mockReset();
    saveMock.mockReset();
    window.history.replaceState({}, '', '/commerce/appearance');
  });

  it('replaces the destination placeholder with the Experience Builder', async () => {
    listMock.mockResolvedValue({ ok: true, data: [versionSummary] });
    showMock.mockResolvedValue({ ok: true, data: versionDetail });
    render(<CommerceAppearancePage />);
    expect(screen.getByText('بناء تجربة المتجر')).toBeTruthy();
    expect(screen.getByLabelText('معاينة المتجر')).toBeTruthy();
    expect(screen.queryByText('هذه الشاشة جزء من مساحة العمل وستنمو لاحقاً دون تكرار وحدات أَوْج.')).toBeNull();
    await waitFor(() => expect(listMock).toHaveBeenCalledWith('s1'));
  });

  it('opens the exact version named by the route query directly, bypassing the ambiguous-choice list logic', async () => {
    // A store-experience-builder consumer outside this Horizon (the Theme
    // Gallery) redirects to `?version=<id>` after creating a draft — the
    // list here deliberately has two eligible drafts (which would normally
    // show the "choose a version" state) to prove the explicit id wins.
    window.history.replaceState({}, '', '/commerce/appearance?version=v1');
    listMock.mockResolvedValue({
      ok: true,
      data: [versionSummary, { ...versionSummary, id: 'v2', name: 'نسخة أخرى' }],
    });
    showMock.mockResolvedValue({
      ok: true,
      data: { ...versionDetail, name: 'AWJ Modern — Theme Gallery' },
    });

    render(<CommerceAppearancePage />);

    await waitFor(() => expect(showMock).toHaveBeenCalledWith('s1', 'v1'));
    expect(screen.queryByText('اختر نسخة للتعديل')).toBeNull();
    // CUST-H1-3 replaced the CUST-H1-2 hard publish gate — an opened,
    // unmodified Draft is now publishable.
    expect(screen.getByRole('button', { name: 'نشر' }).hasAttribute('disabled')).toBe(false);
  });

  it('uses the live store name as the typographic identity fallback', async () => {
    listMock.mockResolvedValue({ ok: true, data: [versionSummary] });
    showMock.mockResolvedValue({ ok: true, data: versionDetail });
    render(<CommerceAppearancePage />);
    expect(screen.getAllByText('متجر النور').length).toBeGreaterThan(0);
    await waitFor(() => expect(listMock).toHaveBeenCalled());
  });

  it('passes canonical company identity to the preview', async () => {
    listMock.mockResolvedValue({ ok: true, data: [versionSummary] });
    showMock.mockResolvedValue({ ok: true, data: versionDetail });
    render(<CommerceAppearancePage />);

    expect(await screen.findByText('السجل التجاري: 7050247977')).toBeTruthy();
  });

  it('reports save success only after the exact-version PUT confirms', async () => {
    listMock.mockResolvedValue({ ok: true, data: [versionSummary] });
    showMock.mockResolvedValue({ ok: true, data: versionDetail });
    saveMock.mockResolvedValue({
      ok: true,
      data: { ...versionDetail, revision: 1 },
    });
    const user = userEvent.setup();
    render(<CommerceAppearancePage />);
    await waitFor(() => expect(showMock).toHaveBeenCalledWith('s1', 'v1'));
    await user.click(screen.getByRole('button', { name: 'حفظ المسودة' }));
    await waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(screen.getByRole('status').textContent).toMatch(/تم حفظ النسخة/);
    expect(screen.queryByText(/لم يُحفظ شيء/)).toBeNull();
  });

  it('enables real Publish for an eligible Draft in the version-aware Customizer (CUST-H1-3)', async () => {
    listMock.mockResolvedValue({ ok: true, data: [versionSummary] });
    showMock.mockResolvedValue({ ok: true, data: versionDetail });
    render(<CommerceAppearancePage />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());
    const publishButton = screen.getByRole('button', { name: 'نشر' }) as HTMLButtonElement;
    expect(publishButton.disabled).toBe(false);
  });
});
