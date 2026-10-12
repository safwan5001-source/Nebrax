/**
 * @vitest-environment jsdom
 *
 * CUST-HV V10d (V0 §17.2) — the Canvas hover action bar: move / hide / duplicate / delete are the shared section operations, committed
 * as ordinary draft edits; the bar exists only while editing the Home page of a Draft.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listMock = vi.fn();
const showMock = vi.fn();
const saveMock = vi.fn();

vi.mock('@/modules/commerce-workspace/presentation-versions', () => ({
  listPresentationVersions: (...args: unknown[]) => listMock(...args),
  showPresentationVersion: (...args: unknown[]) => showMock(...args),
  createPresentationVersion: vi.fn(),
  savePresentationVersion: (...args: unknown[]) => saveMock(...args),
  renamePresentationVersion: vi.fn(),
  deletePresentationVersion: vi.fn(),
}));
vi.mock('@/modules/commerce-workspace/workspace-products', () => ({
  listWorkspaceProducts: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  showWorkspaceProduct: vi.fn(),
}));

import { DEFAULT_PRESENTATION_CONFIG, normalizePresentationConfig } from '../presentation';
import { ExperienceBuilder } from '../ExperienceBuilder';

const config = normalizePresentationConfig({
  ...DEFAULT_PRESENTATION_CONFIG,
  homepage: {
    ...DEFAULT_PRESENTATION_CONFIG.homepage,
    sections: [
      { id: 'hero', type: 'hero', visible: true },
      { id: 'cat', type: 'categories', visible: true },
      { id: 'ben', type: 'benefits', visible: true, content: { items: [{ id: 'b1', title: 'شحن', text: 'سريع' }] } },
    ],
  },
});

function summary(state: 'draft' | 'published') {
  return {
    id: 'v1', storefrontId: 'store-1', name: 'Design', state, schemaVersion: 3, revision: 5, scheduledFor: null,
    lastPublishedAt: null, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    publishedRevision: state === 'published' ? 5 : null, scheduleToken: 'tok', schedulingRuntimeActive: true,
  };
}

function mountBuilder(state: 'draft' | 'published' = 'draft', extra: Record<string, unknown> = {}) {
  listMock.mockResolvedValue({ ok: true, data: [summary(state)] });
  showMock.mockResolvedValue({ ok: true, data: { ...summary(state), config } });
  return render(<ExperienceBuilder storefrontId="store-1" versionId="v1" initialLocale="en" liveStoreName="Shop" {...extra} />);
}
const bar = (id: string) => document.querySelector<HTMLElement>(`[data-section-actions="${id}"]`);
const action = (id: string, name: string) => bar(id)?.querySelector<HTMLElement>(`[data-section-action="${name}"]`) as HTMLElement;
const canvasOrder = () => Array.from(document.querySelectorAll('[data-preview-section-id]')).map((n) => n.getAttribute('data-preview-section-id'));
const ready = () => waitFor(() => expect(bar('hero')).not.toBeNull());

describe('Canvas section action bar (V10d)', () => {
  beforeEach(() => {});
  afterEach(() => {
    cleanup();
    for (const m of [listMock, showMock, saveMock]) m.mockReset();
  });

  it('is a labelled toolbar inside each section wrapper; edges disable their move', async () => {
    mountBuilder();
    await ready();
    expect(bar('hero')?.getAttribute('role')).toBe('toolbar');
    expect(bar('hero')?.parentElement?.getAttribute('data-preview-section-id')).toBe('hero');
    expect(action('hero', 'up').hasAttribute('disabled')).toBe(true);
    expect(action('hero', 'down').hasAttribute('disabled')).toBe(false);
    expect(action('ben', 'down').hasAttribute('disabled')).toBe(true);
  });

  it('move reorders the Canvas, dirties the draft, and does not select the section', async () => {
    const user = userEvent.setup();
    mountBuilder();
    await ready();
    await user.click(action('cat', 'down'));
    expect(canvasOrder()).toEqual(['hero', 'ben', 'cat']);
    expect(document.querySelector('[data-experience-builder]')?.getAttribute('data-lifecycle')).toBe('dirty');
  });

  it('hide removes the section from the Canvas (it stays in the list to show again)', async () => {
    const user = userEvent.setup();
    mountBuilder();
    await ready();
    await user.click(action('cat', 'hide'));
    expect(canvasOrder()).toEqual(['hero', 'ben']);
  });

  it('duplicate adds a copy right after, with design and a suffixed name, and selects it', async () => {
    const user = userEvent.setup();
    mountBuilder();
    await ready();
    await user.click(action('ben', 'duplicate'));
    const order = canvasOrder();
    expect(order).toHaveLength(4);
    expect(order[2]).toBe('ben');
    expect(document.querySelector('[data-experience-builder]')?.getAttribute('data-selected-section')).toBe(order[3]);
  });

  it('deleting an empty section is immediate; one with content asks first, inline, and Cancel keeps it', async () => {
    const user = userEvent.setup();
    mountBuilder();
    await ready();
    await user.click(action('cat', 'remove'));
    expect(canvasOrder()).toEqual(['hero', 'ben']);

    await user.click(action('ben', 'remove'));
    expect(canvasOrder()).toEqual(['hero', 'ben']);
    expect(action('ben', 'confirm-remove')).not.toBeNull();
    await user.click(action('ben', 'cancel-remove'));
    expect(canvasOrder()).toEqual(['hero', 'ben']);
    await user.click(action('ben', 'remove'));
    await user.click(action('ben', 'confirm-remove'));
    expect(canvasOrder()).toEqual(['hero']);
  });

  it('clicks on the bar never select the section', async () => {
    const user = userEvent.setup();
    mountBuilder();
    await ready();
    await user.click(action('cat', 'down'));
    expect(document.querySelector('[data-experience-builder]')?.getAttribute('data-selected-section')).toBe('');
  });

  it('there is no bar on a Published Version or in Theme Preview', async () => {
    mountBuilder('published');
    await waitFor(() => expect(showMock).toHaveBeenCalled());
    await waitFor(() => expect(document.querySelector('[data-preview-section-id]')).not.toBeNull());
    expect(document.querySelector('[data-section-actions]')).toBeNull();
    cleanup();

    mountBuilder('draft', { previewThemeId: 'awj-market' });
    await waitFor(() => expect(document.querySelector('[data-theme-preview-bar]')).not.toBeNull());
    await waitFor(() => expect(document.querySelector('[data-preview-section-id]')).not.toBeNull());
    expect(document.querySelector('[data-section-actions]')).toBeNull();
  });
});
