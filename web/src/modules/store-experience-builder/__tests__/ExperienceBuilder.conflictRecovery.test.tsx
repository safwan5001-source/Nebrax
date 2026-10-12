/**
 * @vitest-environment jsdom
 *
 * CUST-H5-5 — Conflict & failure confidence: a stale 409 keeps the local draft AND Undo history and offers explicit recovery
 * (review the newer version · save my work as a NEW draft — a copy, never a merge · reload), a failed Save keeps everything and
 * retries on the same revision, an in-flight Save plus continued editing honours the Save boundary, and switching/reloading
 * versions is the only way history is dropped.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const listMock = vi.fn();
const showMock = vi.fn();
const createMock = vi.fn();
const saveMock = vi.fn();
const revListMock = vi.fn();

vi.mock('@/modules/commerce-workspace/presentation-versions', () => ({
  listPresentationVersions: (...args: unknown[]) => listMock(...args),
  showPresentationVersion: (...args: unknown[]) => showMock(...args),
  createPresentationVersion: (...args: unknown[]) => createMock(...args),
  savePresentationVersion: (...args: unknown[]) => saveMock(...args),
  renamePresentationVersion: vi.fn(),
  deletePresentationVersion: vi.fn(),
  listPresentationVersionRevisions: (...args: unknown[]) => revListMock(...args),
  showPresentationVersionRevision: vi.fn(),
}));

import { DEFAULT_PRESENTATION_CONFIG } from '../presentation';
import { ExperienceBuilder } from '../ExperienceBuilder';

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'v1',
    storefrontId: 'store-1',
    name: 'Ramadan',
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

const root = () => document.querySelector('[data-experience-builder]') as HTMLElement;
const field = () => screen.getAllByRole('textbox')[0] as HTMLInputElement;
const notice = () => document.body.textContent ?? '';

async function mountAndEdit(text = 'my edit') {
  listMock.mockResolvedValue({ ok: true, data: [summary()] });
  showMock.mockResolvedValue({ ok: true, data: detail() });
  revListMock.mockResolvedValue({ ok: true, data: [] });
  const user = userEvent.setup();
  render(<ExperienceBuilder storefrontId="store-1" initialLocale="en" />);
  await waitFor(() => expect(document.querySelector('[data-selected-version-id="v1"]')).toBeTruthy());
  await user.click(screen.getByRole('button', { name: 'Verification & trust' }));
  await user.type(field(), text);
  expect(root().getAttribute('data-lifecycle')).toBe('dirty');
  return user;
}

async function causeConflict(user: ReturnType<typeof userEvent.setup>) {
  saveMock.mockResolvedValueOnce({ ok: false, reason: 'conflict', message: 'stale' });
  await user.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(document.querySelector('[data-version-conflict]')).toBeTruthy());
}

describe('ExperienceBuilder — CUST-H5-5 conflict & failure confidence', () => {
  afterEach(() => {
    cleanup();
    for (const mock of [listMock, showMock, createMock, saveMock, revListMock]) mock.mockReset();
    vi.restoreAllMocks();
  });

  it('a stale 409 keeps the local draft and the Undo history, blocks a second Save, and lists the three explicit choices', async () => {
    const user = await mountAndEdit();
    await causeConflict(user);

    expect(field().value).toBe('my edit');
    expect(root().getAttribute('data-can-undo')).toBe('true');
    expect(document.querySelector('[data-conflict-hint]')?.textContent).toMatch(/separate copy, not a merge/);
    expect(screen.getByRole('button', { name: 'Review newer version' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save my work as a new draft' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload version' })).toBeTruthy();

    // No blind retry: Save does not fire again while the conflict stands.
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(saveMock).toHaveBeenCalledTimes(1);

    // Undo still works on the preserved history during the conflict.
    await user.click(document.querySelector('[data-history-action="undo"]') as HTMLElement);
    expect(field().value).toBe('');
  });

  it('«Review newer version» opens the saved history so the winner can be inspected without touching the draft', async () => {
    const user = await mountAndEdit();
    await causeConflict(user);

    await user.click(screen.getByRole('button', { name: 'Review newer version' }));

    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Saved history' })).toBeTruthy());
    expect(revListMock).toHaveBeenCalledWith('store-1', 'v1');
    expect(field().value).toBe('my edit');
  });

  it('«Reload version» is the explicit discard: it adopts the server document and clears the history', async () => {
    const user = await mountAndEdit();
    await causeConflict(user);
    showMock.mockResolvedValue({ ok: true, data: detail({ revision: 8 }) });

    await user.click(screen.getByRole('button', { name: 'Reload version' }));

    await waitFor(() => expect(document.querySelector('[data-version-conflict]')).toBeNull());
    expect(root().getAttribute('data-selected-version-revision')).toBe('8');
    expect(root().getAttribute('data-lifecycle')).toBe('clean');
    expect(root().getAttribute('data-can-undo')).toBe('false');
    expect(field().value).toBe('');
  });

  it('«Save my work as a new draft» creates a copy of the winner, saves the local document into it, never writes to the original, and adopts the copy', async () => {
    const user = await mountAndEdit();
    await causeConflict(user);
    createMock.mockResolvedValue({ ok: true, data: detail({ id: 'v-copy', name: 'Ramadan — my edits', revision: 1 }) });
    saveMock.mockResolvedValueOnce({ ok: true, data: detail({ id: 'v-copy', name: 'Ramadan — my edits', revision: 2 }) });

    await user.click(screen.getByRole('button', { name: 'Save my work as a new draft' }));

    await waitFor(() => expect(document.querySelector('[data-selected-version-id="v-copy"]')).toBeTruthy());
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][0]).toBe('store-1');
    expect(createMock.mock.calls[0][1]).toMatch(/my edits$/);
    expect(createMock.mock.calls[0][2]).toBe('v1'); // a copy of the version in conflict — the winner is the source, never overwritten
    // Second save call = into the copy, with the copy's own revision and the merchant's full local document.
    expect(saveMock).toHaveBeenCalledTimes(2);
    expect(saveMock.mock.calls[1][1]).toBe('v-copy');
    expect(saveMock.mock.calls[1][3]).toBe(1);
    expect(saveMock.mock.calls.some((call) => call[1] === 'v1' && call !== saveMock.mock.calls[0])).toBe(false);
    expect(document.querySelector('[data-version-conflict]')).toBeNull();
    expect(notice()).toMatch(/saved as a separate new draft “Ramadan — my edits” \(a copy, not a merge\)/);
    expect(root().getAttribute('data-lifecycle')).toBe('clean');
    expect(root().getAttribute('data-can-undo')).toBe('false'); // a successful save is the Undo boundary
  });

  it('a failed copy keeps everything as it was; a failed save-into-copy is retried on the SAME copy (no second copy)', async () => {
    const user = await mountAndEdit();
    await causeConflict(user);

    createMock.mockResolvedValueOnce({ ok: false, reason: 'failed', message: 'x' });
    await user.click(screen.getByRole('button', { name: 'Save my work as a new draft' }));
    await waitFor(() => expect(notice()).toMatch(/Couldn't create the draft/));
    expect(field().value).toBe('my edit');
    expect(root().getAttribute('data-can-undo')).toBe('true');
    expect(document.querySelector('[data-version-conflict]')).toBeTruthy();

    createMock.mockResolvedValueOnce({ ok: true, data: detail({ id: 'v-copy', name: 'Ramadan — my edits', revision: 1 }) });
    saveMock.mockResolvedValueOnce({ ok: false, reason: 'failed', message: 'x' });
    await user.click(screen.getByRole('button', { name: 'Save my work as a new draft' }));
    await waitFor(() => expect(notice()).toMatch(/“Ramadan — my edits” was created but your edits couldn't be saved into it/));
    expect(field().value).toBe('my edit');
    expect(createMock).toHaveBeenCalledTimes(2);

    saveMock.mockResolvedValueOnce({ ok: true, data: detail({ id: 'v-copy', name: 'Ramadan — my edits', revision: 2 }) });
    await user.click(screen.getByRole('button', { name: 'Save my work as a new draft' }));
    await waitFor(() => expect(document.querySelector('[data-selected-version-id="v-copy"]')).toBeTruthy());
    expect(createMock).toHaveBeenCalledTimes(2); // no third create — the existing copy was reused
    expect(saveMock.mock.calls.filter((call) => call[1] === 'v-copy')).toHaveLength(2);
  });

  it('a failed Save keeps the draft and the Undo history, says nothing was lost, and a retry uses the same revision', async () => {
    const user = await mountAndEdit();
    saveMock.mockResolvedValueOnce({ ok: false, reason: 'failed', message: 'offline' });

    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(notice()).toMatch(/Your changes and Undo history are still here — nothing was lost/));
    expect(document.querySelector('[data-version-conflict]')).toBeNull();
    expect(field().value).toBe('my edit');
    expect(root().getAttribute('data-lifecycle')).toBe('dirty');
    expect(root().getAttribute('data-can-undo')).toBe('true');

    saveMock.mockResolvedValueOnce({ ok: true, data: detail({ revision: 8 }) });
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(root().getAttribute('data-lifecycle')).toBe('clean'));
    expect(saveMock).toHaveBeenCalledTimes(2);
    expect(saveMock.mock.calls[0][3]).toBe(7);
    expect(saveMock.mock.calls[1][3]).toBe(7);
  });

  it('editing while a Save is in flight keeps the newer edit, stays dirty, and the successful Save still clears Undo (hard boundary)', async () => {
    const user = await mountAndEdit('first');
    let resolveSave: (value: unknown) => void = () => {};
    saveMock.mockReturnValueOnce(new Promise((resolve) => { resolveSave = resolve; }));
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));

    await user.type(field(), ' second');
    expect(field().value).toBe('first second');

    resolveSave({ ok: true, data: detail({ revision: 8 }) });
    await waitFor(() => expect(root().getAttribute('data-selected-version-revision')).toBe('8'));

    expect(field().value).toBe('first second');
    expect(root().getAttribute('data-lifecycle')).toBe('dirty');
    expect(root().getAttribute('data-can-undo')).toBe('false');
  });
});

describe('ExperienceBuilder — CUST-H5-5 version switch boundary', () => {
  afterEach(() => {
    cleanup();
    for (const mock of [listMock, showMock, createMock, saveMock, revListMock]) mock.mockReset();
    vi.restoreAllMocks();
  });

  async function mountTwoVersions() {
    listMock.mockResolvedValue({
      ok: true,
      data: [summary({ id: 'a', name: 'نسخة أ', revision: 0 }), summary({ id: 'b', name: 'نسخة ب', revision: 0 })],
    });
    showMock.mockImplementation((_storefrontId: string, versionId: string) =>
      Promise.resolve({ ok: true, data: detail({ id: versionId, name: versionId === 'a' ? 'نسخة أ' : 'نسخة ب', revision: 0 }) }),
    );
    const user = userEvent.setup();
    render(<ExperienceBuilder storefrontId="store-1" initialLocale="ar" />);
    await screen.findByText('اختر نسخة للتعديل');
    await user.click(screen.getByLabelText('نسخة التصميم قيد التعديل'));
    const rowA = within(screen.getByRole('menu', { name: 'إدارة نسخ التصميم' })).getByText('نسخة أ').closest('li') as HTMLElement;
    await user.click(within(rowA).getByRole('button', { name: 'فتح للتعديل' }));
    await waitFor(() => expect(root().getAttribute('data-selected-version-id')).toBe('a'));
    await user.click(screen.getByRole('button', { name: 'التوثيق والثقة' }));
    await user.type(field(), 'تعديل');
    expect(root().getAttribute('data-can-undo')).toBe('true');
    return user;
  }

  async function switchToB(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByLabelText('نسخة التصميم قيد التعديل'));
    const rowB = within(screen.getByRole('menu', { name: 'إدارة نسخ التصميم' })).getByText('نسخة ب').closest('li') as HTMLElement;
    await user.click(within(rowB).getByRole('button', { name: 'فتح للتعديل' }));
  }

  it('declining the discard confirmation keeps the edit and its Undo history; confirming switches and drops the history', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const user = await mountTwoVersions();

    await switchToB(user);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(root().getAttribute('data-selected-version-id')).toBe('a');
    expect(field().value).toContain('تعديل');
    expect(root().getAttribute('data-can-undo')).toBe('true');

    await switchToB(user);
    await waitFor(() => expect(root().getAttribute('data-selected-version-id')).toBe('b'));
    expect(root().getAttribute('data-can-undo')).toBe('false');
    expect(root().getAttribute('data-lifecycle')).toBe('clean');
  });
});
