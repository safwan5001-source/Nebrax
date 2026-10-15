/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: (...args: unknown[]) => apiMock(...args),
}));
vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => (key: string) => key }));
vi.mock('@/modules/store-experience-builder/media/use-media-capability', () => ({ useMediaCapability: () => 'available' }));
vi.mock('@/modules/commerce-workspace/storefront-media', async (original) => ({
  ...(await original<typeof import('@/modules/commerce-workspace/storefront-media')>()),
  listStorefrontMedia: vi.fn().mockResolvedValue({ items: [], meta: { uploadsEnabled: true } }),
  fetchStorefrontMediaAsset: vi.fn().mockResolvedValue(null),
  usageStatus: vi.fn(),
  ensureUsage: vi.fn(),
}));

import { ApiError } from '@/lib/api';
import { ToastProvider } from '@/components/ui/toast';
import { commerceWorkspaceMessage } from '@/modules/commerce-workspace/messages';
import { FacetsPanel } from './facets-panel';
import { PREVIEW_A, MEDIA_A, rawFacet, rawValue } from './visual-editor/test-fixtures';

const tEn = (key: Parameters<typeof commerceWorkspaceMessage>[1]) => commerceWorkspaceMessage('en', key);
const tAr = (key: Parameters<typeof commerceWorkspaceMessage>[1]) => commerceWorkspaceMessage('ar', key);

function panel(over: { canManage?: boolean; canManageIdentity?: boolean; locale?: 'ar' | 'en' } = {}) {
  const { canManage = true, canManageIdentity = true, locale = 'en' } = over;
  return render(
    <ToastProvider>
      <FacetsPanel t={locale === 'en' ? tEn : tAr} locale={locale} canManage={canManage} canManageIdentity={canManageIdentity} />
    </ToastProvider>,
  );
}

const facets = (...rows: Record<string, unknown>[]) => ({ data: { facets: rows } });

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  apiMock.mockReset();
  vi.restoreAllMocks();
});

describe('list thumbnails (§3.1)', () => {
  it('shows a 32 px identity thumbnail only for a dimension or value that has one', async () => {
    apiMock.mockResolvedValueOnce(
      facets(
        rawFacet({
          visual: { self: { content: 'icon', icon: 'gift' } },
          visual_version: 1,
          values: [
            rawValue({ id: 'v1', name: 'Wedding', slug: 'wedding', visual: { content: 'icon', icon: 'heart' }, visual_version: 1 }),
            rawValue({ id: 'v2', name: 'Birthday', slug: 'birthday' }),
            rawValue({ id: 'v3', name: 'Graduation', slug: 'graduation', visual: { content: 'none' }, visual_version: 2 }),
          ],
        }),
      ),
    );
    panel();
    await waitFor(() => expect(document.querySelector('[data-value-row="v1"]')).toBeTruthy());
    const header = document.querySelector('[data-facet-row="f1"] > div') as HTMLElement;
    expect(header.querySelector('[data-row-thumb]')).toBeTruthy();
    expect(document.querySelector('[data-value-row="v1"] [data-row-thumb]')).toBeTruthy();
    // no identity at all, and an explicit «text only»: no grey placeholder box
    expect(document.querySelector('[data-value-row="v2"] [data-row-thumb]')).toBeNull();
    expect(document.querySelector('[data-value-row="v3"] [data-row-thumb]')).toBeNull();
    // the thumbnail is the real tile, at 32 px, and decorative
    const thumb = document.querySelector('[data-value-row="v1"] [data-row-thumb]') as HTMLElement;
    expect(thumb.className).toContain('h-8');
    expect(thumb.getAttribute('aria-hidden')).toBe('true');
    expect(thumb.querySelector('[data-facet-content="icon"]')).toBeTruthy();
  });

  it('a value that inherits its dimension’s defaults gets the thumbnail of what shoppers see', async () => {
    apiMock.mockResolvedValueOnce(
      facets(rawFacet({ visual: { defaults: { content: 'icon', icon: 'gift', shape: 'arch' } }, visual_version: 1 })),
    );
    panel();
    await screen.findByText('Birthday EN');
    expect(document.querySelector('[data-value-row="v2"] [data-row-thumb] [data-facet-content="icon"]')).toBeTruthy();
  });

  it('draws a stored image from its signed thumbnail', async () => {
    apiMock.mockResolvedValueOnce(
      facets(
        rawFacet({
          values: [rawValue({ visual: { content: 'image', image: { mediaId: MEDIA_A } }, visual_version: 2, visual_preview: PREVIEW_A })],
        }),
      ),
    );
    panel();
    await screen.findByText('Birthday EN');
    const img = document.querySelector('[data-value-row="v2"] [data-row-thumb] img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(PREVIEW_A.thumb_320);
  });
});

describe('delete-blocked reason (C4)', () => {
  it('prints the reason as text in the row, and a press on the blocked bin reveals it at every width', async () => {
    apiMock.mockResolvedValueOnce(facets(rawFacet()));
    panel();
    await screen.findByText('Birthday EN');
    const reason = document.querySelector('[data-delete-blocked="v2"]') as HTMLElement;
    expect(reason.textContent).toBe('Assigned to products — disable it instead of deleting.');
    // always visible on a phone, hidden from `md` up until the blocked bin is pressed
    expect(reason.className).toContain('md:hidden');

    const bin = screen.getByRole('button', { name: 'Delete Birthday' });
    expect(bin.getAttribute('aria-disabled')).toBe('true');
    expect(bin.getAttribute('aria-describedby')).toBe(reason.id);
    await userEvent.click(bin);
    expect(reason.className).not.toContain('md:hidden');
    // a blocked bin never opens a confirmation
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(bin);
    expect(reason.className).toContain('md:hidden');
  });

  it('has no reason (and no dimmed bin) for a value that can be deleted', async () => {
    apiMock.mockResolvedValueOnce(facets(rawFacet()));
    panel();
    await screen.findByText('Birthday EN');
    expect(document.querySelector('[data-delete-blocked="v1"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete Wedding' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('a dimension with an assigned value explains why it cannot be deleted', async () => {
    apiMock.mockResolvedValueOnce(facets(rawFacet()));
    panel();
    await screen.findByText('Birthday EN');
    expect(document.querySelector('[data-delete-blocked="f1"]')?.textContent).toContain('Assigned to products');
  });
});

describe('collapsible value lists (C9)', () => {
  it('collapses a dimension’s values, starts open, and remembers the choice', async () => {
    apiMock.mockResolvedValue(facets(rawFacet()));
    panel();
    await screen.findByText('Birthday EN');
    const toggle = screen.getByRole('button', { name: 'Collapse values — Occasion EN' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const list = document.getElementById('values-f1') as HTMLElement;
    expect(list.className).not.toContain('max-md:hidden');

    await userEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Show values — Occasion EN' }).getAttribute('aria-expanded')).toBe('false');
    expect(list.className).toContain('max-md:hidden');
    expect(JSON.parse(window.localStorage.getItem('awj.merch.facets.collapsed') ?? '[]')).toEqual(['f1']);

    cleanup();
    panel();
    await screen.findByText('Birthday EN');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Show values — Occasion EN' }).getAttribute('aria-expanded')).toBe('false'));
  });

  it('works when browser storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    apiMock.mockResolvedValue(facets(rawFacet()));
    panel();
    await screen.findByText('Birthday EN');
    await userEvent.click(screen.getByRole('button', { name: 'Collapse values — Occasion EN' }));
    expect(screen.getByRole('button', { name: 'Show values — Occasion EN' }).getAttribute('aria-expanded')).toBe('false');
  });
});

describe('opening the editor from the list', () => {
  it('a pencil opens the editor on that value, and a successful save refreshes the list and closes it', async () => {
    apiMock
      .mockResolvedValueOnce(facets(rawFacet({ values: [rawValue({ visual: { shape: 'star' }, visual_version: 3 })] })))
      .mockResolvedValueOnce({ data: { visual: { shape: 'square' }, version: 4 } })
      .mockResolvedValueOnce(facets(rawFacet({ values: [rawValue({ visual: { shape: 'square' }, visual_version: 4 })] })));
    panel();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Birthday' }));
    const editor = await screen.findByRole('dialog', { name: 'Edit value — Birthday EN' });
    await userEvent.click(within(editor).getByRole('tab', { name: 'Appearance' }));
    await userEvent.click(within(editor).getByRole('button', { name: 'Square' }));
    await userEvent.click(within(editor).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(apiMock.mock.calls.map(([path, init]) => `${init?.method ?? 'GET'} ${path}`)).toEqual([
      'GET /commerce/workspace/facets',
      'PUT /commerce/workspace/facets/f1/values/v2/visual',
      'GET /commerce/workspace/facets',
    ]);
    expect(apiMock.mock.calls[1][1].body).toEqual({ visual: { shape: 'square' }, expected_version: 3 });
    expect(await screen.findByText('Changes saved.')).toBeTruthy();
  });

  it('after a version conflict, «Reload» reopens the editor on the fresh version and never merges', async () => {
    apiMock
      .mockResolvedValueOnce(facets(rawFacet({ values: [rawValue({ visual: { shape: 'star' }, visual_version: 3 })] })))
      .mockRejectedValueOnce(new ApiError(409, 'changed', { code: 'visual_version_conflict', current_version: 9 }))
      .mockResolvedValueOnce(facets(rawFacet({ values: [rawValue({ visual: { shape: 'heart', size: 'lg' }, visual_version: 9 })] })))
      .mockResolvedValueOnce({ data: { visual: { shape: 'heart', size: 'lg' }, version: 10 } });
    panel();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Birthday' }));
    await userEvent.click(await screen.findByRole('tab', { name: 'Appearance' }));
    await userEvent.click(screen.getByRole('button', { name: 'Square' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Reload' }));

    // a fresh editor on the other user's version: the local edit is gone, the shape is theirs
    await waitFor(() => expect(screen.getByRole('button', { name: 'Heart' }).getAttribute('aria-pressed')).toBe('true'));
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Medium' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiMock.mock.calls.length).toBeGreaterThanOrEqual(4));
    expect(apiMock.mock.calls[3][1].body.expected_version).toBe(9);
  });

  it('a view-only user opens the editor read-only', async () => {
    apiMock.mockResolvedValueOnce(facets(rawFacet()));
    panel({ canManage: false, canManageIdentity: false });
    await screen.findByText('Birthday EN');
    expect(screen.queryByRole('button', { name: 'Edit Birthday' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete Birthday' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'View Birthday' }));
    const editor = await screen.findByRole('dialog', { name: 'View value — Birthday EN' });
    expect(within(editor).getByText(tEn('merchNoPermission'))).toBeTruthy();
    expect((within(editor).getByLabelText('Arabic name') as HTMLInputElement).disabled).toBe(true);
  });
});

describe('quick add, then «Customize appearance» (§3.2)', () => {
  it('adds a value from the data-only dialog, then offers the full editor on the new row — writing no identity first', async () => {
    const withNew = rawFacet({
      values: [rawValue({ id: 'v1', name: 'Wedding', slug: 'wedding', product_count: 0 }), rawValue({ id: 'v9', name: 'Anniversary', name_en: null, slug: 'anniversary', product_count: 0 })],
    });
    apiMock
      .mockResolvedValueOnce(facets(rawFacet()))
      .mockResolvedValueOnce({ data: { value: { id: 'v9', slug: 'anniversary', name: 'Anniversary' } } })
      .mockResolvedValueOnce(facets(withNew));
    panel();
    await userEvent.click((await screen.findAllByRole('button', { name: 'Add value' }))[0]);
    // the quick-add form is the data tab only: names, no image / icon / appearance
    const form = screen.getByRole('dialog');
    expect(within(form).getByLabelText('Arabic name')).toBeTruthy();
    expect(within(form).getByLabelText('English name (optional)')).toBeTruthy();
    expect(within(form).queryByRole('tab')).toBeNull();
    await userEvent.type(within(form).getByLabelText('Arabic name'), 'Anniversary');
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));

    const customize = await screen.findByRole('button', { name: 'Customize appearance' });
    expect(screen.getByText(/Value “Anniversary” was added/)).toBeTruthy();
    // up to here only the row was created: no visual write exists yet
    expect(apiMock.mock.calls.some(([path]) => String(path).endsWith('/visual'))).toBe(false);

    await userEvent.click(customize);
    const editor = await screen.findByRole('dialog', { name: 'Edit value — Anniversary' });
    expect(within(editor).getByRole('tab', { name: 'Image & icon' }).getAttribute('aria-selected')).toBe('true');
    // a brand-new row has no version: the first write will be a creation
    expect(apiMock.mock.calls.some(([path]) => String(path).endsWith('/visual'))).toBe(false);
  });

  it('can be dismissed with «Later»', async () => {
    apiMock
      .mockResolvedValueOnce(facets(rawFacet()))
      .mockResolvedValueOnce({ data: { value: { id: 'v9', slug: 'a', name: 'A' } } })
      .mockResolvedValueOnce(facets(rawFacet()));
    panel();
    await userEvent.click((await screen.findAllByRole('button', { name: 'Add value' }))[0]);
    await userEvent.type(screen.getByLabelText('Arabic name'), 'A');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Later' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers nothing to customise to a role without commerce.manage', async () => {
    apiMock
      .mockResolvedValueOnce(facets(rawFacet()))
      .mockResolvedValueOnce({ data: { value: { id: 'v9', slug: 'a', name: 'A' } } })
      .mockResolvedValueOnce(facets(rawFacet()));
    panel({ canManageIdentity: false });
    await userEvent.click((await screen.findAllByRole('button', { name: 'Add value' }))[0]);
    await userEvent.type(screen.getByLabelText('Arabic name'), 'A');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Customize appearance' })).toBeNull();
  });

  it('works for a new dimension too', async () => {
    apiMock
      .mockResolvedValueOnce(facets())
      .mockResolvedValueOnce({ data: { facet: { id: 'f9', key: 'colour', name: 'Colour' } } })
      .mockResolvedValueOnce(facets(rawFacet({ id: 'f9', key: 'colour', system_key: null, name: 'Colour', name_en: null, values: [] })));
    panel();
    await userEvent.click(await screen.findByRole('button', { name: 'New dimension' }));
    await userEvent.type(screen.getByLabelText('Arabic name'), 'Colour');
    await userEvent.type(screen.getByLabelText('Identifier (lowercase letters and dashes)'), 'colour');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Customize appearance' }));
    expect(await screen.findByRole('dialog', { name: 'Edit dimension — Colour' })).toBeTruthy();
  });
});

describe('Arabic', () => {
  it('words the list controls in Arabic', async () => {
    apiMock.mockResolvedValueOnce(facets(rawFacet()));
    panel({ locale: 'ar' });
    await screen.findByText('Birthday');
    expect(screen.getByRole('button', { name: 'طيّ القيم — Occasion' })).toBeTruthy();
    expect(document.querySelector('[data-delete-blocked="v2"]')?.textContent).toBe('مُسنَدة لمنتجات — عطّلها بدلاً من حذفها.');
  });
});
