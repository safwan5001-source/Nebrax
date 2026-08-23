import { afterEach, describe, expect, it } from 'vitest';
import { mockApi } from '@/lib/mock-data';
import {
  readDemoMediaFile,
  resetDemoProductStoreForTests,
} from '@/lib/demo-product-store';

describe('demo product image persistence', () => {
  afterEach(() => resetDemoProductStoreForTests());

  it('saves the product and its image for product details and POS', async () => {
    const created = await mockApi<{ data: { id: string; name: string } }>('/products', 'POST', {
      name: 'منتج تجريبي بصورة',
      sku: 'DEMO-IMAGE-001',
      type: 'good',
      unit: 'piece',
      sale_price: 1250,
      purchase_price: 800,
      tax_rate: 15,
      is_active: true,
    });
    const body = new FormData();
    body.append('media[]', new Blob(['fake-png'], { type: 'image/png' }), 'front.png');

    const uploaded = await mockApi<{ data: Array<{ id: string; download_url: string }> }>(
      `/products/${created.data.id}/media`,
      'POST',
      body,
    );

    const products = await mockApi<{ data: Array<{ id: string; name: string }> }>('/products');
    const detail = await mockApi<{ data: { units: Array<{ name: string; factor: number }> } }>(`/products/${created.data.id}`);
    const media = await mockApi<{ data: Array<{ id: string; download_url: string }> }>(`/products/${created.data.id}/media`);
    const pos = await mockApi<{ data: Array<{ id: string; pos_image: { download_url: string } | null }> }>('/pos/products');
    const savedFile = await readDemoMediaFile(uploaded.data[0].download_url);

    expect(products.data).toContainEqual(expect.objectContaining({ id: created.data.id, name: 'منتج تجريبي بصورة' }));
    expect(detail.data.units).toEqual([{ name: 'piece', factor: 1 }]);
    expect(media.data).toHaveLength(1);
    expect(pos.data.find((item) => item.id === created.data.id)?.pos_image?.download_url)
      .toBe(uploaded.data[0].download_url);
    expect(await savedFile?.text()).toBe('fake-png');
  });

  it('deletes an uploaded demo product image', async () => {
    const created = await mockApi<{ data: { id: string } }>('/products', 'POST', { name: 'منتج للحذف' });
    const body = new FormData();
    body.append('media[]', new Blob(['image'], { type: 'image/webp' }), 'delete.webp');
    const uploaded = await mockApi<{ data: Array<{ id: string }> }>(`/products/${created.data.id}/media`, 'POST', body);

    await mockApi(`/products/${created.data.id}/media/${uploaded.data[0].id}`, 'DELETE');

    const media = await mockApi<{ data: unknown[] }>(`/products/${created.data.id}/media`);
    expect(media.data).toEqual([]);
  });
});
