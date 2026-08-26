/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductDialog } from './product-dialog';
import { PartnerDialog } from '@/components/partners/partner-dialog';

const { api, translate } = vi.hoisted(() => {
  const strings: Record<string, string> = {
    quick_add: 'Quick new item', add: 'New partner',
    quick_add_hint: 'The minimum needed to finish the document.',
    name: 'Name', sku: 'SKU', sku_auto_placeholder: 'Generated automatically', barcode: 'Barcode',
    type: 'Type', good: 'Good', service: 'Service', unit: 'Unit',
    sale_price: 'Sale price', purchase_price: 'Purchase price', tax_rate: 'Tax rate',
    save: 'Save', cancel: 'Cancel',
    entity_type: 'Entity type', entity_type_customer: 'Customer entity', entity_type_supplier: 'Supplier entity',
    commercial: 'Commercial', individual: 'Individual',
    email: 'Email', phone: 'Phone', city: 'City',
    saveFailed: 'Could not save.', created: 'Created', updated: 'Updated',
    // حقول البيانات الأساسية — تُستعمل للتأكّد من **غيابها** عن الحوار السريع.
    category: 'Category', brand: 'Brand', supplier: 'Supplier',
    min_sale_price: 'Minimum sale price', track_inventory: 'Track inventory',
    product_media: 'Product images', vat_number: 'VAT number', code: 'Code',
    credit_limit: 'Credit limit', opening_balance: 'Opening balance',
    default_price_list: 'Default price list',
  };
  const translator = Object.assign(
    (key: string, values?: Record<string, unknown>) =>
      (strings[key] ?? key).replace(/\{(\w+)\}/g, (_, n) => String(values?.[n] ?? '')),
    { raw: () => ({}), rich: (key: string) => strings[key] ?? key }
  );
  return { api: vi.fn(), translate: translator };
});

vi.mock('next-intl', () => ({ useTranslations: () => translate, useLocale: () => 'en' }));
vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('@/components/ui/toast', () => {
  const fns = { success: vi.fn(), error: vi.fn() };
  return { useToast: () => fns };
});
vi.mock('@/lib/use-number-preview', () => ({
  useNumberPreview: () => ({ number: 'SKU-00042', loading: false }),
}));
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

/**
 * الحوار = إنشاءٌ سريع من داخل مستند. الصفحة الكاملة = البيانات الأساسية.
 * هذه الاختبارات تحرس الحدّ بين الاثنين في الاتجاهين.
 */
describe('quick-create dialogs', () => {
  afterEach(cleanup);
  beforeEach(() => { api.mockReset(); api.mockResolvedValue({ data: { id: 'new' } }); });

  it('keeps the product dialog to what a document line needs', async () => {
    render(<ProductDialog open onClose={() => {}} onSaved={() => {}} />);

    for (const label of ['Name', 'SKU', 'Barcode', 'Type', 'Unit', 'Sale price', 'Purchase price', 'Tax rate']) {
      expect(screen.getByLabelText(new RegExp(`^${label}`))).toBeTruthy();
    }
    for (const absent of ['Category', 'Brand', 'Supplier', 'Minimum sale price', 'Track inventory', 'Product images']) {
      expect(screen.queryByLabelText(absent)).toBeNull();
    }
  });

  it('creates the product through the unchanged endpoint and payload shape', async () => {
    render(<ProductDialog open onClose={() => {}} onSaved={() => {}} />);

    await userEvent.type(screen.getByLabelText(/^Name/), 'Desk lamp');
    await userEvent.type(screen.getByLabelText(/^Sale price/), '250');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const call = api.mock.calls.find(([path, init]) => path === '/products' && init?.method === 'POST');
      expect(call).toBeTruthy();
      const body = call![1].body as Record<string, unknown>;
      expect(body.name).toBe('Desk lamp');
      expect(body.sale_price).toBe(25000);
      expect(body.sku).toBeNull();
      expect(body.track_inventory).toBe(false);
      expect(body.is_active).toBe(true);
    });
  });

  it('shows the suggested product code as a placeholder, never as a value', () => {
    render(<ProductDialog open onClose={() => {}} onSaved={() => {}} />);

    const sku = screen.getByLabelText('SKU') as HTMLInputElement;
    expect(sku.value).toBe('');
    expect(sku.placeholder).toBe('SKU-00042');
  });

  it('keeps the partner dialog to what a document needs', () => {
    render(<PartnerDialog open onClose={() => {}} onSaved={() => {}} />);

    for (const label of ['Name', 'Email', 'Phone', 'City']) {
      expect(screen.getByLabelText(new RegExp(`^${label}`))).toBeTruthy();
    }
    for (const absent of ['VAT number', 'Code', 'Credit limit', 'Opening balance', 'Default price list']) {
      expect(screen.queryByLabelText(absent)).toBeNull();
    }
  });

  it('creates a supplier with the role the calling screen asked for', async () => {
    render(<PartnerDialog open defaultType="supplier" onClose={() => {}} onSaved={() => {}} />);

    await userEvent.type(screen.getByLabelText(/^Name/), 'Najd Supplies');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const call = api.mock.calls.find(([path, init]) => path === '/partners' && init?.method === 'POST');
      expect(call).toBeTruthy();
      expect((call![1].body as Record<string, unknown>).type).toBe('supplier');
    });
  });

  // كلا الحوارين ينشئ فقط: التعديل يخفي ثمانية عشر حقلاً ويوهم بأنها كلّ البيانات.
  it('never issues an update from either quick-create dialog', async () => {
    render(<PartnerDialog open onClose={() => {}} onSaved={() => {}} />);

    await userEvent.type(screen.getByLabelText(/^Name/), 'Al Waha');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(api.mock.calls.every(([, init]) => init?.method !== 'PUT')).toBe(true);
  });

  it('blocks saving an unnamed record in both dialogs', () => {
    const { unmount } = render(<ProductDialog open onClose={() => {}} onSaved={() => {}} />);
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    unmount();

    render(<PartnerDialog open onClose={() => {}} onSaved={() => {}} />);
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
