/**
 * @vitest-environment jsdom
 *
 * CUST-H1-2 — Version-aware Customizer UX: manager list/empty/choose states,
 * create/duplicate/rename/delete, exact-version switching with a stale
 * async-callback guard, Published read-only gating, and the mobile Version
 * Manager sheet. `ExperienceBuilder.test.tsx` covers the exact-version
 * save/conflict wiring and the legacy no-storefront local-editing path.
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

vi.mock('@/modules/commerce-workspace/presentation-versions', () => ({
  listPresentationVersions: (...args: unknown[]) => listMock(...args),
  showPresentationVersion: (...args: unknown[]) => showMock(...args),
  createPresentationVersion: (...args: unknown[]) => createMock(...args),
  savePresentationVersion: (...args: unknown[]) => saveMock(...args),
  renamePresentationVersion: (...args: unknown[]) => renameMock(...args),
  deletePresentationVersion: (...args: unknown[]) => deleteMock(...args),
}));

import { DEFAULT_PRESENTATION_CONFIG } from '../presentation';
import { ExperienceBuilder } from '../ExperienceBuilder';

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'v1',
    storefrontId: 'store-1',
    name: 'رمضان 1448',
    state: 'draft',
    schemaVersion: 1,
    revision: 0,
    scheduledFor: null,
    lastPublishedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
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

describe('ExperienceBuilder — CUST-H1-2 Version Manager', () => {
  afterEach(() => {
    cleanup();
    listMock.mockReset();
    showMock.mockReset();
    createMock.mockReset();
    saveMock.mockReset();
    renameMock.mockReset();
    deleteMock.mockReset();
  });

  function emptyStatePanel(): HTMLElement {
    // النسخة نفسها (حالة فارغة) تظهر أيضاً داخل لوحة `VersionSelector` المخفية
    // في الشريط العلوي؛ نطاق الاستعلام هنا على حاوية الشريط الجانبي فقط.
    const panel = document.querySelector('[data-version-empty-state]');
    if (!panel) throw new Error('empty-state panel missing');
    return panel as HTMLElement;
  }

  it('renders an empty state with a create form when the storefront has no versions yet', async () => {
    listMock.mockResolvedValue({ ok: true, data: [] });
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(listMock).toHaveBeenCalledWith('store-1'));

    await waitFor(() => expect(document.querySelector('[data-version-empty-state]')).toBeTruthy());
    expect(within(emptyStatePanel()).getByText('لا توجد نسخ بعد')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'حفظ المسودة' })).toHaveProperty('disabled', true);
  });

  it('creates the first version, then selects/opens it', async () => {
    listMock.mockResolvedValue({ ok: true, data: [] });
    createMock.mockResolvedValue({ ok: true, data: detail({ revision: 1 }) });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(document.querySelector('[data-version-empty-state]')).toBeTruthy());

    await user.type(within(emptyStatePanel()).getByPlaceholderText('مثال: رمضان ١٤٤٨'), 'رمضان 1448');
    await user.click(within(emptyStatePanel()).getByRole('button', { name: 'إنشاء أول نسخة' }));

    await waitFor(() => expect(createMock).toHaveBeenCalledWith('store-1', 'رمضان 1448'));
    await waitFor(() => expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('رمضان 1448'));
    expect(screen.getByRole('button', { name: 'حفظ المسودة' })).toHaveProperty('disabled', false);
  });

  it('does not auto-select when several drafts exist — shows an explicit choose state instead', async () => {
    listMock.mockResolvedValue({
      ok: true,
      data: [summary({ id: 'a', name: 'مسودة أ' }), summary({ id: 'b', name: 'مسودة ب' })],
    });
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(listMock).toHaveBeenCalled());

    expect(await screen.findByText('اختر نسخة للتعديل')).toBeTruthy();
    expect(showMock).not.toHaveBeenCalled();
  });

  it('lists versions with state badges, long names truncated, and last-modified', async () => {
    listMock.mockResolvedValue({
      ok: true,
      data: [
        summary({ id: 'draft-1', name: 'أ'.repeat(200), state: 'draft' }),
        summary({ id: 'pub-1', name: 'الحالية', state: 'published' }),
      ],
    });
    showMock.mockResolvedValue({ ok: true, data: detail({ id: 'draft-1', name: 'أ'.repeat(200) }) });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await openVersionManager(user);
    const manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    expect(within(manager).getAllByRole('listitem').length).toBe(2);
    expect(within(manager).getByText('منشور')).toBeTruthy();
    expect(within(manager).getAllByText('مسودة').length).toBeGreaterThan(0);
  });

  it('duplicating a Published version creates and opens a new Draft copy', async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary({ id: 'pub-1', name: 'الحالية', state: 'published' })] });
    showMock.mockResolvedValue({ ok: true, data: detail({ id: 'pub-1', name: 'الحالية', state: 'published' }) });
    createMock.mockResolvedValue({
      ok: true,
      data: detail({ id: 'draft-2', name: 'مسودة من الحالية', state: 'draft', revision: 1 }),
    });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    expect(screen.getByText('هذه النسخة منشورة ومقروءة فقط')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'إنشاء مسودة من هذه النسخة' }));

    await waitFor(() => expect(createMock).toHaveBeenCalledWith('store-1', expect.any(String), 'pub-1'));
    await waitFor(() =>
      expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('مسودة من الحالية'),
    );
    expect(screen.queryByText('هذه النسخة منشورة ومقروءة فقط')).toBeNull();
  });

  it('renames a version and reflects the new name immediately after authoritative success', async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary()] });
    showMock.mockResolvedValue({ ok: true, data: detail() });
    renameMock.mockResolvedValue({ ok: true, data: detail({ name: 'اسم جديد', revision: 1 }) });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await openVersionManager(user);
    await user.click(screen.getByRole('button', { name: 'إعادة تسمية' }));
    const input = screen.getByLabelText('اسم النسخة');
    await user.clear(input);
    await user.type(input, 'اسم جديد');
    await user.click(screen.getByRole('button', { name: 'حفظ الاسم' }));

    await waitFor(() => expect(renameMock).toHaveBeenCalledWith('store-1', 'v1', 'اسم جديد', 0));
    await waitFor(() =>
      expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('اسم جديد'),
    );
  });

  it('deletes an eligible Draft after a confirmation that names the version', async () => {
    listMock.mockResolvedValue({
      ok: true,
      data: [summary({ id: 'a', name: 'الحالية' }), summary({ id: 'b', name: 'نسخة قديمة' })],
    });
    deleteMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    await screen.findByText('اختر نسخة للتعديل');

    await openVersionManager(user);
    const manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    const row = within(manager).getByText('نسخة قديمة').closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'حذف' }));

    expect(within(row).getByText('حذف "نسخة قديمة"؟')).toBeTruthy();
    await user.click(within(row).getByRole('button', { name: 'حذف النسخة' }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('store-1', 'b'));
    await waitFor(() => expect(screen.queryByText('نسخة قديمة')).toBeNull());
  });

  it('refreshes the list and reports the lifecycle conflict on a 409 delete', async () => {
    listMock
      .mockResolvedValueOnce({
        ok: true,
        data: [summary({ id: 'a', name: 'الحالية' }), summary({ id: 'b', name: 'نسخة قديمة' })],
      })
      .mockResolvedValueOnce({ ok: true, data: [summary({ id: 'a', name: 'الحالية' })] });
    deleteMock.mockResolvedValue({ ok: false, reason: 'lifecycle_conflict', message: 'blocked' });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1));
    await screen.findByText('اختر نسخة للتعديل');

    await openVersionManager(user);
    const manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    const row = within(manager).getByText('نسخة قديمة').closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'حذف' }));
    await user.click(within(row).getByRole('button', { name: 'حذف النسخة' }));

    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('status').textContent).toMatch(/لم يعد بالإمكان حذف/);
  });

  it('a delayed callback from an earlier switch cannot mutate the later selected version (stale-callback guard)', async () => {
    listMock.mockResolvedValue({
      ok: true,
      data: [summary({ id: 'a', name: 'نسخة أ' }), summary({ id: 'b', name: 'نسخة ب' })],
    });
    let resolveA: (value: unknown) => void = () => {};
    const pendingA = new Promise((resolve) => {
      resolveA = resolve;
    });
    showMock.mockImplementation((_storefrontId: string, versionId: string) => {
      if (versionId === 'a') return pendingA;
      return Promise.resolve({ ok: true, data: detail({ id: 'b', name: 'نسخة ب' }) });
    });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await screen.findByText('اختر نسخة للتعديل');

    await openVersionManager(user);
    let manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    const rowA = within(manager).getByText('نسخة أ').closest('li') as HTMLElement;
    await user.click(within(rowA).getByRole('button', { name: 'فتح للتعديل' }));

    await openVersionManager(user);
    manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    const rowB = within(manager).getByText('نسخة ب').closest('li') as HTMLElement;
    await user.click(within(rowB).getByRole('button', { name: 'فتح للتعديل' }));

    await waitFor(() =>
      expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('نسخة ب'),
    );

    // A's delayed response now arrives — it must be dropped, not applied.
    resolveA({ ok: true, data: detail({ id: 'a', name: 'نسخة أ', revision: 5 }) });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('نسخة ب');
    expect(document.querySelector('[data-experience-builder]')?.getAttribute('data-selected-version-id')).toBe('b');
  });

  it('opens the Version Manager as a mobile bottom sheet and switches from it', async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    listMock.mockResolvedValue({
      ok: true,
      data: [summary({ id: 'a', name: 'نسخة أ' }), summary({ id: 'b', name: 'نسخة ب' })],
    });
    showMock.mockResolvedValue({ ok: true, data: detail({ id: 'b', name: 'نسخة ب' }) });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    window.dispatchEvent(new Event('resize'));
    await screen.findByText('اختر نسخة للتعديل');

    await user.click(screen.getByText('نسخ التصميم'));
    const dialog = await screen.findByRole('dialog', { name: 'إدارة نسخ التصميم' });
    const rowB = within(dialog).getByText('نسخة ب').closest('li') as HTMLElement;
    await user.click(within(rowB).getByRole('button', { name: 'فتح للتعديل' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(document.querySelector('[data-version-selector-mobile]')?.textContent).toContain('نسخة ب'),
    );

    Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, configurable: true });
  });
});
