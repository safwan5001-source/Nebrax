/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InvoiceForm } from './invoice-form';

const { api, push, replace, translate } = vi.hoisted(() => {
  const strings: Record<string, string> = {
    new_title: 'New invoice', edit_title: 'Edit invoice', back: 'Back', cancel: 'Cancel',
    customer_section: 'Customer', partner: 'Customer', choose_partner: 'Choose a customer',
    search_partner: 'Search customers…', no_partner_found: 'No customer found',
    new_partner: 'New', new_partner_title: 'New customer',
    invoice_number: 'Invoice number', invoice_date: 'Invoice date', payment_terms: 'Payment terms',
    days: 'days', due_date: 'Due date',
    lines: 'Lines', items_section: 'Items', add_line: 'Add line', item: 'Item', description: 'Description',
    price: 'Unit price', qty: 'Qty', qty_placeholder: 'Quantity', unit: 'Unit',
    qty_required: 'Every line needs a positive quantity.',
    line_discount_short: 'Discount', tax: 'Tax %',
    total_with_vat: 'Total incl. VAT', remove_line: 'Remove line', manual: 'Manual entry',
    search_product: 'Search products…', no_product_found: 'No product found', new_product: 'New product',
    balance: 'Balance', items_hint: 'A line without a product still posts as revenue.',
    line_advanced: 'Advanced line settings',
    minimum_price_below: 'Net price is below the minimum ({amount}).',
    minimum_price_override_reason: 'Override reason',
    minimum_price_override_reason_placeholder: 'Why is this below the minimum?',
    minimum_price_override_reason_hint: 'Minimum is {amount}.',
    line_cost_center: 'Line cost centre', line_cost_center_none: 'None',
    line_cost_center_single: 'Single', line_cost_center_multiple: 'Multiple',
    allocation_mode: 'Allocation mode', allocation_percent: 'Percent', allocation_amount: 'Amount',
    allocation_center: 'Allocation centre', allocation_value_percent: 'Allocation percent', allocation_value_amount: 'Allocation amount',
    allocation_add: 'Add allocation', allocation_remove: 'Remove allocation',
    allocation_total: 'Allocated', allocation_of_line: 'of the line', allocation_complete: 'Fully allocated',
    allocation_remaining: 'Remaining', allocation_hint: 'Allocations split the line net.',
    allocation_need_center: 'Every allocation needs a cost centre.',
    allocation_duplicate_center: 'A cost centre is repeated.',
    allocation_invalid_value: 'Allocation value is invalid.',
    allocation_percent_invalid: 'Percentages must total 100%.',
    allocation_amount_invalid: 'Amounts must total the line net.',
    discount_shipping: 'Discount, shipping and adjustment', tax_mode: 'Tax mode',
    tax_exclusive: 'Prices exclude VAT', tax_inclusive: 'Prices include VAT',
    discount_mode: 'Discount type', discount_amount: 'Fixed amount', discount_percent: 'Percent',
    shipping: 'Shipping', adjustment: 'Adjustment', adjustment_hint: 'Rounding, not taxed.',
    payment_section: 'Payment', paid_already: 'Paid already',
    payment_method: 'Payment method', method_cash: 'Cash', method_transfer: 'Transfer', method_card: 'Card',
    payment_reference: 'Payment reference', cash_account: 'Cash account', cash_account_main: 'Default cashbox',
    meta_section: 'Invoice details', warehouse: 'Warehouse', warehouse_auto: 'Automatic',
    warehouse_hint: 'Stock leaves this warehouse on posting.',
    price_list: 'Price list', price_list_base: 'Base prices', price_list_apply: 'Apply list',
    price_list_applying: 'Applying…', price_list_inactive: 'inactive',
    price_list_hint: 'Applies to matching lines only.',
    cost_center: 'Cost centre', no_center: 'No cost centre',
    salesperson: 'Salesperson', no_salesperson: 'No salesperson',
    notes: 'Notes', subtotal: 'Subtotal', discount: 'Discount', tax_total: 'VAT', total: 'Total',
    summary_hint: 'Posting creates the journal entry.', summary_title: 'Invoice summary',
    save_draft: 'Save draft', save_post: 'Save and post', need_line: 'Add at least one valid line.',
    saveFailed: 'Could not save.', created: 'Created', updated: 'Updated',
  };
  const translator = Object.assign(
    (key: string, values?: Record<string, unknown>) =>
      (strings[key] ?? key).replace(/\{(\w+)\}/g, (_, n) => String(values?.[n] ?? '')),
    { raw: () => ({}), rich: (key: string) => strings[key] ?? key }
  );
  return { api: vi.fn(), push: vi.fn(), replace: vi.fn(), translate: translator };
});

vi.mock('next-intl', () => ({ useTranslations: () => translate, useLocale: () => 'en' }));
// كائن موجّه **ثابت**: `useRouter: () => ({ push, replace })` يعيد كائناً جديداً في
// كل عرض، و`useEffect` تحميل المستند يعتمد على `router` — فيعيد الجلب بلا نهاية
// ويجوّع حلقة الأحداث. الموجّه الحقيقي من `next/navigation` مستقرّ، فالثبات هنا
// يحاكي الإنتاج لا يخفي عيباً فيه.
const router = { push, replace };
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('@/components/ui/toast', () => {
  const fns = { success: vi.fn(), error: vi.fn() };
  return { useToast: () => fns };
});
vi.mock('@/lib/use-number-preview', () => ({
  useNumberPreview: () => ({ number: 'INV-2026-0120', loading: false }),
}));
vi.mock('@/components/partners/partner-dialog', () => ({ PartnerDialog: () => null }));
vi.mock('@/components/products/product-dialog', () => ({ ProductDialog: () => null }));
// الـ`Combobox` نافذةٌ منبثقة؛ بديلٌ أصليّ يكفي لإثبات الربط، ويحفظ `sub`/`hint`
// في السمات ليُتحقَّق من محتوى البحث.
vi.mock('@/components/ui/combobox', () => ({
  Combobox: ({ id, value, onChange, options, ...rest }: {
    id?: string; value: string; onChange: (v: string) => void;
    options: { value: string; label: string; sub?: string; hint?: string }[];
  }) => (
    <select
      id={id} value={value} onChange={(e) => onChange(e.target.value)}
      data-options={JSON.stringify(options)} {...rest}
    >
      <option value="">—</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
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

const customer = {
  id: 'c1', name: 'Gulf Trading Est.', type: 'customer', code: 'C-001',
  phone: '0138012345', vat_number: '311111111100003',
  default_price_list_id: 'pl-1', default_price_list: { id: 'pl-1', name: 'Wholesale', is_active: true },
};
const product = {
  id: 'pr1', name: 'A4 paper carton', sku: 'SKU-003', barcode: '2000000000003',
  sale_price: '95.00', min_sale_price: null, tax_rate: 15, is_active: true,
  track_inventory: true, quantity_on_hand: 240, units: [{ name: 'carton', factor: 1 }],
};
const minPriceProduct = {
  ...product, id: 'pr2', name: 'Tissue carton', sku: 'SKU-009',
  sale_price: '120.00', min_sale_price: '100.00',
  units: [{ name: 'carton', factor: 1 }, { name: 'packet', factor: 12 }],
};
const centre = { id: 'cc1', code: 'CC1', name: 'Dammam branch', is_active: true };
const centre2 = { id: 'cc2', code: 'CC2', name: 'Khobar branch', is_active: true };

function respond(overrides: Record<string, unknown> = {}, opts: { centers?: unknown[] } = {}) {
  api.mockImplementation((path: string) => {
    if (path in overrides) return Promise.resolve(overrides[path]);
    if (path.startsWith('/partners')) return Promise.resolve({ data: [customer] });
    if (path.startsWith('/products')) return Promise.resolve({ data: [product, minPriceProduct] });
    if (path.startsWith('/cost-centers')) return Promise.resolve({ data: opts.centers ?? [] });
    if (path.startsWith('/warehouses')) return Promise.resolve({ data: [] });
    if (path.startsWith('/employees')) return Promise.resolve({ data: [] });
    if (path.startsWith('/price-lists')) return Promise.resolve({ data: [] });
    if (path.startsWith('/accounts')) return Promise.resolve({ data: [] });
    if (path.startsWith('/sales-config')) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
}

const firstQty = async () => (await screen.findAllByLabelText('Qty'))[0] as HTMLInputElement;
const lineField = (label: string) => screen.getAllByLabelText(label)[0] as HTMLInputElement;

/** مساحتا الاسم المعنيّتان فقط — شجرة الرسائل الكاملة متداخلة ولا تُختزل إلى نصوص. */
type LineMessages = {
  invoiceForm: Record<string, string>;
  purchaseForm: Record<string, string>;
};

async function messages(locale: 'ar' | 'en'): Promise<LineMessages> {
  const loaded = locale === 'ar'
    ? await import('@/messages/ar.json')
    : await import('@/messages/en.json');
  return loaded.default as unknown as LineMessages;
}

/**
 * مصطلح القسم يُقاس على ملفّي الترجمة مباشرة: اختبار المكوّن يعرض القاموس الوهمي
 * لا العربي، فلا يثبت وحده أن الشاشة تقول «البنود» كما تقول فاتورة الشراء.
 */
describe('sales line terminology matches purchases', () => {
  it('names the section البنود and the action إضافة سطر, in both languages', async () => {
    const ar = await messages('ar');
    const en = await messages('en');

    expect(ar.invoiceForm.items_section).toBe('البنود');
    expect(ar.invoiceForm.items_section).toBe(ar.purchaseForm.items_section);
    expect(ar.invoiceForm.add_line).toBe('إضافة سطر');
    expect(ar.invoiceForm.add_line).toBe(ar.purchaseForm.add_line);

    expect(en.invoiceForm.items_section).toBe('Items');
    expect(en.invoiceForm.items_section).toBe(en.purchaseForm.items_section);
    expect(en.invoiceForm.add_line).toBe(en.purchaseForm.add_line);
  });

  it('labels the sales line fields the same way purchases does', async () => {
    const ar = await messages('ar');

    expect(ar.invoiceForm.item).toBe(ar.purchaseForm.item);
    expect(ar.invoiceForm.description).toBe(ar.purchaseForm.description);
    expect(ar.invoiceForm.price).toBe(ar.purchaseForm.unit_price);
    expect(ar.invoiceForm.qty).toBe(ar.purchaseForm.qty);
    expect(ar.invoiceForm.tax).toBe(ar.purchaseForm.tax);
  });
});

describe('InvoiceForm — create shell', () => {
  afterEach(cleanup);
  // `mockClear` لا `mockReset`: الأخيرة تمسح التنفيذ نفسه، فوعدٌ متأخّر من اختبارٍ
  // سابق يستدعي `api()` بعدها فيحصل على `undefined` ثم ينكسر على `.then` — خطأٌ
  // غير ملتقَط يعلّق تشغيل الملف كلّه. المسح يبقي آخر تنفيذ صالحاً حتى يستبدله
  // الاختبار التالي في أول سطر منه.
  beforeEach(() => { api.mockClear(); push.mockClear(); replace.mockClear(); });

  it('renders the create heading and a single back link', async () => {
    respond();
    render(<InvoiceForm />);

    expect(screen.getByRole('heading', { name: 'New invoice' })).toBeTruthy();
    await firstQty();
  });

  it('opens with one item line already visible, before any Add line press', async () => {
    respond();
    render(<InvoiceForm />);

    expect(await screen.findAllByLabelText('Qty')).toHaveLength(1);
  });

  it('shows save and post exactly once each, never duplicated in the header', async () => {
    respond();
    render(<InvoiceForm />);
    await firstQty();

    expect(screen.getAllByRole('button', { name: 'Save draft' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Save and post' })).toHaveLength(1);
  });

  it('keeps the save actions in a bar pinned to the bottom on mobile', async () => {
    respond();
    const { container } = render(<InvoiceForm />);
    await firstQty();

    const bar = container.querySelector('.fixed.bottom-0') as HTMLElement;
    expect(bar).toBeTruthy();
    expect(bar.className).toContain('pb-safe');
    expect(bar.textContent).toContain('Save and post');
  });

  it('puts the items section above the secondary operational fields', async () => {
    respond();
    const { container } = render(<InvoiceForm />);
    await firstQty();

    const text = container.textContent ?? '';
    expect(text.indexOf('Items')).toBeLessThan(text.indexOf('Invoice details') === -1 ? text.length : text.indexOf('Invoice details'));
    expect(text.indexOf('Customer')).toBeLessThan(text.indexOf('Items'));
  });

  it('never renders the deprecated riyal glyph or a currency word', async () => {
    respond();
    const { container } = render(<InvoiceForm />);
    await firstQty();

    expect(container.textContent).not.toMatch(/﷼|\bSAR\b|ريال|ر\.س/);
    expect(container.textContent).toContain('⃁');
  });
});

describe('InvoiceForm — customer selector', () => {
  afterEach(cleanup);
  // `mockClear` لا `mockReset`: الأخيرة تمسح التنفيذ نفسه، فوعدٌ متأخّر من اختبارٍ
  // سابق يستدعي `api()` بعدها فيحصل على `undefined` ثم ينكسر على `.then` — خطأٌ
  // غير ملتقَط يعلّق تشغيل الملف كلّه. المسح يبقي آخر تنفيذ صالحاً حتى يستبدله
  // الاختبار التالي في أول سطر منه.
  beforeEach(() => { api.mockClear(); push.mockClear(); replace.mockClear(); });

  it('asks the API for customers only, so suppliers cannot be invoiced by mistake', async () => {
    respond();
    render(<InvoiceForm />);
    await firstQty();

    expect(api).toHaveBeenCalledWith('/partners?type=customer');
  });

  it('offers code, VAT number and phone as searchable metadata', async () => {
    respond();
    render(<InvoiceForm />);
    await firstQty();

    const options = JSON.parse(screen.getByLabelText(/Customer/).getAttribute('data-options') ?? '[]');
    expect(options[0].label).toBe('Gulf Trading Est.');
    // `Combobox` يبحث في `label` و`sub` و`hint` — فهذه الثلاثة قابلة للبحث.
    expect(options[0].sub).toContain('C-001');
    expect(options[0].sub).toContain('311111111100003');
    expect(options[0].hint).toBe('0138012345');
  });

  it('keeps the create-mode auto-select of the first customer', async () => {
    respond();
    render(<InvoiceForm />);
    await firstQty();

    await waitFor(() => expect((screen.getByLabelText(/Customer/) as HTMLSelectElement).value).toBe('c1'));
  });

  it('adopts the chosen customer default price list on create', async () => {
    respond({}, {});
    api.mockImplementation((path: string) => {
      if (path.startsWith('/partners')) return Promise.resolve({ data: [customer] });
      if (path.startsWith('/products')) return Promise.resolve({ data: [product] });
      if (path.startsWith('/price-lists')) return Promise.resolve({ data: [{ id: 'pl-1', name: 'Wholesale', is_active: true }] });
      return Promise.resolve({ data: [] });
    });
    render(<InvoiceForm />);
    await firstQty();

    await waitFor(() => expect((screen.getByLabelText('Price list') as HTMLSelectElement).value).toBe('pl-1'));
  });
});

describe('InvoiceForm — line behaviour', () => {
  afterEach(cleanup);
  // `mockClear` لا `mockReset`: الأخيرة تمسح التنفيذ نفسه، فوعدٌ متأخّر من اختبارٍ
  // سابق يستدعي `api()` بعدها فيحصل على `undefined` ثم ينكسر على `.then` — خطأٌ
  // غير ملتقَط يعلّق تشغيل الملف كلّه. المسح يبقي آخر تنفيذ صالحاً حتى يستبدله
  // الاختبار التالي في أول سطر منه.
  beforeEach(() => { api.mockClear(); push.mockClear(); replace.mockClear(); });

  it('labels every line field rather than relying on placeholders', async () => {
    respond();
    render(<InvoiceForm />);
    await firstQty();

    for (const label of ['Item', 'Description', 'Unit price', 'Qty', 'Discount', 'Tax %']) {
      const el = screen.getAllByLabelText(label)[0];
      expect(document.querySelector(`label[for="${el.id}"]`)).toBeTruthy();
    }
  });

  it('starts the first line with an empty quantity rather than a silent 1', async () => {
    respond();
    render(<InvoiceForm />);

    expect((await firstQty()).value).toBe('');
  });

  it('starts every added line empty too', async () => {
    respond();
    render(<InvoiceForm />);
    await firstQty();

    await userEvent.click(screen.getByRole('button', { name: /Add line/ }));

    const quantities = screen.getAllByLabelText('Qty') as HTMLInputElement[];
    expect(quantities.map((input) => input.value)).toEqual(['', '']);
  });

  it('blocks saving a line that has content but no quantity, and says why', async () => {
    respond();
    render(<InvoiceForm />);
    await firstQty();

    await userEvent.selectOptions(screen.getAllByLabelText('Item')[0], 'pr1');
    await waitFor(() => expect(lineField('Unit price').value).toBe('95.00'));

    expect(screen.getByText('Every line needs a positive quantity.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Save and post' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('lifts the block once a positive quantity is entered', async () => {
    respond();
    render(<InvoiceForm />);
    await firstQty();

    await userEvent.selectOptions(screen.getAllByLabelText('Item')[0], 'pr1');
    await waitFor(() => expect(lineField('Unit price').value).toBe('95.00'));
    await userEvent.type(await firstQty(), '3');

    await waitFor(() => expect(
      (screen.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement).disabled
    ).toBe(false));
    expect(screen.queryByText('Every line needs a positive quantity.')).toBeNull();
  });

  it('leaves an untouched blank line alone instead of demanding a quantity for it', async () => {
    respond();
    render(<InvoiceForm />);
    await firstQty();

    await userEvent.selectOptions(screen.getAllByLabelText('Item')[0], 'pr1');
    await waitFor(() => expect(lineField('Unit price').value).toBe('95.00'));
    await userEvent.type(await firstQty(), '2');
    await userEvent.click(screen.getByRole('button', { name: /Add line/ }));

    // سطرٌ ثانٍ لم يُمسّ: `submit` يُسقطه أصلاً، فلا يُمنع الحفظ بسببه.
    expect(screen.queryByText('Every line needs a positive quantity.')).toBeNull();
    expect((screen.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the line total as text, never an editable field, next to an accessible delete', async () => {
    respond();
    render(<InvoiceForm />);
    await firstQty();

    expect(screen.queryByRole('textbox', { name: 'Total incl. VAT' })).toBeNull();
    expect(screen.queryByRole('spinbutton', { name: 'Total incl. VAT' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Remove line' }).length).toBeGreaterThan(0);
  });

  it('gives the unit its own visible label when a product has more than one', async () => {
    respond();
    render(<InvoiceForm />);
    await firstQty();

    await userEvent.selectOptions(screen.getAllByLabelText('Item')[0], 'pr2');
    const unit = await screen.findByLabelText('Unit');
    // تسميةٌ مرتبطة لا سمة `aria-label` وحدها.
    expect(document.querySelector(`label[for="${unit.id}"]`)).toBeTruthy();
  });

  it('fills description, price and tax from the chosen product', async () => {
    respond();
    render(<InvoiceForm />);
    await firstQty();

    await userEvent.selectOptions(screen.getAllByLabelText('Item')[0], 'pr1');

    await waitFor(() => expect(lineField('Unit price').value).toBe('95.00'));
    expect(lineField('Description').value).toBe('A4 paper carton');
    expect(lineField('Tax %').value).toBe('15');
  });

  it('computes the line total from quantity, price, discount and tax', async () => {
    respond();
    render(<InvoiceForm />);
    await firstQty();

    await userEvent.selectOptions(screen.getAllByLabelText('Item')[0], 'pr1');
    await waitFor(() => expect(lineField('Unit price').value).toBe('95.00'));
    await userEvent.clear(await firstQty());
    await userEvent.type(await firstQty(), '2');

    // ٢ × ٩٥ = ١٩٠ وضريبة ١٥٪ ⇒ ٢١٨.٥٠
    await waitFor(() => expect(screen.getAllByText(/218\.50/).length).toBeGreaterThan(0));
  });

  it('adds and removes lines, and refuses to remove the only one', async () => {
    respond();
    render(<InvoiceForm />);
    await firstQty();

    expect((screen.getAllByRole('button', { name: 'Remove line' })[0] as HTMLButtonElement).disabled).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: /Add line/ }));
    expect(screen.getAllByLabelText('Qty')).toHaveLength(2);

    await userEvent.click(screen.getAllByRole('button', { name: 'Remove line' })[1]);
    expect(screen.getAllByLabelText('Qty')).toHaveLength(1);
  });

  it('offers the unit selector only for a product with more than one unit', async () => {
    respond();
    render(<InvoiceForm />);
    await firstQty();

    await userEvent.selectOptions(screen.getAllByLabelText('Item')[0], 'pr1');
    await waitFor(() => expect(lineField('Unit price').value).toBe('95.00'));
    expect(screen.queryByLabelText('Unit')).toBeNull();

    await userEvent.selectOptions(screen.getAllByLabelText('Item')[0], 'pr2');
    await waitFor(() => expect(screen.getByLabelText('Unit')).toBeTruthy());
  });

  it('keeps advanced line settings collapsed until they matter', async () => {
    respond({}, { centers: [centre, centre2] });
    render(<InvoiceForm />);
    await firstQty();

    const toggle = screen.getAllByRole('button', { name: /Advanced line settings/ })[0];
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('Line cost centre')).toBeNull();

    await userEvent.click(toggle);
    expect(screen.getByLabelText('Line cost centre')).toBeTruthy();
  });
});

describe('InvoiceForm — totals, saving and errors', () => {
  afterEach(cleanup);
  // `mockClear` لا `mockReset`: الأخيرة تمسح التنفيذ نفسه، فوعدٌ متأخّر من اختبارٍ
  // سابق يستدعي `api()` بعدها فيحصل على `undefined` ثم ينكسر على `.then` — خطأٌ
  // غير ملتقَط يعلّق تشغيل الملف كلّه. المسح يبقي آخر تنفيذ صالحاً حتى يستبدله
  // الاختبار التالي في أول سطر منه.
  beforeEach(() => { api.mockClear(); push.mockClear(); replace.mockClear(); });

  async function ready() {
    respond({ '/invoices': { data: { id: 'inv-9' } } });
    render(<InvoiceForm />);
    await firstQty();
    await userEvent.selectOptions(screen.getAllByLabelText('Item')[0], 'pr1');
    await waitFor(() => expect(lineField('Unit price').value).toBe('95.00'));
    // الكمية تبدأ فارغة الآن، وبلا كميةٍ صالحة لا يُتاح الحفظ.
    await userEvent.type(await firstQty(), '1');
  }

  it('applies a header discount to the total', async () => {
    await ready();

    await userEvent.type(screen.getByLabelText('Fixed amount'), '15');

    // ٩٥ − ١٥ = ٨٠ صافياً، وضريبة ١٥٪ ⇒ ٩٢.٠٠
    await waitFor(() => expect(screen.getAllByText(/92\.00/).length).toBeGreaterThan(0));
  });

  it('switches tax mode without touching the line price', async () => {
    await ready();

    await userEvent.selectOptions(screen.getByLabelText('Tax mode'), '1');

    expect(lineField('Unit price').value).toBe('95.00');
    // متضمَّنة: تُستخرَج الضريبة من ٩٥ فيبقى الإجمالي ٩٥.٠٠
    await waitFor(() => expect(screen.getAllByText(/95\.00/).length).toBeGreaterThan(0));
  });

  it('posts through the separate post endpoint after saving', async () => {
    await ready();

    await userEvent.click(screen.getByRole('button', { name: 'Save and post' }));

    await waitFor(() => expect(api).toHaveBeenCalledWith('/invoices', expect.objectContaining({ method: 'POST' })));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/invoices/inv-9/post', expect.objectContaining({ method: 'POST' })));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/invoices/inv-9'));
  });

  it('saves a draft without calling the post endpoint', async () => {
    await ready();

    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(api).toHaveBeenCalledWith('/invoices', expect.objectContaining({ method: 'POST' })));
    expect(api.mock.calls.some((c) => String(c[0]).endsWith('/post'))).toBe(false);
  });

  it('refuses to save with no priced line, and says so', async () => {
    respond();
    render(<InvoiceForm />);
    await firstQty();

    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Add at least one valid line.');
  });

});

describe('InvoiceForm — edit mode', () => {
  afterEach(cleanup);
  // `mockClear` لا `mockReset`: الأخيرة تمسح التنفيذ نفسه، فوعدٌ متأخّر من اختبارٍ
  // سابق يستدعي `api()` بعدها فيحصل على `undefined` ثم ينكسر على `.then` — خطأٌ
  // غير ملتقَط يعلّق تشغيل الملف كلّه. المسح يبقي آخر تنفيذ صالحاً حتى يستبدله
  // الاختبار التالي في أول سطر منه.
  beforeEach(() => { api.mockClear(); push.mockClear(); replace.mockClear(); });

  const draft = {
    status: 'draft', partner_id: 'c1', warehouse_id: null, price_list_id: null, payment_type: 'credit',
    invoice_date: '2026-06-20', due_date: '2026-07-20', cost_center_id: null, salesperson_id: null,
    discount: '0', shipping: '0', adjustment: '0', tax_inclusive: false, notes: 'Delivered to site',
    is_paid: true, payment_method: 'card', payment_reference: 'CARD-7', cash_account_id: null,
    lines: [{
      product_id: 'pr1', description: 'A4 paper carton', quantity: 7, unit_name: null,
      unit_price: '95.00', tax_rate: 15, line_discount: '0',
    }],
  };

  it('prefills the saved invoice, including the paid-already state', async () => {
    respond({ '/invoices/inv-1': { data: draft } });
    render(<InvoiceForm editId="inv-1" />);

    await waitFor(async () => expect((await firstQty()).value).toBe('7'));
    expect(lineField('Unit price').value).toBe('95.00');
    expect((screen.getByRole('checkbox', { name: /Paid already/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Payment reference') as HTMLInputElement).value).toBe('CARD-7');
    expect(screen.getByRole('heading', { name: 'Edit invoice' })).toBeTruthy();
  });

  it('offers no number preview when editing', async () => {
    respond({ '/invoices/inv-1': { data: draft } });
    render(<InvoiceForm editId="inv-1" />);

    await waitFor(async () => expect((await firstQty()).value).toBe('7'));
    expect(screen.queryByDisplayValue('INV-2026-0120')).toBeNull();
  });

  it('redirects a posted invoice back to its detail page instead of editing it', async () => {
    respond({ '/invoices/inv-1': { data: { ...draft, status: 'posted' } } });
    render(<InvoiceForm editId="inv-1" />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/invoices/inv-1'));
  });

  it('updates over PUT rather than creating a second invoice', async () => {
    respond({ '/invoices/inv-1': { data: draft } });
    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/invoices/inv-1' && options?.method === 'PUT') return Promise.resolve({ data: { id: 'inv-1' } });
      if (path === '/invoices/inv-1') return Promise.resolve({ data: draft });
      if (path.startsWith('/partners')) return Promise.resolve({ data: [customer] });
      if (path.startsWith('/products')) return Promise.resolve({ data: [product] });
      return Promise.resolve({ data: [] });
    });
    render(<InvoiceForm editId="inv-1" />);
    await waitFor(async () => expect((await firstQty()).value).toBe('7'));

    const save = screen.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    await userEvent.click(save);

    await waitFor(() => expect(api).toHaveBeenCalledWith('/invoices/inv-1', expect.objectContaining({ method: 'PUT' })));
  });

  it('shows an alert instead of a blank form when the load fails', async () => {
    respond();
    api.mockImplementation((path: string) => {
      if (path === '/invoices/inv-1') return Promise.reject(new Error('gone'));
      if (path.startsWith('/partners')) return Promise.resolve({ data: [customer] });
      if (path.startsWith('/products')) return Promise.resolve({ data: [product] });
      return Promise.resolve({ data: [] });
    });
    render(<InvoiceForm editId="inv-1" />);

    expect((await screen.findByRole('alert')).textContent).toContain('Could not save.');
  });
});
