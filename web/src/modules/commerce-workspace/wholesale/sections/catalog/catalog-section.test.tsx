// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const locale = vi.hoisted(() => ({ current: 'en' }));
vi.mock('next-intl', () => {
  const t = Object.assign((key: string) => key, { rich: (key: string) => key });
  return { useLocale: () => locale.current, useTranslations: () => t };
});
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const can = vi.hoisted(() => ({ allowed: new Set<string>() }));
vi.mock('@/lib/use-can', () => ({ useCan: () => ({ hydrated: true, can: (p: string) => can.allowed.has(p) }) }));
const channel = vi.hoisted(() => ({ store: { id: 's1', name: 'Wholesale Store', salesChannelId: 'c1' } }));
vi.mock('../../channel-context', () => ({
  useWholesaleChannel: () => ({ readiness: 'active', store: channel.store }),
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => toast }));
const confirmMock = vi.hoisted(() => vi.fn());
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => confirmMock }));

const apiMocks = vi.hoisted(() => ({ page: vi.fn(), counts: vi.fn(), set: vi.fn() }));
vi.mock('./api', () => ({
  loadStoreCatalogPage: (...a: unknown[]) => apiMocks.page(...a),
  loadStoreCatalogCounts: (...a: unknown[]) => apiMocks.counts(...a),
  setStorePublication: (...a: unknown[]) => apiMocks.set(...a),
}));
const ws = vi.hoisted(() => ({ list: vi.fn(), show: vi.fn() }));
vi.mock('@/modules/commerce-workspace/workspace-products', () => ({
  listWorkspaceProducts: (...a: unknown[]) => ws.list(...a),
  showWorkspaceProduct: (...a: unknown[]) => ws.show(...a),
}));

import { CatalogSection } from './catalog-section';

const item = (over = {}) => ({
  id: 'p1', sku: 'SKU-1', name: 'Rice 10kg', nameEn: null, isActive: true, isPublished: false,
  stores: [{ id: 's1', name: 'Wholesale Store', isPublished: false }], ...over,
});
const page = (items = [item()]) => ({ items, meta: { currentPage: 1, lastPage: 1, perPage: 25, total: items.length } });

beforeEach(() => {
  locale.current = 'en';
  channel.store = { id: 's1', name: 'Wholesale Store', salesChannelId: 'c1' };
  can.allowed = new Set(['products.view', 'products.manage', 'commerce.manage']);
  apiMocks.page.mockReset().mockResolvedValue(page());
  apiMocks.counts.mockReset().mockResolvedValue({ all: 12, published: 7, unpublished: 5 });
  apiMocks.set.mockReset().mockResolvedValue([]);
  confirmMock.mockReset().mockResolvedValue(true);
  toast.success.mockReset();
  toast.error.mockReset();
  ws.list.mockReset().mockResolvedValue({ ok: true, data: [{ id: 'p1', name: 'Rice 10kg', nameEn: null, thumbnailUrl: null, isVariantManaged: false, priceAmountMinor: 12500, currency: 'SAR', inStock: true }], hasMore: false });
  ws.show.mockReset();
});
afterEach(cleanup);

describe('CatalogSection', () => {
  it('loads the active store scope and shows server totals', async () => {
    render(<CatalogSection />);
    await waitFor(() => expect(screen.getAllByText('Rice 10kg').length).toBeGreaterThan(0));
    expect(apiMocks.page.mock.calls[0][0]).toBe('s1');
    expect(apiMocks.counts).toHaveBeenCalledWith('s1');
    await waitFor(() => expect(screen.getByText('12')).toBeTruthy());
    expect(screen.getByText('7')).toBeTruthy();
    // units/MOQ stays an honest deferred panel
    expect(screen.getByTestId('deferred-capability').textContent).toMatch(/D-M1/);
  });

  it('publishes only after confirmation and refreshes totals', async () => {
    render(<CatalogSection />);
    await waitFor(() => screen.getAllByText('Rice 10kg'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Publish' })[0]);
    await waitFor(() => expect(apiMocks.set).toHaveBeenCalledWith('p1', 's1', true));
    expect(confirmMock).toHaveBeenCalledOnce();
    expect(toast.success).toHaveBeenCalledWith('Product published');
    expect(apiMocks.counts.mock.calls.length).toBeGreaterThan(1);
  });

  it('ignores a publication write that finishes after the store was switched (no cross-store counts)', async () => {
    apiMocks.counts.mockImplementation(async (storeId: string) =>
      storeId === 's1' ? { all: 11, published: 1, unpublished: 10 } : { all: 99, published: 9, unpublished: 90 },
    );
    let finishWrite: (value: unknown) => void = () => undefined;
    apiMocks.set.mockReturnValue(new Promise((resolve) => (finishWrite = resolve)));

    const view = render(<CatalogSection />);
    await waitFor(() => screen.getAllByText('Rice 10kg'));
    await waitFor(() => screen.getByText('11'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Publish' })[0]);
    await waitFor(() => expect(apiMocks.set).toHaveBeenCalledWith('p1', 's1', true)); // write for store A now pending

    channel.store = { id: 's2', name: 'Other Store', salesChannelId: 'c2' };
    view.rerender(<CatalogSection />);
    await waitFor(() => screen.getByText('99')); // store B's own figures
    expect(screen.queryByText('11')).toBeNull(); // A's figures were dropped on the switch
    const callsBefore = apiMocks.counts.mock.calls.length;

    finishWrite([]); // A's write completes after the switch → its onChanged callback fires
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(screen.getByText('99')).toBeTruthy();
    expect(screen.queryByText('11')).toBeNull();
    // The stale callback neither fetched A's counts again nor disturbed B's request sequence.
    expect(apiMocks.counts.mock.calls.length).toBe(callsBefore);
    expect(apiMocks.counts.mock.calls.slice(callsBefore).filter(([id]) => id === 's1')).toEqual([]);
  });

  it('does not write when the confirmation is declined', async () => {
    confirmMock.mockResolvedValue(false);
    render(<CatalogSection />);
    await waitFor(() => screen.getAllByText('Rice 10kg'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Publish' })[0]);
    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    expect(apiMocks.set).not.toHaveBeenCalled();
  });

  it('reports a failed write without claiming success', async () => {
    apiMocks.set.mockRejectedValue(new Error('x'));
    render(<CatalogSection />);
    await waitFor(() => screen.getAllByText('Rice 10kg'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Publish' })[0]);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not update publication. Nothing changed.'));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('is read-only without products.manage (no publish controls)', async () => {
    can.allowed = new Set(['products.view']);
    render(<CatalogSection />);
    await waitFor(() => screen.getAllByText('Rice 10kg'));
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    expect(screen.getByText(/read-only/)).toBeTruthy();
  });

  it('shows unpublish for a published product', async () => {
    apiMocks.page.mockResolvedValue(page([item({ isPublished: true, stores: [{ id: 's1', name: 'x', isPublished: true }] })]));
    render(<CatalogSection />);
    await waitFor(() => screen.getAllByText('Rice 10kg'));
    expect(screen.getAllByRole('button', { name: 'Unpublish' }).length).toBeGreaterThan(0);
  });

  it('shows an error state with retry when the list fails', async () => {
    apiMocks.page.mockRejectedValueOnce(new Error('x')).mockResolvedValue(page());
    render(<CatalogSection />);
    await waitFor(() => screen.getByRole('alert'));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => screen.getAllByText('Rice 10kg'));
  });

  it('shows the empty state', async () => {
    apiMocks.page.mockResolvedValue(page([]));
    render(<CatalogSection />);
    await waitFor(() => screen.getByText('No products'));
  });

  it('gates the availability tab on commerce.manage and sends no request without it', async () => {
    can.allowed = new Set(['products.view']);
    render(<CatalogSection />);
    fireEvent.click(screen.getByRole('tab', { name: 'Store availability' }));
    expect(screen.getByText(/requires the “manage e-commerce” permission/)).toBeTruthy();
    expect(ws.list).not.toHaveBeenCalled();
  });

  it('lists availability with price and stock for the active store', async () => {
    render(<CatalogSection />);
    fireEvent.click(screen.getByRole('tab', { name: 'Store availability' }));
    await waitFor(() => expect(ws.list).toHaveBeenCalledWith('s1', expect.objectContaining({ page: 1, perPage: 20 })));
    await waitFor(() => expect(screen.getAllByText('In stock').length).toBeGreaterThan(0));
    expect(screen.getAllByText(/125/).length).toBeGreaterThan(0);
    // The list endpoint returns the product's BASE price (the channel price list is resolved only in the detail view),
    // so the column must say so and never call it the channel price.
    expect(screen.getByRole('columnheader', { name: 'Base price' })).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'Price' })).toBeNull();
  });

  it('labels the mobile availability rows as base price too, in English and Arabic', async () => {
    render(<CatalogSection />);
    fireEvent.click(screen.getByRole('tab', { name: 'Store availability' }));
    await waitFor(() => screen.getAllByText('In stock'));
    const mobileRows = document.querySelector('ul.md\\:hidden') as HTMLElement;
    expect(mobileRows).toBeTruthy();
    expect(within(mobileRows).getByText('Base price')).toBeTruthy();
    expect(within(mobileRows).queryByText('Price')).toBeNull();
    cleanup();

    locale.current = 'ar';
    render(<CatalogSection />);
    fireEvent.click(screen.getByRole('tab', { name: 'التوفر في المتجر' }));
    await waitFor(() => screen.getAllByText('متوفر'));
    expect(screen.getByRole('columnheader', { name: 'السعر الأساسي' })).toBeTruthy();
    const arMobileRows = document.querySelector('ul.md\\:hidden') as HTMLElement;
    expect(within(arMobileRows).getByText('السعر الأساسي')).toBeTruthy();
    expect(screen.queryByText('السعر في القناة')).toBeNull(); // the channel-price label belongs to the detail drawer only
  });

  it('reads the availability list for the active store only, with no tenant or channel override', async () => {
    render(<CatalogSection />);
    fireEvent.click(screen.getByRole('tab', { name: 'Store availability' }));
    await waitFor(() => expect(ws.list).toHaveBeenCalled());
    const [storeId, params] = ws.list.mock.calls[0] as [string, Record<string, unknown>];
    expect(storeId).toBe('s1');
    expect(JSON.stringify(params)).not.toMatch(/tenant|channel/i);
  });

  it('renders Arabic', async () => {
    locale.current = 'ar';
    render(<CatalogSection />);
    await waitFor(() => screen.getAllByText('Rice 10kg'));
    expect(screen.getByText('كل المنتجات')).toBeTruthy();
  });
});
