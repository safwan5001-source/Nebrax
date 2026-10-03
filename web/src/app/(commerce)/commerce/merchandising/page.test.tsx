// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: (...args: unknown[]) => apiMock(...args),
}));

const user = { current: { role: 'owner', permissions: undefined as string[] | undefined } };
vi.mock('@/lib/auth', () => ({ currentUser: () => user.current }));
vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => (key: string) => key }));

import CommerceMerchandisingPage from './page';
import { ToastProvider } from '@/components/ui/toast';

function renderPage() {
  return render(
    <ToastProvider>
      <CommerceMerchandisingPage />
    </ToastProvider>,
  );
}

const occasion = {
  id: 'f1', key: 'occasion', system_key: 'occasion', name: 'Occasion', name_en: null, sort_order: 0, is_active: true,
  values: [
    { id: 'v1', slug: 'birthday', name: 'Birthday', name_en: null, sort_order: 0, is_active: true, product_count: 2 },
    { id: 'v2', slug: 'wedding', name: 'Wedding', name_en: null, sort_order: 1, is_active: true, product_count: 0 },
  ],
};

afterEach(() => {
  cleanup();
  apiMock.mockReset();
  user.current = { role: 'owner', permissions: undefined };
});

describe('Merchandising — dimensions tab', () => {
  it('lists facets and values, blocks deleting an assigned value and offers only missing presets', async () => {
    apiMock.mockResolvedValueOnce({ data: { facets: [occasion] } });
    renderPage();

    expect(await screen.findByText('Birthday')).toBeTruthy();
    expect(screen.getByText('2 products')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Delete Birthday' }) as HTMLButtonElement).disabled).toBe(true);
    // البُعد كله لا يُحذف ما دامت قيمة منه مُسنَدة (الخادم يرفضه 409)
    expect((screen.getByRole('button', { name: 'Delete Occasion' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Delete Wedding' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('button', { name: 'Add “Occasion”' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add “Recipient”' })).toBeTruthy();
  });

  it('creates the recipient preset with the system key and refreshes from the server', async () => {
    apiMock
      .mockResolvedValueOnce({ data: { facets: [occasion] } })
      .mockResolvedValueOnce({ data: { facet: { id: 'f2', key: 'recipient', name: 'Recipient', system_key: 'recipient' } } })
      .mockResolvedValueOnce({ data: { facets: [occasion, { id: 'f2', key: 'recipient', system_key: 'recipient', name: 'Recipient', is_active: true, values: [] }] } });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Add “Recipient”' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(3));
    expect(apiMock).toHaveBeenNthCalledWith(2, '/commerce/workspace/facets', {
      method: 'POST',
      body: { key: 'recipient', name: 'Recipient', name_en: 'Recipient', system_key: 'recipient' },
    });
    expect(await screen.findByRole('heading', { name: 'Recipient' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the dialog open and shows a failure when the request is rejected', async () => {
    apiMock
      .mockResolvedValueOnce({ data: { facets: [occasion] } })
      .mockRejectedValueOnce(new Error('network'));
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Add value' }));
    await userEvent.type(screen.getByLabelText('Value name'), 'Birthday');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    // خطأ غير HTTP ⇒ العبارة العامة (لا نص خادم مُختلَق)
    expect(await screen.findByText('Could not save. Please try again.')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('requires a name before sending anything', async () => {
    apiMock.mockResolvedValueOnce({ data: { facets: [occasion] } });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'Add value' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('A name is required.')).toBeTruthy();
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it('is read-only without products.manage', async () => {
    user.current = { role: 'staff', permissions: ['products.view'] };
    apiMock.mockResolvedValueOnce({ data: { facets: [occasion] } });
    renderPage();

    expect(await screen.findByText('Birthday')).toBeTruthy();
    expect(screen.getByText(/view only/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New dimension' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add value' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit Birthday' })).toBeNull();
  });

  it('shows an error state with retry when the load fails', async () => {
    apiMock.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ data: { facets: [] } });
    renderPage();

    expect(await screen.findByText('Could not load the data.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'retry' }));
    expect(await screen.findByText('No dimensions yet')).toBeTruthy();
  });
});

describe('Merchandising — collections tab', () => {
  const collection = { id: 'c1', slug: 'best', title: 'Best sellers', title_en: null, description: null, status: 'active', sort_order: 0, member_count: 2 };

  async function openCollections() {
    apiMock.mockResolvedValueOnce({ data: { facets: [] } }); // facets tab initial
    renderPage();
    apiMock.mockResolvedValueOnce({ data: { collections: [collection] } });
    await userEvent.click(await screen.findByRole('tab', { name: 'Collections' }));
  }

  it('reorders members and saves the exact order', async () => {
    await openCollections();
    apiMock.mockResolvedValueOnce({
      data: { products: [
        { product_id: 'a', name: 'Roses', name_en: null, sku: null, is_active: true, position: 0 },
        { product_id: 'b', name: 'Tulips', name_en: null, sku: null, is_active: true, position: 1 },
      ] },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Manage products' }));
    expect(await screen.findByText('Roses')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Move down: Roses' }));
    const items = within(screen.getByRole('dialog')).getAllByRole('listitem');
    expect(items[0].textContent).toContain('Tulips');

    apiMock.mockResolvedValueOnce({ data: { products: [] } }); // PUT
    apiMock.mockResolvedValueOnce({ data: { collections: [collection] } }); // refresh
    await userEvent.click(screen.getByRole('button', { name: 'Save order' }));

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/collections/c1/products', {
        method: 'PUT',
        body: { product_ids: ['b', 'a'] },
      }),
    );
  });

  it('disables moving the first item up and the last item down', async () => {
    await openCollections();
    apiMock.mockResolvedValueOnce({
      data: { products: [
        { product_id: 'a', name: 'Roses', is_active: true, position: 0 },
        { product_id: 'b', name: 'Tulips', is_active: true, position: 1 },
      ] },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Manage products' }));
    await screen.findByText('Roses');

    expect((screen.getByRole('button', { name: 'Move up: Roses' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Move down: Tulips' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Merchandising — collections for read-only users and pending writes', () => {
  const collection = { id: 'c1', slug: 'best', title: 'Best sellers', title_en: null, description: null, status: 'active', sort_order: 0, member_count: 2 };

  it('lets a view-only user inspect the members read-only', async () => {
    user.current = { role: 'staff', permissions: ['products.view'] };
    apiMock.mockResolvedValueOnce({ data: { facets: [] } });
    renderPage();
    apiMock.mockResolvedValueOnce({ data: { collections: [collection] } });
    await userEvent.click(await screen.findByRole('tab', { name: 'Collections' }));
    apiMock.mockResolvedValueOnce({
      data: { products: [
        { product_id: 'a', name: 'Roses', name_en: null, sku: null, is_active: true, position: 0 },
        { product_id: 'b', name: 'Tulips', name_en: null, sku: null, is_active: true, position: 1 },
      ] },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'View products' }));

    expect(await screen.findByText('Roses')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Move down: Roses' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove: Roses' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save order' })).toBeNull();
    expect(screen.queryByLabelText('Search a product by name or SKU')).toBeNull();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('keeps a form dialog open on Escape while its request is pending', async () => {
    apiMock.mockResolvedValueOnce({ data: { facets: [occasion] } });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Add value' }));
    await userEvent.type(screen.getByLabelText('Value name'), 'Anniversary');

    let finish: (value: unknown) => void = () => undefined;
    apiMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await userEvent.keyboard('{Escape}');

    expect(screen.getByRole('dialog')).toBeTruthy();

    apiMock.mockResolvedValueOnce({ data: { facets: [occasion] } });
    finish({ data: { value: { id: 'v9', slug: 'anniversary', name: 'Anniversary' } } });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('Merchandising — product picker pagination', () => {
  it('offers later pages when the first page is fully excluded or truncated', async () => {
    apiMock.mockResolvedValueOnce({ data: { facets: [occasion] } });
    renderPage();
    apiMock.mockResolvedValueOnce({ data: { facets: [occasion] } });
    await userEvent.click(await screen.findByRole('tab', { name: 'Assign products' }));

    const page = (n: number, last: number, items: Array<{ id: string; name: string }>) => ({
      data: items.map((i) => ({ ...i, sku: null, name_en: null, is_active: true, is_published: true, stores: [] })),
      meta: { current_page: n, last_page: last, per_page: 10, total: 11 },
    });
    apiMock.mockResolvedValueOnce(page(1, 2, [{ id: 'p1', name: 'Rose A' }]));
    await userEvent.type(await screen.findByLabelText('Search a product by name or SKU'), 'rose');
    expect(await screen.findByText('Rose A', undefined, { timeout: 3000 })).toBeTruthy();

    apiMock.mockResolvedValueOnce(page(2, 2, [{ id: 'p2', name: 'Rose B' }]));
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(await screen.findByText('Rose B')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
    expect(apiMock).toHaveBeenLastCalledWith(expect.stringContaining('page=2'));
  });
});

describe('Merchandising — toggles and stale paging', () => {
  it('explains a failed activation instead of silently snapping back', async () => {
    apiMock
      .mockResolvedValueOnce({ data: { facets: [occasion] } })
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ data: { facets: [occasion] } });
    renderPage();

    await userEvent.click(await screen.findByRole('switch', { name: 'Disable Occasion' }));
    expect(await screen.findByText('Could not save. Please try again.')).toBeTruthy();
  });

  it('drops a pending "Show more" response once the search text changed', async () => {
    apiMock.mockResolvedValueOnce({ data: { facets: [occasion] } });
    renderPage();
    apiMock.mockResolvedValueOnce({ data: { facets: [occasion] } });
    await userEvent.click(await screen.findByRole('tab', { name: 'Assign products' }));

    const row = (id: string, name: string) => ({ id, name, sku: null, name_en: null, is_active: true, is_published: true, stores: [] });
    apiMock.mockResolvedValueOnce({ data: [row('p1', 'Rose A')], meta: { current_page: 1, last_page: 2, per_page: 10, total: 11 } });
    const search = await screen.findByLabelText('Search a product by name or SKU');
    await userEvent.type(search, 'rose');
    expect(await screen.findByText('Rose A', undefined, { timeout: 3000 })).toBeTruthy();

    let finish: (value: unknown) => void = () => undefined;
    apiMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));

    await userEvent.clear(search);
    finish({ data: [row('p9', 'Stale Rose')], meta: { current_page: 2, last_page: 2, per_page: 10, total: 11 } });
    await waitFor(() => expect(screen.queryByText('Rose A')).toBeNull());
    expect(screen.queryByText('Stale Rose')).toBeNull();
  });
});

describe('Merchandising — concurrent toggles and stale picker rows', () => {
  it('disables every switch while one activation is in flight', async () => {
    const other = { ...occasion, id: 'f2', key: 'recipient', system_key: 'recipient', name: 'Recipient', values: [] };
    apiMock.mockResolvedValueOnce({ data: { facets: [occasion, other] } });
    renderPage();

    let finish: (value: unknown) => void = () => undefined;
    apiMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await userEvent.click(await screen.findByRole('switch', { name: 'Disable Occasion' }));

    expect((screen.getByRole('switch', { name: 'Disable Recipient' }) as HTMLButtonElement).disabled).toBe(true);
    // وكل أدوات التعديل الأخرى تُقفل أيضاً ريثما تنتهي الكتابة وإعادة التحميل
    expect((screen.getByRole('button', { name: 'Edit Occasion' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Edit Birthday' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'New dimension' }) as HTMLButtonElement).disabled).toBe(true);

    apiMock.mockResolvedValueOnce({ data: { facets: [occasion, other] } });
    finish({ data: { facet: { id: 'f1' } } });
    await waitFor(() => expect((screen.getByRole('switch', { name: 'Disable Recipient' }) as HTMLButtonElement).disabled).toBe(false));
  });

  it('removes old picker rows as soon as the query changes', async () => {
    apiMock.mockResolvedValueOnce({ data: { facets: [occasion] } });
    renderPage();
    apiMock.mockResolvedValueOnce({ data: { facets: [occasion] } });
    await userEvent.click(await screen.findByRole('tab', { name: 'Assign products' }));

    apiMock.mockResolvedValueOnce({
      data: [{ id: 'p1', name: 'Rose A', sku: null, name_en: null, is_active: true, is_published: true, stores: [] }],
      meta: { current_page: 1, last_page: 1, per_page: 10, total: 1 },
    });
    const search = await screen.findByLabelText('Search a product by name or SKU');
    await userEvent.type(search, 'rose');
    expect(await screen.findByText('Rose A', undefined, { timeout: 3000 })).toBeTruthy();

    apiMock.mockImplementationOnce(() => new Promise(() => undefined)); // next query never resolves
    await userEvent.type(search, 's');
    await waitFor(() => expect(screen.queryByText('Rose A')).toBeNull());
  });
});

describe('Merchandising — state that must not leak across products or queries', () => {
  const row = (id: string, name: string) => ({ id, name, sku: null, name_en: null, is_active: true, is_published: true, stores: [] });

  it('does not keep a pending "Show more" from blocking the next query', async () => {
    apiMock.mockResolvedValueOnce({ data: { facets: [occasion] } });
    renderPage();
    apiMock.mockResolvedValueOnce({ data: { facets: [occasion] } });
    await userEvent.click(await screen.findByRole('tab', { name: 'Assign products' }));

    apiMock.mockResolvedValueOnce({ data: [row('p1', 'Rose A')], meta: { current_page: 1, last_page: 2, per_page: 10, total: 11 } });
    const search = await screen.findByLabelText('Search a product by name or SKU');
    await userEvent.type(search, 'rose');
    expect(await screen.findByText('Rose A', undefined, { timeout: 3000 })).toBeTruthy();

    apiMock.mockImplementationOnce(() => new Promise(() => undefined)); // "Show more" for the first query never settles
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));

    apiMock.mockResolvedValueOnce({ data: [row('p2', 'Tulip A')], meta: { current_page: 1, last_page: 2, per_page: 10, total: 11 } });
    await userEvent.clear(search);
    await userEvent.type(search, 'tulip');
    expect(await screen.findByText('Tulip A', undefined, { timeout: 3000 })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Show more' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('clears product A\'s save error when product B is selected', async () => {
    apiMock.mockResolvedValueOnce({ data: { facets: [occasion] } });
    renderPage();
    apiMock.mockResolvedValueOnce({ data: { facets: [occasion] } });
    await userEvent.click(await screen.findByRole('tab', { name: 'Assign products' }));

    const search = await screen.findByLabelText('Search a product by name or SKU');
    apiMock.mockResolvedValueOnce({ data: [row('p1', 'Red roses')], meta: { current_page: 1, last_page: 1, per_page: 10, total: 1 } });
    await userEvent.type(search, 'rose');
    expect(await screen.findByText('Red roses', undefined, { timeout: 3000 })).toBeTruthy();
    apiMock.mockResolvedValueOnce({ data: { value_ids: ['v1'] } });
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await screen.findByRole('checkbox', { name: 'Birthday' });

    apiMock.mockRejectedValueOnce(new Error('network')); // PUT for A fails
    await userEvent.click(screen.getByRole('button', { name: 'Save assignment' }));
    expect(await screen.findByText('Could not save. Please try again.')).toBeTruthy();

    apiMock.mockResolvedValueOnce({ data: [row('p2', 'Tulips')], meta: { current_page: 1, last_page: 1, per_page: 10, total: 1 } });
    await userEvent.clear(search);
    await userEvent.type(search, 'tulip');
    expect(await screen.findByText('Tulips', undefined, { timeout: 3000 })).toBeTruthy();
    apiMock.mockResolvedValueOnce({ data: { value_ids: [] } });
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));

    await waitFor(() => expect(screen.queryByText('Could not save. Please try again.')).toBeNull());
  });
});

describe('Merchandising — edits while a save or a later page is in flight', () => {
  const row = (id: string, name: string) => ({ id, name, sku: null, name_en: null, is_active: true, is_published: true, stores: [] });

  it('keeps loaded rows and offers a retry when "Show more" fails', async () => {
    apiMock.mockResolvedValueOnce({ data: { facets: [occasion] } });
    renderPage();
    apiMock.mockResolvedValueOnce({ data: { facets: [occasion] } });
    await userEvent.click(await screen.findByRole('tab', { name: 'Assign products' }));

    apiMock.mockResolvedValueOnce({ data: [row('p1', 'Rose A')], meta: { current_page: 1, last_page: 2, per_page: 10, total: 11 } });
    await userEvent.type(await screen.findByLabelText('Search a product by name or SKU'), 'rose');
    expect(await screen.findByText('Rose A', undefined, { timeout: 3000 })).toBeTruthy();

    apiMock.mockRejectedValueOnce(new Error('network'));
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));

    expect(await screen.findByText('Could not load the data.')).toBeTruthy();
    expect(screen.getByText('Rose A')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show more' })).toBeTruthy();
  });

  it('disables the assignment checkboxes while the save is pending', async () => {
    apiMock.mockResolvedValueOnce({ data: { facets: [occasion] } });
    renderPage();
    apiMock.mockResolvedValueOnce({ data: { facets: [occasion] } });
    await userEvent.click(await screen.findByRole('tab', { name: 'Assign products' }));
    apiMock.mockResolvedValueOnce({ data: [row('p1', 'Red roses')], meta: { current_page: 1, last_page: 1, per_page: 10, total: 1 } });
    await userEvent.type(await screen.findByLabelText('Search a product by name or SKU'), 'rose');
    expect(await screen.findByText('Red roses', undefined, { timeout: 3000 })).toBeTruthy();
    apiMock.mockResolvedValueOnce({ data: { value_ids: ['v1'] } });
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await screen.findByRole('checkbox', { name: 'Wedding' });

    apiMock.mockImplementationOnce(() => new Promise(() => undefined)); // the PUT never settles
    await userEvent.click(screen.getByRole('button', { name: 'Save assignment' }));

    expect((screen.getByRole('checkbox', { name: 'Wedding' }) as HTMLInputElement).disabled).toBe(true);
  });

  it('disables member edits in the collection dialog while saving', async () => {
    const collection = { id: 'c1', slug: 'best', title: 'Best sellers', title_en: null, description: null, status: 'active', sort_order: 0, member_count: 2 };
    apiMock.mockResolvedValueOnce({ data: { facets: [] } });
    renderPage();
    apiMock.mockResolvedValueOnce({ data: { collections: [collection] } });
    await userEvent.click(await screen.findByRole('tab', { name: 'Collections' }));
    apiMock.mockResolvedValueOnce({
      data: { products: [
        { product_id: 'a', name: 'Roses', name_en: null, sku: null, is_active: true, position: 0 },
        { product_id: 'b', name: 'Tulips', name_en: null, sku: null, is_active: true, position: 1 },
      ] },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Manage products' }));
    await screen.findByText('Roses');

    apiMock.mockImplementationOnce(() => new Promise(() => undefined));
    await userEvent.click(screen.getByRole('button', { name: 'Save order' }));

    expect((screen.getByRole('button', { name: 'Move down: Roses' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Remove: Tulips' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Merchandising — load-more across an A→B→A search', () => {
  it('ignores an old page-two response even when the text returns to the same query', async () => {
    apiMock.mockResolvedValueOnce({ data: { facets: [occasion] } });
    renderPage();
    apiMock.mockResolvedValueOnce({ data: { facets: [occasion] } });
    await userEvent.click(await screen.findByRole('tab', { name: 'Assign products' }));

    const row = (id: string, name: string) => ({ id, name, sku: null, name_en: null, is_active: true, is_published: true, stores: [] });
    apiMock.mockResolvedValueOnce({ data: [row('p1', 'Rose A')], meta: { current_page: 1, last_page: 3, per_page: 10, total: 25 } });
    const search = await screen.findByLabelText('Search a product by name or SKU');
    await userEvent.type(search, 'rose');
    expect(await screen.findByText('Rose A', undefined, { timeout: 3000 })).toBeTruthy();

    let finishOld: (value: unknown) => void = () => undefined;
    apiMock.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; })); // page 2 of the first "rose"
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));

    await userEvent.clear(search);
    apiMock.mockResolvedValueOnce({ data: [row('p3', 'Rose B')], meta: { current_page: 1, last_page: 3, per_page: 10, total: 25 } });
    await userEvent.type(search, 'rose'); // back to the same text, a new generation
    finishOld({ data: [row('p9', 'Stale page two')], meta: { current_page: 2, last_page: 3, per_page: 10, total: 25 } });

    expect(await screen.findByText('Rose B', undefined, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByText('Stale page two')).toBeNull();

    apiMock.mockResolvedValueOnce({ data: [row('p4', 'Rose C')], meta: { current_page: 2, last_page: 3, per_page: 10, total: 25 } });
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(await screen.findByText('Rose C')).toBeTruthy();
    expect(apiMock).toHaveBeenLastCalledWith(expect.stringContaining('page=2'));
  });
});

describe('Merchandising — tab semantics', () => {
  it('wraps the active content in the tab panel its tab controls', async () => {
    apiMock.mockResolvedValueOnce({ data: { facets: [occasion] } });
    renderPage();
    await screen.findByText('Birthday');
    const panel = screen.getByRole('tabpanel');
    expect(panel.id).toBe('panel-facets');
    expect(screen.getByRole('tab', { name: 'Dimensions' }).getAttribute('aria-controls')).toBe('panel-facets');
    expect(within(panel).getByText('Birthday')).toBeTruthy();
  });
});

describe('Merchandising — assign tab', () => {
  it('guides to create dimensions first when there are none', async () => {
    apiMock.mockResolvedValueOnce({ data: { facets: [] } }); // facets tab
    renderPage();
    apiMock.mockResolvedValueOnce({ data: { facets: [] } }); // assign tab
    await userEvent.click(await screen.findByRole('tab', { name: 'Assign products' }));

    expect(await screen.findByText(/Create a dimension and values first/)).toBeTruthy();
  });
});

describe('Merchandising — assigning values to a product', () => {
  it('loads the product\'s values, toggles one and saves the exact set', async () => {
    apiMock.mockResolvedValueOnce({ data: { facets: [occasion] } }); // facets tab
    renderPage();
    apiMock.mockResolvedValueOnce({ data: { facets: [occasion] } }); // assign tab
    await userEvent.click(await screen.findByRole('tab', { name: 'Assign products' }));

    apiMock.mockResolvedValueOnce({
      data: [{ id: 'p1', sku: 'ROSE-1', name: 'Red roses', name_en: null, is_active: true, is_published: true, stores: [] }],
      meta: { current_page: 1, last_page: 1, per_page: 10, total: 1 },
    });
    await userEvent.type(await screen.findByLabelText('Search a product by name or SKU'), 'rose');
    expect(await screen.findByText('Red roses', undefined, { timeout: 3000 })).toBeTruthy();

    apiMock.mockResolvedValueOnce({ data: { value_ids: ['v1'] } }); // current assignments
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const birthday = (await screen.findByRole('checkbox', { name: 'Birthday' })) as HTMLInputElement;
    await waitFor(() => expect(birthday.checked).toBe(true));

    await userEvent.click(screen.getByRole('checkbox', { name: 'Wedding' }));
    apiMock.mockResolvedValueOnce({ data: { value_ids: ['v1', 'v2'] } }); // PUT
    apiMock.mockResolvedValueOnce({ data: { facets: [occasion] } }); // refresh counts
    await userEvent.click(screen.getByRole('button', { name: 'Save assignment' }));

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/products/p1/facets', {
        method: 'PUT',
        body: { value_ids: ['v1', 'v2'] },
      }),
    );
    expect(await screen.findByText('Classification saved.')).toBeTruthy();
  });
  async function openProduct(product: { id: string; sku: string; name: string }, assigned: string[], facets: unknown[]) {
    apiMock.mockResolvedValueOnce({
      data: [{ ...product, name_en: null, is_active: true, is_published: true, stores: [] }],
      meta: { current_page: 1, last_page: 1, per_page: 10, total: 1 },
    });
    const search = await screen.findByLabelText('Search a product by name or SKU');
    await userEvent.clear(search);
    await userEvent.type(search, product.sku.toLowerCase());
    expect(await screen.findByText(product.name, undefined, { timeout: 3000 })).toBeTruthy();
    apiMock.mockResolvedValueOnce({ data: { value_ids: assigned } });
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    void facets;
  }

  it('never offers new values of a deactivated dimension, but keeps assigned ones removable', async () => {
    const inactive = {
      ...occasion,
      is_active: false,
      values: [
        { id: 'v1', slug: 'birthday', name: 'Birthday', name_en: null, sort_order: 0, is_active: true, product_count: 1 },
        { id: 'v2', slug: 'wedding', name: 'Wedding', name_en: null, sort_order: 1, is_active: true, product_count: 0 },
      ],
    };
    apiMock.mockResolvedValueOnce({ data: { facets: [inactive] } });
    renderPage();
    apiMock.mockResolvedValueOnce({ data: { facets: [inactive] } });
    await userEvent.click(await screen.findByRole('tab', { name: 'Assign products' }));
    await openProduct({ id: 'p1', sku: 'ROSE-1', name: 'Red roses' }, ['v1'], [inactive]);

    const assigned = (await screen.findByRole('checkbox', { name: 'Birthday' })) as HTMLInputElement;
    await waitFor(() => expect(assigned.checked).toBe(true));
    expect(assigned.disabled).toBe(false);
    expect((screen.getByRole('checkbox', { name: 'Wedding' }) as HTMLInputElement).disabled).toBe(true);
  });

  it('ignores a save result that arrives after another product was selected', async () => {
    apiMock.mockResolvedValueOnce({ data: { facets: [occasion] } });
    renderPage();
    apiMock.mockResolvedValueOnce({ data: { facets: [occasion] } });
    await userEvent.click(await screen.findByRole('tab', { name: 'Assign products' }));
    await openProduct({ id: 'p1', sku: 'ROSE-1', name: 'Red roses' }, ['v1'], [occasion]);
    await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Birthday' }) as HTMLInputElement).checked).toBe(true));

    let finishSave: (value: unknown) => void = () => undefined;
    apiMock.mockImplementationOnce(() => new Promise((resolve) => { finishSave = resolve; })); // PUT for p1 stays pending
    await userEvent.click(screen.getByRole('button', { name: 'Save assignment' }));

    await openProduct({ id: 'p2', sku: 'TULIP-1', name: 'Tulips' }, ['v2'], [occasion]);
    await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Wedding' }) as HTMLInputElement).checked).toBe(true));

    apiMock.mockResolvedValueOnce({ data: { facets: [occasion] } }); // refresh after the late save
    finishSave({ data: { value_ids: ['v1'] } });
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/products/p1/facets', expect.anything()));

    // لوحة المنتج الثاني لم تُستبدل بنتيجة المنتج الأول
    expect((screen.getByRole('checkbox', { name: 'Wedding' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'Birthday' }) as HTMLInputElement).checked).toBe(false);
  });
});
