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
    lines: 'Lines', add_line: 'Add line', item: 'Item', description: 'Description',
    price: 'Price', qty: 'Qty', unit: 'Unit', line_discount_short: 'Discount', tax: 'Tax %',
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

describe('InvoiceForm — minimum sale price', () => {
  afterEach(cleanup);
  // `mockClear` لا `mockReset`: الأخيرة تمسح التنفيذ نفسه، فوعدٌ متأخّر من اختبارٍ
  // سابق يستدعي `api()` بعدها فيحصل على `undefined` ثم ينكسر على `.then` — خطأٌ
  // غير ملتقَط يعلّق تشغيل الملف كلّه. المسح يبقي آخر تنفيذ صالحاً حتى يستبدله
  // الاختبار التالي في أول سطر منه.
  beforeEach(() => { api.mockClear(); push.mockClear(); replace.mockClear(); });

  it('stays quiet while the price is at or above the minimum', async () => {
    respond();
    render(<InvoiceForm />);
    await firstQty();

    await userEvent.selectOptions(screen.getAllByLabelText('Item')[0], 'pr2');
    await waitFor(() => expect(lineField('Price').value).toBe('120.00'));

    expect(screen.queryByText(/below the minimum/)).toBeNull();
  });

  it('warns and forces the reason open once the price drops below the minimum', async () => {
    respond();
    render(<InvoiceForm />);
    await firstQty();

    await userEvent.selectOptions(screen.getAllByLabelText('Item')[0], 'pr2');
    await waitFor(() => expect(lineField('Price').value).toBe('120.00'));

    await userEvent.clear(lineField('Price'));
    await userEvent.type(lineField('Price'), '80');

    expect(await screen.findByText(/below the minimum \(100\.00/)).toBeTruthy();
    // القاعدة لا تُخفى: الحقل مفتوح ولا يمكن طيّه ما دام السعر تحت الحدّ.
    const toggle = screen.getAllByRole('button', { name: /Advanced line settings/ })[0] as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    expect(screen.getByLabelText('Override reason')).toBeTruthy();
  });

  it('keeps the reason reachable even when the price is fine, so the rule is never hidden', async () => {
    respond();
    render(<InvoiceForm />);
    await firstQty();

    await userEvent.selectOptions(screen.getAllByLabelText('Item')[0], 'pr2');
    await waitFor(() => expect(lineField('Price').value).toBe('120.00'));

    await userEvent.click(screen.getAllByRole('button', { name: /Advanced line settings/ })[0]);
    expect(screen.getByLabelText('Override reason')).toBeTruthy();
  });

  it('sends the override reason with the line', async () => {
    respond({ '/invoices': { data: { id: 'inv-9' } } });
    render(<InvoiceForm />);
    await firstQty();

    await userEvent.selectOptions(screen.getAllByLabelText('Item')[0], 'pr2');
    await waitFor(() => expect(lineField('Price').value).toBe('120.00'));
    await userEvent.clear(lineField('Price'));
    await userEvent.type(lineField('Price'), '80');
    await userEvent.type(await screen.findByLabelText('Override reason'), 'Agreed with the owner');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(api).toHaveBeenCalledWith('/invoices', expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({
        items: [expect.objectContaining({ minimum_price_override_reason: 'Agreed with the owner' })],
      }),
    })));
  });
});

describe('InvoiceForm — cost centre allocations', () => {
  afterEach(cleanup);
  // `mockClear` لا `mockReset`: الأخيرة تمسح التنفيذ نفسه، فوعدٌ متأخّر من اختبارٍ
  // سابق يستدعي `api()` بعدها فيحصل على `undefined` ثم ينكسر على `.then` — خطأٌ
  // غير ملتقَط يعلّق تشغيل الملف كلّه. المسح يبقي آخر تنفيذ صالحاً حتى يستبدله
  // الاختبار التالي في أول سطر منه.
  beforeEach(() => { api.mockClear(); push.mockClear(); replace.mockClear(); });

  async function openAdvancedWithProduct() {
    respond({ '/invoices': { data: { id: 'inv-9' } } }, { centers: [centre, centre2] });
    render(<InvoiceForm />);
    await firstQty();
    await userEvent.selectOptions(screen.getAllByLabelText('Item')[0], 'pr1');
    await waitFor(() => expect(lineField('Price').value).toBe('95.00'));
    await userEvent.click(screen.getAllByRole('button', { name: /Advanced line settings/ })[0]);
  }

  it('blocks saving while an allocation is incomplete, and says why', async () => {
    await openAdvancedWithProduct();

    await userEvent.selectOptions(screen.getByLabelText('Line cost centre'), 'single');

    expect(await screen.findByText('Every allocation needs a cost centre.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('accepts a single 100% allocation and sends it in basis points', async () => {
    await openAdvancedWithProduct();

    await userEvent.selectOptions(screen.getByLabelText('Line cost centre'), 'single');
    await userEvent.selectOptions(screen.getByLabelText('Allocation centre'), 'cc1');

    await waitFor(() => expect(
      (screen.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement).disabled
    ).toBe(false));
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(api).toHaveBeenCalledWith('/invoices', expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({
        items: [expect.objectContaining({
          cost_center_allocations: [{ cost_center_id: 'cc1', mode: 'percent', value: 10000 }],
        })],
      }),
    })));
  });

  it('rejects percentages that do not total 100', async () => {
    await openAdvancedWithProduct();

    await userEvent.selectOptions(screen.getByLabelText('Line cost centre'), 'multiple');
    await userEvent.selectOptions(screen.getAllByLabelText('Allocation centre')[0], 'cc1');
    await userEvent.clear(screen.getAllByLabelText('Allocation percent')[0]);
    await userEvent.type(screen.getAllByLabelText('Allocation percent')[0], '60');

    expect(await screen.findByText('Percentages must total 100%.')).toBeTruthy();
  });

  it('omits the allocations key entirely when the line uses none', async () => {
    await openAdvancedWithProduct();

    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(api).toHaveBeenCalledWith('/invoices', expect.anything()));
    const body = api.mock.calls.find((c) => c[0] === '/invoices')?.[1]?.body;
    expect(body.items[0]).not.toHaveProperty('cost_center_allocations');
  });
});

describe('InvoiceForm — paid already gate', () => {
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
    await waitFor(() => expect(lineField('Price').value).toBe('95.00'));
  }

  it('hides the payment fields from the accessibility tree while unchecked', async () => {
    await ready();

    const method = screen.getByLabelText('Payment method');
    expect(method.closest('[aria-hidden="true"]')).toBeTruthy();
    expect(method.getAttribute('tabindex')).toBe('-1');
  });

  it('reveals them when checked', async () => {
    await ready();

    await userEvent.click(screen.getByRole('checkbox', { name: /Paid already/ }));

    const method = screen.getByLabelText('Payment method');
    expect(method.closest('[aria-hidden="true"]')).toBeNull();
    expect(method.getAttribute('tabindex')).toBeNull();
  });

  it('keeps typed payment values when the gate is closed and reopened', async () => {
    await ready();

    await userEvent.click(screen.getByRole('checkbox', { name: /Paid already/ }));
    await userEvent.type(screen.getByLabelText('Payment reference'), 'TRX-42');
    await userEvent.click(screen.getByRole('checkbox', { name: /Paid already/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Paid already/ }));

    expect((screen.getByLabelText('Payment reference') as HTMLInputElement).value).toBe('TRX-42');
  });

  it('nulls the payment details in the payload while unchecked', async () => {
    await ready();

    await userEvent.click(screen.getByRole('checkbox', { name: /Paid already/ }));
    await userEvent.type(screen.getByLabelText('Payment reference'), 'TRX-42');
    await userEvent.click(screen.getByRole('checkbox', { name: /Paid already/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(api).toHaveBeenCalledWith('/invoices', expect.objectContaining({
      body: expect.objectContaining({
        is_paid: false, payment_method: null, payment_reference: null, cash_account_id: null,
      }),
    })));
  });

  it('sends the payment details once checked', async () => {
    await ready();

    await userEvent.click(screen.getByRole('checkbox', { name: /Paid already/ }));
    await userEvent.type(screen.getByLabelText('Payment reference'), 'TRX-42');
    await userEvent.selectOptions(screen.getByLabelText('Payment method'), 'transfer');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    await waitFor(() => expect(api).toHaveBeenCalledWith('/invoices', expect.objectContaining({
      body: expect.objectContaining({
        is_paid: true, payment_method: 'transfer', payment_reference: 'TRX-42',
      }),
    })));
  });

  it('offers only PaymentService-compatible cash accounts', async () => {
    respond({
      '/accounts': { data: [
        { id: 'a1', code: '1110', name: 'Main cashbox', type: 'asset', is_group: false },
        { id: 'a2', code: '1120', name: 'Bank', type: 'asset', is_group: false },
        { id: 'a3', code: '1130', name: 'Receivables', type: 'asset', is_group: false },
        { id: 'a4', code: '4110', name: 'Sales revenue', type: 'revenue', is_group: false },
        { id: 'a5', code: '1100', name: 'Current assets', type: 'asset', is_group: true },
      ] },
    });
    render(<InvoiceForm />);
    await firstQty();
    await userEvent.click(screen.getByRole('checkbox', { name: /Paid already/ }));

    const account = screen.getByLabelText('Cash account');
    const codes = within(account).getAllByRole('option').map((o) => o.textContent);
    expect(codes.some((c) => c?.includes('1110'))).toBe(true);
    expect(codes.some((c) => c?.includes('1120'))).toBe(true);
    // خارج المدى `^11[12]` أو تجميعي أو غير أصل — يرفضها `PaymentService`.
    expect(codes.some((c) => c?.includes('1130'))).toBe(false);
    expect(codes.some((c) => c?.includes('4110'))).toBe(false);
    expect(codes.some((c) => c?.includes('1100'))).toBe(false);
  });
});

describe('InvoiceForm — API failure', () => {
  afterEach(cleanup);
  // `mockClear` لا `mockReset`: الأخيرة تمسح التنفيذ نفسه، فوعدٌ متأخّر من اختبارٍ
  // سابق يستدعي `api()` بعدها فيحصل على `undefined` ثم ينكسر على `.then` — خطأٌ
  // غير ملتقَط يعلّق تشغيل الملف كلّه. المسح يبقي آخر تنفيذ صالحاً حتى يستبدله
  // الاختبار التالي في أول سطر منه.
  beforeEach(() => { api.mockClear(); push.mockClear(); replace.mockClear(); });

  it('surfaces an API failure as an alert rather than failing silently', async () => {
    respond();
    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/invoices' && options?.method === 'POST') return Promise.reject(new Error('boom'));
      if (path.startsWith('/partners')) return Promise.resolve({ data: [customer] });
      if (path.startsWith('/products')) return Promise.resolve({ data: [product] });
      return Promise.resolve({ data: [] });
    });
    render(<InvoiceForm />);
    await firstQty();
    await userEvent.selectOptions(screen.getAllByLabelText('Item')[0], 'pr1');
    await waitFor(() => expect(lineField('Price').value).toBe('95.00'));

    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Could not save.');
  });
});
