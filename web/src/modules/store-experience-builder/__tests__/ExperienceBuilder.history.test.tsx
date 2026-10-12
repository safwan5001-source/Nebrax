/**
 * @vitest-environment jsdom
 *
 * CUST-H5-2 — local Undo / Redo in the real editor: toolbar + More-menu controls, keyboard shortcuts (and the native-input
 * exclusion), the successful-Save boundary, failed-Save / stale-409 preservation, Version switch and Published read-only.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const listMock = vi.fn();
const showMock = vi.fn();
const createMock = vi.fn();
const saveMock = vi.fn();

vi.mock('@/modules/commerce-workspace/presentation-versions', () => ({
  listPresentationVersions: (...args: unknown[]) => listMock(...args),
  showPresentationVersion: (...args: unknown[]) => showMock(...args),
  createPresentationVersion: (...args: unknown[]) => createMock(...args),
  savePresentationVersion: (...args: unknown[]) => saveMock(...args),
  renamePresentationVersion: vi.fn(),
  deletePresentationVersion: vi.fn(),
  publishPresentationVersion: vi.fn(),
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
    scheduleToken: 'opaque-token-0',
    schedulingRuntimeActive: true,
    ...overrides,
  };
}

function detail(overrides: Record<string, unknown> = {}) {
  const { config, ...rest } = overrides;
  return { ...summary(rest), config: config ?? DEFAULT_PRESENTATION_CONFIG };
}

async function mount(version: Record<string, unknown> = {}) {
  listMock.mockResolvedValue({ ok: true, data: [summary(version)] });
  showMock.mockResolvedValue({ ok: true, data: detail(version) });
  const user = userEvent.setup();
  render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
  await waitFor(() => expect(showMock).toHaveBeenCalled());
  await waitFor(() => expect(document.querySelector('[data-selected-version-id="v1"]')).toBeTruthy());
  await user.click(screen.getByRole('button', { name: 'التوثيق والثقة' }));
  return user;
}

const root = () => document.querySelector('[data-experience-builder]') as HTMLElement;
const undoBtn = () => document.querySelector('[data-history-action="undo"]') as HTMLButtonElement;
const redoBtn = () => document.querySelector('[data-history-action="redo"]') as HTMLButtonElement;
const firstTextbox = () => screen.getAllByRole('textbox')[0] as HTMLInputElement;
const isDisabled = (el: HTMLElement) => el.getAttribute('aria-disabled') === 'true';

describe('ExperienceBuilder — CUST-H5-2 Undo / Redo', () => {
  afterEach(() => {
    cleanup();
    listMock.mockReset();
    showMock.mockReset();
    createMock.mockReset();
    saveMock.mockReset();
    vi.restoreAllMocks();
  });

  it('starts with Undo and Redo unavailable, with an honest reason and a shortcut hint once available', async () => {
    const user = await mount();
    expect(isDisabled(undoBtn())).toBe(true);
    expect(isDisabled(redoBtn())).toBe(true);
    expect(undoBtn().title).toBe('لا تعديلات غير محفوظة للتراجع عنها');
    expect(redoBtn().title).toBe('لا خطوات لإعادتها');
    expect(undoBtn().getAttribute('aria-label')).toBe('تراجع عن التعديل');
    expect(redoBtn().getAttribute('aria-label')).toBe('إعادة التعديل');

    const original = firstTextbox().value;
    await user.type(firstTextbox(), 'x');
    expect(isDisabled(undoBtn())).toBe(false);
    expect(undoBtn().title).toMatch(/تراجع عن التعديل \((Ctrl\+Z|⌘Z)\)/);
    expect(undoBtn().getAttribute('aria-keyshortcuts')).toMatch(/Z/);
    expect(firstTextbox().value).toBe(original + 'x');
  });

  it('typing a phrase is one Undo step; Undo restores the text and a clean status; Redo brings it back', async () => {
    const user = await mount();
    const original = firstTextbox().value;
    await user.type(firstTextbox(), 'تعديل غير محفوظ');
    expect(root().getAttribute('data-lifecycle')).toBe('dirty');

    await user.click(undoBtn());
    expect(firstTextbox().value).toBe(original);
    expect(root().getAttribute('data-lifecycle')).toBe('clean');
    expect(isDisabled(undoBtn())).toBe(true);
    expect(isDisabled(redoBtn())).toBe(false);
    expect(document.querySelector('[data-history-announcer]')?.textContent).toContain('تم التراجع');

    await user.click(redoBtn());
    expect(firstTextbox().value).toBe(original + 'تعديل غير محفوظ');
    expect(root().getAttribute('data-lifecycle')).toBe('dirty');
    expect(isDisabled(redoBtn())).toBe(true);
    expect(document.querySelector('[data-history-announcer]')?.textContent).toContain('تمت إعادة');
  });

  it('Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z work from outside a field, but never steal the native shortcut inside a text field', async () => {
    const user = await mount();
    const original = firstTextbox().value;
    await user.type(firstTextbox(), 'abc');

    // Inside the text field: the editor must not act (the browser owns text undo there).
    const input = firstTextbox();
    input.focus();
    const insideEvent = new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true });
    input.dispatchEvent(insideEvent);
    expect(insideEvent.defaultPrevented).toBe(false);
    expect(firstTextbox().value).toBe(original + 'abc');

    // From the page body: undo, then redo with both Windows bindings.
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document.body, { key: 'z', code: 'KeyZ', ctrlKey: true });
    await waitFor(() => expect(firstTextbox().value).toBe(original));
    fireEvent.keyDown(document.body, { key: 'y', code: 'KeyY', ctrlKey: true });
    await waitFor(() => expect(firstTextbox().value).toBe(original + 'abc'));
    fireEvent.keyDown(document.body, { key: 'z', code: 'KeyZ', ctrlKey: true });
    await waitFor(() => expect(firstTextbox().value).toBe(original));
    fireEvent.keyDown(document.body, { key: 'Z', code: 'KeyZ', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(firstTextbox().value).toBe(original + 'abc'));
  });

  it('two quick choices on a discrete control (a select) are two Undo steps, never merged like keystrokes', async () => {
    const user = await mount();
    await user.click(document.querySelector('[data-panel-option="theme"]') as HTMLElement);
    const select = screen.getByRole('combobox', { name: 'الخط' }) as HTMLSelectElement; // the font preset: a document field
    expect(select.options.length).toBeGreaterThanOrEqual(2);
    const original = select.value;
    const other = Array.from(select.options).find((o) => o.value !== original)!.value;

    await user.selectOptions(select, other);
    await user.selectOptions(select, original); // back again, well inside the 1 s grouping window
    expect(select.value).toBe(original);
    // Merged like keystrokes, the round trip would cancel out and leave nothing to undo.
    expect(undoBtn().getAttribute('aria-disabled')).toBe('false');

    await user.click(undoBtn());
    expect(select.value).toBe(other); // the intermediate choice is not skipped
    await user.click(undoBtn());
    expect(select.value).toBe(original);
    expect(undoBtn().getAttribute('aria-disabled')).toBe('true');
  });

  it('a new edit after Undo discards the Redo branch', async () => {
    const user = await mount();
    await user.type(firstTextbox(), 'a');
    await user.click(undoBtn());
    expect(isDisabled(redoBtn())).toBe(false);
    await user.type(firstTextbox(), 'b');
    expect(isDisabled(redoBtn())).toBe(true);
  });

  it('exposes the same two actions in the More menu for narrow screens, with the same eligibility', async () => {
    const user = await mount();
    await user.type(firstTextbox(), 'a');
    await user.click(screen.getByRole('button', { name: /المزيد من الإجراءات/ }));
    const menu = screen.getByRole('menu', { name: 'المزيد من الإجراءات' });
    const undoItem = within(menu).getByRole('menuitem', { name: 'تراجع عن التعديل' }) as HTMLButtonElement;
    const redoItem = within(menu).getByRole('menuitem', { name: 'إعادة التعديل' }) as HTMLButtonElement;
    expect(undoItem.disabled).toBe(false);
    expect(redoItem.disabled).toBe(true);
    await user.click(undoItem);
    expect(root().getAttribute('data-lifecycle')).toBe('clean');
  });

  it('a successful Save is a hard boundary: Undo and Redo both clear', async () => {
    saveMock.mockResolvedValue({ ok: true, data: detail({ revision: 2 }) });
    const user = await mount();
    await user.type(firstTextbox(), 'a');
    await user.click(undoBtn()); // leaves a Redo entry too
    await user.type(firstTextbox(), 'b');
    await user.click(undoBtn());
    expect(isDisabled(redoBtn())).toBe(false);

    await user.click(document.querySelector('[data-save]') as HTMLElement);
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.querySelector('[data-selected-version-revision="2"]')).toBeTruthy());
    expect(isDisabled(undoBtn())).toBe(true);
    expect(isDisabled(redoBtn())).toBe(true);
  });

  it('a failed Save keeps the draft and the full history', async () => {
    saveMock.mockResolvedValue({ ok: false, reason: 'network' });
    const user = await mount();
    await user.type(firstTextbox(), 'a');
    await user.click(document.querySelector('[data-save]') as HTMLElement);
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.querySelector('[data-status-notice]')).toBeTruthy());
    expect(root().getAttribute('data-lifecycle')).toBe('dirty');
    expect(isDisabled(undoBtn())).toBe(false);
    await user.click(undoBtn());
    expect(root().getAttribute('data-lifecycle')).toBe('clean');
  });

  it('a stale 409 keeps the local history, does not retry, and does not merge', async () => {
    saveMock.mockResolvedValue({ ok: false, reason: 'conflict' });
    const user = await mount();
    await user.type(firstTextbox(), 'a');
    await user.click(document.querySelector('[data-save]') as HTMLElement);
    await waitFor(() => expect(document.querySelector('[data-version-conflict]')).toBeTruthy());
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(isDisabled(undoBtn())).toBe(false);
    expect(showMock).toHaveBeenCalledTimes(1); // no silent reload
  });

  it('Version switch starts a fresh session: the previous Version’s history is gone', async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary({ id: 'v1' }), summary({ id: 'v2', name: 'نسخة ثانية' })] });
    showMock.mockImplementation((_s: string, id: string) =>
      Promise.resolve({ ok: true, data: detail({ id, name: id === 'v2' ? 'نسخة ثانية' : 'رمضان 1448' }) }),
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" versionId="v1" initialLocale="ar" />);
    await waitFor(() => expect(document.querySelector('[data-selected-version-id="v1"]')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'التوثيق والثقة' }));
    await user.type(firstTextbox(), 'a');
    expect(isDisabled(undoBtn())).toBe(false);

    await user.click(screen.getByLabelText('نسخة التصميم قيد التعديل'));
    const manager = screen.getByRole('menu', { name: 'إدارة نسخ التصميم' });
    const rowTwo = within(manager).getByText('نسخة ثانية').closest('li') as HTMLElement;
    await user.click(within(rowTwo).getByRole('button', { name: 'فتح للتعديل' }));
    await waitFor(() => expect(document.querySelector('[data-selected-version-id="v2"]')).toBeTruthy());
    expect(isDisabled(undoBtn())).toBe(true);
    expect(isDisabled(redoBtn())).toBe(true);
  });

  it('Published is read-only: no history, and the shortcuts do nothing', async () => {
    listMock.mockResolvedValue({ ok: true, data: [summary({ state: 'published', publishedRevision: 1 })] });
    showMock.mockResolvedValue({ ok: true, data: detail({ state: 'published', publishedRevision: 1 }) });
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await waitFor(() => expect(document.querySelector('[data-selected-version-state="published"]')).toBeTruthy());
    expect(isDisabled(undoBtn())).toBe(true);
    expect(isDisabled(redoBtn())).toBe(true);
    const event = new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    expect(root().getAttribute('data-lifecycle')).toBe('clean');
  });

  it('shortcuts do nothing while a confirmation dialog (Publish) is open', async () => {
    const user = await mount();
    await user.type(firstTextbox(), 'a');
    await user.click(undoBtn()); // clean again, Redo available — Publish is enabled
    expect(isDisabled(redoBtn())).toBe(false);
    await user.click(document.querySelector('[data-publish]') as HTMLElement);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());

    fireEvent.keyDown(document.body, { key: 'y', code: 'KeyY', ctrlKey: true });
    expect(root().getAttribute('data-lifecycle')).toBe('clean');
    expect(isDisabled(redoBtn())).toBe(false); // still there, untouched behind the modal
  });

  it('shortcuts do nothing while the section library dialog is open on desktop, with focus left on its trigger', async () => {
    const user = await mount();
    await user.type(firstTextbox(), 'a');
    expect(root().getAttribute('data-can-undo')).toBe('true');

    await user.click(document.querySelector('[data-panel-option="homepage"]') as HTMLElement);
    const trigger = screen.getAllByRole('button').find((b) => /إضافة قسم/.test(b.textContent ?? '')) as HTMLElement;
    expect(trigger).toBeTruthy();
    await user.click(trigger);
    await screen.findByRole('dialog');

    trigger.focus(); // focus stays on the trigger behind the overlay
    fireEvent.keyDown(trigger, { key: 'z', code: 'KeyZ', ctrlKey: true });
    expect(root().getAttribute('data-can-undo')).toBe('true');
    expect(root().getAttribute('data-lifecycle')).toBe('dirty');
  });

  it('shortcuts do nothing while an inline delete confirmation (alertdialog, no aria-modal) is pending', async () => {
    // Every section carries a typed name, so deleting any of them asks first (an inline `alertdialog`).
    const named = {
      ...DEFAULT_PRESENTATION_CONFIG,
      homepage: {
        ...DEFAULT_PRESENTATION_CONFIG.homepage,
        sections: DEFAULT_PRESENTATION_CONFIG.homepage.sections.map((section) => ({ ...section, label: 'اسم' })),
      },
    };
    const user = await mount({ config: named });
    await user.type(firstTextbox(), 'a');
    expect(root().getAttribute('data-can-undo')).toBe('true');

    await user.click(document.querySelector('[data-panel-option="homepage"]') as HTMLElement);
    const remove = screen.getAllByRole('button', { name: 'حذف القسم' })[0];
    await user.click(remove);
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm.getAttribute('aria-modal')).toBeNull(); // the case a `[aria-modal]`-only guard would miss

    remove.focus();
    fireEvent.keyDown(remove, { key: 'z', code: 'KeyZ', ctrlKey: true });
    expect(root().getAttribute('data-can-undo')).toBe('true');
    expect(root().getAttribute('data-lifecycle')).toBe('dirty');
  });

  it('shortcuts do nothing while a mobile bottom sheet is open, even with focus left on its trigger behind it', async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    try {
      listMock.mockResolvedValue({ ok: true, data: [summary()] });
      showMock.mockResolvedValue({ ok: true, data: detail() });
      const user = userEvent.setup();
      render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
      await waitFor(() => expect(document.querySelector('[data-selected-version-id="v1"]')).toBeTruthy());

      const trigger = document.querySelector('[data-builder-mobile-bar] button:first-child') as HTMLElement;
      await user.click(trigger);
      const sheet = await screen.findByRole('dialog');
      await user.click(within(sheet).getAllByRole('button', { name: 'أسفل' })[0]); // move a section down — a real, undoable edit
      expect(root().getAttribute('data-can-undo')).toBe('true'); // so the blocked assertion below is not vacuous

      // Focus is on the trigger *behind* the sheet, outside the dialog element.
      trigger.focus();
      fireEvent.keyDown(trigger, { key: 'z', code: 'KeyZ', ctrlKey: true });
      expect(root().getAttribute('data-lifecycle')).toBe('dirty');

      await user.click(within(sheet).getAllByRole('button')[0]); // Close
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      fireEvent.keyDown(document.body, { key: 'z', code: 'KeyZ', ctrlKey: true });
      await waitFor(() => expect(root().getAttribute('data-lifecycle')).toBe('clean'));
    } finally {
      Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, configurable: true });
    }
  });

  it('Undo never calls the network: no save, no reload, no publish', async () => {
    const user = await mount();
    await user.type(firstTextbox(), 'a');
    const showCalls = showMock.mock.calls.length;
    await user.click(undoBtn());
    await user.click(redoBtn());
    expect(saveMock).not.toHaveBeenCalled();
    expect(showMock.mock.calls.length).toBe(showCalls);
  });
});
