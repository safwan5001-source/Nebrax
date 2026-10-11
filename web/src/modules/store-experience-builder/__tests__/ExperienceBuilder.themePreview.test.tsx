/**
 * @vitest-environment jsdom
 *
 * CUST-HV V10b (V0 §16) — Theme Preview in the builder: the Canvas shows the merchant's own document with the theme applied
 * (unsaved, read-only), the Apply summary lists what changes and what is kept, editing and Save/Publish are inert, and the one
 * write — "Apply as a new draft" — goes through a new Draft Version.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listMock = vi.fn();
const showMock = vi.fn();
const saveMock = vi.fn();
const createMock = vi.fn();
const deleteMock = vi.fn();

vi.mock('@/modules/commerce-workspace/presentation-versions', () => ({
  listPresentationVersions: (...args: unknown[]) => listMock(...args),
  showPresentationVersion: (...args: unknown[]) => showMock(...args),
  createPresentationVersion: (...args: unknown[]) => createMock(...args),
  savePresentationVersion: (...args: unknown[]) => saveMock(...args),
  renamePresentationVersion: vi.fn(),
  deletePresentationVersion: (...args: unknown[]) => deleteMock(...args),
}));
vi.mock('@/modules/commerce-workspace/workspace-products', () => ({
  listWorkspaceProducts: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  showWorkspaceProduct: vi.fn(),
}));

import { DEFAULT_PRESENTATION_CONFIG } from '../presentation';
import { ExperienceBuilder } from '../ExperienceBuilder';

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'v1',
    storefrontId: 'store-1',
    name: 'Current design',
    state: 'published',
    schemaVersion: 3,
    revision: 5,
    scheduledFor: null,
    lastPublishedAt: '2026-09-01T00:00:00.000Z',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    publishedRevision: 5,
    scheduleToken: 'opaque',
    schedulingRuntimeActive: true,
    ...overrides,
  };
}

const hrefSet = vi.fn();
const originalLocation = window.location;

function renderPreview(themeId = 'awj-market') {
  return render(
    <ExperienceBuilder
      storefrontId="store-1"
      versionId="v1"
      previewThemeId={themeId}
      initialLocale="en"
      liveStoreName="Shop"
    />,
  );
}

describe('ExperienceBuilder — Theme Preview (V10b)', () => {
  beforeEach(() => {
    listMock.mockResolvedValue({ ok: true, data: [summary()] });
    showMock.mockResolvedValue({ ok: true, data: { ...summary(), config: DEFAULT_PRESENTATION_CONFIG } });
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        href: 'http://localhost/commerce/appearance?version=v1&previewTheme=awj-market',
        search: '?version=v1&previewTheme=awj-market',
        set assign(_v: unknown) {},
      },
    });
    Object.defineProperty(window.location, 'href', {
      configurable: true,
      get: () => 'http://localhost/commerce/appearance?version=v1&previewTheme=awj-market',
      set: (value: string) => hrefSet(value),
    });
  });

  afterEach(() => {
    cleanup();
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    for (const mock of [listMock, showMock, saveMock, createMock, deleteMock, hrefSet]) mock.mockReset();
  });

  async function ready() {
    renderPreview();
    await waitFor(() => expect(document.querySelector('[data-theme-preview-bar]')).not.toBeNull());
    await waitFor(() => expect(showMock).toHaveBeenCalled());
  }

  it('shows the preview bar with the Apply summary and what is kept; editing is inert; nothing is written', async () => {
    await ready();
    const bar = document.querySelector('[data-theme-preview-bar]') as HTMLElement;
    expect(within(bar).getByText('AWJ Market')).toBeTruthy();
    expect(bar.querySelectorAll('[data-theme-area]')).toHaveLength(10);
    expect(bar.querySelector('[data-theme-area="identity"]')?.hasAttribute('data-changed')).toBe(true);
    expect(bar.querySelector('[data-theme-kept]')?.textContent).toContain('Text and content');
    expect(bar.querySelector('[data-theme-kept]')?.textContent).toContain('Section order');

    expect(document.querySelector('[data-builder-controls]')?.hasAttribute('inert')).toBe(true);
    expect(document.querySelector('nav[data-customizer-scroll]')?.hasAttribute('inert')).toBe(true);
    expect(saveMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('renders the Canvas with the theme applied (the preview is the document, themed)', async () => {
    await ready();
    const frame = document.querySelector('[data-preview-frame]') as HTMLElement;
    // AWJ Market sets compact density + the Market preset; the Canvas carries them
    expect(frame.innerHTML).toContain('data-gt="hz hw hs-plain b-sz b-rad shd cd-ir cd-hv mo-d mo-e"');
    expect(frame.querySelector('[data-hd="hh-c hs-u"]')).not.toBeNull();
  });

  it('Apply creates a new draft from the previewed document and opens it', async () => {
    createMock.mockResolvedValue({ ok: true, data: { id: 'v-new', storefrontId: 'store-1', revision: 1, config: DEFAULT_PRESENTATION_CONFIG } });
    saveMock.mockResolvedValue({ ok: true, data: {} });
    const user = userEvent.setup();
    await ready();

    await user.click(document.querySelector('[data-theme-apply]') as HTMLElement);
    await waitFor(() => expect(hrefSet).toHaveBeenCalledWith('/commerce/appearance?version=v-new'));
    expect(createMock).toHaveBeenCalledWith('store-1', 'AWJ Market — Theme preview');
    expect(saveMock.mock.calls[0][2]).toMatchObject({ themePreset: 'awj-market', primaryColor: '#0f766e' });
    expect(saveMock.mock.calls[0][1]).toBe('v-new');
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('a failed apply says so, rolls back, and stays in the preview', async () => {
    createMock.mockResolvedValue({ ok: true, data: { id: 'v-new', storefrontId: 'store-1', revision: 1, config: DEFAULT_PRESENTATION_CONFIG } });
    saveMock.mockResolvedValue({ ok: false, reason: 'conflict' });
    deleteMock.mockResolvedValue(true);
    const user = userEvent.setup();
    await ready();

    await user.click(document.querySelector('[data-theme-apply]') as HTMLElement);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/published store was not changed/));
    expect(deleteMock).toHaveBeenCalledWith('store-1', 'v-new');
    expect(hrefSet).not.toHaveBeenCalled();
    expect(document.querySelector('[data-theme-preview-bar]')).not.toBeNull();
  });

  it('Exit returns to the normal editor, with nothing written', async () => {
    const user = userEvent.setup();
    const replace = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
    await ready();

    await user.click(document.querySelector('[data-theme-exit]') as HTMLElement);
    expect(document.querySelector('[data-theme-preview-bar]')).toBeNull();
    expect(document.querySelector('[data-builder-controls]')?.hasAttribute('inert')).toBe(false);
    expect(replace).toHaveBeenCalled();
    expect(String(replace.mock.calls[0][2])).not.toContain('previewTheme');
    expect(saveMock).not.toHaveBeenCalled();
    replace.mockRestore();
  });

  it('an unknown theme id opens the normal editor', async () => {
    render(<ExperienceBuilder storefrontId="store-1" versionId="v1" previewThemeId="nope" initialLocale="en" />);
    await waitFor(() => expect(showMock).toHaveBeenCalled());
    expect(document.querySelector('[data-theme-preview-bar]')).toBeNull();
  });
});
