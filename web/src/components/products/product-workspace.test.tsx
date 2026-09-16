// @vitest-environment jsdom
import * as React from 'react';
import type { ReactNode } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import { ProductWorkspace } from './product-workspace';
import type { Product } from './product-dialog';
import arMessages from '@/messages/ar.json';
import enMessages from '@/messages/en.json';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: (...args: unknown[]) => apiMock(...args),
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));

vi.mock('@/lib/tax', () => ({ getSystemTaxInclusive: () => Promise.resolve(false) }));
vi.mock('@/lib/use-number-preview', () => ({ useNumberPreview: () => ({ number: '' }) }));

vi.mock('lucide-react', () => {
  const iconStub = () => <span />;
  return new Proxy({ __esModule: true } as Record<string | symbol, unknown>, {
    get: (target, name) =>
      typeof name === 'symbol' || name === 'then' || name === '__esModule'
        ? Reflect.get(target, name)
        : iconStub,
    has: () => true,
  });
});

function wrapAr(children: ReactNode) {
  return (
    <NextIntlClientProvider locale="ar" messages={arMessages as unknown as Record<string, unknown>}>
      {children}
    </NextIntlClientProvider>
  );
}

function wrapEn(children: ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages as unknown as Record<string, unknown>}>
      {children}
    </NextIntlClientProvider>
  );
}

const CATEGORY: { id: string; name: string } = { id: 'cat-1', name: 'إلكترونيات' };
const BRAND: { id: string; name: string } = { id: 'brand-1', name: 'أكمي' };

const EXISTING_PRODUCT: Product = {
  id: 'product-1',
  sku: 'SKU-1',
  barcode: '111222333',
  name: 'منتج قائم',
  name_en: 'Existing product',
  type: 'good',
  unit: 'piece',
  description: null,
  category: null,
  brand: null,
  category_id: CATEGORY.id,
  brand_id: BRAND.id,
  unit_template_id: null,
  default_sales_unit: null,
  default_purchase_unit: null,
  reorder_level: null,
  min_sale_price: null,
  discount: null,
  discount_type: null,
  profit_margin: null,
  tags: null,
  internal_notes: null,
  sales_account_id: null,
  cogs_account_id: null,
  sale_price: '100.00',
  purchase_price: '60.00',
  tax_rate: 15,
  track_inventory: false,
  quantity_on_hand: 0,
  avg_cost: '0.00',
  is_active: true,
};

function installApiMock(overrides: Partial<Record<string, unknown>> = {}) {
  apiMock.mockImplementation(async (path: string, options: { method?: string; body?: unknown } = {}) => {
    const method = options.method ?? 'GET';
    if (path === '/unit-templates') return { data: [] };
    if (path === '/product-categories') return { data: [CATEGORY] };
    if (path === '/brands') return { data: [BRAND] };
    if (path === '/accounts') return { data: [] };
    if (path === '/partners') return { data: [] };
    if (overrides[`${method} ${path}`]) {
      const handler = overrides[`${method} ${path}`] as (options: { body?: unknown }) => unknown;
      return handler(options);
    }
    if (path === '/products' && method === 'POST') {
      return { data: { id: 'created-product-1' } };
    }
    if (path.startsWith('/products/') && method === 'PUT') {
      return { data: {} };
    }
    return { data: [] };
  });
}

describe('ProductWorkspace', () => {
  beforeEach(() => {
    apiMock.mockReset();
    installApiMock();
  });
  afterEach(cleanup);

  it('renders create mode with an empty form and the "Save" action', async () => {
    render(wrapAr(<ProductWorkspace mode="create" />));

    const name = await screen.findByLabelText(/الاسم \*/) as HTMLInputElement;
    expect(name.value).toBe('');
    expect(screen.getByRole('button', { name: 'حفظ' })).toBeTruthy();
  });

  it('renders edit mode pre-filled with the existing product values', async () => {
    render(wrapAr(<ProductWorkspace mode="edit" product={EXISTING_PRODUCT} />));

    expect(await screen.findByDisplayValue('منتج قائم')).toBeTruthy();
    expect(screen.getByDisplayValue('Existing product')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'حفظ التغييرات' })).toBeTruthy();
  });

  it('category and brand selectors submit authoritative FK ids, never free text', async () => {
    const user = userEvent.setup();
    const puts: Array<Record<string, unknown>> = [];
    installApiMock({
      'PUT /products/product-1': ({ body }: { body?: unknown }) => {
        puts.push(body as Record<string, unknown>);
        return { data: {} };
      },
    });
    render(wrapAr(<ProductWorkspace mode="edit" product={EXISTING_PRODUCT} />));

    await screen.findByDisplayValue('منتج قائم');
    await user.click(screen.getByRole('button', { name: 'حفظ التغييرات' }));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]!.category_id).toBe(CATEGORY.id);
    expect(puts[0]!.brand_id).toBe(BRAND.id);
    expect(puts[0]!.category).toBeUndefined();
    expect(puts[0]!.brand).toBeUndefined();
  });

  it('first Save sends exactly one POST /products and captures the returned product_id', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    render(wrapAr(<ProductWorkspace mode="create" onCreated={onCreated} />));

    await user.type(screen.getByLabelText(/الاسم \*/), 'منتج جديد');
    await user.type(screen.getByLabelText('سعر البيع'), '10');
    await user.click(screen.getByRole('button', { name: 'حفظ' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('created-product-1'));
    expect(apiMock.mock.calls.filter(([path, options]) => path === '/products' && options?.method === 'POST')).toHaveLength(1);
  });

  it('remains mounted after the first Save and switches to the persisted/update contract', async () => {
    const user = userEvent.setup();
    render(wrapAr(<ProductWorkspace mode="create" />));

    await user.type(screen.getByLabelText(/الاسم \*/), 'منتج جديد');
    await user.type(screen.getByLabelText('سعر البيع'), '10');
    await user.click(screen.getByRole('button', { name: 'حفظ' }));

    // لا تنقّل، لا إغلاق: الحقل نفسه يبقى في الشجرة، والزر يتحوّل إلى «حفظ التغييرات».
    await waitFor(() => expect(screen.getByRole('button', { name: 'حفظ التغييرات' })).toBeTruthy());
    expect((screen.getByLabelText(/الاسم \*/) as HTMLInputElement).value).toBe('منتج جديد');

    await user.click(screen.getByRole('button', { name: 'حفظ التغييرات' }));

    await waitFor(() => {
      const puts = apiMock.mock.calls.filter(([path, options]) => path === '/products/created-product-1' && options?.method === 'PUT');
      expect(puts).toHaveLength(1);
    });
    expect(apiMock.mock.calls.filter(([path, options]) => path === '/products' && options?.method === 'POST')).toHaveLength(1);
  });

  it('a failed first Save does not unlock the persisted state, and retry still POSTs', async () => {
    const user = userEvent.setup();
    let attempt = 0;
    installApiMock({
      'POST /products': () => {
        attempt += 1;
        if (attempt === 1) throw new Error('rejected');
        return { data: { id: 'created-product-2' } };
      },
    });
    const onCreated = vi.fn();
    render(wrapAr(<ProductWorkspace mode="create" onCreated={onCreated} />));

    await user.type(screen.getByLabelText(/الاسم \*/), 'منتج جديد');
    await user.type(screen.getByLabelText('سعر البيع'), '10');
    await user.click(screen.getByRole('button', { name: 'حفظ' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(onCreated).not.toHaveBeenCalled();
    // الزر يبقى «حفظ» — لا انتقال إلى حالة محفوظة زائفة.
    expect(screen.getByRole('button', { name: 'حفظ' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'حفظ' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('created-product-2'));
    expect(apiMock.mock.calls.filter(([path, options]) => path === '/products' && options?.method === 'POST')).toHaveLength(2);
  });

  it('renders Arabic labels by default (RTL)', async () => {
    render(wrapAr(<ProductWorkspace mode="create" />));
    expect(await screen.findByText('التصنيف')).toBeTruthy();
    expect(screen.getByText('الماركة')).toBeTruthy();
  });

  it('renders English labels and keeps code/number fields LTR', async () => {
    render(wrapEn(<ProductWorkspace mode="create" />));
    expect(await screen.findByText('Category')).toBeTruthy();
    expect(screen.getByText('Brand')).toBeTruthy();
    expect(screen.getByLabelText('SKU').getAttribute('dir')).toBe('ltr');
    expect(screen.getByLabelText('Barcode').getAttribute('dir')).toBe('ltr');
  });
});
