/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NewProductPage from '@/app/(app)/products/new/page';
import EditProductPage from '@/app/(app)/products/[id]/edit/page';

const { api, push, translate, params } = vi.hoisted(() => {
  const strings: Record<string, string> = {
    new_title: 'New product', edit_title: 'Edit product', back: 'Back',
    save: 'Save', cancel: 'Cancel', loading_profile: 'Loading product…',
    load_profile_failed: 'Could not load the product.',
    section_identity: 'Item identity', section_sales: 'Sales', section_purchases: 'Purchases',
    section_inventory: 'Inventory', section_more: 'Additional data',
    name: 'Name', name_en: 'English name', type: 'Type', good: 'Good', service: 'Service',
    sku: 'SKU', sku_auto_placeholder: 'Generated automatically',
    sku_auto_hint: 'Leave blank and the server assigns the next code.',
    barcode: 'Barcode', category: 'Category', brand: 'Brand', unclassified: 'Unclassified',
    active: 'Active', active_hint: 'Inactive items are hidden from invoices.',
    sale_price: 'Sale price', purchase_price: 'Purchase price', tax_rate: 'Tax rate',
    min_sale_price: 'Minimum sale price', min_sale_price_hint: 'Lowest accepted price.',
    profit_margin: 'Profit margin', discount: 'Discount', discount_type: 'Discount unit',
    sales_account: 'Sales account', cogs_account: 'Cost account', default_account: 'Default account',
    supplier: 'Supplier', no_supplier: 'No supplier',
    track_inventory: 'Track inventory', track_inventory_hint: 'Balance follows stock movements.',
    unit_template: 'Unit template', no_unit_template: 'No template', unit_template_hint: 'Sets the base unit.',
    unit: 'Unit', template_units_readonly: 'Template units: {units}',
    initial_quantity: 'Opening quantity', initial_quantity_hint: 'Posts an opening entry.',
    initial_quantity_locked: 'Opening stock is set at creation.',
    reorder_level: 'Reorder level',
    description: 'Description', tags: 'Tags', tags_hint: 'Comma separated',
    internal_notes: 'Internal notes',
    product_media: 'Product images', product_media_hint: 'Up to 8 images.',
    upload_media: 'Upload images', no_media: 'No images yet', delete: 'Delete',
    selected_media_count: '{count} of {max}',
    media_limit_reached: 'Too many images.', media_invalid_file: 'Unsupported file.',
    media_upload_failed_after_create: 'The product was created but images failed.',
    price_hint_excl: 'With VAT: {amount}', price_hint_incl: 'Without VAT: {amount}',
    saveFailed: 'Could not save.', created: 'Created', updated: 'Updated',
    loading: 'Loading', retry: 'Try again',
  };
  const translator = Object.assign(
    (key: string, values?: Record<string, unknown>) =>
      (strings[key] ?? key).replace(/\{(\w+)\}/g, (_, n) => String(values?.[n] ?? '')),
    { raw: () => ({}), rich: (key: string) => strings[key] ?? key }
  );
  return { api: vi.fn(), push: vi.fn(), translate: translator, params: { current: { id: 'pr9' } } };
});

vi.mock('next-intl', () => ({ useTranslations: () => translate, useLocale: () => 'en' }));
// موجّهٌ ثابت: كائنٌ جديد كل عرض يجعل `useEffect` المعتمد عليه يعيد الجلب بلا نهاية.
const router = { push };
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useParams: () => params.current,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/lib/api', () => ({
  api,
  ApiError: class ApiError extends Error {},
  fetchImageUrl: () => Promise.resolve(null),
}));
vi.mock('@/components/ui/toast', () => {
  const fns = { success: vi.fn(), error: vi.fn() };
  return { useToast: () => fns };
});
vi.mock('@/lib/use-number-preview', () => ({
  useNumberPreview: () => ({ number: 'SKU-00042', loading: false }),
}));
vi.mock('@/lib/tax', () => ({ getSystemTaxInclusive: () => Promise.resolve(false) }));
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

const categories = [{ id: 'pc-1', name: 'Stationery' }, { id: 'pc-2', name: 'Furniture' }];
const brands = [{ id: 'br-1', name: 'Jazira' }];
const templates = [
  { id: 'ut-1', name: 'Carton / pack', base_unit: 'carton', units: [{ id: 'u1', name: 'pack', factor: 12 }] },
];
const suppliers = [{ id: 'p7', name: 'Jazira Supplies', type: 'supplier' }];
const accounts = [
  { id: 'a1', code: '4110', name: 'Sales revenue', type: 'revenue', is_group: false },
  { id: 'a2', code: '5110', name: 'Cost of goods', type: 'expense', is_group: false },
];

const storedProduct = {
  id: 'pr9', name: 'Tissue carton', name_en: 'Tissue carton', sku: 'SKU-009', barcode: '2000000000090',
  type: 'good', unit: 'carton', unit_template_id: 'ut-1',
  category: 'Stationery', brand: 'Jazira', category_id: 'pc-1', brand_id: 'br-1',
  sale_price: '120.00', purchase_price: '78.00', tax_rate: 15,
  min_sale_price: '100.00', profit_margin: 20, discount: 5, discount_type: 'percent',
  supplier_id: 'p7', sales_account_id: 'a1', cogs_account_id: 'a2',
  track_inventory: true, reorder_level: 40, quantity_on_hand: 320, avg_cost: '76.00',
  description: 'Premium tissue.', tags: 'tissue', internal_notes: 'Reorder monthly.',
  is_active: true, units: [{ name: 'carton', factor: 1 }, { name: 'pack', factor: 12 }],
};

/** مراجع الكتالوج تُجلب في كل عرض للنموذج؛ الجداول تُحسم بالمسار لا بالترتيب. */
function respond(overrides: Record<string, unknown> = {}) {
  api.mockImplementation((path: string) => {
    if (path === '/product-categories') return Promise.resolve({ data: categories });
    if (path === '/brands') return Promise.resolve({ data: brands });
    if (path === '/unit-templates') return Promise.resolve({ data: templates });
    if (path === '/partners?type=supplier') return Promise.resolve({ data: suppliers });
    if (path === '/accounts') return Promise.resolve({ data: accounts });
    if (path.endsWith('/media')) return Promise.resolve({ data: [] });
    if (path === '/products/pr9') return Promise.resolve({ data: storedProduct });
    if (path in overrides) return (overrides[path] as () => Promise<unknown>)();
    return Promise.resolve({ data: { id: 'new-product' } });
  });
}

async function renderCreate() {
  respond();
  render(<NewProductPage />);
  await screen.findByLabelText(/Name/);
}

describe('product master-data form', () => {
  afterEach(cleanup);
  beforeEach(() => {
    api.mockReset();
    push.mockReset();
    params.current = { id: 'pr9' };
  });

  it('renders the create form as the approved form pattern: sections, one save, no header CTA', async () => {
    await renderCreate();

    expect(screen.getByRole('heading', { name: 'New product' })).toBeTruthy();
    for (const section of ['Item identity', 'Sales', 'Purchases', 'Inventory', 'Additional data']) {
      expect(screen.getByText(section)).toBeTruthy();
    }
    expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(1);
  });

  it('labels every identifier and keeps SKU and barcode left-to-right', async () => {
    await renderCreate();

    const sku = screen.getByLabelText('SKU') as HTMLInputElement;
    const barcode = screen.getByLabelText('Barcode') as HTMLInputElement;
    expect(sku.getAttribute('dir')).toBe('ltr');
    expect(barcode.getAttribute('dir')).toBe('ltr');
    expect(sku.className).toContain('num');
    expect(barcode.className).toContain('num');
  });

  // الرقم المقترح **معاينة غير محجوزة**: عرضُه كقيمة كان يعِد برقمٍ قد يخصّص
  // الخادم غيره، ويمنع تركَ الحقل فارغاً وهو يبدو ممتلئاً.
  it('shows the generated SKU as a hint, never as a value that would be sent', async () => {
    await renderCreate();

    const sku = screen.getByLabelText('SKU') as HTMLInputElement;
    expect(sku.value).toBe('');
    expect(sku.placeholder).toBe('SKU-00042');
    expect(screen.getByText('Leave blank and the server assigns the next code.')).toBeTruthy();
  });

  it('offers managed categories and brands, not free text', async () => {
    await renderCreate();

    const category = await screen.findByLabelText('Category');
    expect(category.tagName).toBe('SELECT');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Stationery' })).toBeTruthy());
    expect(screen.getByRole('option', { name: 'Jazira' })).toBeTruthy();
  });

  it('keeps save disabled until the required name is present', async () => {
    await renderCreate();

    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText(/^Name/), 'Desk lamp');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('sends category and brand as managed ids so the product is filterable in the list', async () => {
    await renderCreate();

    await userEvent.type(screen.getByLabelText(/^Name/), 'Desk lamp');
    await userEvent.type(screen.getByLabelText(/Sale price/), '250');
    await userEvent.selectOptions(await screen.findByLabelText('Category'), ['pc-2']);
    await userEvent.selectOptions(screen.getByLabelText('Brand'), ['br-1']);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const call = api.mock.calls.find(([path, init]) => path === '/products' && init?.method === 'POST');
      expect(call).toBeTruthy();
      const body = call![1].body as Record<string, unknown>;
      expect(body.category_id).toBe('pc-2');
      expect(body.brand_id).toBe('br-1');
      expect(body).not.toHaveProperty('category');
      expect(body).not.toHaveProperty('brand');
    });
  });

  it('converts prices to minor units and leaves an empty SKU as null', async () => {
    await renderCreate();

    await userEvent.type(screen.getByLabelText(/^Name/), 'Desk lamp');
    await userEvent.type(screen.getByLabelText(/Sale price/), '250.75');
    await userEvent.type(screen.getByLabelText('Purchase price'), '180');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const call = api.mock.calls.find(([path, init]) => path === '/products' && init?.method === 'POST');
      const body = call![1].body as Record<string, unknown>;
      expect(body.sale_price).toBe(25075);
      expect(body.purchase_price).toBe(18000);
      expect(body.sku).toBeNull();
      expect(body.tax_rate).toBe(15);
    });
  });

  // `initial_quantity` فعلٌ يولّد قيداً مرحّلاً، ولا يظهر إلا لصنفٍ متتبَّع.
  it('reveals opening quantity and reorder level only when inventory is tracked', async () => {
    await renderCreate();

    expect(screen.queryByLabelText('Opening quantity')).toBeNull();
    await userEvent.click(screen.getByRole('switch', { name: 'Track inventory' }));
    expect(screen.getByLabelText('Opening quantity')).toBeTruthy();
    expect(screen.getByLabelText('Reorder level')).toBeTruthy();
  });

  it('sends the opening quantity on create', async () => {
    await renderCreate();

    await userEvent.type(screen.getByLabelText(/^Name/), 'Desk lamp');
    await userEvent.type(screen.getByLabelText(/Sale price/), '250');
    await userEvent.click(screen.getByRole('switch', { name: 'Track inventory' }));
    await userEvent.type(screen.getByLabelText('Opening quantity'), '12');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const call = api.mock.calls.find(([path, init]) => path === '/products' && init?.method === 'POST');
      const body = call![1].body as Record<string, unknown>;
      expect(body.track_inventory).toBe(true);
      expect(body.initial_quantity).toBe(12);
    });
  });

  it('inherits the base unit from the chosen template and shows its alternates read-only', async () => {
    await renderCreate();

    await userEvent.selectOptions(await screen.findByLabelText('Unit template'), ['ut-1']);
    expect((screen.getByLabelText('Unit') as HTMLInputElement).value).toBe('carton');
    expect((screen.getByLabelText('Unit') as HTMLInputElement).readOnly).toBe(true);
    expect(screen.getByText('Template units: pack ×12')).toBeTruthy();
  });

  it('uses the central riyal symbol for the discount unit, never the retired glyph', async () => {
    await renderCreate();

    const discountUnit = screen.getByLabelText('Discount unit');
    expect(discountUnit.textContent).toContain('⃁');
    expect(discountUnit.textContent).not.toContain('﷼');
    expect(discountUnit.textContent).not.toContain('SAR');
  });

  it('exposes the image control behind a real labelled button', async () => {
    await renderCreate();

    expect(screen.getByRole('button', { name: 'Upload images' })).toBeTruthy();
    expect(screen.getByText('No images yet')).toBeTruthy();
    expect(screen.getByLabelText('Upload images')).toBeTruthy();
  });

  it('surfaces a save failure at the top of the form, not below every section', async () => {
    respond();
    api.mockImplementation((path: string, init?: { method?: string }) => {
      if (path === '/product-categories') return Promise.resolve({ data: categories });
      if (path === '/brands') return Promise.resolve({ data: brands });
      if (path === '/unit-templates') return Promise.resolve({ data: templates });
      if (path === '/partners?type=supplier') return Promise.resolve({ data: suppliers });
      if (path === '/accounts') return Promise.resolve({ data: accounts });
      if (path === '/products' && init?.method === 'POST') return Promise.reject(new Error('boom'));
      return Promise.resolve({ data: [] });
    });
    render(<NewProductPage />);
    await screen.findByLabelText(/^Name/);

    await userEvent.type(screen.getByLabelText(/^Name/), 'Desk lamp');
    await userEvent.type(screen.getByLabelText(/Sale price/), '250');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it('prefills every stored field on edit', async () => {
    respond();
    render(<EditProductPage />);

    await waitFor(() => expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe('Tissue carton'));
    expect((screen.getByLabelText('SKU') as HTMLInputElement).value).toBe('SKU-009');
    expect((screen.getByLabelText(/Sale price/) as HTMLInputElement).value).toBe('120.00');
    expect((screen.getByLabelText('Minimum sale price') as HTMLInputElement).value).toBe('100.00');
    expect((screen.getByLabelText('Reorder level') as HTMLInputElement).value).toBe('40');
    expect((screen.getByRole('switch', { name: 'Track inventory' }) as HTMLElement).getAttribute('aria-checked')).toBe('true');
  });

  // `UpdateProductRequest` يرفضها بـ`prohibited`؛ إظهارها كان يوهم بتعديلٍ لا يحدث.
  it('never offers opening quantity on edit, and explains why', async () => {
    respond();
    render(<EditProductPage />);

    await waitFor(() => expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe('Tissue carton'));
    expect(screen.queryByLabelText('Opening quantity')).toBeNull();
    expect(screen.getByText('Opening stock is set at creation.')).toBeTruthy();
  });

  it('saves the edit with PUT and without the prohibited opening quantity', async () => {
    respond();
    render(<EditProductPage />);

    await waitFor(() => expect((screen.getByLabelText(/^Name/) as HTMLInputElement).value).toBe('Tissue carton'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const call = api.mock.calls.find(([path, init]) => path === '/products/pr9' && init?.method === 'PUT');
      expect(call).toBeTruthy();
      const body = call![1].body as Record<string, unknown>;
      expect(body).not.toHaveProperty('initial_quantity');
      expect(body.name).toBe('Tissue carton');
      expect(body.sale_price).toBe(12000);
      expect(body.min_sale_price).toBe(10000);
      expect(body.supplier_id).toBe('p7');
    });
  });

  it('shows an error state with a retry when the product cannot be loaded', async () => {
    api.mockImplementation((path: string) => {
      if (path === '/products/pr9') return Promise.reject(new Error('nope'));
      return Promise.resolve({ data: [] });
    });
    render(<EditProductPage />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
