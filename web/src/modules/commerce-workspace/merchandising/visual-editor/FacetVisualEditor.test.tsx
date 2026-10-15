/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: (...args: unknown[]) => apiMock(...args),
}));

const capability = vi.hoisted(() => ({ current: 'available' as 'available' | 'gated' | 'checking', probes: 0 }));
vi.mock('@/modules/store-experience-builder/media/use-media-capability', () => ({
  useMediaCapability: () => {
    capability.probes += 1;
    return capability.current;
  },
}));

vi.mock('@/modules/commerce-workspace/storefront-media', async (original) => ({
  ...(await original<typeof import('@/modules/commerce-workspace/storefront-media')>()),
  listStorefrontMedia: vi.fn(),
  fetchStorefrontMediaAsset: vi.fn(),
  ensureUsage: vi.fn(),
  usageStatus: vi.fn(),
}));

import { ApiError } from '@/lib/api';
import * as library from '@/modules/commerce-workspace/storefront-media';
import { asset, page, usage } from '@/modules/store-experience-builder/__tests__/media-fixtures';
import { commerceWorkspaceMessage } from '@/modules/commerce-workspace/messages';
import { FacetVisualEditor, type FacetVisualEditorProps } from './FacetVisualEditor';
import { FACET_VISUAL_SIZE_PX } from '@/modules/store-experience-builder/presentation/facet-visual-style';
import { MEDIA_A, MEDIA_B, PREVIEW_A, facetOf, rawFacet, rawValue } from './test-fixtures';

const listMedia = vi.mocked(library.listStorefrontMedia);
const fetchAsset = vi.mocked(library.fetchStorefrontMediaAsset);

const tEn = (key: Parameters<typeof commerceWorkspaceMessage>[1]) => commerceWorkspaceMessage('en', key);

type Opts = Partial<Omit<FacetVisualEditorProps, 'target'>> & {
  kind?: 'value' | 'facet';
  facet?: Record<string, unknown>;
  value?: Record<string, unknown>;
};

function mount(opts: Opts = {}) {
  const { kind = 'value', facet: facetOver = {}, value: valueOver = {}, ...rest } = opts;
  const facet = facetOf({
    ...facetOver,
    values: [
      rawValue({ id: 'v1', slug: 'wedding', name: 'Wedding', name_en: null, sort_order: 0, product_count: 0 }),
      rawValue({ ...valueOver }),
      rawValue({ id: 'v3', slug: 'graduation', name: 'Graduation', name_en: null, sort_order: 2, product_count: 0 }),
    ],
  });
  const handlers = { onClose: vi.fn(), onSaved: vi.fn(), onReload: vi.fn() };
  const view = render(
    <FacetVisualEditor
      target={kind === 'value' ? { kind: 'value', facet, value: facet.values[1] } : { kind: 'facet', facet }}
      locale="en"
      t={tEn}
      canManageData
      canManageIdentity
      {...handlers}
      {...rest}
    />,
  );
  return { ...view, ...handlers, facet };
}

const tab = (name: RegExp | string) => screen.getByRole('tab', { name });
const openTab = (name: RegExp | string) => userEvent.click(tab(name));
const save = () => userEvent.click(screen.getByRole('button', { name: 'Save' }));
const visualCalls = () => apiMock.mock.calls.filter(([path]) => String(path).endsWith('/visual'));
const dataCalls = () => apiMock.mock.calls.filter(([path]) => !String(path).endsWith('/visual'));
const preview = () => document.querySelector('[data-preview-panel]') as HTMLElement;

beforeEach(() => {
  capability.current = 'available';
  capability.probes = 0;
  fetchAsset.mockReset();
  listMedia.mockReset();
  fetchAsset.mockResolvedValue(asset());
  listMedia.mockResolvedValue(page([asset()]));
  vi.mocked(library.usageStatus).mockResolvedValue(usage());
  vi.mocked(library.ensureUsage).mockResolvedValue(usage());
});
afterEach(() => {
  cleanup();
  apiMock.mockReset();
  vi.unstubAllGlobals();
});

describe('container, titles and fields (C6, C7)', () => {
  it('titles a value «Edit value — name» and a dimension «Edit dimension — name» (always with the name)', () => {
    mount();
    expect(screen.getByRole('dialog', { name: 'Edit value — Birthday EN' })).toBeTruthy();
    cleanup();
    mount({ kind: 'facet' });
    expect(screen.getByRole('dialog', { name: 'Edit dimension — Occasion EN' })).toBeTruthy();
  });

  it('is titled in Arabic with the Arabic name', () => {
    mount({ locale: 'ar' });
    expect(screen.getByRole('dialog', { name: 'تعديل القيمة — Birthday' })).toBeTruthy();
  });

  it('uses the same field labels for a dimension and a value', () => {
    for (const kind of ['value', 'facet'] as const) {
      mount({ kind });
      expect(screen.getByLabelText('Arabic name')).toBeTruthy();
      expect(screen.getByLabelText('English name (optional)')).toBeTruthy();
      cleanup();
    }
  });

  it('has three tabs, Data first, and switches the panel', async () => {
    mount();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Data', 'Image & icon', 'Appearance']);
    expect(tab('Data').getAttribute('aria-selected')).toBe('true');
    await openTab('Appearance');
    expect(tab('Appearance').getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[data-tab-panel="appearance"]')).toBeTruthy();
    expect(document.querySelector('[data-tab-panel="data"]')).toBeNull();
  });

  it('shows the identifier, the product count and the core badge read-only', () => {
    mount();
    expect(screen.getByText('birthday', { selector: '[data-identifier]' })).toBeTruthy();
    expect(document.querySelector('[data-product-count]')?.textContent).toBe('2');
    cleanup();
    mount({ kind: 'facet' });
    expect(screen.getByText('occasion', { selector: '[data-identifier]' })).toBeTruthy();
    expect(screen.getByText('Core')).toBeTruthy();
  });

  it('opens on the requested tab', () => {
    mount({ initialTab: 'image' });
    expect(tab('Image & icon').getAttribute('aria-selected')).toBe('true');
  });
});

describe('content type (Image & icon)', () => {
  it('offers inherit / image / icon / text only for a value, and no «inherit» for a dimension’s own identity', async () => {
    mount({ initialTab: 'image' });
    const group = screen.getAllByRole('group', { name: 'Content type' })[0];
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Inherit from dimension', 'Image', 'Icon', 'Text only']);
    expect(within(group).getByRole('button', { name: 'Inherit from dimension' }).getAttribute('aria-pressed')).toBe('true');
    cleanup();

    mount({ kind: 'facet', initialTab: 'image' });
    const groups = screen.getAllByRole('group', { name: 'Content type' });
    expect(within(groups[0]).getAllByRole('button').map((b) => b.textContent)).toEqual(['Image', 'Icon', 'Text only']);
    // the value defaults block has «Not set / Icon / Text only» and no image
    expect(within(groups[1]).getAllByRole('button').map((b) => b.textContent)).toEqual(['Not set', 'Icon', 'Text only']);
    expect(screen.getByRole('heading', { name: 'Value defaults' })).toBeTruthy();
  });

  it('shows the icon picker for «Icon» and an explanation for «Text only»', async () => {
    mount({ initialTab: 'image' });
    expect(screen.queryByRole('group', { name: 'Choose an icon' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Icon' }));
    expect(screen.getByRole('group', { name: 'Choose an icon' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Text only' }));
    expect(screen.queryByRole('group', { name: 'Choose an icon' })).toBeNull();
    expect(screen.getByText('The value shows by name only, with no image or icon.')).toBeTruthy();
  });

  it('picking an icon and a colour writes only those keys', async () => {
    apiMock.mockResolvedValue({ data: { visual: {}, version: 1 } });
    mount({ initialTab: 'image' });
    await userEvent.click(screen.getByRole('button', { name: 'Icon' }));
    await userEvent.click(screen.getByRole('button', { name: 'Gift' }));
    const hex = screen.getAllByLabelText('Colour code')[0];
    await userEvent.type(hex, '#112233');
    await save();
    await waitFor(() => expect(visualCalls()).toHaveLength(1));
    expect(visualCalls()[0]).toEqual([
      '/commerce/workspace/facets/f1/values/v2/visual',
      { method: 'PUT', body: { visual: { content: 'icon', icon: 'gift', iconColor: '#112233' }, expected_version: null } },
    ]);
  });

  it('warns live when the icon colour has less than 3:1 against the background', async () => {
    mount({ initialTab: 'image', value: { visual: { content: 'icon', icon: 'gift', iconColor: '#777777', background: '#808080' }, visual_version: 1 } });
    expect(screen.getByText(/below 3:1/)).toBeTruthy();
    cleanup();
    mount({ initialTab: 'image', value: { visual: { content: 'icon', icon: 'gift', iconColor: '#000000', background: '#ffffff' }, visual_version: 1 } });
    expect(screen.queryByText(/below 3:1/)).toBeNull();
    expect(screen.getByText(/contrast is 21\.00:1/)).toBeTruthy();
  });

  it('a newly picked image is decorative by default and goes through the pick-only field', async () => {
    apiMock.mockResolvedValue({ data: { visual: {}, version: 1 } });
    mount({ initialTab: 'image' });
    await userEvent.click(screen.getByRole('button', { name: 'Image' }));
    expect(screen.getByText(/Choose an image from the library/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Choose from library' }));
    await userEvent.click(await screen.findByRole('button', { name: /Use: storefront-hero\.jpg/ }));
    // pick-only: no framing editor, but the alt / decorative controls are there
    await screen.findByText('storefront-hero.jpg');
    expect(screen.queryByRole('button', { name: 'Edit image' })).toBeNull();
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);

    await save();
    await waitFor(() => expect(visualCalls()).toHaveLength(1));
    expect(visualCalls()[0][1].body).toEqual({
      visual: { content: 'image', image: { mediaId: MEDIA_A, decorative: true } },
      expected_version: null,
    });
  });

  it('removing the image touches neither the shape nor the size', async () => {
    apiMock.mockResolvedValue({ data: { visual: {}, version: 3 } });
    mount({
      initialTab: 'image',
      value: { visual: { content: 'image', image: { mediaId: MEDIA_A, decorative: true, zoom: 1.4 }, shape: 'arch', size: 'lg', showLabel: false }, visual_version: 2, visual_preview: PREVIEW_A },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await save();
    await waitFor(() => expect(visualCalls()).toHaveLength(1));
    expect(visualCalls()[0][1].body).toEqual({
      visual: { content: 'image', shape: 'arch', size: 'lg', showLabel: false },
      expected_version: 2,
    });
  });

  it('keeps alt text optional: a language without one is a neutral note, not an error', async () => {
    mount({
      initialTab: 'image',
      value: { visual: { content: 'image', image: { mediaId: MEDIA_A } }, visual_version: 2, visual_preview: PREVIEW_A },
    });
    await screen.findByText('storefront-hero.jpg');
    const coverage = document.querySelector('[data-alt-coverage="missing"]') as HTMLElement;
    expect(coverage.textContent).toContain('optional');
    expect(coverage.className).not.toContain('text-negative');
  });

  it('with the media library off the image option is disabled with the reason; icon and text still work', async () => {
    capability.current = 'gated';
    mount({ initialTab: 'image' });
    const image = screen.getByRole('button', { name: 'Image' }) as HTMLButtonElement;
    expect(image.disabled).toBe(true);
    const reason = screen.getByText(/media library is not enabled/i);
    expect(image.getAttribute('aria-describedby')).toBe(reason.id);
    expect((screen.getByRole('button', { name: 'Icon' }) as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Text only' }));
    expect(screen.getByRole('button', { name: 'Text only' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('appearance, inheritance and restore (per property)', () => {
  const facetWithDefaults = { visual: { defaults: { shape: 'arch', size: 'lg', showLabel: false } }, visual_version: 1 };

  it('shows «inherited from the dimension» for every property the value does not set', async () => {
    mount({ initialTab: 'appearance', facet: facetWithDefaults, value: { visual: { shape: 'star' }, visual_version: 1 } });
    const row = (key: string) => document.querySelector(`[data-prop="${key}"]`) as HTMLElement;
    expect(row('shape').getAttribute('data-prop-source')).toBe('own');
    expect(within(row('shape')).getByText('Customized for this value')).toBeTruthy();
    expect(row('size').getAttribute('data-prop-source')).toBe('facet');
    expect(within(row('size')).getByText('Inherited from the dimension: Large')).toBeTruthy();
    expect(within(row('showLabel')).getByText('Inherited from the dimension: Hidden')).toBeTruthy();
    // an inherited property offers no restore; the customised one does
    expect(within(row('size')).queryByRole('button', { name: /Restore/ })).toBeNull();
    expect(within(row('shape')).getByRole('button', { name: 'Restore inheritance — Shape' })).toBeTruthy();
  });

  it('restoring one property brings back only that property’s inheritance', async () => {
    mount({ initialTab: 'appearance', facet: facetWithDefaults, value: { visual: { shape: 'star', size: 'sm' }, visual_version: 1 } });
    await userEvent.click(screen.getByRole('button', { name: 'Restore inheritance — Shape' }));
    const row = (key: string) => document.querySelector(`[data-prop="${key}"]`) as HTMLElement;
    expect(within(row('shape')).getByText('Inherited from the dimension: Islamic arch')).toBeTruthy();
    // the size stays customised
    expect(row('size').getAttribute('data-prop-source')).toBe('own');
    expect(screen.getByRole('button', { name: 'Islamic arch' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('with nothing set anywhere the badge reads the system default', () => {
    mount({ initialTab: 'appearance' });
    expect(within(document.querySelector('[data-prop="shape"]') as HTMLElement).getByText('Default: Circle')).toBeTruthy();
  });

  it('draws every shape button with a name and aria-pressed, 12 of them, and marks the effective one', () => {
    mount({ initialTab: 'appearance', facet: facetWithDefaults });
    const shapes = document.querySelectorAll('[data-shape-option]');
    expect(shapes).toHaveLength(12);
    shapes.forEach((button) => {
      expect(button.getAttribute('aria-label')).toBeTruthy();
      expect(['true', 'false']).toContain(button.getAttribute('aria-pressed'));
    });
    expect(screen.getByRole('button', { name: 'Islamic arch' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('focal point, fit and zoom exist only with an image, and say so otherwise', () => {
    mount({ initialTab: 'appearance' });
    expect(document.querySelector('[data-image-only-hint]')).toBeTruthy();
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('with an image: a 3×3 focal grid, fit, and a 1–3 zoom in steps of 0.1', async () => {
    mount({
      initialTab: 'appearance',
      value: { visual: { content: 'image', image: { mediaId: MEDIA_A } }, visual_version: 2, visual_preview: PREVIEW_A },
    });
    await waitFor(() => expect(document.querySelectorAll('[data-focal-option]')).toHaveLength(9));
    const slider = screen.getByRole('slider', { name: 'Zoom' }) as HTMLInputElement;
    expect([slider.min, slider.max, slider.step]).toEqual(['1', '3', '0.1']);
    expect(screen.getByRole('button', { name: 'Show whole image' })).toBeTruthy();
    // the grid is physical (never mirrored by direction) and the centre is the default
    expect(document.querySelector('[data-focal-option="0-0"]')?.closest('[dir]')?.getAttribute('dir')).toBe('ltr');
    expect(screen.getByRole('button', { name: 'Center' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('saving zoom 1.4 sends image.zoom 1.4, and a focal choice sends image.focal', async () => {
    apiMock.mockResolvedValue({ data: { visual: {}, version: 3 } });
    mount({
      initialTab: 'appearance',
      value: { visual: { content: 'image', image: { mediaId: MEDIA_A, decorative: true } }, visual_version: 2, visual_preview: PREVIEW_A },
    });
    fireEvent.change(await screen.findByRole('slider', { name: 'Zoom' }), { target: { value: '1.4' } });
    await userEvent.click(screen.getByRole('button', { name: 'Top left' }));
    await userEvent.click(screen.getByRole('button', { name: 'Show whole image' }));
    await save();
    await waitFor(() => expect(visualCalls()).toHaveLength(1));
    expect(visualCalls()[0][1].body).toEqual({
      visual: { content: 'image', image: { mediaId: MEDIA_A, fit: 'contain', focal: { x: 0, y: 0 }, zoom: 1.4, decorative: true } },
      expected_version: 2,
    });
  });

  it('never sends crop or rotate, whatever the stored document carried', async () => {
    apiMock.mockResolvedValue({ data: { visual: {}, version: 3 } });
    mount({
      initialTab: 'appearance',
      value: { visual: { content: 'image', image: { mediaId: MEDIA_A, crop: { x: 0, y: 0, w: 1, h: 1, aspect: '1:1' }, rotate: 90 } }, visual_version: 2, visual_preview: PREVIEW_A },
    });
    fireEvent.change(await screen.findByRole('slider', { name: 'Zoom' }), { target: { value: '2' } });
    await save();
    await waitFor(() => expect(visualCalls()).toHaveLength(1));
    const body = JSON.stringify(visualCalls()[0][1].body);
    expect(body).not.toContain('crop');
    expect(body).not.toContain('rotate');
  });

  it('moves the focal point from a drag on the previewed picture', async () => {
    apiMock.mockResolvedValue({ data: { visual: {}, version: 3 } });
    mount({
      initialTab: 'appearance',
      value: { visual: { content: 'image', image: { mediaId: MEDIA_A, decorative: true } }, visual_version: 2, visual_preview: PREVIEW_A },
    });
    await waitFor(() => expect(document.querySelector('[data-preview-edited] [data-facet-content="image"]')).toBeTruthy());
    expect(screen.getByText('Drag on the image to set the focal point.')).toBeTruthy();
    const edited = document.querySelector('[data-preview-edited]') as HTMLElement;
    const frame = edited.querySelector('[data-facet-content] > span[aria-hidden="true"]') as HTMLElement;
    frame.getBoundingClientRect = () => ({ left: 100, top: 100, width: 80, height: 80, right: 180, bottom: 180, x: 100, y: 100, toJSON: () => ({}) });
    fireEvent.pointerDown(edited, { clientX: 180, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(edited, { pointerId: 1 });
    await save();
    await waitFor(() => expect(visualCalls()).toHaveLength(1));
    expect(visualCalls()[0][1].body.visual.image.focal).toEqual({ x: 100, y: 0 });
  });
});

describe('live preview', () => {
  it('shows the edited value between its two real neighbours of the same dimension', () => {
    mount();
    const items = Array.from(preview().querySelectorAll('[data-preview-item]'));
    expect(items.map((i) => i.textContent)).toEqual(['Wedding', 'Birthday EN', 'Graduation']);
    expect(items[1].hasAttribute('data-preview-edited')).toBe(true);
  });

  it('shows a value alone when it has no neighbours, and says so', () => {
    const only = facetOf({ values: [rawValue()] });
    render(
      <FacetVisualEditor
        target={{ kind: 'value', facet: only, value: only.values[0] }}
        locale="en"
        t={tEn}
        canManageData
        canManageIdentity
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onReload={vi.fn()}
      />,
    );
    expect(preview().querySelectorAll('[data-preview-item]')).toHaveLength(1);
    expect(screen.getByText(/no neighbouring values/)).toBeTruthy();
  });

  it('updates instantly, with no request, as the shape and the name change', async () => {
    mount({ initialTab: 'appearance' });
    const frame = () => document.querySelector('[data-preview-edited] [data-facet-content] > span[aria-hidden="true"]') as HTMLElement;
    // no identity yet: nothing drawn for a text-only value
    await openTab('Image & icon');
    await userEvent.click(screen.getByRole('button', { name: 'Icon' }));
    await userEvent.click(screen.getByRole('button', { name: 'Gift' }));
    await openTab('Appearance');
    await userEvent.click(screen.getByRole('button', { name: 'Square' }));
    expect(frame().style.borderRadius).toBe('0px');
    await userEvent.click(screen.getByRole('button', { name: 'Circle' }));
    expect(frame().style.borderRadius).toBe('50%');
    await openTab('Data');
    // the English UI previews the English name (as shoppers on the English store see it)
    await userEvent.clear(screen.getByLabelText('English name (optional)'));
    await userEvent.type(screen.getByLabelText('English name (optional)'), 'Anniversary');
    expect(preview().querySelector('[data-preview-edited]')?.textContent).toContain('Anniversary');
    expect(apiMock).not.toHaveBeenCalled();
  });

  // D-W-1: the tile frame is capped at its cell (`max-width: 100%`), and the cells used to be ~76 px wide, so Medium
  // (80 px) and Large (112 px) both collapsed to the same ~64.7 px. jsdom cannot measure layout, so this pins the two
  // decisions that produce the real sizes: the frame's nominal width, and a cell that is wide enough to hold it. The
  // measured sizes in a real browser are in the VD-5 report.
  it.each([
    ['Grid', 12],
    ['Cards', 22],
    ['Rail', 12],
    ['Icons', 12],
  ])('%s layout: every size step keeps its true frame size and a cell wide enough for it', async (layoutName, chrome) => {
    mount({ initialTab: 'appearance' });
    await userEvent.click(within(preview()).getByRole('button', { name: layoutName }));
    const frame = () =>
      document.querySelector('[data-preview-edited] [data-facet-content] > span[aria-hidden="true"]') as HTMLElement;
    const cell = () => document.querySelector('[data-preview-edited]') as HTMLElement;
    const cells = () => document.querySelector('[data-preview-cells]') as HTMLElement;
    // The edited value needs something to draw (a text-only value has no frame).
    await openTab('Image & icon');
    await userEvent.click(screen.getByRole('button', { name: 'Icon' }));
    await userEvent.click(screen.getByRole('button', { name: 'Gift' }));
    await openTab('Appearance');

    const seen: Record<string, number> = {};
    for (const [label, size] of [['Small', 'sm'], ['Medium', 'md'], ['Large', 'lg']] as const) {
      await userEvent.click(screen.getByRole('button', { name: label }));
      const width = parseFloat(frame().style.width);
      expect(width).toBe(FACET_VISUAL_SIZE_PX[size]);
      seen[size] = width;
      // The room each cell gives the frame: the column minimum (grid-like layouts) or the item's own minimum (rail).
      const room =
        layoutName === 'Rail'
          ? parseFloat(cell().style.minWidth)
          : parseFloat(/minmax\((\d+(?:\.\d+)?)px/.exec(cells().getAttribute('style') ?? '')?.[1] ?? 'NaN');
      expect(room).toBeGreaterThanOrEqual(width + chrome);
    }
    expect(new Set(Object.values(seen)).size).toBe(3);
  });

  it('switches the layout for the preview only, never saving it', async () => {
    mount();
    expect(screen.getByRole('button', { name: 'Grid' }).getAttribute('aria-pressed')).toBe('true');
    for (const name of ['Cards', 'Rail', 'Icons', 'List']) {
      await userEvent.click(screen.getByRole('button', { name }));
      expect(screen.getByRole('button', { name }).getAttribute('aria-pressed')).toBe('true');
    }
    // switching a preview layout is not an edit
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('draws the preview inside a store-themed frame', () => {
    mount();
    expect(preview().querySelector('.awj-store-preview')).toBeTruthy();
  });

  it('a dimension previews its own tile and its values with the edited defaults', async () => {
    mount({ kind: 'facet', initialTab: 'image', facet: { visual: { defaults: { content: 'icon', icon: 'gift' } }, visual_version: 1 } });
    const groups = preview().querySelectorAll('[data-store-frame] > div');
    expect(groups).toHaveLength(2);
    expect(screen.getByText('The dimension')).toBeTruthy();
    expect(screen.getByText('Dimension values')).toBeTruthy();
    // the values inherit the icon default
    expect(groups[1].querySelectorAll('[data-facet-content="icon"]').length).toBeGreaterThan(0);
  });
});

describe('image fallback states in the preview', () => {
  const withImage = { visual: { content: 'image', image: { mediaId: MEDIA_A }, icon: 'gift' }, visual_version: 2 };

  it('uses the signed visual_preview thumbnail for the stored image, without reading the library', async () => {
    mount({ value: { ...withImage, visual_preview: PREVIEW_A } });
    await waitFor(() => expect(document.querySelector('[data-preview-edited] img')).toBeTruthy());
    expect((document.querySelector('[data-preview-edited] img') as HTMLImageElement).getAttribute('src')).toBe(PREVIEW_A.thumb_320);
    expect(fetchAsset).not.toHaveBeenCalledWith(MEDIA_A, expect.anything());
  });

  it('image not ready: says so and falls back to the icon', async () => {
    fetchAsset.mockResolvedValue(asset({ variantsState: 'pending' }));
    mount({ value: withImage });
    expect(await screen.findByText(/still processing in the library/)).toBeTruthy();
    expect(document.querySelector('[data-preview-edited] [data-facet-content="icon"]')).toBeTruthy();
  });

  it('image deleted: says so and falls back to the icon', async () => {
    fetchAsset.mockResolvedValue(null);
    mount({ value: withImage });
    expect(await screen.findByText(/deleted from the library/)).toBeTruthy();
    expect(document.querySelector('[data-preview-edited] [data-facet-content="icon"]')).toBeTruthy();
  });

  it('image fails to load: says so and falls back to the icon', async () => {
    class FailingImage {
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal('Image', FailingImage);
    mount({ value: { ...withImage, visual_preview: PREVIEW_A } });
    expect(await screen.findByText(/could not be loaded/)).toBeTruthy();
    expect(document.querySelector('[data-preview-edited] [data-facet-content="icon"]')).toBeTruthy();
  });

  it('a role that cannot read the library and has no stored thumbnail gets an honest «unavailable»', async () => {
    mount({ canManageIdentity: false, value: withImage });
    expect(await screen.findByText(/preview is unavailable right now/)).toBeTruthy();
    expect(fetchAsset).not.toHaveBeenCalled();
  });
});

describe('permissions and capability (D-04)', () => {
  it('products.manage + commerce.manage: every tab is editable', async () => {
    mount({ initialTab: 'appearance' });
    expect(document.querySelector('[data-identity-banner]')).toBeNull();
    expect((screen.getByRole('button', { name: 'Square' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByLabelText('Show the name') as HTMLButtonElement).disabled).toBe(false);
    await openTab('Data');
    expect((screen.getByLabelText('Arabic name') as HTMLInputElement).disabled).toBe(false);
    expect(capability.probes).toBeGreaterThan(0);
  });

  it('products.manage only: Data editable; the identity tabs read-only with the explanation and no pick or upload', async () => {
    mount({ canManageIdentity: false, initialTab: 'data', value: { visual: { content: 'image', image: { mediaId: MEDIA_A, decorative: true, alt: { en: 'A rose' } }, shape: 'arch' }, visual_version: 2, visual_preview: PREVIEW_A } });
    expect((screen.getByLabelText('Arabic name') as HTMLInputElement).disabled).toBe(false);
    expect(document.querySelector('[data-identity-banner]')).toBeNull();

    await openTab('Image & icon');
    expect(screen.getByRole('note').textContent).toContain('requires the e-commerce management permission');
    expect(screen.queryByRole('button', { name: 'Choose from library' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Replace' })).toBeNull();
    expect(screen.queryByText(/Upload/)).toBeNull();
    // the saved picture is shown from its signed thumbnail
    const summary = document.querySelector('[data-readonly-image]') as HTMLElement;
    expect(summary.querySelector('img')?.getAttribute('src')).toBe(PREVIEW_A.thumb_320);
    expect(summary.textContent).toContain('A rose');
    expect((screen.getByRole('button', { name: 'Icon' }) as HTMLButtonElement).disabled).toBe(true);

    await openTab('Appearance');
    expect(screen.getByRole('note').textContent).toContain('requires the e-commerce management permission');
    expect((screen.getByRole('button', { name: 'Square' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /^Restore/ })).toBeNull();

    // no library read at all: no probe, no asset fetch, no listing
    expect(capability.probes).toBe(0);
    expect(fetchAsset).not.toHaveBeenCalled();
    expect(listMedia).not.toHaveBeenCalled();
  });

  it('products.manage only: saving a name writes the data and never the identity', async () => {
    apiMock.mockResolvedValue({ data: { value: { id: 'v2', slug: 'birthday', name: 'Birthday 2' } } });
    const { onSaved } = mount({ canManageIdentity: false });
    await userEvent.type(screen.getByLabelText('Arabic name'), ' 2');
    await save();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(visualCalls()).toHaveLength(0);
    expect(dataCalls()).toHaveLength(1);
  });

  it('products.view only: the whole editor is read-only with the existing «no permission» message', async () => {
    mount({ canManageData: false, canManageIdentity: false });
    expect(screen.getByText(tEn('merchNoPermission'))).toBeTruthy();
    expect((screen.getByLabelText('Arabic name') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('English name (optional)') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('switch', { name: 'Status' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('dialog', { name: 'View value — Birthday EN' })).toBeTruthy();
    await openTab('Appearance');
    expect((screen.getByRole('button', { name: 'Square' }) as HTMLButtonElement).disabled).toBe(true);
    // the data-permission banner is the only note: it is not the identity explanation
    expect(screen.queryByText(/e-commerce management permission/)).toBeNull();
    expect(capability.probes).toBe(0);
  });
});

describe('saving', () => {
  it('writes the data first, then the visual identity with the expected_version read when it opened', async () => {
    apiMock
      .mockResolvedValueOnce({ data: { value: { id: 'v2', slug: 'birthday', name: 'Birthday 2' } } })
      .mockResolvedValueOnce({ data: { visual: { shape: 'square' }, version: 4 } });
    const { onSaved } = mount({ value: { visual: { shape: 'star' }, visual_version: 3 } });
    await userEvent.type(screen.getByLabelText('Arabic name'), ' 2');
    await openTab('Appearance');
    await userEvent.click(screen.getByRole('button', { name: 'Square' }));
    await save();

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(apiMock.mock.calls).toEqual([
      ['/commerce/workspace/facets/f1/values/v2', { method: 'PUT', body: { name: 'Birthday 2', name_en: 'Birthday EN', is_active: true } }],
      ['/commerce/workspace/facets/f1/values/v2/visual', { method: 'PUT', body: { visual: { shape: 'square' }, expected_version: 3 } }],
    ]);
  });

  it('writes only the part that changed', async () => {
    apiMock.mockResolvedValue({ data: { visual: { shape: 'square' }, version: 4 } });
    const { onSaved } = mount({ initialTab: 'appearance', value: { visual: { shape: 'star' }, visual_version: 3 } });
    await userEvent.click(screen.getByRole('button', { name: 'Square' }));
    await save();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(dataCalls()).toHaveLength(0);
    expect(visualCalls()).toHaveLength(1);
  });

  it('sends the null tombstone when every customisation was restored', async () => {
    apiMock.mockResolvedValue({ data: { visual: null, version: 4 } });
    const { onSaved } = mount({ initialTab: 'appearance', value: { visual: { shape: 'star' }, visual_version: 3 } });
    await userEvent.click(screen.getByRole('button', { name: 'Restore inheritance — Shape' }));
    await save();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(visualCalls()[0][1].body).toEqual({ visual: null, expected_version: 3 });
  });

  it('writes a dimension’s {self, defaults} document', async () => {
    apiMock.mockResolvedValue({ data: { visual: {}, version: 1 } });
    mount({ kind: 'facet', initialTab: 'appearance', facet: { visual: { self: { shape: 'heart' } }, visual_version: 5 } });
    const squares = screen.getAllByRole('button', { name: 'Square' });
    await userEvent.click(squares[1]); // the value defaults block
    await save();
    await waitFor(() => expect(visualCalls()).toHaveLength(1));
    expect(visualCalls()[0]).toEqual([
      '/commerce/workspace/facets/f1/visual',
      { method: 'PUT', body: { visual: { self: { shape: 'heart' }, defaults: { shape: 'square' } }, expected_version: 5 } },
    ]);
  });

  it('partial failure keeps the editor open, shows each part’s result, and a retry sends only the failed part', async () => {
    apiMock
      .mockResolvedValueOnce({ data: { value: { id: 'v2', slug: 'birthday', name: 'Birthday 2' } } })
      .mockRejectedValueOnce(new ApiError(422, 'bad', { code: 'visual_invalid', errors: { 'visual.image.mediaId': ['media_not_ready'] } }))
      .mockResolvedValueOnce({ data: { visual: {}, version: 1 } });
    const { onSaved, onClose } = mount({});
    await userEvent.type(screen.getByLabelText('Arabic name'), ' 2');
    await openTab('Image & icon');
    await userEvent.click(screen.getByRole('button', { name: 'Image' }));
    await userEvent.click(screen.getByRole('button', { name: 'Choose from library' }));
    await userEvent.click(await screen.findByRole('button', { name: /Use: storefront-hero\.jpg/ }));
    await screen.findByText('storefront-hero.jpg');
    await save();

    expect(await screen.findByText(/Some appearance settings are invalid/)).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    const results = document.querySelector('[data-save-results]') as HTMLElement;
    expect(within(results).getByText(/Data:/).parentElement?.textContent).toContain('Saved');
    // the failing part sits beside its tab, on the control, and the data tab shows no alert
    expect(within(tab(/Image & icon/)).queryByText(/This tab has an error/)).toBeTruthy();
    expect(within(tab('Data')).queryByText(/This tab has an error/)).toBeNull();
    expect(screen.getByText('The image is still processing. Wait for it to finish, then save.')).toBeTruthy();

    await save();
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    // the name was saved the first time: the retry does not write it again
    expect(dataCalls()).toHaveLength(1);
    expect(visualCalls()).toHaveLength(2);
  });

  it('a failed data write is shown beside the Data tab, and the identity is still attempted', async () => {
    apiMock
      .mockRejectedValueOnce(new ApiError(422, 'الاسم مكرر', {}))
      .mockResolvedValueOnce({ data: { visual: {}, version: 1 } });
    const { onSaved } = mount({});
    await userEvent.type(screen.getByLabelText('Arabic name'), ' 2');
    await openTab('Appearance');
    await userEvent.click(screen.getByRole('button', { name: 'Square' }));
    await save();

    expect(await screen.findByText('الاسم مكرر')).toBeTruthy();
    expect(within(tab(/Data/)).queryByText(/This tab has an error/)).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
    expect(visualCalls()).toHaveLength(1);
  });

  it.each([409, 428])('%s: says the identity changed, offers a reload, and never retries over an unseen version', async (status) => {
    apiMock.mockRejectedValue(new ApiError(status, 'changed', { code: status === 409 ? 'visual_version_conflict' : 'visual_precondition_required', current_version: 9 }));
    const { onReload, onSaved } = mount({ initialTab: 'appearance', value: { visual: { shape: 'star' }, visual_version: 3 } });
    await userEvent.click(screen.getByRole('button', { name: 'Square' }));
    await save();

    expect(await screen.findByText('The identity was changed by another user. Reload to see the latest version.')).toBeTruthy();
    expect(visualCalls()).toHaveLength(1);
    expect(onSaved).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(onReload).toHaveBeenCalledTimes(1);
    // it reopens on the tab the user was on
    expect(onReload).toHaveBeenCalledWith('appearance');
    // still only the one attempt
    expect(visualCalls()).toHaveLength(1);
  });

  it('puts 422 field errors on their controls and flags the tabs they live in', async () => {
    apiMock.mockRejectedValue(
      new ApiError(422, 'bad', { code: 'visual_invalid', errors: { 'visual.shape': ['unknown_shape'], 'visual.iconColor': ['invalid_color'] } }),
    );
    mount({ initialTab: 'appearance' });
    await userEvent.click(screen.getByRole('button', { name: 'Square' }));
    await save();

    const shapeRow = (await waitFor(() => document.querySelector('[data-prop="shape"]'))) as HTMLElement;
    await waitFor(() => expect(within(shapeRow).getByText('Unknown shape.')).toBeTruthy());
    expect(within(tab(/Appearance/)).queryByText(/This tab has an error/)).toBeTruthy();
    expect(within(tab(/Image & icon/)).queryByText(/This tab has an error/)).toBeTruthy();
    expect(within(tab('Data')).queryByText(/This tab has an error/)).toBeNull();
    // an error on a control that is not on screen (no icon section for a text-only value) is still listed
    expect(document.querySelector('[data-visual-error="own:iconColor"]')?.textContent).toBe('Icon colour: Invalid colour; use the #RRGGBB format.');
    expect(document.querySelector('[data-visual-error="own:shape"]')?.textContent).toBe('Shape: Unknown shape.');
  });

  it('translates media_not_found onto the image control', async () => {
    apiMock.mockRejectedValue(new ApiError(422, 'bad', { code: 'visual_invalid', errors: { 'visual.image.mediaId': ['media_not_found'] } }));
    listMedia.mockResolvedValue(page([asset({ id: MEDIA_B })]));
    mount({ initialTab: 'image', value: { visual: { content: 'image', image: { mediaId: MEDIA_A, decorative: true } }, visual_version: 2, visual_preview: PREVIEW_A } });
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await userEvent.click(screen.getByRole('button', { name: 'Choose from library' }));
    await userEvent.click(await screen.findByRole('button', { name: /Use: storefront-hero\.jpg/ }));
    await screen.findByText('storefront-hero.jpg');
    await save();
    const message = 'This image is no longer in the library. Choose another image.';
    expect(await screen.findAllByText(message)).toBeTruthy();
    // beside the picker itself, and again in the summary next to the actions
    expect(document.querySelector('[data-section="image"] [data-error-code="media_not_found"]')).toBeTruthy();
  });

  it('refuses a double submit: a second click while the first is in flight sends nothing', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    apiMock.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const { onSaved } = mount({ initialTab: 'appearance', value: { visual: { shape: 'star' }, visual_version: 3 } });
    await userEvent.click(screen.getByRole('button', { name: 'Square' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    const saving = screen.getByRole('button', { name: 'Saving…' }) as HTMLButtonElement;
    expect(saving.disabled).toBe(true);
    fireEvent.click(saving);
    fireEvent.click(saving);
    expect(apiMock).toHaveBeenCalledTimes(1);
    resolve({ data: { visual: { shape: 'square' }, version: 4 } });
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it('requires an Arabic name before any request', async () => {
    const { onSaved } = mount({});
    await userEvent.clear(screen.getByLabelText('Arabic name'));
    await save();
    expect(await screen.findByText('A name is required.')).toBeTruthy();
    expect(apiMock).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe('closing with unsaved changes', () => {
  it('closes at once when nothing changed', async () => {
    const { onClose } = mount({});
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it('Escape on an edited editor asks instead of closing', async () => {
    const { onClose } = mount({});
    await userEvent.type(screen.getByLabelText('Arabic name'), 'x');
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByRole('dialog', { name: 'Unsaved changes' })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('after a partly saved attempt, discarding still tells the parent the list is stale', async () => {
    apiMock
      .mockResolvedValueOnce({ data: { value: { id: 'v2', slug: 'birthday', name: 'Birthday 2' } } })
      .mockRejectedValueOnce(new ApiError(422, 'bad', { code: 'visual_invalid', errors: { 'visual.shape': ['unknown_shape'] } }));
    const { onClose } = mount({});
    await userEvent.type(screen.getByLabelText('Arabic name'), ' 2');
    await openTab('Appearance');
    await userEvent.click(screen.getByRole('button', { name: 'Square' }));
    await save();
    await screen.findByText(/Some appearance settings are invalid/);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it('asks before discarding edits, and keeps the editor open when the user keeps editing', async () => {
    const { onClose } = mount({});
    await userEvent.type(screen.getByLabelText('Arabic name'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const confirm = screen.getByRole('dialog', { name: 'Unsaved changes' });
    expect(confirm).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Unsaved changes' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Arabic name') as HTMLInputElement).value).toBe('Birthdayx');
  });

  it('discards on confirmation', async () => {
    const { onClose } = mount({});
    await userEvent.type(screen.getByLabelText('Arabic name'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('an edit made and then undone is not an unsaved change', async () => {
    const { onClose } = mount({ initialTab: 'appearance' });
    await userEvent.click(screen.getByRole('button', { name: 'Square' }));
    await userEvent.click(screen.getByRole('button', { name: 'Restore inheritance — Shape' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith(false);
  });
});

describe('mobile container', () => {
  it('collapses the preview into a strip that opens on demand', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined,
    }));
    mount({});
    const strip = document.querySelector('[data-preview-strip]') as HTMLElement;
    expect(strip).toBeTruthy();
    expect(document.querySelector('[data-preview-panel]')).toBeNull();
    const toggle = within(strip).getByRole('button', { name: /Preview/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelectorAll('[data-preview-panel]')).toHaveLength(1);
  });

  it('keeps the actions in a footer outside the scrolling body', () => {
    mount({});
    const save = screen.getByRole('button', { name: 'Save' });
    const body = document.querySelector('[data-tab-panel]')?.closest('.overflow-y-auto');
    expect(body).toBeTruthy();
    expect(body?.contains(save)).toBe(false);
    expect(document.querySelector('[class*="safe-area-inset-bottom"]')?.contains(save)).toBe(true);
  });
});
