/**
 * @vitest-environment jsdom
 *
 * CUST-H5-4 — Saved history & Restore in the real editor: open / empty / error states, read-only preview, Restore into an
 * editable Draft (unsaved, undoable, saved against the CURRENT revision), media warnings, and «Create draft» for Published.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const listMock = vi.fn();
const showMock = vi.fn();
const createMock = vi.fn();
const saveMock = vi.fn();
const revListMock = vi.fn();
const revShowMock = vi.fn();

vi.mock('@/modules/commerce-workspace/presentation-versions', () => ({
  listPresentationVersions: (...args: unknown[]) => listMock(...args),
  showPresentationVersion: (...args: unknown[]) => showMock(...args),
  createPresentationVersion: (...args: unknown[]) => createMock(...args),
  savePresentationVersion: (...args: unknown[]) => saveMock(...args),
  listPresentationVersionRevisions: (...args: unknown[]) => revListMock(...args),
  showPresentationVersionRevision: (...args: unknown[]) => revShowMock(...args),
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
    schemaVersion: 3,
    revision: 7,
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

const oldConfig = {
  ...DEFAULT_PRESENTATION_CONFIG,
  branding: { ...DEFAULT_PRESENTATION_CONFIG.branding, displayName: 'اسم قديم من اللقطة' },
};

function revRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    versionId: 'v1',
    versionRevision: 3,
    schemaVersion: 3,
    sizeBytes: 1500,
    createdAt: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
    isCurrent: false,
    ...overrides,
  };
}

function revDetail(overrides: Record<string, unknown> = {}) {
  return { ...revRow(overrides), config: oldConfig, mediaIssues: [], ...overrides };
}

async function mount(version: Record<string, unknown> = {}) {
  listMock.mockResolvedValue({ ok: true, data: [summary(version)] });
  showMock.mockResolvedValue({ ok: true, data: detail(version) });
  revListMock.mockResolvedValue({ ok: true, data: [revRow({ id: 'r2', versionRevision: 7, isCurrent: true }), revRow()] });
  const user = userEvent.setup();
  render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" />);
  await waitFor(() => expect(document.querySelector('[data-selected-version-id="v1"]')).toBeTruthy());
  return user;
}

const root = () => document.querySelector('[data-experience-builder]') as HTMLElement;
const historyBtn = () => document.querySelector('[data-history-open]') as HTMLButtonElement;
const dialog = () => screen.queryByRole('dialog', { name: 'Saved history' });
const rowButton = (rowIndex: number, name: string) =>
  within(document.querySelectorAll('[data-history-row]')[rowIndex] as HTMLElement).getByRole('button', { name }) as HTMLButtonElement;

async function openHistory(user: ReturnType<typeof userEvent.setup>) {
  await user.click(historyBtn());
  await waitFor(() => expect(document.querySelectorAll('[data-history-row]').length).toBeGreaterThan(0));
}

describe('ExperienceBuilder — CUST-H5-4 saved history & restore', () => {
  afterEach(() => {
    cleanup();
    for (const mock of [listMock, showMock, createMock, saveMock, revListMock, revShowMock]) mock.mockReset();
    vi.restoreAllMocks();
  });

  it('opens the saved-history dialog for the exact open Version, lists snapshots, and returns focus on close', async () => {
    const user = await mount();
    await openHistory(user);

    expect(revListMock).toHaveBeenCalledWith('store-1', 'v1');
    expect(dialog()).toBeTruthy();
    expect(document.querySelectorAll('[data-history-row]')).toHaveLength(2);

    await user.keyboard('{Escape}');
    expect(dialog()).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(historyBtn()));
  });

  it('shows an honest empty state and an error state with a working Retry', async () => {
    const user = await mount();
    revListMock.mockResolvedValueOnce({ ok: true, data: [] });
    await user.click(historyBtn());
    await waitFor(() => expect(document.querySelector('[data-history-empty]')).toBeTruthy());
    await user.keyboard('{Escape}');

    revListMock.mockResolvedValueOnce({ ok: false, reason: 'failed', message: 'x' });
    await user.click(historyBtn());
    await waitFor(() => expect(document.querySelector('[data-history-error]')).toBeTruthy());
    revListMock.mockResolvedValueOnce({ ok: true, data: [revRow()] });
    await user.click(document.querySelector('[data-history-retry]') as HTMLElement);
    await waitFor(() => expect(document.querySelectorAll('[data-history-row]')).toHaveLength(1));
  });

  it('Preview is read-only: it shows the snapshot, disables Save/Publish/Undo, and Exit leaves the editor exactly as it was', async () => {
    const user = await mount();
    await openHistory(user);
    revShowMock.mockResolvedValueOnce({ ok: true, data: revDetail() });

    await user.click(rowButton(1, 'Preview'));

    await waitFor(() => expect(document.querySelector('[data-history-preview-bar]')).toBeTruthy());
    expect(revShowMock).toHaveBeenCalledWith('store-1', 'v1', 'r1');
    expect(dialog()).toBeNull();
    expect(root().getAttribute('data-history-preview')).toBe('true');
    expect((document.querySelector('[data-save]') as HTMLButtonElement).disabled).toBe(true);
    expect((document.querySelector('[data-publish]') as HTMLButtonElement).disabled).toBe(true);
    expect(historyBtn().disabled).toBe(true);
    expect(root().getAttribute('data-can-undo')).toBe('false');
    expect(document.body.textContent).toContain('اسم قديم من اللقطة');
    // The editing UI is inert while previewing.
    expect(document.querySelector('[data-builder-toolbar]')?.closest('[inert]')).toBeNull();
    expect(saveMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Exit preview' }));
    expect(document.querySelector('[data-history-preview-bar]')).toBeNull();
    expect(root().getAttribute('data-history-preview')).toBe('false');
    expect(root().getAttribute('data-lifecycle')).toBe('clean');
    expect(document.body.textContent).not.toContain('اسم قديم من اللقطة');
  });

  it('Restore loads the snapshot as an UNSAVED edit, never calls the server to write, and Undo brings the previous state back', async () => {
    const user = await mount();
    await openHistory(user);
    revShowMock.mockResolvedValueOnce({ ok: true, data: revDetail() });

    await user.click(rowButton(1, 'Restore'));

    await waitFor(() => expect(root().getAttribute('data-lifecycle')).toBe('dirty'));
    expect(dialog()).toBeNull();
    expect(screen.getByText(/Snapshot loaded into the editor as an unsaved edit/)).toBeTruthy();
    expect(saveMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
    expect(root().getAttribute('data-selected-version-revision')).toBe('7'); // the counter did not move
    expect(root().getAttribute('data-can-undo')).toBe('true');

    // Undo (the restore is one ordinary editor step).
    await user.click(document.querySelector('[data-history-action="undo"]') as HTMLElement);
    expect(root().getAttribute('data-lifecycle')).toBe('clean');
  });

  it('Save after Restore uses the CURRENT Version revision and the snapshot document — the historical revision is never sent', async () => {
    const user = await mount();
    await openHistory(user);
    revShowMock.mockResolvedValueOnce({ ok: true, data: revDetail({ versionRevision: 3 }) });
    saveMock.mockResolvedValue({ ok: true, data: detail({ revision: 8, config: oldConfig }) });

    await user.click(rowButton(1, 'Restore'));
    await waitFor(() => expect(root().getAttribute('data-lifecycle')).toBe('dirty'));
    await user.click(document.querySelector('[data-save]') as HTMLElement);

    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    const [storefrontId, versionId, config, revision] = saveMock.mock.calls[0];
    expect([storefrontId, versionId, revision]).toEqual(['store-1', 'v1', 7]); // 7 = current, NOT the snapshot's 3
    expect(config.branding.displayName).toBe('اسم قديم من اللقطة');
    await waitFor(() => expect(root().getAttribute('data-selected-version-revision')).toBe('8'));
  });

  it('warns about media that is unavailable TODAY without altering the restored document', async () => {
    const user = await mount();
    await openHistory(user);
    revShowMock.mockResolvedValueOnce({
      ok: true,
      data: revDetail({ mediaIssues: [{ path: 'branding.logoMedia.mediaId', code: 'media_missing', message: '' }] }),
    });

    await user.click(rowButton(1, 'Restore'));

    await waitFor(() => expect(root().getAttribute('data-lifecycle')).toBe('dirty'));
    expect(screen.getByText(/1 image\(s\) in this snapshot are no longer available/)).toBeTruthy();
  });

  it('a snapshot identical to the editor changes nothing and says so', async () => {
    const user = await mount();
    await openHistory(user);
    revShowMock.mockResolvedValueOnce({ ok: true, data: revDetail({ config: DEFAULT_PRESENTATION_CONFIG }) });

    await user.click(rowButton(1, 'Restore'));

    await waitFor(() => expect(screen.getByText(/identical to what's in the editor now/)).toBeTruthy());
    expect(root().getAttribute('data-lifecycle')).toBe('clean');
  });

  it('a failed snapshot read never pretends success and leaves the draft untouched', async () => {
    const user = await mount();
    await openHistory(user);
    revShowMock.mockResolvedValueOnce({ ok: false, reason: 'failed', message: 'x' });

    await user.click(rowButton(1, 'Restore'));

    await waitFor(() => expect(screen.getByText(/Couldn't restore the snapshot. Nothing changed./)).toBeTruthy());
    expect(root().getAttribute('data-lifecycle')).toBe('clean');
  });

  it('the identical-to-current snapshot cannot be restored in place', async () => {
    const user = await mount();
    await openHistory(user);
    expect(rowButton(0, 'Restore').disabled).toBe(true);
    expect(rowButton(1, 'Restore').disabled).toBe(false);
  });

  it('warns when Restore would replace unsaved edits', async () => {
    const user = await mount();
    await user.click(screen.getByRole('button', { name: 'Verification & trust' }));
    await user.type(screen.getAllByRole('textbox')[0], 'x');
    expect(root().getAttribute('data-lifecycle')).toBe('dirty');
    await openHistory(user);
    expect(document.querySelector('[data-history-dirty-note]')).toBeTruthy();
  });

  describe('Published Version', () => {
    async function mountPublished() {
      return mount({ state: 'published', publishedRevision: 7 });
    }

    it('never restores in place: it offers «Create draft» and creates a NEW draft from the snapshot, leaving Published as it is', async () => {
      const user = await mountPublished();
      await openHistory(user);
      expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
      createMock.mockResolvedValueOnce({
        ok: true,
        data: { ...detail({ id: 'v-new', name: 'رمضان 1448 — from saved snapshot', state: 'draft', revision: 1, config: oldConfig }), mediaIssues: [] },
      });

      await user.click(rowButton(1, 'Create draft'));

      await waitFor(() => expect(document.querySelector('[data-selected-version-id="v-new"]')).toBeTruthy());
      expect(createMock).toHaveBeenCalledTimes(1);
      expect(createMock.mock.calls[0].slice(0, 1)).toEqual(['store-1']);
      expect(createMock.mock.calls[0][2]).toBe('v1'); // source version
      expect(createMock.mock.calls[0][3]).toBe('r1'); // the snapshot
      expect(createMock.mock.calls[0][1]).toMatch(/from saved snapshot$/);
      expect(saveMock).not.toHaveBeenCalled();
      expect(root().getAttribute('data-selected-version-state')).toBe('draft');
      expect(screen.getByText(/A new draft was created from the snapshot. The live store is unchanged./)).toBeTruthy();
    });

    it('a failed create changes nothing and says so', async () => {
      const user = await mountPublished();
      await openHistory(user);
      createMock.mockResolvedValueOnce({ ok: false, reason: 'failed', message: 'x' });

      await user.click(rowButton(1, 'Create draft'));

      await waitFor(() => expect(screen.getByText(/Couldn't create a draft from the snapshot. Nothing changed./)).toBeTruthy());
      expect(root().getAttribute('data-selected-version-id')).toBe('v1');
    });

    it('previewing a Published snapshot then «Create draft» from the bar works the same way', async () => {
      const user = await mountPublished();
      await openHistory(user);
      revShowMock.mockResolvedValueOnce({ ok: true, data: revDetail() });
      await user.click(rowButton(1, 'Preview'));
      await waitFor(() => expect(document.querySelector('[data-history-preview-bar]')).toBeTruthy());
      revShowMock.mockResolvedValue({ ok: true, data: revDetail() });
      createMock.mockResolvedValueOnce({ ok: true, data: { ...detail({ id: 'v-new2', state: 'draft', revision: 1 }), mediaIssues: [] } });

      await user.click(screen.getByRole('button', { name: 'Create draft' }));

      await waitFor(() => expect(document.querySelector('[data-selected-version-id="v-new2"]')).toBeTruthy());
      expect(document.querySelector('[data-history-preview-bar]')).toBeNull();
    });
  });

  it('a late list response after the dialog was closed is not shown (no stale overlay)', async () => {
    const user = await mount();
    let resolveList: (value: unknown) => void = () => {};
    revListMock.mockReturnValueOnce(new Promise((resolve) => { resolveList = resolve; }));
    await user.click(historyBtn());
    expect(document.querySelector('[data-history-loading]')).toBeTruthy();

    await user.keyboard('{Escape}');
    resolveList({ ok: true, data: [revRow()] });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(dialog()).toBeNull();
    expect(document.querySelector('[data-history-list]')).toBeNull();
  });

  it('keyboard Undo does nothing behind the open history dialog', async () => {
    const user = await mount();
    await user.click(screen.getByRole('button', { name: 'Verification & trust' }));
    await user.type(screen.getAllByRole('textbox')[0], 'x');
    await openHistory(user);

    fireEvent.keyDown(document.body, { key: 'z', code: 'KeyZ', ctrlKey: true });

    expect(root().getAttribute('data-lifecycle')).toBe('dirty');
    expect(root().getAttribute('data-can-undo')).toBe('true');
  });

  it('the More menu offers the same entry (below lg) and opens the same dialog', async () => {
    const user = await mount();
    await user.click(screen.getByRole('button', { name: /More actions/ }));
    await user.click(within(screen.getByRole('menu', { name: 'More actions' })).getByRole('menuitem', { name: 'Saved history' }));
    await waitFor(() => expect(dialog()).toBeTruthy());
  });
});
