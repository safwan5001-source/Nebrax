// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProductImportPage from './page';

const { api, downloadFile, downloadCsv, translate } = vi.hoisted(() => {
  const translator = Object.assign(
    (key: string, values: Record<string, unknown> = {}) =>
      Object.keys(values).length ? `${key}:${Object.values(values).join(',')}` : key,
    { raw: () => ({}), rich: (key: string) => key }
  );
  return {
    api: vi.fn(),
    downloadFile: vi.fn(),
    downloadCsv: vi.fn(),
    translate: translator,
  };
});

vi.mock('next-intl', () => ({ useTranslations: () => translate, useLocale: () => 'ar' }));
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
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
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
  { key: 'nebrax_id', label_ar: 'معرّف نبراكس', label_en: 'Nebrax ID', type: 'identifier', required: false, clearable: false, update_locked: true, writable: false },
  { key: 'sku', label_ar: 'رمز الصنف', label_en: 'SKU', type: 'text', required: false, clearable: false, update_locked: false, writable: true },
  { key: 'name', label_ar: 'الاسم', label_en: 'Name', type: 'text', required: true, clearable: false, update_locked: false, writable: true },
  { key: 'type', label_ar: 'النوع', label_en: 'Type', type: 'enum', required: true, clearable: false, update_locked: true, writable: true },
  { key: 'sale_price', label_ar: 'سعر البيع', label_en: 'Sale price', type: 'money', required: true, clearable: false, update_locked: false, writable: true },
  { key: 'barcode', label_ar: 'الباركود', label_en: 'Barcode', type: 'text', required: false, clearable: true, update_locked: false, writable: true },
];

const inspection = {
  columns: [
    { index: 0, header: 'Code', samples: ['SKU-1'], suggested_field: 'sku' },
    { index: 1, header: 'Product Name', samples: ['قهوة'], suggested_field: 'name' },
    { index: 2, header: 'Price', samples: ['35.00'], suggested_field: 'sale_price' },
    { index: 3, header: 'Kind', samples: ['good'], suggested_field: 'type' },
    { index: 4, header: 'Mystery', samples: [''], suggested_field: null },
  ],
  total_rows: 1,
  fields,
};

const cleanPreview = {
  mode: 'create', blank_policy: 'ignore', master_data_policy: 'match_or_error',
  total_rows: 2, create_rows: 2, update_rows: 0, skipped_rows: 0, warning_rows: 0, error_rows: 0,
  rows: [
    { row: 2, action: 'create', status: 'ok', valid: true, sku: 'SKU-1', name: 'قهوة', type: 'good', barcode: null, messages: [] },
    { row: 3, action: 'create', status: 'ok', valid: true, sku: 'SKU-2', name: 'شاي', type: 'good', barcode: null, messages: [] },
  ],
  rows_shown: 2, rows_truncated: false, errors: [],
};

const brokenPreview = {
  ...cleanPreview,
  create_rows: 1, error_rows: 1,
  rows: [
    cleanPreview.rows[0],
    { row: 3, action: 'error', status: 'error', valid: false, sku: 'SKU-2', name: 'شاي', type: 'good', barcode: null, messages: ['رمز SKU مكرر داخل الملف'] },
  ],
  errors: [{ row: 3, messages: ['رمز SKU مكرر داخل الملف'] }],
};

function csvFile(name = 'products.csv'): File {
  return new File(['sku,name\nSKU-1,قهوة\n'], name, { type: 'text/csv' });
}

/** يرفع ملفاً ويصل بالتدفّق إلى خطوة مطابقة الأعمدة. */
async function uploadTo(step: 'mode' | 'mapping' | 'rules', user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByLabelText('import_file'), csvFile());
  await waitFor(() => expect(screen.getByLabelText('import_mode_create')).toBeTruthy());
  if (step === 'mode') return;

  await user.click(screen.getByRole('button', { name: 'import_next' }));
  await waitFor(() => expect(screen.getByText('import_mapping_source')).toBeTruthy());
  if (step === 'mapping') return;

  await user.click(screen.getByRole('button', { name: 'import_next' }));
  await waitFor(() => expect(screen.getByLabelText('import_blank_policy')).toBeTruthy());
}

beforeEach(() => {
  api.mockReset();
  downloadFile.mockReset();
  downloadCsv.mockReset();
  api.mockImplementation((path: string) => {
    if (path === '/products/import/inspect') return Promise.resolve({ data: inspection });
    if (path === '/products/import/preview') return Promise.resolve({ data: cleanPreview });
    if (path === '/products/import/apply') {
      return Promise.resolve({
        data: { mode: 'create', created: 2, updated: 0, skipped: 0, total_rows: 2, results: cleanPreview.rows },
      });
    }
    return Promise.resolve({ data: {} });
  });
});

afterEach(cleanup);

describe('شاشة استيراد المنتجات', () => {
  it('تبدأ عند خطوة الملف وتقبل CSV وXLSX معاً', () => {
    render(<ProductImportPage />);

    const input = screen.getByLabelText('import_file') as HTMLInputElement;
    expect(input.accept).toContain('.csv');
    expect(input.accept).toContain('.xlsx');
    expect(screen.getByText('import_drop_hint')).toBeTruthy();
  });

  it('ترسل الملف للفحص وتنتقل إلى خطوة العملية باقتراح مطابقة', async () => {
    const user = userEvent.setup();
    render(<ProductImportPage />);

    await uploadTo('mode', user);

    expect(api).toHaveBeenCalledWith('/products/import/inspect', expect.objectContaining({ method: 'POST' }));
    expect(screen.getByLabelText('import_mode_create')).toBeTruthy();
    expect(screen.getByLabelText('import_mode_update')).toBeTruthy();
    expect(screen.getByLabelText('import_mode_upsert')).toBeTruthy();
  });

  it('تعرض جدول مطابقة الأعمدة بالعيّنات والاقتراح', async () => {
    const user = userEvent.setup();
    render(<ProductImportPage />);
    await uploadTo('mapping', user);

    expect((screen.getByLabelText('Code') as HTMLSelectElement).value).toBe('sku');
    expect((screen.getByLabelText('Product Name') as HTMLSelectElement).value).toBe('name');
    expect((screen.getByLabelText('Mystery') as HTMLSelectElement).value).toBe('');
    expect(screen.getByText('SKU-1')).toBeTruthy();
  });

  it('تمنع المتابعة حين يبقى حقل مطلوب بلا مطابقة', async () => {
    const user = userEvent.setup();
    render(<ProductImportPage />);
    await uploadTo('mapping', user);

    await user.selectOptions(screen.getByLabelText('Product Name'), '');

    expect(screen.getByRole('alert').textContent).toContain('import_mapping_missing_required');
    expect((screen.getByRole('button', { name: 'import_next' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('تطالب بمعرّف في وضع التحديث ولا تقبل الاسم بديلاً', async () => {
    const user = userEvent.setup();
    render(<ProductImportPage />);
    await uploadTo('mode', user);

    await user.click(screen.getByLabelText('import_mode_update'));
    await user.click(screen.getByRole('button', { name: 'import_next' }));
    await user.selectOptions(screen.getByLabelText('Code'), '');

    expect(screen.getByRole('alert').textContent).toContain('import_mapping_missing_identifier');
  });

  it('لا تسمح بربط عمودين بالحقل نفسه', async () => {
    const user = userEvent.setup();
    render(<ProductImportPage />);
    await uploadTo('mapping', user);

    await user.selectOptions(screen.getByLabelText('Mystery'), 'name');

    expect(screen.getByRole('alert').textContent).toContain('import_mapping_duplicate');
  });

  it('تعطّل سياسة الفراغ في وضع الإنشاء وتتيحها في التحديث', async () => {
    const user = userEvent.setup();
    render(<ProductImportPage />);
    await uploadTo('rules', user);

    expect((screen.getByLabelText('import_blank_policy') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('import_master_data_policy') as HTMLSelectElement).value).toBe('match_or_error');
  });

  it('ترسل السياسات المختارة والمطابقة إلى مسار المعاينة', async () => {
    const user = userEvent.setup();
    render(<ProductImportPage />);
    await uploadTo('rules', user);

    await user.selectOptions(screen.getByLabelText('import_master_data_policy'), 'create_missing');
    await user.click(screen.getByRole('button', { name: 'import_next' }));

    await waitFor(() => expect(api).toHaveBeenCalledWith('/products/import/preview', expect.anything()));
    const body = api.mock.calls.find((call) => call[0] === '/products/import/preview')?.[1].body as FormData;
    expect(body.get('mode')).toBe('create');
    expect(body.get('master_data_policy')).toBe('create_missing');
    expect(body.get('mapping[0]')).toBe('sku');
    expect(body.get('mapping[4]')).toBe('ignore');
  });

  it('تعرض عدادات المعاينة الست وتفاصيل الصفوف', async () => {
    const user = userEvent.setup();
    render(<ProductImportPage />);
    await uploadTo('rules', user);
    await user.click(screen.getByRole('button', { name: 'import_next' }));

    await waitFor(() => expect(screen.getByText('import_kpi_total')).toBeTruthy());
    ['import_kpi_create', 'import_kpi_update', 'import_kpi_skip', 'import_kpi_warning', 'import_kpi_error'].forEach(
      (key) => expect(screen.getByText(key)).toBeTruthy()
    );
    expect(screen.getAllByText('قهوة').length).toBeGreaterThan(0);
  });

  it('تمنع التنفيذ حين توجد أخطاء مانعة وتتيح تنزيل تقريرها', async () => {
    api.mockImplementation((path: string) => {
      if (path === '/products/import/inspect') return Promise.resolve({ data: inspection });
      if (path === '/products/import/preview') return Promise.resolve({ data: brokenPreview });
      return Promise.resolve({ data: {} });
    });

    const user = userEvent.setup();
    render(<ProductImportPage />);
    await uploadTo('rules', user);
    await user.click(screen.getByRole('button', { name: 'import_next' }));

    await waitFor(() => expect(screen.getByText('import_kpi_error')).toBeTruthy());
    expect((screen.getByRole('button', { name: 'import_next' }) as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByRole('button', { name: 'import_download_errors' }));
    expect(downloadCsv).toHaveBeenCalledWith('nebrax-products-import-errors', expect.any(String));
  });

  it('توضّح أن قائمة الصفوف مختصرة بينما العدادات كاملة', async () => {
    api.mockImplementation((path: string) => {
      if (path === '/products/import/inspect') return Promise.resolve({ data: inspection });
      if (path === '/products/import/preview') {
        return Promise.resolve({
          data: { ...cleanPreview, total_rows: 900, create_rows: 900, rows_shown: 2, rows_truncated: true },
        });
      }
      return Promise.resolve({ data: {} });
    });

    const user = userEvent.setup();
    render(<ProductImportPage />);
    await uploadTo('rules', user);
    await user.click(screen.getByRole('button', { name: 'import_next' }));

    await waitFor(() => expect(screen.getByText('import_rows_truncated:2,900')).toBeTruthy());
  });

  it('تؤكّد قبل التنفيذ ثم تعرض النتيجة وتتيح تنزيل تقريرها', async () => {
    const user = userEvent.setup();
    render(<ProductImportPage />);
    await uploadTo('rules', user);
    await user.click(screen.getByRole('button', { name: 'import_next' }));
    await waitFor(() => expect(screen.getByText('import_kpi_total')).toBeTruthy());

    await user.click(screen.getByRole('button', { name: 'import_next' }));
    expect(screen.getByText('import_confirm_body:2,0,0')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'import_apply' }));
    await waitFor(() => expect(screen.getByText('import_result_title')).toBeTruthy());

    expect(api).toHaveBeenCalledWith('/products/import/apply', expect.anything());
    await user.click(screen.getByRole('button', { name: 'import_download_result' }));
    expect(downloadCsv).toHaveBeenCalledWith('nebrax-products-import-result', expect.any(String));
  });

  it('تعرض فشل الخادم كرسالة خطأ مرئية لا صمتاً', async () => {
    api.mockImplementation((path: string) => {
      if (path === '/products/import/inspect') {
        return Promise.reject(Object.assign(new Error('صيغة الملف غير مدعومة.'), { status: 422 }));
      }
      return Promise.resolve({ data: {} });
    });

    const user = userEvent.setup();
    render(<ProductImportPage />);
    await user.upload(screen.getByLabelText('import_file'), csvFile());

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });

  it('تنزّل القالب من الخادم لا من المتصفح', async () => {
    const user = userEvent.setup();
    render(<ProductImportPage />);

    await user.click(screen.getByRole('button', { name: 'import_template' }));
    expect(downloadFile).toHaveBeenCalledWith(
      '/products/import/template',
      'nebrax-products-import-template.csv'
    );
  });

  it('تبقي كل تسميات الحقول مترجَمة بلا نص عربي مكتوب في الشيفرة', async () => {
    const user = userEvent.setup();
    const { container } = render(<ProductImportPage />);
    await uploadTo('mapping', user);

    // بيانات العيّنة عربية عمداً، فالفحص على التسميات والأزرار وحدها.
    const chrome = [
      ...container.querySelectorAll('label, button, th, legend'),
    ].map((node) => node.textContent ?? '');
    expect(chrome.some((text) => /[؀-ۿ]/.test(text))).toBe(false);
  });
});

describe('جدول معاينة الاستيراد على الجوال', () => {
  it('يقدّم بطاقة مضغوطة بجانب الجدول بدل تمرير أفقي للصفحة', async () => {
    const user = userEvent.setup();
    const { container } = render(<ProductImportPage />);
    await uploadTo('rules', user);
    await user.click(screen.getByRole('button', { name: 'import_next' }));
    await waitFor(() => expect(screen.getByText('import_kpi_total')).toBeTruthy());

    const desktop = container.querySelector('.hidden.overflow-x-auto.rounded-md.border.md\\:block');
    const mobile = container.querySelector('ul.md\\:hidden');
    expect(desktop).toBeTruthy();
    expect(mobile).toBeTruthy();
    expect(within(mobile as HTMLElement).getAllByText('قهوة').length).toBe(1);
  });
});
