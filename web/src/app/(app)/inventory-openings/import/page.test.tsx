// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InventoryOpeningImportPage from './page';

const { api, downloadFile, downloadCsv, translate, toast, toastSuccess, push } = vi.hoisted(() => ({
  api: vi.fn(),
  downloadFile: vi.fn(),
  downloadCsv: vi.fn(),
  toast: vi.fn(),
  toastSuccess: vi.fn(),
  push: vi.fn(),
  translate: Object.assign(
    (key: string, values: Record<string, unknown> = {}) =>
      Object.keys(values).length ? `${key}:${Object.values(values).join(',')}` : key,
    { raw: () => ({}), rich: (key: string) => key }
  ),
}));

vi.mock('next-intl', () => ({ useTranslations: () => translate, useLocale: () => 'ar' }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock('@/lib/api', () => ({
  api,
  downloadFile,
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));
vi.mock('@/lib/export', () => ({ downloadCsv, toCsv: (h: unknown, r: unknown) => JSON.stringify({ h, r }) }));
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast, success: toastSuccess, error: vi.fn() }),
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

const fields = [
  { key: 'nebrax_id', label_ar: 'معرّف نبراكس', label_en: 'Nebrax ID', type: 'text', required: false },
  { key: 'sku', label_ar: 'رمز الصنف', label_en: 'SKU', type: 'text', required: false },
  { key: 'barcode', label_ar: 'الباركود', label_en: 'Barcode', type: 'text', required: false },
  { key: 'warehouse', label_ar: 'المخزن', label_en: 'Warehouse', type: 'text', required: false },
  { key: 'opening_quantity', label_ar: 'الكمية', label_en: 'Quantity', type: 'quantity', required: true },
  { key: 'opening_unit_cost', label_ar: 'تكلفة الوحدة', label_en: 'Unit cost', type: 'money', required: true },
];

const inspection = {
  columns: [
    { index: 0, header: 'رمز الصنف', samples: ['SKU-1001'], suggested_field: 'sku' },
    { index: 1, header: 'المخزن', samples: ['WH-1'], suggested_field: 'warehouse' },
    { index: 2, header: 'الكمية', samples: ['120'], suggested_field: 'opening_quantity' },
    { index: 3, header: 'التكلفة', samples: ['18.50'], suggested_field: 'opening_unit_cost' },
  ],
  total_rows: 1,
  fields,
};

const cleanCounters = {
  total_rows: 1, valid_rows: 1, error_rows: 0, duplicate_rows: 0,
  products_not_found: 0, warehouses_not_found: 0, products_with_movements: 0,
  total_quantity: 120, total_value: '2220.00',
};

const cleanPreview = {
  opening_date: '2026-01-01',
  allow_zero_cost: false,
  mapping: { 0: 'sku', 1: 'warehouse', 2: 'opening_quantity', 3: 'opening_unit_cost' },
  counters: cleanCounters,
  rows: [{
    row: 2, status: 'valid', sku: 'SKU-1001', barcode: null, product_name: 'قهوة عربية',
    warehouse: 'المخزن الرئيسي', quantity: 120, unit_cost: '18.50', total_cost: '2220.00',
    notes: null, issues: [],
  }],
  rows_shown: 1,
  rows_truncated: false,
  errors: [],
};

const brokenPreview = {
  ...cleanPreview,
  counters: { ...cleanCounters, valid_rows: 0, error_rows: 1, products_with_movements: 1, total_quantity: 0, total_value: '0.00' },
  rows: [{
    row: 2, status: 'error', sku: 'SKU-1001', barcode: null, product_name: 'قهوة عربية',
    warehouse: 'المخزن الرئيسي', quantity: 120, unit_cost: '18.50', total_cost: '2220.00', notes: null,
    issues: [{ code: 'product_has_prior_movement', field: 'sku', value: 'SKU-1001', message: 'لهذا المنتج حركة سابقة' }],
  }],
  errors: [{ row: 2, issues: [{ code: 'product_has_prior_movement', field: 'sku', value: 'SKU-1001', message: 'لهذا المنتج حركة سابقة' }] }],
};

const draft = {
  id: 'doc-1', number: 'OPN-2026-00001', opening_date: '2026-01-01', status: 'draft',
  notes: null, source_filename: 'openings.csv', total_quantity: 120, total_value: '2220.00',
  journal_entry_id: null, posted_at: null, lines: [],
};

function csvFile(): File {
  return new File(['sku,warehouse\n'], 'openings.csv', { type: 'text/csv' });
}

/** يرفع الملف ويتقدّم حتى الخطوة المطلوبة. */
async function uploadTo(step: 'mapping' | 'preview' | 'confirm', user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByLabelText('choose_file'), csvFile());
  await waitFor(() => expect(screen.getByText(/rows_found/)).toBeTruthy());

  await user.click(screen.getByRole('button', { name: 'next' }));
  await waitFor(() => expect(screen.getByText('mapping_source')).toBeTruthy());
  if (step === 'mapping') return;

  await user.click(screen.getByRole('button', { name: 'run_preview' }));
  await waitFor(() => expect(screen.getByText('counter_valid_rows')).toBeTruthy());
  if (step === 'preview') return;

  await user.click(screen.getByRole('button', { name: 'next' }));
  await waitFor(() => expect(screen.getByText('confirm_hint')).toBeTruthy());
}

beforeEach(() => {
  api.mockReset();
  downloadFile.mockReset();
  downloadFile.mockResolvedValue('downloaded');
  downloadCsv.mockReset();
  toast.mockReset();
  toastSuccess.mockReset();
  push.mockReset();
  api.mockImplementation((path: string) => {
    if (path === '/inventory-openings/import/inspect') return Promise.resolve({ data: inspection });
    if (path === '/inventory-openings/import/preview') return Promise.resolve({ data: cleanPreview });
    if (path === '/inventory-openings/import/apply') return Promise.resolve({ data: draft });
    return Promise.resolve({ data: null });
  });
});

afterEach(cleanup);

describe('استيراد الأرصدة الافتتاحية', () => {
  it('تبدأ بالملف والتاريخ ولا تتقدّم قبل قراءة الأعمدة', async () => {
    render(<InventoryOpeningImportPage />);

    expect(screen.getByRole('button', { name: 'next' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('opening_date')).toBeTruthy();
  });

  it('تقترح مطابقة الأعمدة من الخادم وتقبل تغييرها', async () => {
    const user = userEvent.setup();
    render(<InventoryOpeningImportPage />);
    await uploadTo('mapping', user);

    const target = screen.getByLabelText('mapping_target_for:رمز الصنف') as HTMLSelectElement;
    expect(target.value).toBe('sku');

    await user.selectOptions(target, 'barcode');
    expect(target.value).toBe('barcode');
    // ما زالت المطابقة صالحة: الباركود معرّفٌ مقبول.
    expect(screen.getByRole('button', { name: 'run_preview' }).hasAttribute('disabled')).toBe(false);
  });

  it('تمنع الفحص حين يسقط عمود المخزن', async () => {
    const user = userEvent.setup();
    render(<InventoryOpeningImportPage />);
    await uploadTo('mapping', user);

    await user.selectOptions(screen.getByLabelText('mapping_target_for:المخزن'), '');

    expect(screen.getByText('mapping_missing_warehouse')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'run_preview' }).hasAttribute('disabled')).toBe(true);
  });

  it('تمنع الفحص حين يسقط حقل مطلوب', async () => {
    const user = userEvent.setup();
    render(<InventoryOpeningImportPage />);
    await uploadTo('mapping', user);

    await user.selectOptions(screen.getByLabelText('mapping_target_for:الكمية'), '');

    expect(screen.getByText('mapping_missing_required:الكمية')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'run_preview' }).hasAttribute('disabled')).toBe(true);
  });

  it('ترسل التاريخ والسياسة والمطابقة إلى الفحص', async () => {
    const user = userEvent.setup();
    render(<InventoryOpeningImportPage />);

    await user.upload(screen.getByLabelText('choose_file'), csvFile());
    await waitFor(() => expect(screen.getByText(/rows_found/)).toBeTruthy());
    await user.click(screen.getByLabelText('allow_zero_cost'));
    await user.click(screen.getByRole('button', { name: 'next' }));
    await user.click(screen.getByRole('button', { name: 'run_preview' }));

    await waitFor(() => expect(screen.getByText('counter_valid_rows')).toBeTruthy());
    const call = api.mock.calls.find(([path]) => path === '/inventory-openings/import/preview');
    const body = call?.[1]?.body as FormData;
    expect(body.get('allow_zero_cost')).toBe('1');
    expect(body.get('opening_date')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.get('mapping[1]')).toBe('warehouse');
  });

  it('تعرض كل عدّادات المعاينة وقيمة المخزون بالريال', async () => {
    const user = userEvent.setup();
    render(<InventoryOpeningImportPage />);
    await uploadTo('preview', user);

    for (const counter of [
      'counter_valid_rows', 'counter_error_rows', 'counter_duplicate_rows',
      'counter_products_not_found', 'counter_warehouses_not_found', 'counter_products_with_movements',
      'counter_total_quantity', 'counter_total_value',
    ]) {
      expect(screen.getByText(counter)).toBeTruthy();
    }
    expect(screen.getByText('no_blocking_errors')).toBeTruthy();
    expect(screen.getAllByText(/2,220\.00/).length).toBeGreaterThan(0);
  });

  it('توقف التقدّم عند وجود خطأ مانع وتتيح تنزيل تقريره', async () => {
    api.mockImplementation((path: string) => {
      if (path === '/inventory-openings/import/inspect') return Promise.resolve({ data: inspection });
      if (path === '/inventory-openings/import/preview') return Promise.resolve({ data: brokenPreview });
      return Promise.resolve({ data: draft });
    });

    const user = userEvent.setup();
    render(<InventoryOpeningImportPage />);
    await uploadTo('preview', user);

    expect(screen.getByRole('alert').textContent).toContain('blocking_errors:1');
    expect(screen.getByRole('button', { name: 'next' }).hasAttribute('disabled')).toBe(true);
    // سبب الرفض ظاهرٌ للمستخدم لا مخفيٌّ في السجلّات.
    expect(screen.getAllByText(/لهذا المنتج حركة سابقة/).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'download_issues' }));
    expect(downloadCsv).toHaveBeenCalled();
    // ولا استيراد قد جرى.
    expect(api.mock.calls.some(([path]) => path === '/inventory-openings/import/apply')).toBe(false);
  });

  it('تنشئ المسودة ولا ترحّلها، وتحيل إلى صفحتها', async () => {
    const user = userEvent.setup();
    render(<InventoryOpeningImportPage />);
    await uploadTo('confirm', user);

    await user.click(screen.getByRole('button', { name: 'create_draft' }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('draft_created:OPN-2026-00001'));
    // لا مسار ترحيل استُدعي من هذه الشاشة إطلاقاً.
    expect(api.mock.calls.some(([path]) => String(path).endsWith('/post'))).toBe(false);
    expect(screen.getByText('draft_next_step')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'open_draft' }));
    expect(push).toHaveBeenCalledWith('/inventory-openings/doc-1');
  });

  it('تبلّغ فشل الخادم بنصّه بدل ابتلاعه', async () => {
    const { ApiError } = await import('@/lib/api');
    api.mockImplementation((path: string) => {
      if (path === '/inventory-openings/import/inspect') return Promise.resolve({ data: inspection });
      return Promise.reject(new ApiError(422, 'صف العناوين يحتوي أسماء أعمدة مكرّرة', {}));
    });

    const user = userEvent.setup();
    render(<InventoryOpeningImportPage />);
    await uploadTo('mapping', user);
    await user.click(screen.getByRole('button', { name: 'run_preview' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('أسماء أعمدة مكرّرة');
  });

  it('تنزّل القالب من الخادم لا من المتصفح، وتقول إن التنزيل غير متاح في المعاينة', async () => {
    const user = userEvent.setup();
    render(<InventoryOpeningImportPage />);

    await user.click(screen.getByRole('button', { name: 'download_template' }));
    expect(downloadFile).toHaveBeenCalledWith(
      '/inventory-openings/import/template',
      'nebrax-inventory-opening-template.csv'
    );
    expect(downloadCsv).not.toHaveBeenCalled();

    downloadFile.mockResolvedValue('demo-unavailable');
    await user.click(screen.getByRole('button', { name: 'download_template' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({ title: 'export_demo_unavailable', variant: 'info' })
    );
  });

  it('تبقي كل التسميات مترجَمة بلا نص عربي مكتوب في الشيفرة', async () => {
    const user = userEvent.setup();
    const { container } = render(<InventoryOpeningImportPage />);
    await uploadTo('mapping', user);

    // ترويسات الملف وعيّناته عربية عمداً، فالفحص على الأزرار والتسميات وحدها.
    const chrome = [...container.querySelectorAll('button, label, legend, h1')].map(
      (node) => node.textContent ?? ''
    );
    expect(chrome.some((text) => /[؀-ۿ]/.test(text))).toBe(false);
  });
});
