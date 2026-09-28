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

  it('pressing Enter repeatedly while the first create is still pending does not send duplicate requests (codex round 3)', async () => {
    listMock.mockResolvedValue({ ok: true, data: [] });
    let resolveCreate: (value: unknown) => void = () => {};
    createMock.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(document.querySelector('[data-version-empty-state]')).toBeTruthy());

    const input = within(emptyStatePanel()).getByPlaceholderText('مثال: رمضان ١٤٤٨');
    await user.type(input, 'رمضان 1448');
    await user.type(input, '{Enter}');
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));

    // The request is still pending — a repeated Enter must not fire another one.
    await user.type(input, '{Enter}');
    expect(createMock).toHaveBeenCalledTimes(1);

    resolveCreate({ ok: true, data: detail({ revision: 1 }) });
    await waitFor(() =>
      expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('رمضان 1448'),
    );
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

  // Review findings (chatgpt-codex-connector, PR #1085) — three related
  // "stale local state after the merchant moved on" races.

  it('switching storefrontId resets the previous store\'s version state instead of leaking it', async () => {
    listMock.mockImplementation((storefrontId: string) =>
      storefrontId === 'store-1'
        ? Promise.resolve({ ok: true, data: [summary({ id: 'a', name: 'نسخة المتجر الأول' })] })
        : Promise.resolve({
            ok: true,
            data: [summary({ id: 'x', name: 'نسخة أ' }), summary({ id: 'y', name: 'نسخة ب' })],
          }),
    );
    showMock.mockResolvedValue({ ok: true, data: detail({ id: 'a', name: 'نسخة المتجر الأول' }) });
    const { rerender } = render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() =>
      expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('نسخة المتجر الأول'),
    );

    // Store 2 has two drafts (ambiguous) — nothing should auto-select, and the
    // first store's version must not linger as the "open" one under the new
    // storefrontId (which would let Save target the wrong store/version pair).
    rerender(<ExperienceBuilder storefrontId="store-2" initialLocale="ar" />);
    await waitFor(() => expect(listMock).toHaveBeenCalledWith('store-2'));

    expect(
      screen.getByLabelText('نسخة التصميم قيد التعديل').textContent,
    ).not.toContain('نسخة المتجر الأول');
    expect(document.querySelector('[data-experience-builder]')?.getAttribute('data-selected-version-id')).toBe('');
    expect(screen.getByRole('button', { name: 'حفظ المسودة' })).toHaveProperty('disabled', true);
    await screen.findByText('اختر نسخة للتعديل');
  });

  it('a rename conflict on the currently open version blocks further save/rename until an explicit reload', async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary({ id: 'a', name: 'قديم', revision: 0 })] });
    showMock
      .mockResolvedValueOnce({ ok: true, data: detail({ id: 'a', name: 'قديم', revision: 0 }) })
      .mockResolvedValueOnce({ ok: true, data: detail({ id: 'a', name: 'اسم من جلسة أخرى', revision: 3 }) });
    renameMock.mockResolvedValue({ ok: false, reason: 'conflict', message: 'stale' });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(1));

    await openVersionManager(user);
    await user.click(screen.getByRole('button', { name: 'إعادة تسمية' }));
    await user.clear(screen.getByLabelText('اسم النسخة'));
    await user.type(screen.getByLabelText('اسم النسخة'), 'اسم جديد');
    await user.click(screen.getByRole('button', { name: 'حفظ الاسم' }));

    await waitFor(() => expect(renameMock).toHaveBeenCalledTimes(1));
    // The row-level list refresh must not silently resync the open editor's
    // stale local revision/content — the save/rename path stays blocked.
    expect(screen.getByRole('button', { name: 'حفظ المسودة' })).toHaveProperty('disabled', true);

    // A retry (same stale local state) must not reach the server again.
    // (The manager is already open from the previous attempt.)
    await user.click(screen.getByRole('button', { name: 'إعادة تسمية' }));
    await user.clear(screen.getByLabelText('اسم النسخة'));
    await user.type(screen.getByLabelText('اسم النسخة'), 'محاولة ثانية');
    await user.click(screen.getByRole('button', { name: 'حفظ الاسم' }));
    expect(renameMock).toHaveBeenCalledTimes(1);

    // Only an explicit reload re-reads the full (now-current) detail and
    // clears the block.
    await user.click(screen.getByRole('button', { name: 'تحديث النسخة' }));
    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('اسم من جلسة أخرى'),
    );
    expect(screen.getByRole('button', { name: 'حفظ المسودة' })).toHaveProperty('disabled', false);
  });

  it('a save that resolves after the merchant switches to another version does not overwrite it', async () => {
    listMock.mockResolvedValue({
      ok: true,
      data: [summary({ id: 'a', name: 'نسخة أ', revision: 0 }), summary({ id: 'b', name: 'نسخة ب', revision: 0 })],
    });
    showMock.mockImplementation((_storefrontId: string, versionId: string) =>
      Promise.resolve({
        ok: true,
        data: versionId === 'a'
          ? detail({ id: 'a', name: 'نسخة أ', revision: 0 })
          : detail({ id: 'b', name: 'نسخة ب', revision: 0 }),
      }),
    );
    let resolveSave: (value: unknown) => void = () => {};
    const pendingSave = new Promise((resolve) => {
      resolveSave = resolve;
    });
    saveMock.mockReturnValue(pendingSave);
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await screen.findByText('اختر نسخة للتعديل');

    await openVersionManager(user);
    let manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    const rowA = within(manager).getByText('نسخة أ').closest('li') as HTMLElement;
    await user.click(within(rowA).getByRole('button', { name: 'فتح للتعديل' }));
    await waitFor(() =>
      expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('نسخة أ'),
    );

    // Save on A is in flight (never resolved yet) when the merchant switches to B.
    await user.click(screen.getByRole('button', { name: 'حفظ المسودة' }));
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));

    await openVersionManager(user);
    manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    const rowB = within(manager).getByText('نسخة ب').closest('li') as HTMLElement;
    await user.click(within(rowB).getByRole('button', { name: 'فتح للتعديل' }));
    await waitFor(() =>
      expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('نسخة ب'),
    );

    // A's save now resolves successfully — it must not pull the editor back to A.
    resolveSave({ ok: true, data: detail({ id: 'a', name: 'نسخة أ', revision: 1 }) });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('نسخة ب');
    expect(document.querySelector('[data-experience-builder]')?.getAttribute('data-selected-version-id')).toBe('b');
    expect(screen.queryByText('تم حفظ النسخة.')).toBeNull();
  });

  it('a rename that completes after switching to another version does not overwrite it (codex round 2)', async () => {
    listMock.mockResolvedValue({
      ok: true,
      data: [summary({ id: 'a', name: 'نسخة أ', revision: 0 }), summary({ id: 'b', name: 'نسخة ب', revision: 0 })],
    });
    showMock.mockImplementation((_storefrontId: string, versionId: string) =>
      Promise.resolve({
        ok: true,
        data: versionId === 'a'
          ? detail({ id: 'a', name: 'نسخة أ', revision: 0 })
          : detail({ id: 'b', name: 'نسخة ب', revision: 0 }),
      }),
    );
    let resolveRename: (value: unknown) => void = () => {};
    renameMock.mockReturnValue(new Promise((resolve) => { resolveRename = resolve; }));
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await screen.findByText('اختر نسخة للتعديل');

    await openVersionManager(user);
    let manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    const rowA = within(manager).getByText('نسخة أ').closest('li') as HTMLElement;
    await user.click(within(rowA).getByRole('button', { name: 'فتح للتعديل' }));
    await waitFor(() =>
      expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('نسخة أ'),
    );

    await openVersionManager(user);
    manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    const rowAAgain = within(manager).getByText('نسخة أ').closest('li') as HTMLElement;
    await user.click(within(rowAAgain).getByRole('button', { name: 'إعادة تسمية' }));
    await user.clear(screen.getByLabelText('اسم النسخة'));
    await user.type(screen.getByLabelText('اسم النسخة'), 'اسم جديد لأ');
    await user.click(screen.getByRole('button', { name: 'حفظ الاسم' }));
    await waitFor(() => expect(renameMock).toHaveBeenCalledTimes(1));

    // Switch to B while A's rename is still in flight. The manager is
    // already open (renaming doesn't close it) — reopening it here would
    // toggle it closed instead.
    manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    const rowB = within(manager).getByText('نسخة ب').closest('li') as HTMLElement;
    await user.click(within(rowB).getByRole('button', { name: 'فتح للتعديل' }));
    await waitFor(() =>
      expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('نسخة ب'),
    );

    // A's rename now resolves successfully — must not pull the editor back to A.
    resolveRename({ ok: true, data: detail({ id: 'a', name: 'اسم جديد لأ', revision: 1 }) });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('نسخة ب');
    expect(document.querySelector('[data-experience-builder]')?.getAttribute('data-selected-version-id')).toBe('b');
  });

  it('a create superseded by a version switch updates only the manager list, not the open editor', async () => {
    listMock.mockResolvedValue({
      ok: true,
      data: [summary({ id: 'a', name: 'نسخة أ' }), summary({ id: 'b', name: 'نسخة ب' })],
    });
    showMock.mockImplementation((_storefrontId: string, versionId: string) =>
      Promise.resolve({
        ok: true,
        data: versionId === 'a' ? detail({ id: 'a', name: 'نسخة أ' }) : detail({ id: 'b', name: 'نسخة ب' }),
      }),
    );
    let resolveCreate: (value: unknown) => void = () => {};
    createMock.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await screen.findByText('اختر نسخة للتعديل');

    await openVersionManager(user);
    let manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    const rowA = within(manager).getByText('نسخة أ').closest('li') as HTMLElement;
    await user.click(within(rowA).getByRole('button', { name: 'فتح للتعديل' }));
    await waitFor(() =>
      expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('نسخة أ'),
    );

    await openVersionManager(user);
    await user.click(screen.getByRole('button', { name: '+ نسخة جديدة' }));
    await user.type(screen.getByPlaceholderText('مثال: رمضان ١٤٤٨'), 'نسخة موسمية');
    await user.click(screen.getByRole('button', { name: 'إنشاء' }));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));

    // Switch to B while the create for a brand-new version is still pending.
    // The manager is already open (submitting the create form doesn't close
    // it) — reopening it here would toggle it closed instead.
    manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    const rowB = within(manager).getByText('نسخة ب').closest('li') as HTMLElement;
    await user.click(within(rowB).getByRole('button', { name: 'فتح للتعديل' }));
    await waitFor(() =>
      expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('نسخة ب'),
    );

    resolveCreate({ ok: true, data: detail({ id: 'new-1', name: 'نسخة موسمية', revision: 1 }) });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The editor must stay on B — the newly created version must not be forced open.
    expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('نسخة ب');
    // But it should still be visible in the manager's list for later opening.
    await openVersionManager(user);
    manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    expect(within(manager).getByText('نسخة موسمية')).toBeTruthy();
  });

  it('switching storefronts before a slower store\'s list response arrives never lets it overwrite the new store\'s list', async () => {
    let resolveStore1List: (value: unknown) => void = () => {};
    const pendingStore1List = new Promise((resolve) => { resolveStore1List = resolve; });
    listMock.mockImplementation((storefrontId: string) =>
      storefrontId === 'store-1'
        ? pendingStore1List
        : Promise.resolve({ ok: true, data: [summary({ id: 'x', name: 'نسخة المتجر الثاني' })] }),
    );
    showMock.mockResolvedValue({ ok: true, data: detail({ id: 'x', name: 'نسخة المتجر الثاني' }) });
    const { rerender } = render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(listMock).toHaveBeenCalledWith('store-1'));

    // Move on to store-2 before store-1's list ever resolves.
    rerender(<ExperienceBuilder storefrontId="store-2" initialLocale="ar" />);
    await waitFor(() =>
      expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('نسخة المتجر الثاني'),
    );

    // store-1's slow response now finally arrives — it must not clobber store-2's list.
    resolveStore1List({ ok: true, data: [summary({ id: 'stale', name: 'نسخة قديمة من متجر آخر' })] });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(
      screen.getByLabelText('نسخة التصميم قيد التعديل').textContent,
    ).toContain('نسخة المتجر الثاني');
  });

  it('creating a new version while the open one has unsaved edits requires confirming the discard first (codex round 3)', async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary({ id: 'a', name: 'نسخة أ', revision: 0 })] });
    showMock.mockResolvedValue({ ok: true, data: detail({ id: 'a', name: 'نسخة أ', revision: 0 }) });
    createMock.mockResolvedValue({ ok: true, data: detail({ id: 'new-1', name: 'نسخة جديدة', revision: 1 }) });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'التوثيق والثقة' }));
    await user.type(screen.getAllByRole('textbox')[0], 'تعديل غير محفوظ');

    // First attempt: declines the discard confirmation — no create request fires.
    await openVersionManager(user);
    await user.click(screen.getByRole('button', { name: '+ نسخة جديدة' }));
    await user.type(screen.getByPlaceholderText('مثال: رمضان ١٤٤٨'), 'نسخة جديدة');
    await user.click(screen.getByRole('button', { name: 'إنشاء' }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(createMock).not.toHaveBeenCalled();
    expect((screen.getAllByRole('textbox')[0] as HTMLInputElement).value).toContain('تعديل غير محفوظ');

    // Second attempt: confirms the discard — the create proceeds and adopts.
    await user.click(screen.getByRole('button', { name: '+ نسخة جديدة' }));
    await user.type(screen.getByPlaceholderText('مثال: رمضان ١٤٤٨'), 'نسخة جديدة');
    await user.click(screen.getByRole('button', { name: 'إنشاء' }));
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('نسخة جديدة'),
    );

    confirmSpy.mockRestore();
  });

  it('duplicating a version while the open one has unsaved edits requires confirming the discard first (codex round 3)', async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary({ id: 'a', name: 'نسخة أ', revision: 0 })] });
    showMock.mockResolvedValue({ ok: true, data: detail({ id: 'a', name: 'نسخة أ', revision: 0 }) });
    createMock.mockResolvedValue({
      ok: true,
      data: detail({ id: 'copy-1', name: 'نسخة من نسخة أ', revision: 1 }),
    });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'التوثيق والثقة' }));
    await user.type(screen.getAllByRole('textbox')[0], 'تعديل غير محفوظ');

    await openVersionManager(user);
    const manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    const rowA = within(manager).getByText('نسخة أ').closest('li') as HTMLElement;

    // First attempt: declines the discard confirmation — no request fires.
    await user.click(within(rowA).getByRole('button', { name: 'تكرار النسخة' }));
    await user.click(within(rowA).getByRole('button', { name: 'إنشاء' }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(createMock).not.toHaveBeenCalled();

    // Second attempt: confirms the discard — the duplicate proceeds and adopts.
    await user.click(within(rowA).getByRole('button', { name: 'تكرار النسخة' }));
    await user.click(within(rowA).getByRole('button', { name: 'إنشاء' }));
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('نسخة من نسخة أ'),
    );

    confirmSpy.mockRestore();
  });
});
