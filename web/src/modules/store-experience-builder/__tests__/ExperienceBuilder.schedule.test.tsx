/**
 * @vitest-environment jsdom
 *
 * CUST-H1-5 — Scheduling UX: toolbar/manager entry points, the schedule
 * dialog's date/time/timezone contract, the exact request shape (version id
 * + revision + opaque schedule token), reschedule prefill, the
 * replace-existing-schedule warning, cancel-schedule as a distinct lifecycle
 * action, failure/conflict UX, the Production runtime gate, and locale.
 * Version CRUD/switching itself is covered by `ExperienceBuilder.versions.test.tsx`;
 * immediate publish by `ExperienceBuilder.publish.test.tsx`.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const listMock = vi.fn();
const showMock = vi.fn();
const createMock = vi.fn();
const saveMock = vi.fn();
const renameMock = vi.fn();
const deleteMock = vi.fn();
const publishMock = vi.fn();
const scheduleMock = vi.fn();
const cancelScheduleMock = vi.fn();

vi.mock('@/modules/commerce-workspace/presentation-versions', () => ({
  listPresentationVersions: (...args: unknown[]) => listMock(...args),
  showPresentationVersion: (...args: unknown[]) => showMock(...args),
  createPresentationVersion: (...args: unknown[]) => createMock(...args),
  savePresentationVersion: (...args: unknown[]) => saveMock(...args),
  renamePresentationVersion: (...args: unknown[]) => renameMock(...args),
  deletePresentationVersion: (...args: unknown[]) => deleteMock(...args),
  publishPresentationVersion: (...args: unknown[]) => publishMock(...args),
  schedulePresentationVersion: (...args: unknown[]) => scheduleMock(...args),
  cancelPresentationVersionSchedule: (...args: unknown[]) => cancelScheduleMock(...args),
}));

// `useCompany()` hits the real `/me` endpoint via `fetch`, which jsdom has no
// mock for; every pre-existing ExperienceBuilder test already tolerates this
// (the hook swallows the rejection and leaves `company` null — proven by
// CUST-H1-2/3's suites passing unchanged). Most cases here rely on that same
// safe null → `Asia/Riyadh` fallback (`safeTimeZone`); the one scenario that
// needs a *different* authoritative zone mocks this hook explicitly.
const useCompanyMock = vi.fn(() => null as { timezone?: string | null } | null);
vi.mock('@/lib/company', () => ({
  useCompany: () => useCompanyMock(),
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
    scheduleToken: 'token-epoch-0',
    schedulingRuntimeActive: true,
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

/**
 * Native `type="date"`/`type="time"` inputs are not reliably typeable via
 * `userEvent.type` under jsdom (no real segmented date-picker keyboard
 * behavior) — `fireEvent.change` sets the value directly, exactly how a
 * native browser date/time picker commits a value, without pretending to
 * simulate keystrokes an accessible native control never actually receives
 * as plain text.
 */
function setScheduleDateTime(dialog: HTMLElement, date: string, time: string) {
  fireEvent.change(within(dialog).getByLabelText('تاريخ النشر'), { target: { value: date } });
  fireEvent.change(within(dialog).getByLabelText('وقت النشر'), { target: { value: time } });
}

describe('ExperienceBuilder — CUST-H1-5 Scheduling UX', () => {
  afterEach(() => {
    cleanup();
    listMock.mockReset();
    showMock.mockReset();
    createMock.mockReset();
    saveMock.mockReset();
    renameMock.mockReset();
    deleteMock.mockReset();
    publishMock.mockReset();
    scheduleMock.mockReset();
    cancelScheduleMock.mockReset();
    useCompanyMock.mockReset();
    useCompanyMock.mockReturnValue(null);
  });

  it('shows Schedule enabled for an eligible, unmodified Draft', async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary()] });
    showMock.mockResolvedValue({ ok: true, data: detail() });
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" liveStoreName="متجر النور" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    expect(screen.getByRole('button', { name: 'جدولة' })).toHaveProperty('disabled', false);
    // Schedule never hides Publish, and vice versa — both remain distinct actions.
    expect(screen.getByRole('button', { name: 'نشر' })).toHaveProperty('disabled', false);
  });

  it('disables Schedule (with a clear explanation) when the Production runtime gate is not active', async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary({ schedulingRuntimeActive: false })] });
    showMock.mockResolvedValue({ ok: true, data: detail({ schedulingRuntimeActive: false }) });
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    const scheduleButton = screen.getByRole('button', { name: 'جدولة' }) as HTMLButtonElement;
    expect(scheduleButton.disabled).toBe(true);
    expect(scheduleButton.title).toMatch(/لم يُفعَّل بعد/);
    // The gate never implies Publish Now is unavailable — that stays gated only by the usual Draft/dirty rules.
    expect(screen.getByRole('button', { name: 'نشر' })).toHaveProperty('disabled', false);
  });

  it('does not offer Schedule for an already-Published version', async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary({ state: 'published', publishedRevision: 3 })] });
    showMock.mockResolvedValue({ ok: true, data: detail({ state: 'published', publishedRevision: 3 }) });
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    const scheduleButton = screen.getByRole('button', { name: 'جدولة' }) as HTMLButtonElement;
    expect(scheduleButton.disabled).toBe(true);
    expect(scheduleButton.title).toBe('هذه النسخة منشورة بالفعل.');
  });

  it('disables the toolbar Schedule button for the currently-open Scheduled version, pointing to the manager', async () => {
    listMock.mockResolvedValue({
      ok: true,
      data: [summary({ state: 'scheduled', scheduledFor: '2026-12-01T00:00:00.000Z' })],
    });
    showMock.mockResolvedValue({ ok: true, data: detail({ state: 'scheduled', scheduledFor: '2026-12-01T00:00:00.000Z' }) });
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    const scheduleButton = screen.getByRole('button', { name: 'جدولة' }) as HTMLButtonElement;
    expect(scheduleButton.disabled).toBe(true);
    expect(scheduleButton.title).toBe('هذه النسخة مجدولة بالفعل — أعد الجدولة أو ألغِها من إدارة النسخ.');
  });

  it('opens a dialog naming the version and storefront, with date/time inputs and the authoritative timezone label', async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary({ name: 'رمضان 1448' })] });
    showMock.mockResolvedValue({ ok: true, data: detail({ name: 'رمضان 1448' }) });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" liveStoreName="متجر النور" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'جدولة' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText((_, node) => node?.textContent === 'جدولة «رمضان 1448»')).toBeTruthy();
    expect(within(dialog).getByText((_, node) => node?.textContent === 'المتجر: متجر النور')).toBeTruthy();
    expect(document.querySelector('[data-schedule-date]')).toBeTruthy();
    expect(document.querySelector('[data-schedule-time]')).toBeTruthy();
    // No authoritative company timezone was resolvable in this test (mocked null) — falls back to the
    // tenant model's own DB-level default, never a browser-timezone guess.
    expect(within(dialog).getAllByText(/بتوقيت الرياض/).length).toBeGreaterThan(0);
    expect(scheduleMock).not.toHaveBeenCalled();
  });

  it('sends the exact version id + revision + explicit-offset time + current schedule token', async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary({ id: 'v1', revision: 3, scheduleToken: 'tok-7' })] });
    showMock.mockResolvedValue({ ok: true, data: detail({ id: 'v1', revision: 3, scheduleToken: 'tok-7' }) });
    scheduleMock.mockReturnValue(new Promise(() => {})); // stays pending — only the request shape matters here.
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'جدولة' }));
    const dialog = screen.getByRole('dialog');
    setScheduleDateTime(dialog, '2026-12-01', '09:30');
    await user.click(within(dialog).getByRole('button', { name: 'جدولة' }));

    await waitFor(() =>
      expect(scheduleMock).toHaveBeenCalledWith('store-1', 'v1', 3, '2026-12-01T06:30:00.000Z', 'tok-7'),
    );
  });

  it('rejects a past date/time before ever calling the API', async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary()] });
    showMock.mockResolvedValue({ ok: true, data: detail() });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'جدولة' }));
    const dialog = screen.getByRole('dialog');
    setScheduleDateTime(dialog, '2020-01-01', '09:30');

    expect(within(dialog).getByText('اختر وقتاً في المستقبل.')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'جدولة' })).toHaveProperty('disabled', true);
    expect(scheduleMock).not.toHaveBeenCalled();
  });

  it('on success, the toolbar and manager reflect the new Scheduled state', async () => {
    listMock
      .mockResolvedValueOnce({ ok: true, data: [summary({ id: 'v1', revision: 1 })] })
      .mockResolvedValueOnce({
        ok: true,
        data: [summary({ id: 'v1', revision: 1, state: 'scheduled', scheduledFor: '2026-12-01T06:30:00.000Z', scheduleToken: 'tok-1' })],
      });
    showMock.mockResolvedValue({ ok: true, data: detail({ id: 'v1', revision: 1 }) });
    scheduleMock.mockResolvedValue({
      ok: true,
      data: detail({ id: 'v1', revision: 1, state: 'scheduled', scheduledFor: '2026-12-01T06:30:00.000Z', scheduleToken: 'tok-1' }),
    });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'جدولة' }));
    const dialog = screen.getByRole('dialog');
    setScheduleDateTime(dialog, '2026-12-01', '09:30');
    await user.click(within(dialog).getByRole('button', { name: 'جدولة' }));

    await waitFor(() => expect(screen.getByText('تمت الجدولة. ستُنشَر هذه النسخة تلقائياً في الموعد المحدَّد.')).toBeTruthy());
    expect(screen.queryByRole('dialog')).toBeNull();
    // Publish Now is no longer offered on a version that just became Scheduled.
    expect(screen.getByRole('button', { name: 'نشر' })).toHaveProperty('disabled', true);
  });

  it('reschedule opens the same dialog prefilled with the current scheduled time, in reschedule mode', async () => {
    listMock.mockResolvedValue({
      ok: true,
      data: [summary({ id: 'v1', state: 'scheduled', scheduledFor: '2026-12-01T06:30:00.000Z' })],
    });
    showMock.mockResolvedValue({
      ok: true,
      data: detail({ id: 'v1', state: 'scheduled', scheduledFor: '2026-12-01T06:30:00.000Z' }),
    });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await openVersionManager(user);
    const manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    await user.click(within(manager).getByRole('button', { name: 'إعادة الجدولة' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText((_, node) => node?.textContent === 'إعادة جدولة «رمضان 1448»')).toBeTruthy();
    expect((within(dialog).getByLabelText('تاريخ النشر') as HTMLInputElement).value).toBe('2026-12-01');
    expect((within(dialog).getByLabelText('وقت النشر') as HTMLInputElement).value).toBe('09:30');
    expect(within(dialog).getByRole('button', { name: 'حفظ الموعد الجديد' })).toBeTruthy();
  });

  it('scheduling a Draft while another version is already scheduled shows the replace warning naming it', async () => {
    listMock.mockResolvedValue({
      ok: true,
      data: [
        summary({ id: 'other', name: 'عروض الصيف', state: 'scheduled', scheduledFor: '2026-11-01T00:00:00.000Z' }),
        summary({ id: 'v1', name: 'رمضان 1448', revision: 1 }),
      ],
    });
    showMock.mockResolvedValue({ ok: true, data: detail({ id: 'v1', name: 'رمضان 1448', revision: 1 }) });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" versionId="v1" />);
    await waitFor(() => expect(showMock).toHaveBeenCalledWith('store-1', 'v1'));

    await user.click(screen.getByRole('button', { name: 'جدولة' }));

    const dialog = screen.getByRole('dialog');
    const warning = dialog.querySelector('[data-schedule-replace-warning]');
    expect(warning?.textContent).toContain('عروض الصيف');
    expect(warning?.textContent).toMatch(/تُلغي جدولة تلك/);
  });

  it('a stale schedule token shows a clear conflict message and never auto-retries', async () => {
    listMock
      .mockResolvedValueOnce({ ok: true, data: [summary({ id: 'v1', revision: 1, scheduleToken: 'tok-old' })] })
      .mockResolvedValueOnce({ ok: true, data: [summary({ id: 'v1', revision: 1, scheduleToken: 'tok-new' })] });
    showMock.mockResolvedValue({ ok: true, data: detail({ id: 'v1', revision: 1, scheduleToken: 'tok-old' }) });
    scheduleMock.mockResolvedValue({ ok: false, reason: 'stale_token', message: 'stale token' });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'جدولة' }));
    const dialog = screen.getByRole('dialog');
    setScheduleDateTime(dialog, '2026-12-01', '09:30');
    await user.click(within(dialog).getByRole('button', { name: 'جدولة' }));

    await waitFor(() => expect(scheduleMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    // The dialog closes on any failure (its stale revision/token would
    // otherwise sit in the closure and resend on a second click, looping the
    // same 409) — the conflict is reported via the top-level status notice,
    // and the merchant must explicitly reopen Schedule from a refreshed row.
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText(/تغيّرت حالة الجدولة لهذا المتجر/)).toBeTruthy();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(scheduleMock).toHaveBeenCalledTimes(1);
  });

  it('a stale target revision shows the revision-specific conflict message and closes the dialog', async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary({ id: 'v1', revision: 1 })] });
    showMock.mockResolvedValue({ ok: true, data: detail({ id: 'v1', revision: 1 }) });
    scheduleMock.mockResolvedValue({ ok: false, reason: 'stale_revision', message: 'stale revision' });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'جدولة' }));
    const dialog = screen.getByRole('dialog');
    setScheduleDateTime(dialog, '2026-12-01', '09:30');
    await user.click(within(dialog).getByRole('button', { name: 'جدولة' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText(/تم تعديل هذه النسخة من جلسة أخرى/)).toBeTruthy();
  });

  it('an active-conflict (target became Published meanwhile) shows the specific message and closes the dialog', async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary({ id: 'v1', revision: 1 })] });
    showMock.mockResolvedValue({ ok: true, data: detail({ id: 'v1', revision: 1 }) });
    scheduleMock.mockResolvedValue({ ok: false, reason: 'active_conflict', message: 'active' });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'جدولة' }));
    const dialog = screen.getByRole('dialog');
    setScheduleDateTime(dialog, '2026-12-01', '09:30');
    await user.click(within(dialog).getByRole('button', { name: 'جدولة' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      screen.getByText('أصبحت هذه النسخة هي المنشورة حالياً، فلا يمكن جدولتها. حُدِّثت القائمة.'),
    ).toBeTruthy();
  });

  it('cancel-schedule shows a lifecycle confirmation naming the version, not a generic "are you sure"', async () => {
    listMock.mockResolvedValue({
      ok: true,
      data: [summary({ id: 'v1', name: 'رمضان 1448', state: 'scheduled', scheduledFor: '2026-12-01T00:00:00.000Z' })],
    });
    showMock.mockResolvedValue({
      ok: true,
      data: detail({ id: 'v1', name: 'رمضان 1448', state: 'scheduled', scheduledFor: '2026-12-01T00:00:00.000Z' }),
    });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await openVersionManager(user);
    const manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    await user.click(within(manager).getByRole('button', { name: 'إلغاء الجدولة' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText((_, node) => node?.textContent === 'إلغاء جدولة «رمضان 1448»؟')).toBeTruthy();
    expect(within(dialog).getByText(/لن يتم حذف هذه النسخة/)).toBeTruthy();
    expect(within(dialog).getByText(/التصميم المنشور حالياً على المتجر الحي لن يتغيّر/)).toBeTruthy();
    expect(cancelScheduleMock).not.toHaveBeenCalled();
  });

  it('confirming cancel-schedule sends the current token and returns the version to Draft', async () => {
    listMock
      .mockResolvedValueOnce({
        ok: true,
        data: [summary({ id: 'v1', state: 'scheduled', scheduledFor: '2026-12-01T00:00:00.000Z', scheduleToken: 'tok-3' })],
      })
      .mockResolvedValueOnce({ ok: true, data: [summary({ id: 'v1', state: 'draft', scheduleToken: 'tok-4' })] });
    showMock.mockResolvedValue({
      ok: true,
      data: detail({ id: 'v1', state: 'scheduled', scheduledFor: '2026-12-01T00:00:00.000Z', scheduleToken: 'tok-3' }),
    });
    cancelScheduleMock.mockResolvedValue({ ok: true, data: detail({ id: 'v1', state: 'draft', scheduleToken: 'tok-4' }) });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await openVersionManager(user);
    const manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    await user.click(within(manager).getByRole('button', { name: 'إلغاء الجدولة' }));
    // Scoped to the confirm dialog: the row's own trigger (same label) stays
    // present in the still-open background popover, exactly like the
    // publish-confirm dialog's equivalent row-action case.
    const confirmDialog = screen.getByRole('dialog');
    await user.click(within(confirmDialog).getByRole('button', { name: 'إلغاء الجدولة' }));

    await waitFor(() => expect(cancelScheduleMock).toHaveBeenCalledWith('store-1', 'v1', 'tok-3'));
    await waitFor(() => expect(screen.getByText('أُلغيت الجدولة. عادت هذه النسخة مسودة.')).toBeTruthy());
    expect(screen.queryByRole('dialog')).toBeNull();
    // Cancel returned it to Draft — Publish Now is offered again, Reschedule is gone.
    expect(screen.getByRole('button', { name: 'نشر' })).toHaveProperty('disabled', false);
  });

  it('cancel-schedule remains available even when the Production runtime gate is not active — it is a safe recovery action, never blocked', async () => {
    listMock.mockResolvedValue({
      ok: true,
      data: [
        summary({
          id: 'v1',
          state: 'scheduled',
          scheduledFor: '2026-12-01T00:00:00.000Z',
          schedulingRuntimeActive: false,
        }),
      ],
    });
    showMock.mockResolvedValue({
      ok: true,
      data: detail({ id: 'v1', state: 'scheduled', scheduledFor: '2026-12-01T00:00:00.000Z', schedulingRuntimeActive: false }),
    });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await openVersionManager(user);
    const manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    const cancelButton = within(manager).getByRole('button', { name: 'إلغاء الجدولة' }) as HTMLButtonElement;
    expect(cancelButton.disabled).toBe(false);
    // Reschedule, unlike Cancel, is still gated (would imply live execution that won't happen).
    expect(within(manager).getByRole('button', { name: 'إعادة الجدولة' })).toHaveProperty('disabled', true);
  });

  it('the manager shows a persistent gated notice (not only a hover tooltip) when the runtime is not active', async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary({ schedulingRuntimeActive: false })] });
    showMock.mockResolvedValue({ ok: true, data: detail({ schedulingRuntimeActive: false }) });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await openVersionManager(user);
    const manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    expect(document.querySelector('[data-scheduling-gated-notice]')).toBeTruthy();
    expect(within(manager).getByText(/لم يُفعَّل بعد على هذا الخادم/)).toBeTruthy();
  });

  it('cancel (keep it) closes the dialog without cancelling the schedule', async () => {
    listMock.mockResolvedValue({
      ok: true,
      data: [summary({ id: 'v1', state: 'scheduled', scheduledFor: '2026-12-01T00:00:00.000Z' })],
    });
    showMock.mockResolvedValue({
      ok: true,
      data: detail({ id: 'v1', state: 'scheduled', scheduledFor: '2026-12-01T00:00:00.000Z' }),
    });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await openVersionManager(user);
    const manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    await user.click(within(manager).getByRole('button', { name: 'إلغاء الجدولة' }));
    await user.click(screen.getByRole('button', { name: 'تراجع' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(cancelScheduleMock).not.toHaveBeenCalled();
  });

  it('renders the schedule dialog in English for locale en', async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary({ name: 'Ramadan 1448' })] });
    showMock.mockResolvedValue({ ok: true, data: detail({ name: 'Ramadan 1448' }) });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" liveStoreName="Al-Noor Store" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'Schedule' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText((_, node) => node?.textContent === 'Schedule "Ramadan 1448"')).toBeTruthy();
    expect(within(dialog).getByText((_, node) => node?.textContent === 'Storefront: Al-Noor Store')).toBeTruthy();
    expect(within(dialog).getAllByText(/Riyadh time/).length).toBeGreaterThan(0);
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });

  it('uses the authoritative company timezone (not Asia/Riyadh) when the tenant is configured for a different zone', async () => {
    useCompanyMock.mockReturnValue({ timezone: 'Africa/Cairo' });
    listMock.mockResolvedValue({ ok: true, data: [summary()] });
    showMock.mockResolvedValue({ ok: true, data: detail() });
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'Schedule' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByText(/Africa\/Cairo/).length).toBeGreaterThan(0);
    expect(within(dialog).queryByText(/Riyadh/)).toBeNull();
  });

  it('mobile: Reschedule from the bottom-sheet Version Manager closes the sheet and opens the dialog', async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    listMock.mockResolvedValue({
      ok: true,
      data: [summary({ id: 'v1', name: 'المفتوحة', state: 'scheduled', scheduledFor: '2026-12-01T00:00:00.000Z' })],
    });
    showMock.mockResolvedValue({
      ok: true,
      data: detail({ id: 'v1', name: 'المفتوحة', state: 'scheduled', scheduledFor: '2026-12-01T00:00:00.000Z' }),
    });
    const user = userEvent.setup();
    try {
      render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" versionId="v1" />);
      await waitFor(() => expect(showMock).toHaveBeenCalledWith('store-1', 'v1'));

      await user.click(document.querySelector('[data-version-selector-mobile]') as HTMLElement);
      const sheet = screen.getByRole('dialog', { name: 'إدارة نسخ التصميم' });
      await user.click(within(sheet).getByRole('button', { name: 'إعادة الجدولة' }));

      expect(screen.queryByRole('dialog', { name: 'إدارة نسخ التصميم' })).toBeNull();
      const confirm = screen.getByRole('dialog');
      expect(within(confirm).getByText((_, node) => node?.textContent === 'إعادة جدولة «المفتوحة»')).toBeTruthy();
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, configurable: true });
    }
  });
});
