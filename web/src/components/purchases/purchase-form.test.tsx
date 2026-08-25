/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PurchaseForm } from './purchase-form';

const { api, push, translate } = vi.hoisted(() => {
  const strings: Record<string, string> = {
    new_title: 'New purchase invoice',
    edit_title: 'Edit purchase invoice',
    items_section: 'Items',
    add_line: 'Add line',
    item: 'Item',
    description: 'Description',
    unit_price: 'Unit price',
    qty: 'Qty',
    unit: 'Unit',
    line_discount: 'Discount',
    tax: 'Tax %',
    line_total: 'Line total',
    remove_line: 'Remove line',
    pick_product: 'Choose a product',
    search_product: 'Search products…',
    no_product_found: 'No product found',
    new_product: 'New product',
    product_required: 'Every line needs a product.',
    qty_required: 'Every line needs a positive quantity.',
    items_hint: 'Stocked products hit inventory.',
    supplier_section: 'Supplier and payment',
    supplier: 'Supplier',
    new_supplier_title: 'New supplier',
    s_attachments: 'Attach documents',
    s_attachments_hint: 'Attach the supplier invoice.',
    attachments_empty: 'Click to choose files',
    attachments_empty_hint: 'PDF, images, Excel and more — up to 10 files',
    attachments_add_more: 'Add more files',
    attachments_pending: 'Files to upload on save',
    attachments_uploaded: 'Saved attachments',
    attachments_uploading: 'Uploading…',
    attachments_limit: 'At most 10 files.',
    attachments_invalid: 'Unsupported file or larger than 10MB.',
    remove_attachment: 'Remove attachment',
    save_draft: 'Save draft',
    save_post: 'Save and post',
    import_from_document: 'Import from document',
    totals: 'Totals',
    total: 'Total',
    subtotal: 'Subtotal',
    tax_amount: 'Tax',
    tax_mode: 'Tax mode',
    tax_exclusive: 'Tax exclusive',
    tax_inclusive: 'Tax inclusive',
    back: 'Back',
    cancel: 'Cancel',
  };
  const translator = Object.assign(
    (key: string, values?: Record<string, unknown>) =>
      (strings[key] ?? key).replace(/\{(\w+)\}/g, (_, n) => String(values?.[n] ?? '')),
    { raw: () => ({}), rich: (key: string) => strings[key] ?? key }
  );
  return { api: vi.fn(), push: vi.fn(), translate: translator };
});

vi.mock('next-intl', () => ({ useTranslations: () => translate, useLocale: () => 'en' }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
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
  useNumberPreview: () => ({ number: 'PUR-2026-0050', loading: false }),
}));
vi.mock('@/lib/tax', () => ({ getSystemTaxInclusive: () => Promise.resolve(false) }));
vi.mock('@/components/partners/partner-dialog', () => ({ PartnerDialog: () => null }));
vi.mock('@/components/products/product-dialog', () => ({ ProductDialog: () => null }));
// الـ`Combobox` نافذةٌ منبثقة معقّدة؛ بديلٌ أصليّ يكفي لإثبات ربط اختيار المنتج.
vi.mock('@/components/ui/combobox', () => ({
  Combobox: ({ id, value, onChange, options, ...rest }: {
    id?: string; value: string; onChange: (v: string) => void;
    options: { value: string; label: string }[];
  }) => (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} {...rest}>
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

const supplier = { id: 'sup-1', name: 'Najd Supplies', type: 'supplier' };
const product = {
  id: 'prod-1', name: 'Portland cement', sku: 'CEM-1', barcode: null, purchase_price: '20.00',
  tax_rate: 15, is_active: true, track_inventory: true, quantity_on_hand: 100,
  units: [{ name: 'bag', factor: 1 }, { name: 'pallet', factor: 50 }],
};

function respondWithReferenceData(overrides: Record<string, unknown> = {}) {
  api.mockImplementation((path: string) => {
    if (path in overrides) return Promise.resolve(overrides[path]);
    if (path.startsWith('/partners')) return Promise.resolve({ data: [supplier] });
    if (path.startsWith('/products')) return Promise.resolve({ data: [product] });
    if (path.startsWith('/cost-centers')) return Promise.resolve({ data: [] });
    if (path.startsWith('/warehouses')) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
}

/** أول سطر بند — يُميَّز بحقل الكمية الذي لا يوجد إلا داخل سطر. */
async function firstLineQty() {
  return (await screen.findAllByLabelText('Qty'))[0] as HTMLInputElement;
}

function fileOf(name: string, type = 'application/pdf', size = 1024) {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

describe('PurchaseForm — line card', () => {
  afterEach(cleanup);
  beforeEach(() => { api.mockReset(); push.mockReset(); });

  it('starts a new line with an empty quantity rather than a silent 1', async () => {
    respondWithReferenceData();
    render(<PurchaseForm />);

    expect((await firstLineQty()).value).toBe('');
  });

  it('labels every line field on mobile, where there is no column header', async () => {
    respondWithReferenceData();
    render(<PurchaseForm />);
    await firstLineQty();

    for (const label of ['Item', 'Description', 'Unit price', 'Qty', 'Discount', 'Tax %']) {
      expect(screen.getAllByLabelText(label).length).toBeGreaterThan(0);
    }
  });

  it('keeps the line total as text, never an editable field', async () => {
    respondWithReferenceData();
    render(<PurchaseForm />);
    await firstLineQty();

    // التسمية موجودة للجوال، لكنها لا تعنون أي عنصر إدخال.
    expect(screen.queryByRole('textbox', { name: 'Line total' })).toBeNull();
    expect(screen.queryByRole('spinbutton', { name: 'Line total' })).toBeNull();
  });

  it('blocks saving while any line has no quantity, and says why', async () => {
    respondWithReferenceData();
    render(<PurchaseForm />);
    await firstLineQty();

    await userEvent.selectOptions(screen.getAllByLabelText('Item')[0], 'prod-1');

    expect(screen.getByText('Every line needs a positive quantity.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Save and post' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('does not treat an empty quantity as zero or one in the totals', async () => {
    respondWithReferenceData();
    render(<PurchaseForm />);
    await firstLineQty();

    await userEvent.selectOptions(screen.getAllByLabelText('Item')[0], 'prod-1');
    // سعر ٢٠ وكمية فارغة: الإجمالي صفر — لا ٢٠ من كميةٍ ضمنية.
    expect(screen.queryByText(/20\.00/)).toBeNull();
  });

  it('enables saving once a positive quantity is entered', async () => {
    respondWithReferenceData();
    render(<PurchaseForm />);
    await firstLineQty();

    await userEvent.selectOptions(screen.getByLabelText(/Supplier/), 'sup-1');
    await userEvent.selectOptions(screen.getAllByLabelText('Item')[0], 'prod-1');
    await userEvent.type(await firstLineQty(), '3');

    await waitFor(() => expect(
      (screen.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement).disabled
    ).toBe(false));
    expect(screen.queryByText('Every line needs a positive quantity.')).toBeNull();
  });

  it('rejects a zero quantity as firmly as an empty one', async () => {
    respondWithReferenceData();
    render(<PurchaseForm />);
    await firstLineQty();

    await userEvent.selectOptions(screen.getAllByLabelText('Item')[0], 'prod-1');
    await userEvent.type(await firstLineQty(), '0');

    expect(screen.getByText('Every line needs a positive quantity.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('fills price, tax and description from the chosen product', async () => {
    respondWithReferenceData();
    render(<PurchaseForm />);
    await firstLineQty();

    await userEvent.selectOptions(screen.getAllByLabelText('Item')[0], 'prod-1');

    expect((screen.getAllByLabelText('Unit price')[0] as HTMLInputElement).value).toBe('20.00');
    expect((screen.getAllByLabelText('Tax %')[0] as HTMLInputElement).value).toBe('15');
    expect((screen.getAllByLabelText('Description')[0] as HTMLInputElement).value).toBe('Portland cement');
  });

  it('computes the line total from quantity, price, discount and tax', async () => {
    respondWithReferenceData();
    render(<PurchaseForm />);
    await firstLineQty();

    await userEvent.selectOptions(screen.getAllByLabelText('Item')[0], 'prod-1');
    await userEvent.type(await firstLineQty(), '4');

    // ٤ × ٢٠ = ٨٠، وضريبة ١٥٪ ⇒ ٩٢.٠٠
    await waitFor(() => expect(screen.getAllByText(/92\.00/).length).toBeGreaterThan(0));
  });

  it('offers the unit selector only for a product with more than one unit', async () => {
    respondWithReferenceData();
    render(<PurchaseForm />);
    await firstLineQty();

    expect(screen.queryByLabelText('Unit')).toBeNull();
    await userEvent.selectOptions(screen.getAllByLabelText('Item')[0], 'prod-1');
    expect(screen.getByLabelText('Unit')).toBeTruthy();
  });

  it('adds and removes lines', async () => {
    respondWithReferenceData();
    render(<PurchaseForm />);
    await firstLineQty();

    await userEvent.click(screen.getByRole('button', { name: /Add line/ }));
    expect(screen.getAllByLabelText('Qty')).toHaveLength(2);

    await userEvent.click(screen.getAllByRole('button', { name: 'Remove line' })[1]);
    expect(screen.getAllByLabelText('Qty')).toHaveLength(1);
  });

  it('sends the entered quantity through to the payload', async () => {
    respondWithReferenceData();
    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/purchases' && options?.method === 'POST') return Promise.resolve({ data: { id: 'pu-9' } });
      if (path.startsWith('/partners')) return Promise.resolve({ data: [supplier] });
      if (path.startsWith('/products')) return Promise.resolve({ data: [product] });
      return Promise.resolve({ data: [] });
    });
    render(<PurchaseForm />);
    await firstLineQty();

    await userEvent.selectOptions(screen.getByLabelText(/Supplier/), 'sup-1');
    await userEvent.selectOptions(screen.getAllByLabelText('Item')[0], 'prod-1');
    await userEvent.type(await firstLineQty(), '7');

    const save = screen.getByRole('button', { name: 'Save draft' }) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    await userEvent.click(save);

    await waitFor(() => expect(api).toHaveBeenCalledWith('/purchases', expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({
        // مفتاح الحمولة `items` كما هو في العقد — لم يتغيّر في هذه الجولة.
        items: [expect.objectContaining({ product_id: 'prod-1', quantity: 7, unit_price: 2000, tax_rate: 15 })],
      }),
    })));
  });
});

describe('PurchaseForm — editing an existing invoice', () => {
  afterEach(cleanup);
  beforeEach(() => { api.mockReset(); push.mockReset(); });

  it('shows the stored quantity untouched', async () => {
    respondWithReferenceData({
      '/purchases/pu-1': {
        data: {
          partner_id: 'sup-1', warehouse_id: null, cost_center_id: null, payment_type: 'credit',
          purchase_date: '2026-06-20', supplier_invoice_no: null, tax_inclusive: false, notes: null,
          lines: [{ product_id: 'prod-1', description: 'Portland cement', quantity: 12, unit_name: null, unit_price: '2000', tax_rate: 15 }],
          attachments: [],
        },
      },
    });
    render(<PurchaseForm editId="pu-1" />);

    await waitFor(async () => expect((await firstLineQty()).value).toBe('12'));
  });
});

describe('PurchaseForm — attachments', () => {
  afterEach(cleanup);
  beforeEach(() => { api.mockReset(); push.mockReset(); });

  /** المُشغِّلات المرئية لاختيار الملفات — بلا الحقل المخفيّ نفسه. */
  function visibleUploadTriggers() {
    return screen.getAllByRole('button').filter((button) => {
      const text = button.textContent ?? '';
      return text.includes('Click to choose files') || text.includes('Add more files');
    });
  }

  it('offers exactly one visible way to choose files when there are none', async () => {
    respondWithReferenceData();
    render(<PurchaseForm />);
    await firstLineQty();

    expect(visibleUploadTriggers()).toHaveLength(1);
    expect(screen.getByText('PDF, images, Excel and more — up to 10 files')).toBeTruthy();
  });

  it('no longer duplicates the chooser in the section header', async () => {
    respondWithReferenceData();
    render(<PurchaseForm />);
    await firstLineQty();

    // الزرّ القديم كان يحمل مفتاح `select_attachments` ويستدعي نفس الحقل المخفيّ.
    expect(screen.queryByRole('button', { name: /select_attachments/ })).toBeNull();
    expect(screen.getByText('Attach documents')).toBeTruthy();
  });

  it('lists a chosen file and swaps the dropzone for a compact add action', async () => {
    respondWithReferenceData();
    const { container } = render(<PurchaseForm />);
    await firstLineQty();

    const input = container.querySelector('#purchase-attachments') as HTMLInputElement;
    await userEvent.upload(input, fileOf('supplier-invoice.pdf'));

    expect(await screen.findByText('supplier-invoice.pdf')).toBeTruthy();
    expect(screen.queryByText('Click to choose files')).toBeNull();

    const triggers = visibleUploadTriggers();
    expect(triggers).toHaveLength(1);
    expect(triggers[0].textContent).toContain('Add more files');
  });

  it('routes "add more files" to the same hidden input', async () => {
    respondWithReferenceData();
    const { container } = render(<PurchaseForm />);
    await firstLineQty();

    const input = container.querySelector('#purchase-attachments') as HTMLInputElement;
    await userEvent.upload(input, fileOf('first.pdf'));
    await screen.findByText('first.pdf');

    const clicked = vi.spyOn(input, 'click');
    await userEvent.click(screen.getByRole('button', { name: /Add more files/ }));
    expect(clicked).toHaveBeenCalledOnce();
  });

  it('still refuses an unsupported file type', async () => {
    respondWithReferenceData();
    const { container } = render(<PurchaseForm />);
    await firstLineQty();

    const input = container.querySelector('#purchase-attachments') as HTMLInputElement;
    await userEvent.upload(input, fileOf('macro.exe', 'application/x-msdownload'), { applyAccept: false });

    expect(await screen.findByText('Unsupported file or larger than 10MB.')).toBeTruthy();
    expect(screen.queryByText('macro.exe')).toBeNull();
  });

  it('still refuses a file over the size limit', async () => {
    respondWithReferenceData();
    const { container } = render(<PurchaseForm />);
    await firstLineQty();

    const input = container.querySelector('#purchase-attachments') as HTMLInputElement;
    await userEvent.upload(input, fileOf('huge.pdf', 'application/pdf', 11 * 1024 * 1024));

    expect(await screen.findByText('Unsupported file or larger than 10MB.')).toBeTruthy();
  });

  it('removes a pending file and brings the single dropzone back', async () => {
    respondWithReferenceData();
    const { container } = render(<PurchaseForm />);
    await firstLineQty();

    const input = container.querySelector('#purchase-attachments') as HTMLInputElement;
    await userEvent.upload(input, fileOf('note.pdf'));
    await screen.findByText('note.pdf');

    await userEvent.click(screen.getByRole('button', { name: /Remove attachment: note\.pdf/ }));

    expect(screen.queryByText('note.pdf')).toBeNull();
    const triggers = visibleUploadTriggers();
    expect(triggers).toHaveLength(1);
    expect(within(triggers[0]).getByText('Click to choose files')).toBeTruthy();
  });
});
