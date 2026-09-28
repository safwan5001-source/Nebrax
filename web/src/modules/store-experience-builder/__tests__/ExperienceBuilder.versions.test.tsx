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

  it('truncates the generated draft name to the server\'s 120-character limit instead of sending an invalid request (codex round 12)', async () => {
    const longName = 'أ'.repeat(118); // "مسودة من " (9 chars) + 118 = 127, over the limit
    listMock.mockResolvedValue({ ok: true, data: [summary({ id: 'pub-1', name: longName, state: 'published' })] });
    showMock.mockResolvedValue({ ok: true, data: detail({ id: 'pub-1', name: longName, state: 'published' }) });
    createMock.mockResolvedValue({
      ok: true,
      data: detail({ id: 'draft-2', name: 'مسودة', state: 'draft', revision: 1 }),
    });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'إنشاء مسودة من هذه النسخة' }));

    await waitFor(() => expect(createMock).toHaveBeenCalled());
    const sentName = createMock.mock.calls[0][1] as string;
    expect(sentName.length).toBeLessThanOrEqual(120);
    expect(sentName.startsWith('مسودة من ')).toBe(true);
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

  it("a create for a previous storefront resolving late does not clear a newer storefront's own creating flag (codex round 4)", async () => {
    listMock.mockResolvedValue({ ok: true, data: [] });
    let resolveA: (value: unknown) => void = () => {};
    let resolveB: (value: unknown) => void = () => {};
    createMock.mockImplementation((storefrontId: string) =>
      storefrontId === 'store-a'
        ? new Promise((resolve) => { resolveA = resolve; })
        : new Promise((resolve) => { resolveB = resolve; }),
    );
    const createButton = () => within(emptyStatePanel()).getByRole('button', { name: /إنشاء أول نسخة|جاري الإنشاء/ });
    const user = userEvent.setup();
    const { rerender } = render(<ExperienceBuilder storefrontId="store-a" initialLocale="ar" />);
    await waitFor(() => expect(document.querySelector('[data-version-empty-state]')).toBeTruthy());

    await user.type(within(emptyStatePanel()).getByPlaceholderText('مثال: رمضان ١٤٤٨'), 'أ');
    await user.click(createButton());
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));

    // Move on to store B before A's create ever resolves.
    rerender(<ExperienceBuilder storefrontId="store-b" initialLocale="ar" />);
    await waitFor(() => expect(document.querySelector('[data-version-empty-state]')).toBeTruthy());
    await user.type(within(emptyStatePanel()).getByPlaceholderText('مثال: رمضان ١٤٤٨'), 'ب');
    await user.click(createButton());
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(2));
    expect((createButton() as HTMLButtonElement).disabled).toBe(true);

    // A's stale create now resolves — it must not clear B's own creating flag.
    resolveA({ ok: true, data: detail({ id: 'a-1', name: 'أ', revision: 1 }) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((createButton() as HTMLButtonElement).disabled).toBe(true);

    resolveB({ ok: true, data: detail({ id: 'b-1', name: 'ب', revision: 1 }) });
    await waitFor(() =>
      expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('ب'),
    );
  });

  it('an edit made while a create is still pending is not discarded when the create resolves (codex round 4)', async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary({ id: 'a', name: 'نسخة أ', revision: 0 })] });
    showMock.mockResolvedValue({ ok: true, data: detail({ id: 'a', name: 'نسخة أ', revision: 0 }) });
    let resolveCreate: (value: unknown) => void = () => {};
    createMock.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    // The draft is clean when creation starts — no discard confirmation needed.
    await openVersionManager(user);
    await user.click(screen.getByRole('button', { name: '+ نسخة جديدة' }));
    await user.type(screen.getByPlaceholderText('مثال: رمضان ١٤٤٨'), 'نسخة جديدة');
    await user.click(screen.getByRole('button', { name: 'إنشاء' }));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));

    // The merchant keeps editing version A while that create POST is pending —
    // nothing in the UI blocks it, and no switch (which would bump the token)
    // has happened, so this edit alone must still protect A from being
    // silently replaced by the new version's content.
    await user.click(screen.getByRole('button', { name: 'التوثيق والثقة' }));
    await user.type(screen.getAllByRole('textbox')[0], 'تعديل أثناء الإنشاء');

    resolveCreate({ ok: true, data: detail({ id: 'new-1', name: 'نسخة جديدة', revision: 1 }) });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('نسخة أ');
    expect((screen.getAllByRole('textbox')[0] as HTMLInputElement).value).toBe('تعديل أثناء الإنشاء');
  });

  it("adopting a newly created version clears a still-pending save's stuck busy state (codex round 4)", async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary({ id: 'a', name: 'نسخة أ', revision: 0 })] });
    showMock.mockResolvedValue({ ok: true, data: detail({ id: 'a', name: 'نسخة أ', revision: 0 }) });
    let resolveSave: (value: unknown) => void = () => {};
    saveMock.mockReturnValue(new Promise((resolve) => { resolveSave = resolve; }));
    createMock.mockResolvedValue({ ok: true, data: detail({ id: 'new-1', name: 'نسخة جديدة', revision: 1 }) });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    // Dirty A, save it — never resolves yet.
    await user.click(screen.getByRole('button', { name: 'التوثيق والثقة' }));
    await user.type(screen.getAllByRole('textbox')[0], 'تعديل');
    await user.click(screen.getByRole('button', { name: 'حفظ المسودة' }));
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));

    // While A's save is still in flight, the merchant creates (confirming the
    // discard of A's unsaved edit) a brand-new version.
    await openVersionManager(user);
    await user.click(screen.getByRole('button', { name: '+ نسخة جديدة' }));
    await user.type(screen.getByPlaceholderText('مثال: رمضان ١٤٤٨'), 'نسخة جديدة');
    await user.click(screen.getByRole('button', { name: 'إنشاء' }));
    await waitFor(() =>
      expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('نسخة جديدة'),
    );

    // A's now-superseded save resolves — it must not leave the newly opened
    // version's Save button stuck disabled forever.
    resolveSave({ ok: true, data: detail({ id: 'a', name: 'نسخة أ', revision: 1 }) });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByRole('button', { name: 'حفظ المسودة' })).toHaveProperty('disabled', false);

    confirmSpy.mockRestore();
  });

  it('pressing Enter to submit a reopened manager create form while an earlier create is pending does not send a duplicate request (codex round 5)', async () => {
    listMock.mockResolvedValue({ ok: true, data: [] });
    let resolveCreate: (value: unknown) => void = () => {};
    createMock.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(document.querySelector('[data-version-empty-state]')).toBeTruthy());

    await openVersionManager(user);
    const manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    await user.click(within(manager).getByRole('button', { name: '+ نسخة جديدة' }));
    await user.type(within(manager).getByPlaceholderText('مثال: رمضان ١٤٤٨'), 'الأولى');
    await user.click(within(manager).getByRole('button', { name: 'إنشاء' }));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));

    // Submitting closed the form — reopen it (the toggle button itself has no
    // `creating` guard) while the first create is still pending, and try
    // submitting a second one via Enter instead of the (disabled) button.
    await user.click(within(manager).getByRole('button', { name: '+ نسخة جديدة' }));
    const input = within(manager).getByPlaceholderText('مثال: رمضان ١٤٤٨');
    await user.type(input, 'الثانية');
    await user.type(input, '{Enter}');
    expect(createMock).toHaveBeenCalledTimes(1);

    resolveCreate({ ok: true, data: detail({ id: 'new-1', name: 'الأولى', revision: 1 }) });
    await waitFor(() =>
      expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('الأولى'),
    );
  });

  it("opening a version while its own delete is still pending is blocked (codex round 5)", async () => {
    listMock.mockResolvedValue({
      ok: true,
      data: [summary({ id: 'a', name: 'الحالية' }), summary({ id: 'b', name: 'نسخة قديمة' })],
    });
    let resolveDelete: (value: unknown) => void = () => {};
    deleteMock.mockReturnValue(new Promise((resolve) => { resolveDelete = resolve; }));
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await screen.findByText('اختر نسخة للتعديل');

    await openVersionManager(user);
    const manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    const row = within(manager).getByText('نسخة قديمة').closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'حذف' }));
    await user.click(within(row).getByRole('button', { name: 'حذف النسخة' }));

    // The confirmation step dismisses immediately, but the DELETE request
    // itself is still pending — Open must stay disabled until it settles,
    // or the merchant could open a version that no longer exists by the
    // time its own GET resolves.
    expect(
      (within(row).getByRole('button', { name: 'فتح للتعديل' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    resolveDelete({ ok: true });
    await waitFor(() => expect(screen.queryByText('نسخة قديمة')).toBeNull());
  });

  it("switching storefronts while a rename-conflict's list refresh is pending does not apply the conflict to the new store (codex round 5)", async () => {
    let resolveStaleRefresh: (value: unknown) => void = () => {};
    listMock
      // 1st call: initial mount for store-1.
      .mockResolvedValueOnce({ ok: true, data: [summary({ id: 'a', name: 'نسخة أ', revision: 0 })] })
      // 2nd call: the rename conflict's own refresh for store-1 — kept
      // pending so the merchant can move on to store-2 before it resolves.
      .mockImplementationOnce(() => new Promise((resolve) => { resolveStaleRefresh = resolve; }))
      // 3rd call: initial mount for store-2, after the storefront switch.
      .mockResolvedValueOnce({ ok: true, data: [summary({ id: 'x', name: 'نسخة المتجر الثاني' })] });
    showMock.mockImplementation((_storefrontId: string, versionId: string) =>
      Promise.resolve({
        ok: true,
        data: versionId === 'a'
          ? detail({ id: 'a', name: 'نسخة أ', revision: 0 })
          : detail({ id: 'x', name: 'نسخة المتجر الثاني' }),
      }),
    );
    renameMock.mockResolvedValue({ ok: false, reason: 'conflict', message: 'stale' });
    const user = userEvent.setup();
    const { rerender } = render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() =>
      expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('نسخة أ'),
    );

    await openVersionManager(user);
    await user.click(screen.getByRole('button', { name: 'إعادة تسمية' }));
    await user.clear(screen.getByLabelText('اسم النسخة'));
    await user.type(screen.getByLabelText('اسم النسخة'), 'اسم جديد');
    await user.click(screen.getByRole('button', { name: 'حفظ الاسم' }));
    await waitFor(() => expect(renameMock).toHaveBeenCalledTimes(1));

    // The conflict's own list refresh (2nd listMock call, for store-1) is
    // still pending when the merchant moves on to an entirely different store.
    rerender(<ExperienceBuilder storefrontId="store-2" initialLocale="ar" />);
    await waitFor(() =>
      expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('نسخة المتجر الثاني'),
    );

    // The stale refresh now finally resolves — it must not install a
    // conflict banner (scoped to store-1's version 'a') over store-2's
    // unrelated, freshly opened version.
    resolveStaleRefresh({ ok: true, data: [summary({ id: 'a', name: 'اسم جديد', revision: 1 })] });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(
      screen.getByLabelText('نسخة التصميم قيد التعديل').textContent,
    ).toContain('نسخة المتجر الثاني');
  });

  it("a pending delete on one row blocks starting a new write on another row until it settles (codex round 6)", async () => {
    listMock.mockResolvedValue({
      ok: true,
      data: [summary({ id: 'a', name: 'الحالية' }), summary({ id: 'b', name: 'نسخة قديمة' })],
    });
    let resolveDelete: (value: unknown) => void = () => {};
    deleteMock.mockReturnValue(new Promise((resolve) => { resolveDelete = resolve; }));
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await screen.findByText('اختر نسخة للتعديل');

    await openVersionManager(user);
    const manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    const rowB = within(manager).getByText('نسخة قديمة').closest('li') as HTMLElement;
    await user.click(within(rowB).getByRole('button', { name: 'حذف' }));
    await user.click(within(rowB).getByRole('button', { name: 'حذف النسخة' }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledTimes(1));

    // `versionBusy` is a single shared slot — starting a write on a
    // different row while B's delete is in flight would silently steal it,
    // hiding B's own pending delete from its Open button.
    const rowA = within(manager).getByText('الحالية').closest('li') as HTMLElement;
    expect(
      (within(rowA).getByRole('button', { name: 'إعادة تسمية' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (within(rowB).getByRole('button', { name: 'فتح للتعديل' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    resolveDelete({ ok: true });
    await waitFor(() => expect(screen.queryByText('نسخة قديمة')).toBeNull());
    expect(
      (within(rowA).getByRole('button', { name: 'إعادة تسمية' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('a successful retry after a failed initial list load auto-selects a single eligible version and clears the stale error (codex round 6)', async () => {
    listMock
      .mockResolvedValueOnce({ ok: false, reason: 'failed', message: 'boom' })
      .mockResolvedValueOnce({ ok: true, data: [summary({ id: 'a', name: 'نسخة أ' })] });
    showMock.mockResolvedValue({ ok: true, data: detail({ id: 'a', name: 'نسخة أ' }) });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    // The same error string also shows in the always-present (but closed)
    // toolbar manager panel and in the top notice bar (plain text, no retry
    // button of its own) — only the visible `InspectorStatusMessage`'s own
    // `<p>` sits next to the retry button this test needs.
    const visibleErrorParagraph = () =>
      screen
        .queryAllByText('تعذّر تحميل نسخ التصميم. أعد المحاولة.')
        .find((el) => el.tagName === 'P' && !el.closest('[aria-hidden="true"]')) ?? null;
    await waitFor(() => expect(visibleErrorParagraph()).toBeTruthy());
    const retryButton = visibleErrorParagraph()!.closest('div')!.querySelector('button') as HTMLButtonElement;

    await user.click(retryButton);

    // A successful retry must run the same deterministic auto-selection the
    // initial mount uses — not just refresh the (otherwise unreachable) list.
    await waitFor(() =>
      expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('نسخة أ'),
    );
    expect(visibleErrorParagraph()).toBeNull();
  });

  it('switching storefronts while a delete-conflict list refresh is pending does not apply the notice to the new store (codex round 6)', async () => {
    let resolveStaleRefresh: (value: unknown) => void = () => {};
    listMock
      .mockResolvedValueOnce({
        ok: true,
        data: [summary({ id: 'a', name: 'نسخة أ', revision: 0 }), summary({ id: 'b', name: 'نسخة ب', revision: 0 })],
      })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveStaleRefresh = resolve; }))
      .mockResolvedValueOnce({ ok: true, data: [summary({ id: 'x', name: 'نسخة المتجر الثاني' })] });
    showMock.mockImplementation((_storefrontId: string, versionId: string) =>
      Promise.resolve({
        ok: true,
        data: versionId === 'a'
          ? detail({ id: 'a', name: 'نسخة أ', revision: 0 })
          : versionId === 'x'
            ? detail({ id: 'x', name: 'نسخة المتجر الثاني' })
            : detail({ id: 'b', name: 'نسخة ب', revision: 0 }),
      }),
    );
    deleteMock.mockResolvedValue({ ok: false, reason: 'lifecycle_conflict', message: 'blocked' });
    const user = userEvent.setup();
    const { rerender } = render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await screen.findByText('اختر نسخة للتعديل');

    // Two drafts is ambiguous (no auto-select) — open A explicitly so B (not
    // the open version) is the one eligible to delete.
    await openVersionManager(user);
    let manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    const rowA = within(manager).getByText('نسخة أ').closest('li') as HTMLElement;
    await user.click(within(rowA).getByRole('button', { name: 'فتح للتعديل' }));
    await waitFor(() =>
      expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('نسخة أ'),
    );

    await openVersionManager(user);
    manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    const rowB = within(manager).getByText('نسخة ب').closest('li') as HTMLElement;
    await user.click(within(rowB).getByRole('button', { name: 'حذف' }));
    await user.click(within(rowB).getByRole('button', { name: 'حذف النسخة' }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledTimes(1));

    // The delete conflict's own list refresh (2nd listMock call, store-1) is
    // still pending when the merchant moves on to a different store.
    rerender(<ExperienceBuilder storefrontId="store-2" initialLocale="ar" />);
    await waitFor(() =>
      expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('نسخة المتجر الثاني'),
    );

    resolveStaleRefresh({ ok: true, data: [summary({ id: 'a', name: 'نسخة أ', revision: 0 })] });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Store-1's delete-conflict notice must not land on store-2's editor.
    expect(screen.queryByText(/لم يعد بالإمكان حذف/)).toBeNull();
    expect(
      screen.getByLabelText('نسخة التصميم قيد التعديل').textContent,
    ).toContain('نسخة المتجر الثاني');
  });

  it('an edit made to the still-open version while switching to another is not discarded when the switch resolves (codex round 7)', async () => {
    listMock.mockResolvedValue({
      ok: true,
      data: [summary({ id: 'a', name: 'نسخة أ', revision: 0 }), summary({ id: 'b', name: 'نسخة ب', revision: 0 })],
    });
    let resolveShowB: (value: unknown) => void = () => {};
    showMock.mockImplementation((_storefrontId: string, versionId: string) =>
      versionId === 'a'
        ? Promise.resolve({ ok: true, data: detail({ id: 'a', name: 'نسخة أ', revision: 0 }) })
        : new Promise((resolve) => { resolveShowB = resolve; }),
    );
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

    // Start switching to B — its GET never resolves during this test.
    await openVersionManager(user);
    manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    const rowB = within(manager).getByText('نسخة ب').closest('li') as HTMLElement;
    await user.click(within(rowB).getByRole('button', { name: 'فتح للتعديل' }));

    // Nothing blocks editing A's still-open panel while B's GET is pending.
    await user.click(screen.getByRole('button', { name: 'التوثيق والثقة' }));
    await user.type(screen.getAllByRole('textbox')[0], 'تعديل أثناء التبديل');

    resolveShowB({ ok: true, data: detail({ id: 'b', name: 'نسخة ب', revision: 0 }) });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The editor must stay on A with the newer edit intact — not silently
    // switched to B, discarding it.
    expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('نسخة أ');
    expect((screen.getAllByRole('textbox')[0] as HTMLInputElement).value).toBe('تعديل أثناء التبديل');
  });

  it("deleting a version whose own switch is still loading is blocked (codex round 7)", async () => {
    listMock.mockResolvedValue({
      ok: true,
      data: [summary({ id: 'a', name: 'نسخة أ', revision: 0 }), summary({ id: 'b', name: 'نسخة ب', revision: 0 })],
    });
    let resolveShowB: (value: unknown) => void = () => {};
    showMock.mockImplementation((_storefrontId: string, versionId: string) =>
      versionId === 'a'
        ? Promise.resolve({ ok: true, data: detail({ id: 'a', name: 'نسخة أ', revision: 0 }) })
        : new Promise((resolve) => { resolveShowB = resolve; }),
    );
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await screen.findByText('اختر نسخة للتعديل');

    await openVersionManager(user);
    let manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    const rowB = within(manager).getByText('نسخة ب').closest('li') as HTMLElement;
    await user.click(within(rowB).getByRole('button', { name: 'فتح للتعديل' }));

    // B's GET is still pending — its own Delete trigger must stay disabled,
    // or a successful delete could race the GET and leave the editor
    // pointed at a version that no longer exists.
    await openVersionManager(user);
    manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    const rowBAgain = within(manager).getByText('نسخة ب').closest('li') as HTMLElement;
    expect(
      (within(rowBAgain).getByRole('button', { name: 'حذف' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    resolveShowB({ ok: true, data: detail({ id: 'b', name: 'نسخة ب', revision: 0 }) });
    await waitFor(() =>
      expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('نسخة ب'),
    );
  });

  it('a pending rename on one row blocks starting a delete on another until it settles (codex round 7)', async () => {
    listMock.mockResolvedValue({
      ok: true,
      data: [summary({ id: 'a', name: 'نسخة أ', revision: 0 }), summary({ id: 'b', name: 'نسخة ب', revision: 0 })],
    });
    let resolveRename: (value: unknown) => void = () => {};
    renameMock.mockReturnValue(new Promise((resolve) => { resolveRename = resolve; }));
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await screen.findByText('اختر نسخة للتعديل');

    await openVersionManager(user);
    const manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    const rowA = within(manager).getByText('نسخة أ').closest('li') as HTMLElement;
    await user.click(within(rowA).getByRole('button', { name: 'إعادة تسمية' }));
    await user.clear(within(rowA).getByLabelText('اسم النسخة'));
    await user.type(within(rowA).getByLabelText('اسم النسخة'), 'اسم جديد لأ');
    await user.click(within(rowA).getByRole('button', { name: 'حفظ الاسم' }));
    await waitFor(() => expect(renameMock).toHaveBeenCalledTimes(1));

    // A's rename is still pending — starting a delete on B must be blocked
    // outright, not merely allowed to race A's completion for the shared
    // `versionBusy` slot.
    const rowB = within(manager).getByText('نسخة ب').closest('li') as HTMLElement;
    expect(
      (within(rowB).getByRole('button', { name: 'حذف' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    resolveRename({ ok: true, data: detail({ id: 'a', name: 'اسم جديد لأ', revision: 1 }) });
    await waitFor(() =>
      expect((within(rowB).getByRole('button', { name: 'حذف' }) as HTMLButtonElement).disabled).toBe(false),
    );
  });

  it('retrying a failed background list refresh does not discard the dirty draft of the still-open version (codex round 8)', async () => {
    listMock
      .mockResolvedValueOnce({ ok: true, data: [summary({ id: 'a', name: 'نسخة أ', revision: 0 })] })
      .mockResolvedValueOnce({ ok: false, reason: 'failed', message: 'boom' })
      .mockResolvedValueOnce({ ok: true, data: [summary({ id: 'a', name: 'نسخة أ', revision: 1 })] });
    showMock.mockResolvedValue({ ok: true, data: detail({ id: 'a', name: 'نسخة أ', revision: 0 }) });
    renameMock.mockResolvedValue({ ok: false, reason: 'conflict', message: 'stale' });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'التوثيق والثقة' }));
    await user.type(screen.getAllByRole('textbox')[0], 'تعديل غير محفوظ');

    // A rename conflict's own list refresh fails, leaving the manager's list
    // in an error state while A stays open with the unsaved edit above.
    await openVersionManager(user);
    await user.click(screen.getByRole('button', { name: 'إعادة تسمية' }));
    await user.clear(screen.getByLabelText('اسم النسخة'));
    await user.type(screen.getByLabelText('اسم النسخة'), 'اسم آخر');
    await user.click(screen.getByRole('button', { name: 'حفظ الاسم' }));
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));

    // Retry (the manager panel's own — a version is still open, so the
    // inspector-body retry never shows) must not silently re-select/reload
    // and discard the dirty draft.
    const manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    await user.click(within(manager).getByRole('button', { name: 'تحديث النسخة' }));
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(3));

    expect((screen.getAllByRole('textbox')[0] as HTMLInputElement).value).toBe('تعديل غير محفوظ');
    expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('نسخة أ');
  });

  it('an edit made while the conflict-reload GET is pending is not discarded when it resolves (codex round 8)', async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary({ id: 'a', name: 'نسخة أ', revision: 0 })] });
    let resolveReload: (value: unknown) => void = () => {};
    showMock
      .mockResolvedValueOnce({ ok: true, data: detail({ id: 'a', name: 'نسخة أ', revision: 0 }) })
      .mockReturnValueOnce(new Promise((resolve) => { resolveReload = resolve; }));
    renameMock.mockResolvedValue({ ok: false, reason: 'conflict', message: 'stale' });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(1));

    await openVersionManager(user);
    await user.click(screen.getByRole('button', { name: 'إعادة تسمية' }));
    await user.clear(screen.getByLabelText('اسم النسخة'));
    await user.type(screen.getByLabelText('اسم النسخة'), 'اسم جديد');
    await user.click(screen.getByRole('button', { name: 'حفظ الاسم' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'تحديث النسخة' })).toBeTruthy());

    // Click reload — its GET never resolves during this test.
    await user.click(screen.getByRole('button', { name: 'تحديث النسخة' }));
    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(2));

    // Nothing blocks editing while the reload's own GET is still pending.
    await user.click(screen.getByRole('button', { name: 'التوثيق والثقة' }));
    await user.type(screen.getAllByRole('textbox')[0], 'تعديل أثناء التحديث');

    resolveReload({ ok: true, data: detail({ id: 'a', name: 'نسخة من جلسة أخرى', revision: 3 }) });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The reload click only confirms discarding what was already dirty when
    // it was clicked — not this newer edit made while it was in flight.
    expect((screen.getAllByRole('textbox')[0] as HTMLInputElement).value).toBe('تعديل أثناء التحديث');
  });

  it('a pending rename on a row blocks starting a delete on the same row (codex round 8)', async () => {
    listMock.mockResolvedValue({
      ok: true,
      data: [summary({ id: 'a', name: 'نسخة أ', revision: 0 }), summary({ id: 'b', name: 'نسخة ب', revision: 0 })],
    });
    let resolveRename: (value: unknown) => void = () => {};
    renameMock.mockReturnValue(new Promise((resolve) => { resolveRename = resolve; }));
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await screen.findByText('اختر نسخة للتعديل');

    await openVersionManager(user);
    const manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    const row = within(manager).getByText('نسخة أ').closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'إعادة تسمية' }));
    await user.clear(within(row).getByLabelText('اسم النسخة'));
    await user.type(within(row).getByLabelText('اسم النسخة'), 'اسم جديد');
    await user.click(within(row).getByRole('button', { name: 'حفظ الاسم' }));
    await waitFor(() => expect(renameMock).toHaveBeenCalledTimes(1));

    // Submitting returned this row's own action bar to view (`mode` resets
    // synchronously) even though the rename is still pending in the
    // background — Delete on this same row must stay blocked.
    expect(
      (within(row).getByRole('button', { name: 'حذف' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    resolveRename({ ok: true, data: detail({ id: 'a', name: 'اسم جديد', revision: 1 }) });
    await waitFor(() =>
      expect((within(row).getByRole('button', { name: 'حذف' }) as HTMLButtonElement).disabled).toBe(false),
    );
  });

  it('switching the storefront to null resets the previously open version and draft (codex round 8)', async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary({ id: 'a', name: 'نسخة أ', revision: 0 })] });
    showMock.mockResolvedValue({ ok: true, data: detail({ id: 'a', name: 'نسخة أ', revision: 0 }) });
    const { rerender } = render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() =>
      expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('نسخة أ'),
    );

    rerender(<ExperienceBuilder storefrontId={null} initialLocale="ar" />);

    // No storefront selected is the pre-CUST-H1-2 local-only editing mode —
    // it must not keep showing store-1's version identity.
    expect(
      document.querySelector('[data-experience-builder]')?.getAttribute('data-selected-version-id'),
    ).toBe('');
    expect(screen.queryByLabelText('نسخة التصميم قيد التعديل')).toBeNull();
    expect(screen.queryByText('نسخة أ')).toBeNull();
  });

  it("a reload whose GET fails leaves the conflict block in place instead of silently clearing it (codex round 9)", async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary({ id: 'a', name: 'نسخة أ', revision: 0 })] });
    showMock
      .mockResolvedValueOnce({ ok: true, data: detail({ id: 'a', name: 'نسخة أ', revision: 0 }) })
      .mockResolvedValueOnce({ ok: false, reason: 'failed', message: 'network' });
    renameMock.mockResolvedValue({ ok: false, reason: 'conflict', message: 'stale' });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(1));

    await openVersionManager(user);
    await user.click(screen.getByRole('button', { name: 'إعادة تسمية' }));
    await user.clear(screen.getByLabelText('اسم النسخة'));
    await user.type(screen.getByLabelText('اسم النسخة'), 'اسم جديد');
    await user.click(screen.getByRole('button', { name: 'حفظ الاسم' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'تحديث النسخة' })).toBeTruthy());
    expect(screen.getByRole('button', { name: 'حفظ المسودة' })).toHaveProperty('disabled', true);

    await user.click(screen.getByRole('button', { name: 'تحديث النسخة' }));
    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(2));

    // The reload's own GET failed — the stale local draft/revision is still
    // what's open, so the conflict block must stay in place, not be cleared
    // just because a reload was attempted.
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'حفظ المسودة' })).toHaveProperty('disabled', true);
  });

  it("an edit made during a conflict reload leaves the conflict block in place once the fetch resolves (codex round 9)", async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary({ id: 'a', name: 'نسخة أ', revision: 0 })] });
    let resolveReload: (value: unknown) => void = () => {};
    showMock
      .mockResolvedValueOnce({ ok: true, data: detail({ id: 'a', name: 'نسخة أ', revision: 0 }) })
      .mockReturnValueOnce(new Promise((resolve) => { resolveReload = resolve; }));
    renameMock.mockResolvedValue({ ok: false, reason: 'conflict', message: 'stale' });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(1));

    await openVersionManager(user);
    await user.click(screen.getByRole('button', { name: 'إعادة تسمية' }));
    await user.clear(screen.getByLabelText('اسم النسخة'));
    await user.type(screen.getByLabelText('اسم النسخة'), 'اسم جديد');
    await user.click(screen.getByRole('button', { name: 'حفظ الاسم' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'تحديث النسخة' })).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'تحديث النسخة' }));
    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(2));

    // The merchant edits again while the reload's own GET is still pending.
    await user.click(screen.getByRole('button', { name: 'التوثيق والثقة' }));
    await user.type(screen.getAllByRole('textbox')[0], 'تعديل أثناء التحديث');

    resolveReload({ ok: true, data: detail({ id: 'a', name: 'نسخة من جلسة أخرى', revision: 3 }) });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The fetched (now-current) detail was not adopted — this newer edit was
    // protected — so the conflict must not be reported resolved either;
    // otherwise a rename from the refreshed list row, or another Save, could
    // advance selectedVersion's revision without ever having pulled the
    // fetched config into draft, overwriting the other session silently.
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'حفظ المسودة' })).toHaveProperty('disabled', true);
  });

  it("a first create resolving after an A→B→A switch does not re-enable creation while a second A create is still pending (codex round 9)", async () => {
    // Each store already has one open version, so `selectedVersion` stays
    // non-null throughout — the stale first create's late list update (below)
    // cannot flip the screen between empty/choose states and hide the panel
    // this test observes.
    listMock.mockImplementation((storefrontId: string) =>
      Promise.resolve({
        ok: true,
        data: [
          storefrontId === 'store-a'
            ? summary({ id: 'a', name: 'نسخة أ', revision: 0 })
            : summary({ id: 'b', storefrontId: 'store-b', name: 'نسخة ب', revision: 0 }),
        ],
      }),
    );
    showMock.mockImplementation((storefrontId: string, versionId: string) =>
      Promise.resolve({
        ok: true,
        data: versionId === 'a'
          ? detail({ id: 'a', name: 'نسخة أ', revision: 0 })
          : detail({ id: 'b', storefrontId: 'store-b', name: 'نسخة ب', revision: 0 }),
      }),
    );
    let resolveFirstA: (value: unknown) => void = () => {};
    const secondA = new Promise(() => {}); // never resolves during this test
    createMock
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirstA = resolve; })) // first A create
      .mockImplementationOnce(() => secondA); // second A create
    const user = userEvent.setup();
    const { rerender } = render(<ExperienceBuilder storefrontId="store-a" initialLocale="ar" />);
    await waitFor(() =>
      expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('نسخة أ'),
    );

    // Start a create for store A — it never resolves during this test.
    await openVersionManager(user);
    await user.click(screen.getByRole('button', { name: '+ نسخة جديدة' }));
    await user.type(screen.getByPlaceholderText('مثال: رمضان ١٤٤٨'), 'نسخة ثانية أولى');
    await user.click(screen.getByRole('button', { name: 'إنشاء' }));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));

    // Switch away to B, then back to A — the mount effect resets
    // `versionCreating` and bumps the request token on each switch alone,
    // with no B-side create involved.
    rerender(<ExperienceBuilder storefrontId="store-b" initialLocale="ar" />);
    await waitFor(() =>
      expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('نسخة ب'),
    );
    rerender(<ExperienceBuilder storefrontId="store-a" initialLocale="ar" />);
    await waitFor(() =>
      expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('نسخة أ'),
    );

    // Start a second, genuinely new create for A. The form auto-closes on
    // submit (`submitCreate` resets `showCreateForm`), so the pending state
    // isn't visible on this button anymore — reopen the form afterward to
    // inspect the `creating` prop it's bound to.
    if (!screen.queryByRole('menu', { name: 'إدارة نسخ التصميم' })) {
      await openVersionManager(user);
    }
    await user.click(screen.getByRole('button', { name: '+ نسخة جديدة' }));
    await user.type(screen.getByPlaceholderText('مثال: رمضان ١٤٤٨'), 'نسخة ثانية');
    expect(screen.getByRole('button', { name: 'إنشاء' })).toHaveProperty('disabled', false);
    await user.click(screen.getByRole('button', { name: 'إنشاء' }));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(2));

    // Reopen the form (with a name typed, so only the `creating` prop gates
    // the button) while the second request is still outstanding.
    await user.click(screen.getByRole('button', { name: '+ نسخة جديدة' }));
    await user.type(screen.getByPlaceholderText('مثال: رمضان ١٤٤٨'), 'فحص');
    expect(screen.getByRole('button', { name: /إنشاء|جاري الإنشاء/ })).toHaveProperty('disabled', true);

    // The first (stale) A create now resolves. Storefront equality alone
    // would satisfy its "same store" check (we're back on A) and clear the
    // creating flag — re-enabling the create controls (this same button,
    // still showing the name typed above) while the second A request is
    // still outstanding, permitting an unintended third create.
    resolveFirstA({ ok: true, data: detail({ id: 'stale-first', name: 'نسخة ثانية أولى', revision: 0 }) });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByRole('button', { name: /إنشاء|جاري الإنشاء/ })).toHaveProperty('disabled', true);
  });

  it("the published-version \"create draft\" action is blocked while any other row write is pending, not only a duplicate (codex round 10)", async () => {
    listMock.mockResolvedValue({
      ok: true,
      data: [
        summary({ id: 'pub-1', name: 'الحالية', state: 'published' }),
        summary({ id: 'draft-1', name: 'مسودة أخرى', revision: 0 }),
      ],
    });
    showMock.mockImplementation((_storefrontId: string, versionId: string) =>
      Promise.resolve({
        ok: true,
        data: versionId === 'pub-1'
          ? detail({ id: 'pub-1', name: 'الحالية', state: 'published' })
          : detail({ id: 'draft-1', name: 'مسودة أخرى', revision: 0 }),
      }),
    );
    renameMock.mockReturnValue(new Promise(() => {})); // never resolves during this test
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    // Two eligible candidates (one published, one draft) is not ambiguous —
    // the draft auto-selects (the published one is never a candidate) —
    // switch explicitly to the published row to exercise its read-only view.
    await waitFor(() =>
      expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('مسودة أخرى'),
    );

    await openVersionManager(user);
    let manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    const pubRow = within(manager).getByText('الحالية').closest('li') as HTMLElement;
    await user.click(within(pubRow).getByRole('button', { name: 'عرض' }));
    await waitFor(() => expect(screen.getByText('هذه النسخة منشورة ومقروءة فقط')).toBeTruthy());
    expect(
      (screen.getByRole('button', { name: 'إنشاء مسودة من هذه النسخة' }) as HTMLButtonElement).disabled,
    ).toBe(false);

    // Start (and leave pending) a rename on the *other* row — unrelated to
    // this published version, and not a duplicate at all.
    await openVersionManager(user);
    manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    const draftRow = within(manager).getByText('مسودة أخرى').closest('li') as HTMLElement;
    await user.click(within(draftRow).getByRole('button', { name: 'إعادة تسمية' }));
    await user.clear(screen.getByLabelText('اسم النسخة'));
    await user.type(screen.getByLabelText('اسم النسخة'), 'اسم جديد');
    await user.click(screen.getByRole('button', { name: 'حفظ الاسم' }));
    await waitFor(() => expect(renameMock).toHaveBeenCalledTimes(1));

    // `versionBusy` is the same single shared slot `handleDuplicateVersion`
    // would write into — starting a duplicate now would race with (and could
    // be silently cleared by) this unrelated rename settling first.
    expect(
      (screen.getByRole('button', { name: 'إنشاء مسودة من هذه النسخة' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("a create resolving after switching to a different already-open version (no new create) still clears the creating flag (codex round 11)", async () => {
    // Regression guard for the round-9 fix itself: gating the flag-clear on
    // the general `versionRequestTokenRef` (bumped by *any* version switch,
    // not only a new create) would leave `versionCreating` stuck `true`
    // forever once the merchant opens a different existing version while a
    // create is still pending — even though nothing else claims the flag.
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
    let resolveCreate: (value: unknown) => void = () => {};
    createMock.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    // Two eligible drafts is ambiguous — open one explicitly.
    await screen.findByText('اختر نسخة للتعديل');
    await openVersionManager(user);
    let manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    let rowA = within(manager).getByText('نسخة أ').closest('li') as HTMLElement;
    await user.click(within(rowA).getByRole('button', { name: 'فتح للتعديل' }));
    await waitFor(() =>
      expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('نسخة أ'),
    );

    // Start a create — it never resolves during this test yet.
    await openVersionManager(user);
    await user.click(screen.getByRole('button', { name: '+ نسخة جديدة' }));
    await user.type(screen.getByPlaceholderText('مثال: رمضان ١٤٤٨'), 'نسخة ثالثة');
    await user.click(screen.getByRole('button', { name: 'إنشاء' }));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));

    // Switch to the *other already-existing* version — no new create
    // involved, only an ordinary version switch (which does bump the
    // general request token). The manager is already open from the create
    // above (submitting only closes its inline form, not the dropdown).
    if (!screen.queryByRole('menu', { name: 'إدارة نسخ التصميم' })) {
      await openVersionManager(user);
    }
    manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    const rowB = within(manager).getByText('نسخة ب').closest('li') as HTMLElement;
    await user.click(within(rowB).getByRole('button', { name: 'فتح للتعديل' }));
    await waitFor(() =>
      expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('نسخة ب'),
    );

    // The create now resolves. It must not force-adopt version B's editor
    // (token mismatch already covers that, tested elsewhere), but it must
    // still clear `versionCreating` — reopening the create form should show
    // it enabled, not stuck disabled forever.
    resolveCreate({ ok: true, data: detail({ id: 'new-1', name: 'نسخة ثالثة', revision: 0 }) });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await openVersionManager(user);
    await user.click(screen.getByRole('button', { name: '+ نسخة جديدة' }));
    await user.type(screen.getByPlaceholderText('مثال: رمضان ١٤٤٨'), 'فحص');
    expect(screen.getByRole('button', { name: 'إنشاء' })).toHaveProperty('disabled', false);
  });

  it("a stale row-write completing after an A→B→A switch does not clear a newer, still-pending row write's busy state (codex round 11)", async () => {
    listMock.mockImplementation((storefrontId: string) =>
      Promise.resolve({
        ok: true,
        data: [
          storefrontId === 'store-a'
            ? summary({ id: 'a', name: 'نسخة أ', revision: 0 })
            : summary({ id: 'b', storefrontId: 'store-b', name: 'نسخة ب', revision: 0 }),
        ],
      }),
    );
    showMock.mockImplementation((storefrontId: string, versionId: string) =>
      Promise.resolve({
        ok: true,
        data: versionId === 'a'
          ? detail({ id: 'a', name: 'نسخة أ', revision: 0 })
          : detail({ id: 'b', storefrontId: 'store-b', name: 'نسخة ب', revision: 0 }),
      }),
    );
    let resolveFirstRename: (value: unknown) => void = () => {};
    renameMock
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirstRename = resolve; })) // first rename on A
      .mockImplementationOnce(() => new Promise(() => {})); // second rename on A, never resolves
    const user = userEvent.setup();
    const { rerender } = render(<ExperienceBuilder storefrontId="store-a" initialLocale="ar" />);
    await waitFor(() =>
      expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('نسخة أ'),
    );

    // Start a rename on A's only row — it never resolves during this test.
    await openVersionManager(user);
    await user.click(screen.getByRole('button', { name: 'إعادة تسمية' }));
    await user.clear(screen.getByLabelText('اسم النسخة'));
    await user.type(screen.getByLabelText('اسم النسخة'), 'محاولة أولى');
    await user.click(screen.getByRole('button', { name: 'حفظ الاسم' }));
    await waitFor(() => expect(renameMock).toHaveBeenCalledTimes(1));

    // Switch away to B, then back to A — the mount effect resets
    // `versionBusy` and bumps the request token, so A's row controls read
    // idle again even though the first rename is still outstanding.
    rerender(<ExperienceBuilder storefrontId="store-b" initialLocale="ar" />);
    await waitFor(() =>
      expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('نسخة ب'),
    );
    rerender(<ExperienceBuilder storefrontId="store-a" initialLocale="ar" />);
    await waitFor(() =>
      expect(screen.getByLabelText('نسخة التصميم قيد التعديل').textContent).toContain('نسخة أ'),
    );

    // Start a second, genuinely new rename on A's row.
    if (!screen.queryByRole('menu', { name: 'إدارة نسخ التصميم' })) {
      await openVersionManager(user);
    }
    await user.click(screen.getByRole('button', { name: 'إعادة تسمية' }));
    await user.clear(screen.getByLabelText('اسم النسخة'));
    await user.type(screen.getByLabelText('اسم النسخة'), 'محاولة ثانية');
    await user.click(screen.getByRole('button', { name: 'حفظ الاسم' }));
    await waitFor(() => expect(renameMock).toHaveBeenCalledTimes(2));

    // The row returns to idle mode on submit (its own trigger buttons
    // reappear), gated by `busy !== null` for this row.
    expect(
      (screen.getByRole('button', { name: 'تكرار النسخة' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    // The first (stale) rename now resolves successfully. Storefront
    // equality alone would satisfy its cleanup check and clear the shared
    // `versionBusy` slot — re-enabling this row's triggers while the second
    // rename is still outstanding, letting a new write start and race it.
    resolveFirstRename({ ok: true, data: detail({ id: 'a', name: 'محاولة أولى', revision: 1 }) });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(
      (screen.getByRole('button', { name: 'تكرار النسخة' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
