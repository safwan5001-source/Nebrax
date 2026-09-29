/**
 * @vitest-environment jsdom
 *
 * CUST-H1-3 — Immediate Version Publishing: toolbar/manager eligibility,
 * the confirmation dialog's content, the exact request shape (version id +
 * revision + publication-head state), success/failure UX, and the no-retry
 * conflict rule. Version CRUD/switching itself is covered by
 * `ExperienceBuilder.versions.test.tsx`.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const listMock = vi.fn();
const showMock = vi.fn();
const createMock = vi.fn();
const saveMock = vi.fn();
const renameMock = vi.fn();
const deleteMock = vi.fn();
const publishMock = vi.fn();

vi.mock('@/modules/commerce-workspace/presentation-versions', () => ({
  listPresentationVersions: (...args: unknown[]) => listMock(...args),
  showPresentationVersion: (...args: unknown[]) => showMock(...args),
  createPresentationVersion: (...args: unknown[]) => createMock(...args),
  savePresentationVersion: (...args: unknown[]) => saveMock(...args),
  renamePresentationVersion: (...args: unknown[]) => renameMock(...args),
  deletePresentationVersion: (...args: unknown[]) => deleteMock(...args),
  publishPresentationVersion: (...args: unknown[]) => publishMock(...args),
}));

import { DEFAULT_PRESENTATION_CONFIG } from '../presentation';
import { ExperienceBuilder } from '../ExperienceBuilder';

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'v1',
    storefrontId: 'store-1',
    name: 'رمضان 1448',
    state: 'draft',
    schemaVersion: 2,
    revision: 1,
    scheduledFor: null,
    lastPublishedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    publishedRevision: null,
    ...overrides,
  };
}

function detail(overrides: Record<string, unknown> = {}) {
  const { config, ...rest } = overrides;
  return { ...summary(rest), config: config ?? DEFAULT_PRESENTATION_CONFIG };
}

async function openVersionManager(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText('نسخة التصميم قيد التعديل'));
}

describe('ExperienceBuilder — CUST-H1-3 Immediate Version Publishing', () => {
  afterEach(() => {
    cleanup();
    listMock.mockReset();
    showMock.mockReset();
    createMock.mockReset();
    saveMock.mockReset();
    renameMock.mockReset();
    deleteMock.mockReset();
    publishMock.mockReset();
  });

  it('shows Publish enabled for an eligible, unmodified Draft', async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary()] });
    showMock.mockResolvedValue({ ok: true, data: detail() });
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" liveStoreName="متجر النور" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    expect(screen.getByRole('button', { name: 'نشر' })).toHaveProperty('disabled', false);
  });

  it('does not offer normal Publish for an already-Published version', async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary({ state: 'published', publishedRevision: 3 })] });
    showMock.mockResolvedValue({ ok: true, data: detail({ state: 'published', publishedRevision: 3 }) });
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    const publishButton = screen.getByRole('button', { name: 'نشر' }) as HTMLButtonElement;
    expect(publishButton.disabled).toBe(true);
    expect(publishButton.title).toBe('هذه النسخة منشورة بالفعل.');
  });

  it('disables Publish for a Scheduled version with a cancel-schedule hint', async () => {
    listMock.mockResolvedValue({
      ok: true,
      data: [summary({ state: 'scheduled', scheduledFor: '2026-12-01T00:00:00.000Z' })],
    });
    showMock.mockResolvedValue({ ok: true, data: detail({ state: 'scheduled', scheduledFor: '2026-12-01T00:00:00.000Z' }) });
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    const publishButton = screen.getByRole('button', { name: 'نشر' }) as HTMLButtonElement;
    expect(publishButton.disabled).toBe(true);
    expect(publishButton.title).toMatch(/مجدولة/);
  });

  it('disables Publish while there are unsaved edits, with a save-first hint', async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary()] });
    showMock.mockResolvedValue({ ok: true, data: detail() });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'التوثيق والثقة' }));
    await user.type(screen.getAllByRole('textbox')[0], 'تعديل غير محفوظ');

    const publishButton = screen.getByRole('button', { name: 'نشر' }) as HTMLButtonElement;
    expect(publishButton.disabled).toBe(true);
    expect(publishButton.title).toBe('احفظ التعديلات أولاً، ثم انشر.');
  });

  it('opens a confirmation naming the exact version and the storefront, not a generic "are you sure"', async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary({ name: 'رمضان 1448' })] });
    showMock.mockResolvedValue({ ok: true, data: detail({ name: 'رمضان 1448' }) });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" liveStoreName="متجر النور" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'نشر' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText((_, node) => node?.textContent === 'نشر «رمضان 1448»؟')).toBeTruthy();
    expect(within(dialog).getByText((_, node) => node?.textContent === 'المتجر: متجر النور')).toBeTruthy();
    expect(within(dialog).getByText('لا يوجد تصميم منشور لهذا المتجر بعد — سيكون هذا أول نشر له.')).toBeTruthy();
    expect(publishMock).not.toHaveBeenCalled();
  });

  it('sends the exact version id + revision + publication-head state derived from the last loaded list', async () => {
    listMock.mockResolvedValue({
      ok: true,
      data: [
        summary({ id: 'pub-1', name: 'الحالية', state: 'published', publishedRevision: 5 }),
        summary({ id: 'v1', name: 'رمضان 1448', revision: 3, publishedRevision: 5 }),
      ],
    });
    showMock.mockResolvedValue({ ok: true, data: detail({ id: 'v1', name: 'رمضان 1448', revision: 3, publishedRevision: 5 }) });
    publishMock.mockReturnValue(new Promise(() => {})); // stays pending — only the request shape matters here.
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" versionId="v1" />);
    await waitFor(() => expect(showMock).toHaveBeenCalledWith('store-1', 'v1'));

    await user.click(screen.getByRole('button', { name: 'نشر' }));
    await user.click(screen.getByRole('button', { name: 'نشر الآن' }));

    await waitFor(() => expect(publishMock).toHaveBeenCalledWith('store-1', 'v1', 3, 5, 'pub-1'));
  });

  it('sends explicit null publication-head expectations for a storefront never published before', async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary({ id: 'v1', revision: 1 })] });
    showMock.mockResolvedValue({ ok: true, data: detail({ id: 'v1', revision: 1 }) });
    publishMock.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'نشر' }));
    await user.click(screen.getByRole('button', { name: 'نشر الآن' }));

    await waitFor(() => expect(publishMock).toHaveBeenCalledWith('store-1', 'v1', 1, null, null));
  });

  it('on success, updates the open editor to read-only Published and demotes the previous live version to Draft in the manager', async () => {
    listMock
      .mockResolvedValueOnce({
        ok: true,
        data: [
          summary({ id: 'pub-1', name: 'الحالية', state: 'published', publishedRevision: 1 }),
          summary({ id: 'v1', name: 'رمضان 1448', revision: 1, publishedRevision: 1 }),
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        data: [
          summary({ id: 'pub-1', name: 'الحالية', state: 'draft', publishedRevision: 2 }),
          summary({ id: 'v1', name: 'رمضان 1448', state: 'published', revision: 1, publishedRevision: 2 }),
        ],
      });
    showMock.mockResolvedValue({ ok: true, data: detail({ id: 'v1', name: 'رمضان 1448', revision: 1, publishedRevision: 1 }) });
    publishMock.mockResolvedValue({
      ok: true,
      data: detail({ id: 'v1', name: 'رمضان 1448', state: 'published', revision: 1, publishedRevision: 2 }),
    });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" versionId="v1" />);
    await waitFor(() => expect(showMock).toHaveBeenCalledWith('store-1', 'v1'));

    await user.click(screen.getByRole('button', { name: 'نشر' }));
    await user.click(screen.getByRole('button', { name: 'نشر الآن' }));

    await waitFor(() => expect(screen.getByText('تم النشر. هذه النسخة هي التصميم المباشر الآن.')).toBeTruthy());
    expect(screen.getByText('هذه النسخة منشورة ومقروءة فقط')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();

    await openVersionManager(user);
    const manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    const previousLiveRow = within(manager).getByText('الحالية').closest('li') as HTMLElement;
    expect(within(previousLiveRow).getByText('مسودة')).toBeTruthy();
  });

  it('a stale publication-head conflict shows a clear message, refreshes state, and never auto-retries the publish', async () => {
    listMock
      .mockResolvedValueOnce({ ok: true, data: [summary({ id: 'v1', revision: 1, publishedRevision: 1 })] })
      .mockResolvedValueOnce({ ok: true, data: [summary({ id: 'v1', revision: 1, publishedRevision: 2 })] });
    showMock.mockResolvedValue({ ok: true, data: detail({ id: 'v1', revision: 1, publishedRevision: 1 }) });
    publishMock.mockResolvedValue({ ok: false, reason: 'stale', message: 'stale' });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'نشر' }));
    await user.click(screen.getByRole('button', { name: 'نشر الآن' }));

    await waitFor(() => expect(publishMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    expect(screen.getByText(/تغيّرت حالة النشر منذ آخر مراجعة/)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();

    // No automatic retry: the dialog is closed and nothing else calls publish again.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(publishMock).toHaveBeenCalledTimes(1);
  });

  it('a scheduled-target conflict shows the cancel-schedule-first message', async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary({ id: 'v1', revision: 1 })] });
    showMock.mockResolvedValue({ ok: true, data: detail({ id: 'v1', revision: 1 }) });
    publishMock.mockResolvedValue({ ok: false, reason: 'scheduled_conflict', message: 'scheduled' });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'نشر' }));
    await user.click(screen.getByRole('button', { name: 'نشر الآن' }));

    await waitFor(() =>
      expect(screen.getByText(/ألغِ الجدولة أولاً من إدارة النسخ/)).toBeTruthy(),
    );
  });

  it('a forward-schema conflict shows the unsupported-format message', async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary({ id: 'v1', revision: 1 })] });
    showMock.mockResolvedValue({ ok: true, data: detail({ id: 'v1', revision: 1 }) });
    publishMock.mockResolvedValue({ ok: false, reason: 'unsupported_schema', message: 'forward' });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'نشر' }));
    await user.click(screen.getByRole('button', { name: 'نشر الآن' }));

    await waitFor(() =>
      expect(screen.getByText('إصدار هذه النسخة أحدث مما يدعمه النظام حالياً. حدِّث الصفحة أو تواصل مع الدعم.')).toBeTruthy(),
    );
  });

  it('Publish now on a Version Manager row targets that exact row, even when a different Draft is open', async () => {
    listMock.mockResolvedValue({
      ok: true,
      data: [summary({ id: 'v1', name: 'المفتوحة', revision: 1 }), summary({ id: 'v2', name: 'أخرى', revision: 4 })],
    });
    showMock.mockResolvedValue({ ok: true, data: detail({ id: 'v1', name: 'المفتوحة', revision: 1 }) });
    publishMock.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" versionId="v1" />);
    await waitFor(() => expect(showMock).toHaveBeenCalledWith('store-1', 'v1'));

    await openVersionManager(user);
    const manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    const rowB = within(manager).getByText('أخرى').closest('li') as HTMLElement;
    await user.click(within(rowB).getByRole('button', { name: 'نشر الآن' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText((_, node) => node?.textContent === 'نشر «أخرى»؟')).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: 'نشر الآن' }));
    await waitFor(() => expect(publishMock).toHaveBeenCalledWith('store-1', 'v2', 4, null, null));
    // The open editor (v1) is untouched by publishing a different row.
    expect(document.querySelector('[data-experience-builder]')?.getAttribute('data-selected-version-id')).toBe('v1');
  });

  it('cancel closes the dialog without publishing', async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary()] });
    showMock.mockResolvedValue({ ok: true, data: detail() });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'نشر' }));
    await user.click(screen.getByRole('button', { name: 'إلغاء' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(publishMock).not.toHaveBeenCalled();
  });

  it('renders the confirmation in English for locale en', async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary({ name: 'Ramadan 1448' })] });
    showMock.mockResolvedValue({ ok: true, data: detail({ name: 'Ramadan 1448' }) });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" liveStoreName="Al-Noor Store" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'Publish' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText((_, node) => node?.textContent === 'Publish "Ramadan 1448"?')).toBeTruthy();
    expect(within(dialog).getByText((_, node) => node?.textContent === 'Storefront: Al-Noor Store')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Publish now' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('mobile: Publish now from the bottom-sheet Version Manager closes the sheet and opens the dialog', async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    listMock.mockResolvedValue({
      ok: true,
      data: [summary({ id: 'v1', name: 'المفتوحة' }), summary({ id: 'v2', name: 'أخرى' })],
    });
    showMock.mockResolvedValue({ ok: true, data: detail({ id: 'v1', name: 'المفتوحة' }) });
    const user = userEvent.setup();
    try {
      render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" versionId="v1" />);
      await waitFor(() => expect(showMock).toHaveBeenCalledWith('store-1', 'v1'));

      await user.click(document.querySelector('[data-version-selector-mobile]') as HTMLElement);
      const sheet = screen.getByRole('dialog', { name: 'إدارة نسخ التصميم' });
      const rowB = within(sheet).getByText('أخرى').closest('li') as HTMLElement;
      await user.click(within(rowB).getByRole('button', { name: 'نشر الآن' }));

      expect(screen.queryByRole('dialog', { name: 'إدارة نسخ التصميم' })).toBeNull();
      const confirm = screen.getByRole('dialog');
      expect(within(confirm).getByText((_, node) => node?.textContent === 'نشر «أخرى»؟')).toBeTruthy();
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, configurable: true });
    }
  });
});
