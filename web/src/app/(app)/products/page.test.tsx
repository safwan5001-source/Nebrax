// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProductsPage from './page';

const { api, translate, getSystemTaxInclusive, getShowStockQuantities } = vi.hoisted(() => {
  const strings: Record<string, string> = {
    title: 'Products',
    search: 'Search products',
    sku: 'SKU',
    barcode: 'Barcode',
    name: 'Name',
    type: 'Type',
    good: 'Good',
    service: 'Service',
    stock: 'Stock',
    status_label: 'Status',
    active: 'Active',
    inactive: 'Inactive',
    sale_price: 'Sale price',
    tax_incl_tag: 'incl. VAT',
    tax_excl_tag: 'excl. VAT',
    empty: 'No products',
    import: 'Import',
    add: 'Add product',
    view: 'View',
    edit: 'Edit',
    copy: 'Copy',
    delete: 'Delete',
    action_failed: 'Action failed',
    noResults: 'No results',
    exportCsv: 'Export CSV',
    retry: 'Try again',
  };
  // بديلٌ مبسّط لـ`t`: `rich` تُرجع القيم غير الدالّية فقط، فيكفي لاختبار سجلّ
  // الجوال دون محاكاة ICU كاملاً — الترجمة نفسها مُختبَرة في `nebrax/`.
  const translator = Object.assign((key: string) => strings[key] ?? key, {
    raw: () => ({}),
    rich: (key: string, values: Record<string, unknown> = {}) =>
      Object.values(values).filter((value) => typeof value !== 'function').join(' ') || (strings[key] ?? key),
  });
  return {
    api: vi.fn(),
    translate: translator,
    getSystemTaxInclusive: vi.fn(),
    getShowStockQuantities: vi.fn(),
  };
});

vi.mock('next-intl', () => ({ useTranslations: () => translate, useLocale: () => 'en' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('@/lib/tax', () => ({ getSystemTaxInclusive }));
vi.mock('@/lib/inventory', () => ({ getShowStockQuantities }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/components/products/product-dialog', () => ({ ProductDialog: () => null }));
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

const baseProduct = {
  id: 'p1', sku: 'SKU-1000', barcode: '6280000001001', name: 'Diesel oil filter', name_en: null,
  type: 'good', unit: 'pc', description: null, category: null, brand: null,
  category_id: 'c1', brand_id: null, unit_template_id: null, reorder_level: 5,
  min_sale_price: null, discount: null, discount_type: null, profit_margin: null,
  tags: null, internal_notes: null, sales_account_id: null, cogs_account_id: null,
  sale_price: '75.50', purchase_price: '50.00', tax_rate: 15,
  track_inventory: true, quantity_on_hand: 21, avg_cost: '48.00', is_active: true,
};

function respondWith(products: unknown[]) {
  api.mockImplementation((path: string) => {
    if (path === '/product-categories') {
      return Promise.resolve({ data: [{ id: 'c1', name: 'Spare parts', parent_id: null, is_active: true }] });
    }
    return Promise.resolve({ data: products });
  });
}

/** سجلّ الجوال هو قائمة `DataTable` المقابلة للجدول — أول `ul` في الصفحة. */
async function firstMobileRecord() {
  const list = await screen.findByRole('list');
  return within(list).getAllByRole('listitem')[0];
}

describe('ProductsPage mobile record identifiers', () => {
  afterEach(cleanup);

  beforeEach(() => {
    api.mockReset();
    getSystemTaxInclusive.mockResolvedValue(false);
    getShowStockQuantities.mockResolvedValue(true);
  });

  it('shows the SKU and the barcode together, each with its own label', async () => {
    respondWith([baseProduct]);
    render(<ProductsPage />);

    const record = within(await firstMobileRecord());
    expect(record.getByText('SKU')).toBeTruthy();
    expect(record.getByText('SKU-1000')).toBeTruthy();
    expect(record.getByText('Barcode')).toBeTruthy();
    expect(record.getByText('6280000001001')).toBeTruthy();
  });

  it('renders both identifiers left-to-right so scanned codes stay readable in an RTL page', async () => {
    respondWith([baseProduct]);
    render(<ProductsPage />);

    const record = within(await firstMobileRecord());
    expect(record.getByText('SKU-1000').getAttribute('dir')).toBe('ltr');
    expect(record.getByText('6280000001001').getAttribute('dir')).toBe('ltr');
  });

  it('shows the barcode alone when the product has no SKU', async () => {
    respondWith([{ ...baseProduct, sku: null }]);
    render(<ProductsPage />);

    const record = within(await firstMobileRecord());
    expect(record.getByText('6280000001001')).toBeTruthy();
    expect(record.queryByText('SKU')).toBeNull();
  });

  it('shows the SKU alone when the product has no barcode', async () => {
    respondWith([{ ...baseProduct, barcode: null }]);
    render(<ProductsPage />);

    const record = within(await firstMobileRecord());
    expect(record.getByText('SKU-1000')).toBeTruthy();
    expect(record.queryByText('Barcode')).toBeNull();
  });

  it('keeps the record hierarchy: name, then category, then price', async () => {
    respondWith([baseProduct]);
    render(<ProductsPage />);

    const text = (await firstMobileRecord()).textContent ?? '';
    expect(text.indexOf('Diesel oil filter')).toBeLessThan(text.indexOf('Spare parts'));
    expect(text.indexOf('Spare parts')).toBeLessThan(text.indexOf('75.50'));
  });
});
