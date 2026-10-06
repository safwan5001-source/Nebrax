import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: (...args: unknown[]) => apiMock(...args),
}));

import {
  addonsPayload,
  addonsSignature,
  canAdd,
  loadAddons,
  loadCandidate,
  loadVariants,
  mapAddons,
  mapCandidate,
  mapVariants,
  addonVisibility,
  rowProblem,
  saveAddons,
  type AddonRow,
} from './addons';

afterEach(() => apiMock.mockReset());

const body = {
  data: {
    addons: [
      { addon_product_id: 'a', addon_variant_id: null, name: 'شوكولاتة', name_en: 'Chocolate', sku: 'CHOC', product_is_active: true, max_quantity: 3, is_active: true },
      { addon_product_id: 'b', addon_variant_id: 'v1', name: 'بالون', name_en: null, sku: null, product_is_active: false, max_quantity: 99, is_active: false },
    ],
  },
};
const rows = (): AddonRow[] => mapAddons(body)!;

describe('add-on storefront visibility hint', () => {
  const store = (id: string, isPublished: boolean) => ({ id, isPublished });

  it('is unpublished when the target is published nowhere, no_shared_store when the published stores are disjoint, ok otherwise', () => {
    expect(addonVisibility([store('s1', true)], [store('s1', false)])).toBe('unpublished');
    expect(addonVisibility([store('s1', true)], [])).toBe('unpublished');
    expect(addonVisibility([store('s1', true)], [store('s2', true)])).toBe('no_shared_store');
    expect(addonVisibility([store('s1', true), store('s2', true)], [store('s2', true)])).toBe('ok');
  });

  it('never warns without evidence: unknown target, or a parent that is not published anywhere itself', () => {
    expect(addonVisibility([store('s1', true)], null)).toBe('ok');
    expect(addonVisibility(null, [store('s2', true)])).toBe('ok');
    expect(addonVisibility([store('s1', false)], [store('s2', true)])).toBe('ok');
  });
});

describe('add-ons client', () => {
  it('maps rows, clamps quantity to 1–10 and flags inactive target products', () => {
    const [a, b] = rows();
    expect(a).toMatchObject({ addonProductId: 'a', addonVariantId: null, name: 'شوكولاتة', sku: 'CHOC', maxQuantity: 3, isActive: true, productIsActive: true });
    expect(b).toMatchObject({ addonVariantId: 'v1', maxQuantity: 10, isActive: false, productIsActive: false });
    expect(rowProblem(a)).toBeNull();
    expect(rowProblem(b)).toBe('inactive_product');
    expect(mapAddons({ data: {} })).toBeNull();
  });

  it('fails the load on a row it cannot read instead of dropping it (a whole-set save would delete it server-side)', () => {
    expect(mapAddons({ data: { addons: [{ addon_product_id: 'a', max_quantity: 1 }, { nope: true }] } })).toBeNull();
    expect(mapAddons({ data: { addons: [{ addon_product_id: 'a', max_quantity: 1 }] } })).toHaveLength(1);
  });

  it('sends only ids, variant, quantity and active — never a price or name', () => {
    const payload = addonsPayload(rows());
    expect(payload.addons[0]).toEqual({ addon_product_id: 'a', addon_variant_id: null, max_quantity: 3, is_active: true });
    for (const row of payload.addons) expect(Object.keys(row).sort()).toEqual(['addon_product_id', 'addon_variant_id', 'is_active', 'max_quantity']);
    expect(addonsSignature(rows())).toBe(addonsSignature(rows()));
  });

  it('prevents self-reference, duplicates and exceeding the limit', () => {
    const list = rows();
    expect(canAdd(list, 'parent', 'parent')).toBe('self');
    expect(canAdd(list, 'parent', 'a')).toBe('duplicate');
    expect(canAdd(list, 'parent', 'c')).toBeNull();
    const full = Array.from({ length: 8 }, (_, i) => ({ ...list[0], addonProductId: `p${i}` }));
    expect(canAdd(full, 'parent', 'zz')).toBe('limit');
  });

  it('reads context for a candidate: read-only price, active state and variant management', () => {
    expect(mapCandidate({ data: { id: 'a', name: 'x', sku: 'S', is_active: true, sale_price: '25.00', variant_state: 'simple' } })).toMatchObject({ price: '25.00', variantManaged: false, isActive: true });
    expect(mapCandidate({ data: { id: 'a', name: 'x', sale_price: 25, variant_state: 'variant_managed', is_active: false } })).toMatchObject({ price: '25', variantManaged: true, isActive: false });
    expect(mapCandidate({ data: {} })).toBeNull();
    expect(mapVariants({ data: [{ id: 'v', display_name: 'أحمر / كبير', sku: 'B-R-L', is_active: true }, { id: 'w', sku: 'B-2' }, {}] })).toEqual([
      { id: 'v', label: 'أحمر / كبير', sku: 'B-R-L', isActive: true },
      { id: 'w', label: 'B-2', sku: 'B-2', isActive: true },
    ]);
  });

  it('uses the product-scoped and core product paths', async () => {
    apiMock.mockResolvedValue(body);
    await loadAddons('p1');
    expect(apiMock).toHaveBeenLastCalledWith('/commerce/workspace/products/p1/addons');
    await saveAddons('p1', rows());
    expect(apiMock.mock.calls.at(-1)![1]).toMatchObject({ method: 'PUT' });
    apiMock.mockResolvedValue({ data: { id: 'a', name: 'x' } });
    await loadCandidate('a/b');
    expect(apiMock).toHaveBeenLastCalledWith('/products/a%2Fb');
    apiMock.mockResolvedValue({ data: [] });
    await loadVariants('a');
    expect(apiMock).toHaveBeenLastCalledWith('/products/a/variants');
  });
});
