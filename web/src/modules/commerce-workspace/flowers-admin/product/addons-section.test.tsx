// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: (...args: unknown[]) => apiMock(...args),
}));

import { ApiError } from '@/lib/api';
import { ToastProvider } from '@/components/ui/toast';
import { renderIntl } from '@/test-utils/intl';
import { AddonsSection } from './addons-section';

afterEach(() => {
  cleanup();
  apiMock.mockReset();
});

type Row = Record<string, unknown>;
const addon = (id: string, over: Row = {}): Row => ({ addon_product_id: id, addon_variant_id: null, name: `منتج ${id}`, name_en: null, sku: `SKU-${id}`, product_is_active: true, max_quantity: 1, is_active: true, ...over });
const catalog: Record<string, Row> = {
  c1: { id: 'c1', name: 'شوكولاتة بلجيكية', sku: 'CHOC', is_active: true, sale_price: '35.00', variant_state: 'simple' },
  v1: { id: 'v1', name: 'بالون', sku: 'BAL', is_active: true, sale_price: '12.00', variant_state: 'variant_managed' },
  off: { id: 'off', name: 'منتج موقوف', sku: 'OFF', is_active: false, sale_price: '5.00', variant_state: 'simple' },
};

function server(initial: Row[], opts: { rejectSave?: ApiError; canManage?: boolean; noRevision?: boolean; revisionFromSecondRead?: boolean } = {}) {
  let current = initial;
  let addonReads = 0;
  let readFails = false;
  const writes: { addons: Row[]; expected_revision?: string }[] = [];
  const revisionOf = (rows: Row[]) => JSON.stringify(rows);
  apiMock.mockImplementation(async (path: string, options?: { method?: string; body?: { addons: Row[]; expected_revision?: string } }) => {
    if (path.includes('/products/publication')) {
      return { data: Object.values(catalog).map((p) => ({ id: p.id, sku: p.sku, name: p.name, name_en: null, is_active: p.is_active, is_published: true, stores: [] })), meta: { current_page: 1, last_page: 1, per_page: 10, total: 3 } };
    }
    if (path.endsWith('/variants')) return { data: [{ id: 'var-a', display_name: 'أحمر', sku: 'BAL-R', is_active: true }, { id: 'var-b', display_name: 'ذهبي', sku: 'BAL-G', is_active: true }] };
    if (path.includes('/commerce/workspace/products/p1/addons')) {
      if (options?.method === 'PUT') {
        if (opts.rejectSave) throw opts.rejectSave;
        if (options.body!.expected_revision !== undefined && options.body!.expected_revision !== revisionOf(current)) throw new ApiError(409, 'stale', {});
        writes.push(options.body!);
        current = options.body!.addons.map((a) => ({ name: `منتج ${a.addon_product_id}`, name_en: null, sku: null, product_is_active: true, ...a }));
      } else if (readFails) {
        throw new ApiError(500, 'boom', {});
      }
      addonReads += 1;
      const hidden = opts.noRevision || (opts.revisionFromSecondRead && addonReads === 1);

      return { data: { addons: current, ...(hidden ? {} : { revision: revisionOf(current) }) } };
    }
    const match = path.match(/^\/products\/([^/]+)$/);
    if (match && catalog[match[1]]) return { data: catalog[match[1]] };
    throw new ApiError(404, 'x', {});
  });
  renderIntl(
    <ToastProvider>
      <AddonsSection productId="p1" locale="en" canManage={opts.canManage ?? true} />
    </ToastProvider>,
    'en',
  );

  return { writes, setRemote: (next: Row[]) => { current = next; }, failRead: () => { readFails = true; } };
}

async function searchAndPick(query: string, productName: string) {
  await userEvent.click((await screen.findAllByRole('button', { name: 'Add an add-on' }))[0]);
  fireEvent.change(await screen.findByPlaceholderText(/Search products|Search/i), { target: { value: query } });
  const row = (await screen.findByText(productName)).closest('li') as HTMLElement;
  await userEvent.click(within(row).getByRole('button', { name: 'Choose' }));
}

describe('AddonsSection', () => {
  it('lists add-ons with read-only price context, quantity, state, and flags an inactive product', async () => {
    server([addon('c1', { max_quantity: 3 }), addon('off', { product_is_active: false })]);
    const list = (await screen.findByText('منتج c1')).closest('ul') as HTMLElement;
    await waitFor(() => expect(list.textContent).toContain('35.00'));
    expect((screen.getByLabelText('Max qty', { selector: '#addon-qty-0' }) as HTMLSelectElement).value).toBe('3');
    expect(list.textContent).toContain('product is inactive');
  });

  it('searches the tenant catalogue, shows the read-only price, adds a simple product and saves ids only', async () => {
    const srv = server([]);
    await searchAndPick('choc', 'شوكولاتة بلجيكية');
    await waitFor(() => expect(document.querySelector('[data-addon-candidate]')).toBeTruthy());
    expect(document.querySelector('[data-addon-candidate]')?.textContent).toContain('35.00');
    await userEvent.click(screen.getByRole('button', { name: 'Add to list' }));
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    expect(srv.writes).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(srv.writes).toHaveLength(1));
    expect(srv.writes[0].addons).toEqual([{ addon_product_id: 'c1', addon_variant_id: null, max_quantity: 1, is_active: true }]);
    expect(await screen.findByText('All changes saved')).toBeTruthy();
  });

  it('requires a variant for a variant-managed product before it can be added', async () => {
    const srv = server([]);
    await searchAndPick('bal', 'بالون');
    const confirm = await screen.findByRole('button', { name: 'Add to list' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await userEvent.selectOptions(screen.getByLabelText('Variant'), 'var-b');
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(confirm);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(srv.writes).toHaveLength(1));
    expect(srv.writes[0].addons[0]).toMatchObject({ addon_product_id: 'v1', addon_variant_id: 'var-b' });
  });

  it('refuses an inactive product and a duplicate, and never lists the parent itself', async () => {
    server([addon('c1')]);
    await searchAndPick('x', 'منتج موقوف');
    expect(await screen.findByText('This product is inactive and cannot be added.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Add to list' }) as HTMLButtonElement).disabled).toBe(true);
    // المنتج المضاف أصلاً مُستبعَد من نتائج المنتقي.
    expect(screen.queryByText('شوكولاتة بلجيكية')).toBeNull();
  });

  it('edits quantity/active/order/removal locally and saves the full list; discard restores', async () => {
    const srv = server([addon('a'), addon('b')]);
    await screen.findByText('منتج a');
    await userEvent.selectOptions(document.querySelector('#addon-qty-0') as HTMLSelectElement, '5');
    await userEvent.click(screen.getByRole('switch', { name: 'منتج b: active' }));
    await userEvent.click(screen.getByRole('button', { name: 'Move up: منتج b' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(srv.writes).toHaveLength(1));
    expect(srv.writes[0].addons).toEqual([
      { addon_product_id: 'b', addon_variant_id: null, max_quantity: 1, is_active: false },
      { addon_product_id: 'a', addon_variant_id: null, max_quantity: 5, is_active: true },
    ]);

    await userEvent.click(screen.getByRole('button', { name: 'Remove: منتج b' }));
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByText('منتج b')).toBeTruthy();
  });

  it('blocks saving while an add-on targets an inactive product, and surfaces server rejections', async () => {
    server([addon('off', { product_is_active: false })]);
    await screen.findByText('منتج off');
    await userEvent.selectOptions(document.querySelector('#addon-qty-0') as HTMLSelectElement, '2');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Remove add-ons whose product is inactive before saving.')).toBeTruthy();

    cleanup();
    apiMock.mockReset();
    server([addon('a')], { rejectSave: new ApiError(422, 'لا يمكن ربط المنتج بنفسه كإضافة.', {}) });
    await screen.findByText('منتج a');
    await userEvent.click(screen.getByRole('switch', { name: 'منتج a: active' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('لا يمكن ربط المنتج بنفسه كإضافة.')).toBeTruthy();
  });

  it('never overwrites add-ons another admin changed', async () => {
    const srv = server([addon('a')]);
    await screen.findByText('منتج a');
    await userEvent.click(screen.getByRole('button', { name: 'Remove: منتج a' }));
    srv.setRemote([addon('a'), addon('z')]);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/changed on the server since you opened this page/)).toBeTruthy();
    expect(srv.writes).toHaveLength(0);
    expect(screen.getByText('منتج z')).toBeTruthy();
  });

  it('sends the revision it read so the server rejects a stale replacement under its lock', async () => {
    const srv = server([addon('a')]);
    await screen.findByText('منتج a');
    await userEvent.click(screen.getByRole('button', { name: 'Remove: منتج a' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(srv.writes).toHaveLength(1));
    expect(srv.writes[0].expected_revision).toBe(JSON.stringify([addon('a')]));
  });

  it('after a 409 whose refresh read fails it reports the failure and never writes with the stale revision', async () => {
    const srv = server([addon('a')]);
    await screen.findByText('منتج a');
    await userEvent.click(screen.getByRole('button', { name: 'Remove: منتج a' }));
    srv.setRemote([addon('a'), addon('z')]);
    srv.failRead();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());
    expect(srv.writes).toHaveLength(0);
  });

  it('without a server revision it falls back to the pre-read and never writes when that read fails', async () => {
    const srv = server([addon('a')], { noRevision: true });
    await screen.findByText('منتج a');
    await userEvent.click(screen.getByRole('button', { name: 'Remove: منتج a' }));
    srv.failRead();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());
    expect(srv.writes).toHaveLength(0);
  });

  it('carries the revision returned by the fallback pre-read into the PUT (rolling backend deploy)', async () => {
    const srv = server([addon('a')], { revisionFromSecondRead: true });
    await screen.findByText('منتج a');
    await userEvent.click(screen.getByRole('button', { name: 'Remove: منتج a' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(srv.writes).toHaveLength(1));
    expect(srv.writes[0].expected_revision).toBe(JSON.stringify([addon('a')]));
  });

  it('is read-only without products.manage', async () => {
    server([addon('a')], { canManage: false });
    await screen.findByText('منتج a');
    expect(screen.queryByRole('button', { name: 'Add an add-on' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect((screen.getByRole('switch', { name: 'منتج a: active' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/view-only access/)).toBeTruthy();
  });
});
