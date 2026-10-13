/**
 * @vitest-environment jsdom
 *
 * CUST-H5-6 — the H5 features verified together, as one product: one editing session mixing settings and structural edits is
 * undone/redone as a unit; a Draft that becomes Published (or a Scheduled Version) behaves per the lifecycle contract; and the
 * presentation document is never persisted in browser storage (reload discards local history honestly — §3.7).
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const listMock = vi.fn();
const showMock = vi.fn();
const saveMock = vi.fn();
const publishMock = vi.fn();
const revListMock = vi.fn();

vi.mock('@/modules/commerce-workspace/presentation-versions', () => ({
  listPresentationVersions: (...args: unknown[]) => listMock(...args),
  showPresentationVersion: (...args: unknown[]) => showMock(...args),
  createPresentationVersion: vi.fn(),
  savePresentationVersion: (...args: unknown[]) => saveMock(...args),
  renamePresentationVersion: vi.fn(),
  deletePresentationVersion: vi.fn(),
  publishPresentationVersion: (...args: unknown[]) => publishMock(...args),
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
    revision: 4,
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

async function mount(version: Record<string, unknown> = {}, locale: 'en' | 'ar' = 'en') {
  listMock.mockResolvedValue({ ok: true, data: [summary(version)] });
  showMock.mockResolvedValue({ ok: true, data: detail(version) });
  revListMock.mockResolvedValue({ ok: true, data: [] });
  const user = userEvent.setup();
  render(<ExperienceBuilder storefrontId="store-1" initialLocale={locale} />);
  await waitFor(() => expect(document.querySelector('[data-selected-version-id="v1"]')).toBeTruthy());
  return user;
}

const root = () => document.querySelector('[data-experience-builder]') as HTMLElement;
const undoBtn = () => document.querySelector('[data-history-action="undo"]') as HTMLButtonElement;
const redoBtn = () => document.querySelector('[data-history-action="redo"]') as HTMLButtonElement;
const sectionOrder = () => Array.from(document.querySelectorAll('[data-section-id]')).map((el) => el.getAttribute('data-section-id'));

afterEach(() => {
  cleanup();
  for (const mock of [listMock, showMock, saveMock, publishMock, revListMock]) mock.mockReset();
  vi.restoreAllMocks();
});

describe('CUST-H5-6 — Undo/Redo over mixed settings and structural edits', () => {
  it('a session mixing a text setting, a discrete setting and a section move is undone and redone step by step, and Save is the boundary', async () => {
    const user = await mount();

    // settings (text) → settings (discrete) → structure (reorder)
    await user.click(screen.getByRole('button', { name: 'Verification & trust' }));
    const field = () => screen.getAllByRole('textbox')[0] as HTMLInputElement;
    await user.type(field(), 'abc');
    await user.click(document.querySelector('[data-panel-option="theme"]') as HTMLElement);
    const font = screen.getByRole('combobox', { name: 'Typography' }) as HTMLSelectElement;
    const originalFont = font.value;
    const otherFont = Array.from(font.options).find((o) => o.value !== originalFont)!.value;
    await user.selectOptions(font, otherFont);
    await user.click(document.querySelector('[data-panel-option="homepage"]') as HTMLElement);
    const originalOrder = sectionOrder();
    expect(originalOrder.length).toBeGreaterThanOrEqual(2);
    const firstRow = document.querySelector(`[data-section-id="${originalOrder[0]}"]`) as HTMLElement;
    await user.click(within(firstRow).getByRole('button', { name: 'Down' }));
    const movedOrder = sectionOrder();
    expect(movedOrder).not.toEqual(originalOrder);
    expect(root().getAttribute('data-lifecycle')).toBe('dirty');

    // Undo ×3 walks back through structure, then the discrete setting, then the text — in that order.
    await user.click(undoBtn());
    expect(sectionOrder()).toEqual(originalOrder);
    await user.click(document.querySelector('[data-panel-option="theme"]') as HTMLElement);
    expect((screen.getByRole('combobox', { name: 'Typography' }) as HTMLSelectElement).value).toBe(otherFont);
    await user.click(undoBtn());
    expect((screen.getByRole('combobox', { name: 'Typography' }) as HTMLSelectElement).value).toBe(originalFont);
    await user.click(screen.getByRole('button', { name: 'Verification & trust' }));
    expect(field().value).toBe('abc');
    await user.click(undoBtn());
    expect(field().value).toBe('');
    expect(root().getAttribute('data-lifecycle')).toBe('clean');
    expect(undoBtn().getAttribute('aria-disabled')).toBe('true');

    // Redo ×3 replays it all.
    await user.click(redoBtn());
    await user.click(redoBtn());
    await user.click(redoBtn());
    expect(redoBtn().getAttribute('aria-disabled')).toBe('true');
    expect(field().value).toBe('abc');
    await user.click(document.querySelector('[data-panel-option="homepage"]') as HTMLElement);
    expect(sectionOrder()).toEqual(movedOrder);

    // Save is the hard boundary.
    saveMock.mockResolvedValueOnce({ ok: true, data: detail({ revision: 5 }) });
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(root().getAttribute('data-selected-version-revision')).toBe('5'));
    expect(undoBtn().getAttribute('aria-disabled')).toBe('true');
    expect(redoBtn().getAttribute('aria-disabled')).toBe('true');
  });
});

describe('CUST-H5-6 — lifecycle interactions', () => {
  it('Publishing a Draft that still has a Redo branch clears the history and leaves the editor read-only', async () => {
    const user = await mount();
    await user.click(screen.getByRole('button', { name: 'Verification & trust' }));
    await user.type(screen.getAllByRole('textbox')[0], 'x');
    await user.click(undoBtn()); // clean again, with a Redo branch left behind
    expect(root().getAttribute('data-lifecycle')).toBe('clean');
    expect(redoBtn().getAttribute('aria-disabled')).toBe('false');
    publishMock.mockResolvedValueOnce({ ok: true, data: detail({ state: 'published', publishedRevision: 1 }) });

    await user.click(screen.getByRole('button', { name: 'Publish' }));
    await user.click(screen.getByRole('button', { name: 'Publish now' }));

    await waitFor(() => expect(root().getAttribute('data-selected-version-state')).toBe('published'));
    expect(root().getAttribute('data-can-undo')).toBe('false');
    expect(document.querySelector('[data-history-action="redo"]')).toBeTruthy();
    expect(redoBtn().getAttribute('aria-disabled')).toBe('true');
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('a Scheduled Version is still an editable draft for history: Undo works and nothing is saved by it', async () => {
    const user = await mount({ state: 'scheduled', scheduledFor: '2026-12-01T00:00:00.000Z' });
    await user.click(screen.getByRole('button', { name: 'Verification & trust' }));
    await user.type(screen.getAllByRole('textbox')[0], 'x');
    expect(root().getAttribute('data-can-undo')).toBe('true');

    await user.click(undoBtn());

    expect(root().getAttribute('data-lifecycle')).toBe('clean');
    expect(saveMock).not.toHaveBeenCalled();
    expect(publishMock).not.toHaveBeenCalled();
  });

  it('Published offers saved-history recovery (Create draft) but no Undo/Redo', async () => {
    const user = await mount({ state: 'published', publishedRevision: 4 });
    expect(root().getAttribute('data-can-undo')).toBe('false');
    expect(undoBtn().getAttribute('aria-disabled')).toBe('true');
    await user.click(document.querySelector('[data-history-open]') as HTMLElement);
    await waitFor(() => expect(revListMock).toHaveBeenCalledWith('store-1', 'v1'));
  });
});

describe('CUST-H5-6 — reload / close policy (§3.7)', () => {
  const root_ = join(__dirname, '..');

  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sources(full);
      return /\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : [];
    });
  }

  it('the history modules use no browser storage at all', () => {
    for (const file of sources(join(root_, 'history'))) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
    }
  });

  it('the Customizer persists exactly one thing in browser storage — the sidebar preference — never the presentation document', () => {
    const source = readFileSync(join(root_, 'ExperienceBuilder.tsx'), 'utf8');
    const uses = source.match(/(?:localStorage|sessionStorage|indexedDB)[^\n]*/g) ?? [];
    expect(uses.length).toBeGreaterThan(0);
    const calls = source.match(/window\.localStorage\.(?:setItem|getItem)\(\s*[^,)]+/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toContain('STORE_BUILDER_SIDEBAR_STORAGE_KEY');
    expect(source).not.toMatch(/sessionStorage|indexedDB/);
  });

  it('closing or reloading with unsaved edits asks first; with a clean draft it does not', async () => {
    const user = await mount();
    const leave = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(leave()).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Verification & trust' }));
    await user.type(screen.getAllByRole('textbox')[0], 'x');
    expect(leave()).toBe(true);

    await user.click(undoBtn()); // back to the saved document
    expect(leave()).toBe(false);
  });

  it('nothing is written to localStorage while editing, undoing, saving or restoring', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const user = await mount();
    setItem.mockClear();
    await user.click(screen.getByRole('button', { name: 'Verification & trust' }));
    await user.type(screen.getAllByRole('textbox')[0], 'secret-ish');
    await user.click(undoBtn());
    await user.click(redoBtn());
    saveMock.mockResolvedValueOnce({ ok: true, data: detail({ revision: 5 }) });
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(root().getAttribute('data-selected-version-revision')).toBe('5'));
    const documentWrites = setItem.mock.calls.filter(([, value]) => String(value).includes('secret-ish') || String(value).includes('themePreset'));
    expect(documentWrites).toEqual([]);
  });
});
