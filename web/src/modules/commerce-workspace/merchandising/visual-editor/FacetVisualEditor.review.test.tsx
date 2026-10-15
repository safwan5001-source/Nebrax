/**
 * @vitest-environment jsdom
 */
// VD-3 review follow-up: focus, restore focus, touch targets, the save guard, every refusal's own message, and the
// smaller fixes (announce once, no remount while saving, errors cleared on edit).
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: (...args: unknown[]) => apiMock(...args),
}));
vi.mock('@/modules/store-experience-builder/media/use-media-capability', () => ({ useMediaCapability: () => 'available' }));
vi.mock('@/modules/commerce-workspace/storefront-media', async (original) => ({
  ...(await original<typeof import('@/modules/commerce-workspace/storefront-media')>()),
  listStorefrontMedia: vi.fn(),
  fetchStorefrontMediaAsset: vi.fn(),
  ensureUsage: vi.fn(),
  usageStatus: vi.fn(),
}));

import { ApiError } from '@/lib/api';
import { commerceWorkspaceMessage } from '@/modules/commerce-workspace/messages';
import * as library from '@/modules/commerce-workspace/storefront-media';
import { asset, page, usage } from '@/modules/store-experience-builder/__tests__/media-fixtures';
import { FacetVisualEditor, type FacetVisualEditorProps } from './FacetVisualEditor';
import { MEDIA_A, PREVIEW_A, facetOf, rawValue } from './test-fixtures';
import { touchTargetViolations } from './test-touch-targets';

const fetchAsset = vi.mocked(library.fetchStorefrontMediaAsset);
const tEn = (key: Parameters<typeof commerceWorkspaceMessage>[1]) => commerceWorkspaceMessage('en', key);

function targetOf(valueOver: Record<string, unknown> = {}) {
  const facet = facetOf({ values: [rawValue({ id: 'v1', name: 'Wedding', name_en: null }), rawValue(valueOver)] });
  return { kind: 'value' as const, facet, value: facet.values[1] };
}

type Opts = Partial<Omit<FacetVisualEditorProps, 'target'>> & { value?: Record<string, unknown> };

function mount(opts: Opts = {}) {
  const { value = {}, ...rest } = opts;
  const handlers = { onClose: vi.fn(), onSaved: vi.fn(), onReload: vi.fn() };
  const view = render(
    <FacetVisualEditor target={targetOf(value)} locale="en" t={tEn} canManageData canManageIdentity {...handlers} {...rest} />,
  );
  return { ...view, ...handlers };
}

const tab = (name: RegExp | string) => screen.getByRole('tab', { name });
const save = () => userEvent.click(screen.getByRole('button', { name: 'Save' }));
const visualCalls = () => apiMock.mock.calls.filter(([path]) => String(path).endsWith('/visual'));

beforeEach(() => {
  fetchAsset.mockReset();
  fetchAsset.mockResolvedValue(asset());
  vi.mocked(library.listStorefrontMedia).mockReset();
  vi.mocked(library.listStorefrontMedia).mockResolvedValue(page([asset()]));
  vi.mocked(library.usageStatus).mockResolvedValue(usage());
  vi.mocked(library.ensureUsage).mockResolvedValue(usage());
});
afterEach(() => {
  cleanup();
  apiMock.mockReset();
});

// ── F1: focus returns to the opener ─────────────────────────────────────────────

function Host({ fallback = false, valueOver = {} }: { fallback?: boolean; valueOver?: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const [follow, setFollow] = useState(false);
  return (
    <>
      <button type="button" data-open-editor="v2" onClick={() => (fallback ? setFollow(true) : setOpen(true))}>
        opener
      </button>
      {follow && !open ? (
        // the quick-add follow-up: its button is replaced by the editor, so it cannot get the focus back
        <button type="button" onClick={() => { setFollow(false); setOpen(true); }}>
          Customize appearance
        </button>
      ) : null}
      {open ? (
        <FacetVisualEditor
          target={targetOf(valueOver)}
          locale="en"
          t={tEn}
          canManageData
          canManageIdentity
          returnFocusTo={() => document.querySelector<HTMLElement>('[data-open-editor="v2"]')}
          onClose={() => setOpen(false)}
          onSaved={() => setOpen(false)}
          onReload={() => undefined}
        />
      ) : null}
    </>
  );
}

describe('focus returns to the opener (F1)', () => {
  async function openFrom(name: string) {
    await userEvent.click(screen.getByRole('button', { name }));
    await screen.findByRole('dialog');
  }
  const opener = () => screen.getByRole('button', { name: 'opener' });

  it('after Escape', async () => {
    render(<Host />);
    await openFrom('opener');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener()));
  });

  it('after Cancel', async () => {
    render(<Host />);
    await openFrom('opener');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener()));
  });

  it('after a successful save', async () => {
    apiMock.mockResolvedValue({ data: { value: { id: 'v2', slug: 'birthday', name: 'Birthday 2' } } });
    render(<Host />);
    await openFrom('opener');
    await userEvent.type(screen.getByLabelText('Arabic name'), ' 2');
    await save();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener()));
  });

  it('after a discard confirmation', async () => {
    render(<Host />);
    await openFrom('opener');
    await userEvent.type(screen.getByLabelText('Arabic name'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener()));
  });

  it('when it was opened from «Customize appearance» (a button the editor replaced) it returns to the row’s edit button', async () => {
    render(<Host fallback />);
    await userEvent.click(opener());
    await openFrom('Customize appearance');
    expect(screen.queryByRole('button', { name: 'Customize appearance' })).toBeNull();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener()));
  });
});

// ── F2: restoring inheritance keeps focus on a control ───────────────────────────

describe('«Restore inheritance» keeps focus inside the editor (F2)', () => {
  const body = () => document.body;
  const container = () => screen.getByRole('dialog');

  it('moves focus to the restored shape control', async () => {
    mount({ value: { visual: { shape: 'star' }, visual_version: 1 } });
    await userEvent.click(tab('Appearance'));
    const restore = screen.getByRole('button', { name: 'Restore inheritance — Shape' });
    await userEvent.click(restore);
    expect(restore.isConnected).toBe(false);
    await waitFor(() => expect(document.activeElement).not.toBe(body()));
    expect(document.activeElement).not.toBe(container());
    expect(document.activeElement?.closest('[data-prop="shape"]')).toBeTruthy();
    expect(document.activeElement?.getAttribute('aria-pressed')).toBe('true');
  });

  it('moves focus to the restored size option, and to the switch for the label', async () => {
    mount({ value: { visual: { size: 'sm', showLabel: false }, visual_version: 1 } });
    await userEvent.click(tab('Appearance'));
    await userEvent.click(screen.getByRole('button', { name: 'Restore inheritance — Size' }));
    await waitFor(() => expect(document.activeElement?.closest('[data-prop="size"]')).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: 'Restore inheritance — Show the name' }));
    await waitFor(() => expect(document.activeElement?.closest('[data-prop="showLabel"]')).toBeTruthy());
    expect(document.activeElement).not.toBe(container());
  });
});

// ── F3: touch targets ─────────────────────────────────────────────────────────────

describe('touch targets are at least 44 px (F3)', () => {
  it('the helper really rejects a small or shrinking target', () => {
    const host = document.createElement('div');
    host.innerHTML =
      '<button class="h-9 w-9">a</button><button class="min-h-11 md:min-h-8">b</button><button class="size-11 max-md:size-9">c</button><button class="min-h-11">ok</button>';
    expect(touchTargetViolations(host)).toHaveLength(3);
  });

  const full = { value: { visual: { content: 'icon', icon: 'gift', iconColor: '#112233', background: '#ffeedd' }, visual_version: 1 } };

  it.each(['Data', 'Image & icon', 'Appearance'])('every interactive element in the %s tab (and the sheet chrome)', async (name) => {
    mount(full);
    await userEvent.click(tab(name));
    expect(touchTargetViolations(screen.getByRole('dialog'))).toEqual([]);
  });

  it('the image tab with a picture (media field, alt, decorative) and the dimension editor', async () => {
    mount({ initialTab: 'image', value: { visual: { content: 'image', image: { mediaId: MEDIA_A } }, visual_version: 2, visual_preview: PREVIEW_A } });
    await screen.findByText('storefront-hero.jpg');
    expect(touchTargetViolations(screen.getByRole('dialog'))).toEqual([]);
    cleanup();
    render(
      <FacetVisualEditor
        target={{ kind: 'facet', facet: facetOf() }}
        locale="en"
        t={tEn}
        canManageData
        canManageIdentity
        initialTab="image"
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onReload={vi.fn()}
      />,
    );
    expect(touchTargetViolations(screen.getByRole('dialog'))).toEqual([]);
  });

  it('the Status and Show-the-name switches are reached through a row-sized label', async () => {
    mount(full);
    const status = screen.getByRole('switch', { name: 'Status' }) as HTMLButtonElement;
    expect(status.labels?.[0]?.className).toContain('min-h-11');
    // clicking the label's text toggles it
    await userEvent.click(screen.getByText('Active'));
    expect(status.getAttribute('aria-checked')).toBe('false');
    await userEvent.click(tab('Appearance'));
    const showName = screen.getByRole('switch', { name: 'Show the name' }) as HTMLButtonElement;
    expect(showName.labels?.[0]?.className).toContain('min-h-11');
    await userEvent.click(screen.getByText(/The name stays available/));
    expect(showName.getAttribute('aria-checked')).toBe('false');
  });
});

// ── F4: the save guard itself ─────────────────────────────────────────────────────

describe('the double-submit guard (F4)', () => {
  it('two clicks on the ENABLED Save button in one act send one request per part', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    apiMock.mockImplementation(() => new Promise((r) => { resolve = r; }));
    mount({ value: { visual: { shape: 'star' }, visual_version: 3 } });
    await userEvent.type(screen.getByLabelText('Arabic name'), ' 2');
    await userEvent.click(tab('Appearance'));
    await userEvent.click(screen.getByRole('button', { name: 'Square' }));
    const button = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    // one batch: React has not re-rendered (so `saving` is still false) between the two clicks
    act(() => {
      button.click();
      button.click();
    });
    expect(apiMock).toHaveBeenCalledTimes(1); // the data part, once

    resolve({ data: { value: { id: 'v2', slug: 'birthday', name: 'Birthday 2' } } });
    await waitFor(() => expect(visualCalls()).toHaveLength(1));
    resolve({ data: { visual: { shape: 'square' }, version: 4 } });
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
  });
});

// ── F5: each refusal has its own message ──────────────────────────────────────────

describe('every refusal of the identity write has its own message (F5)', () => {
  async function failWith(error: unknown, tabName = 'Appearance') {
    apiMock.mockRejectedValue(error);
    const view = mount({ initialTab: 'appearance', value: { visual: { shape: 'star' }, visual_version: 3 } });
    expect(tabName).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Square' }));
    await save();
    await waitFor(() => expect(visualCalls()).toHaveLength(1));
    return view;
  }
  const results = () => document.querySelector('[data-save-part="visual"]') as HTMLElement;

  it('403 says the identity needs the e-commerce permission', async () => {
    const { onSaved } = await failWith(new ApiError(403, 'forbidden', {}));
    expect(await screen.findByText(/requires the e-commerce management permission/, { selector: '[role=alert] *, [role=alert]' })).toBeTruthy();
    expect(results().querySelector('button')).toBeNull();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('404 says it no longer exists and offers a reload, never a retry', async () => {
    const { onReload } = await failWith(new ApiError(404, 'gone', {}));
    expect(await screen.findByText(/no longer exists; another user may have deleted it/)).toBeTruthy();
    await userEvent.click(within(results()).getByRole('button', { name: 'Reload' }));
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(visualCalls()).toHaveLength(1);
  });

  it('429 says to wait and try again, with no reload and no automatic retry', async () => {
    await failWith(new ApiError(429, 'slow down', {}));
    expect(await screen.findByText(/Too many requests in a short time\. Wait a moment/)).toBeTruthy();
    expect(results().querySelector('button')).toBeNull();
    expect(visualCalls()).toHaveLength(1);
    // the user can press Save again
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('500 is a server error, distinct from 404, 429 and a network failure', async () => {
    await failWith(new ApiError(500, 'boom', {}));
    expect(await screen.findByText(/because of a server error\. Nothing changed/)).toBeTruthy();
    expect(screen.queryByText(/Too many requests/)).toBeNull();
    expect(screen.queryByText(/Could not reach the server/)).toBeNull();
  });

  it('a network failure says the server could not be reached', async () => {
    await failWith(new TypeError('network'));
    expect(await screen.findByText(/Could not reach the server\. Check your connection/)).toBeTruthy();
    expect(screen.queryByText(/because of a server error/)).toBeNull();
  });

  it('an unexpected status falls back to the generic message', async () => {
    await failWith(new ApiError(418, 'teapot', {}));
    expect(await screen.findByText(tEn('merchSaveFailed'))).toBeTruthy();
  });

  it('the messages exist in Arabic as well', async () => {
    apiMock.mockRejectedValue(new ApiError(429, 'x', {}));
    mount({ locale: 'ar', t: (key) => commerceWorkspaceMessage('ar', key), initialTab: 'appearance', value: { visual: { shape: 'star' }, visual_version: 3 } });
    await userEvent.click(screen.getByRole('button', { name: 'مربع' }));
    await userEvent.click(screen.getByRole('button', { name: 'حفظ' }));
    expect(await screen.findByText(/طلبات كثيرة في وقت قصير/)).toBeTruthy();
  });
});

// ── F6: smaller fixes ─────────────────────────────────────────────────────────────

describe('smaller review fixes (F6)', () => {
  it('a tab with an error reads «Image & icon, This tab has an error»', async () => {
    apiMock.mockRejectedValue(new ApiError(422, 'bad', { code: 'visual_invalid', errors: { 'visual.icon': ['unknown_icon'] } }));
    mount({ value: { visual: { content: 'icon', icon: 'gift' }, visual_version: 1 } });
    await userEvent.click(tab('Image & icon'));
    await userEvent.click(screen.getByRole('button', { name: 'Heart' }));
    await save();
    expect(await screen.findByRole('tab', { name: 'Image & icon, This tab has an error' })).toBeTruthy();
  });

  it('a 2.995:1 pair reads «2.99:1», never «3.00:1» next to a «below 3:1» warning', () => {
    mount({ initialTab: 'image', value: { visual: { content: 'icon', icon: 'gift', iconColor: '#959595', background: '#ffffff' }, visual_version: 1 } });
    expect(screen.getByText(/contrast is 2\.99:1, below 3:1/)).toBeTruthy();
    expect(screen.queryByText(/3\.00/)).toBeNull();
  });

  it('a server field error is announced once: the footer copy is visual only', async () => {
    apiMock.mockRejectedValue(new ApiError(422, 'bad', { code: 'visual_invalid', errors: { 'visual.shape': ['unknown_shape'] } }));
    mount({ initialTab: 'appearance' });
    await userEvent.click(screen.getByRole('button', { name: 'Square' }));
    await save();
    const inline = await screen.findAllByText('Unknown shape.');
    expect(inline).toHaveLength(1);
    expect(inline[0].closest('[role=alert]')).toBeTruthy();
    const footer = document.querySelector('[data-visual-error="own:shape"]') as HTMLElement;
    expect(footer.getAttribute('aria-hidden')).toBe('true');
    expect(footer.closest('[role=alert]')).toBeNull();
  });

  it('editing the control clears its server error, its tab dot and the «invalid» line', async () => {
    apiMock.mockRejectedValue(new ApiError(422, 'bad', { code: 'visual_invalid', errors: { 'visual.shape': ['unknown_shape'] } }));
    mount({ initialTab: 'appearance' });
    await userEvent.click(screen.getByRole('button', { name: 'Square' }));
    await save();
    await screen.findByText('Unknown shape.');
    expect(screen.getByRole('tab', { name: /Appearance, This tab has an error/ })).toBeTruthy();

    // another control: the error stays
    await userEvent.click(screen.getByRole('button', { name: 'Large' }));
    expect(screen.getByText('Unknown shape.')).toBeTruthy();

    // the control that owns it: the error goes
    await userEvent.click(screen.getByRole('button', { name: 'Circle' }));
    expect(screen.queryByText('Unknown shape.')).toBeNull();
    expect(document.querySelector('[data-visual-error]')).toBeNull();
    expect(screen.queryByText(/Some appearance settings are invalid/)).toBeNull();
    expect(screen.getByRole('tab', { name: 'Appearance' })).toBeTruthy();
  });

  it('keeps the media field mounted (and its asset unrefetched) while saving and after a failed save', async () => {
    let reject: (error: unknown) => void = () => undefined;
    apiMock.mockImplementation(() => new Promise((_, r) => { reject = r; }));
    mount({
      initialTab: 'image',
      value: { visual: { content: 'image', image: { mediaId: MEDIA_A, decorative: true } }, visual_version: 2, visual_preview: PREVIEW_A },
    });
    await screen.findByText('storefront-hero.jpg');
    const field = document.querySelector('[data-media-field]') as HTMLElement;
    await userEvent.click(screen.getByRole('checkbox'));
    const fetchesBefore = fetchAsset.mock.calls.length;
    await save();
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeTruthy();
    // still the same element, now inert
    expect(document.querySelector('[data-media-field]')).toBe(field);
    expect(field.parentElement?.hasAttribute('inert')).toBe(true);
    reject(new ApiError(500, 'boom', {}));
    await screen.findByText(/server error/);
    expect(document.querySelector('[data-media-field]')).toBe(field);
    expect(field.parentElement?.hasAttribute('inert')).toBe(false);
    expect(fetchAsset.mock.calls.length).toBe(fetchesBefore);
  });
});
