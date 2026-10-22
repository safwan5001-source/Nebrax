// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProductWorkbookImportPage from './page';

const { api, translate, toastSuccess } = vi.hoisted(() => ({
  api: vi.fn(),
  toastSuccess: vi.fn(),
  translate: Object.assign(
    (key: string, values: Record<string, unknown> = {}) =>
      Object.keys(values).length ? `${key}:${Object.values(values).join(',')}` : key,
    { raw: () => ({}), rich: (key: string) => key }
  ),
}));

vi.mock('next-intl', () => ({ useTranslations: () => translate, useLocale: () => 'ar' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api };
});
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast: vi.fn(), success: toastSuccess, error: vi.fn() }),
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

const priceLists = [
  { id: 'pl-1', name: 'قائمة الجملة', is_active: true },
  { id: 'pl-2', name: 'قائمة معطّلة', is_active: false },
];

function workbookFile(): File {
  return new File(['x'], 'workbook.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function jobFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    domain: 'product_workbook',
    status: 'ready',
    original_filename: 'workbook.xlsx',
    extension: 'xlsx',
    byte_size: 50,
    content_sha256: 'x',
    row_count: 2,
    column_count: 5,
    processed_rows: 0,
    apply_result: null,
    error_message: null,
    created_by: null,
    cancelled_by: null,
    cancelled_at: null,
    purge_after: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const inspectionFixture = {
  sheets: {
    products: {
      present: true,
      total_rows: 3,
      columns: [
        { index: 0, header: 'اسم الصنف', suggested_field: 'name' },
        { index: 1, header: 'السعر', suggested_field: 'sale_price' },
        { index: 2, header: 'عمود غريب', suggested_field: null },
      ],
    },
    barcodes: { present: true, total_rows: 1, columns: [{ index: 0, header: 'Barcode', suggested_field: 'barcode' }, { index: 1, header: 'Colour', suggested_field: null }] },
    unit_prices: { present: false, total_rows: 0, columns: [] },
  },
  fields: {
    products: [
      { key: 'name', label_ar: 'الاسم', label_en: 'Name', type: 'string', required: true, clearable: false, update_locked: false, writable: true },
      { key: 'sale_price', label_ar: 'سعر البيع', label_en: 'Sale price', type: 'money', required: true, clearable: false, update_locked: false, writable: true },
      { key: 'sku', label_ar: 'الرمز', label_en: 'SKU', type: 'string', required: false, clearable: true, update_locked: true, writable: true },
    ],
    barcodes: [],
    unit_prices: [],
  },
};

const cleanPreview = {
  products: { total_rows: 0, error_rows: 0, errors: [] },
  barcodes: { total_rows: 1, error_rows: 0, errors: [] },
  unit_prices: { total_rows: 1, error_rows: 0, errors: [] },
  ready: true,
};

beforeEach(() => {
  window.history.replaceState({}, '', '/products/workbook-import');
  api.mockReset();
  toastSuccess.mockReset();
  api.mockImplementation((path: string) => {
    if (path === '/price-lists') return Promise.resolve({ data: priceLists });
    if (path === '/products/workbook/preview') return Promise.resolve({ data: cleanPreview });
    return Promise.resolve({ data: {} });
  });
});

afterEach(cleanup);

describe('استيراد مصنّف المنتجات — أول واجهة دائمة له (بلا مسار جلسي سابق)', () => {
  it('لا يمكن المتابعة بلا اختيار قائمة سعر — القرار D-F محفوظ في الواجهة', async () => {
    render(<ProductWorkbookImportPage />);

    await waitFor(() => expect(screen.getByLabelText('price_list')).toBeTruthy());
    const select = screen.getByLabelText('price_list') as HTMLSelectElement;
    // القائمة المعطّلة لا تظهر ضمن الخيارات إطلاقاً.
    expect(Array.from(select.options).some((option) => option.value === 'pl-2')).toBe(false);
    expect(Array.from(select.options).some((option) => option.value === 'pl-1')).toBe(true);

    expect((screen.getByRole('button', { name: 'run_preview' }) as HTMLButtonElement).disabled).toBe(true);
  });

  /**
   * PR-DUR-HARDEN-1 (Part B) — زرّ المعاينة داخل شريط إجراءاتٍ ملتصق وآمن
   * الحافّة السفلية على الجوال (`FormActions`/`pb-safe`).
   */
  it('زرّ المعاينة داخل شريط إجراءاتٍ ملتصق وآمن الحافّة السفلية', async () => {
    render(<ProductWorkbookImportPage />);

    await waitFor(() => expect(screen.getByLabelText('price_list')).toBeTruthy());
    const runPreviewButton = screen.getByRole('button', { name: 'run_preview' });
    const actionsBar = runPreviewButton.closest('.pb-safe');
    expect(actionsBar).toBeTruthy();
    expect(actionsBar?.className).toContain('fixed');
  });

  it('التطبيق ذرّيٌّ: لا شريط تقدّم، والنتيجة تلخّص الأوراق الثلاث معاً', async () => {
    const user = userEvent.setup();
    render(<ProductWorkbookImportPage />);

    await waitFor(() => expect(screen.getByLabelText('price_list')).toBeTruthy());
    await user.selectOptions(screen.getByLabelText('price_list'), 'pl-1');
    await user.upload(screen.getByLabelText('step_file'), workbookFile());

    await waitFor(() => expect((screen.getByRole('button', { name: 'run_preview' }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole('button', { name: 'run_preview' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy());

    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/import-jobs' && options?.method === 'POST') return Promise.resolve({ data: jobFixture() });
      if (path === '/import-jobs/job-1/apply') {
        return Promise.resolve({
          data: jobFixture({
            status: 'completed',
            processed_rows: 2,
            apply_result: {
              products: { created: 0, updated: 0, skipped: 0 },
              barcodes: { created: 1, skipped: 0 },
              unit_prices: { created: 1 },
            },
          }),
        });
      }
      return Promise.resolve({ data: {} });
    });

    await user.click(screen.getByRole('button', { name: 'apply' }));

    await waitFor(() => expect(screen.getByText('result_products:0,0')).toBeTruthy());
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(toastSuccess).toHaveBeenCalled();

    const body = api.mock.calls.find((call) => call[0] === '/import-jobs/job-1/apply')?.[1]?.body as Record<string, unknown>;
    expect(body.price_list_id).toBe('pl-1');
  });

  it('تستأنف تشغيلةً موجودة من رابط الصفحة بلا إعادة رفع الملف', async () => {
    window.history.replaceState({}, '', '/products/workbook-import?job=job-1');
    api.mockImplementation((path: string) => {
      if (path === '/import-jobs/job-1') return Promise.resolve({ data: jobFixture({ status: 'ready' }) });
      if (path === '/price-lists') return Promise.resolve({ data: priceLists });
      return Promise.resolve({ data: {} });
    });

    render(<ProductWorkbookImportPage />);

    await waitFor(() => expect(screen.getByText('resumed_title')).toBeTruthy());
    expect(api).not.toHaveBeenCalledWith('/products/workbook/preview', expect.anything());
  });

  it('يفحص الملف عند اختياره ويعرض الأوراق والأعمدة غير المتعرَّف عليها دون أن يمنع المعاينة', async () => {
    api.mockImplementation((path: string) => {
      if (path === '/price-lists') return Promise.resolve({ data: priceLists });
      if (path === '/products/workbook/inspect') return Promise.resolve({ data: inspectionFixture });
      return Promise.resolve({ data: {} });
    });
    const user = userEvent.setup();
    render(<ProductWorkbookImportPage />);

    await waitFor(() => expect(screen.getByLabelText('price_list')).toBeTruthy());
    await user.selectOptions(screen.getByLabelText('price_list'), 'pl-1');
    await user.upload(screen.getByLabelText('step_file'), workbookFile());

    await waitFor(() => expect(screen.getByText('step_sheets')).toBeTruthy());
    // الورقة غير الموجودة تُعلَن، والعمود الذي لا يتعرّف عليه المطابق التلقائي في ورقة لا تقبل مطابقة يدوية يُعلَن تجاهله.
    expect(screen.getByText('sheet_absent')).toBeTruthy();
    expect(screen.getByText('sheet_unrecognized:Colour')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'run_preview' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('يرسل مطابقة الأعمدة المعدَّلة مع المعاينة ويحجب المعاينة عند نقص حقلٍ إلزامي', async () => {
    api.mockImplementation((path: string) => {
      if (path === '/price-lists') return Promise.resolve({ data: priceLists });
      if (path === '/products/workbook/inspect') return Promise.resolve({ data: inspectionFixture });
      if (path === '/products/workbook/preview') return Promise.resolve({ data: cleanPreview });
      return Promise.resolve({ data: {} });
    });
    const user = userEvent.setup();
    render(<ProductWorkbookImportPage />);

    await waitFor(() => expect(screen.getByLabelText('price_list')).toBeTruthy());
    await user.selectOptions(screen.getByLabelText('price_list'), 'pl-1');
    await user.upload(screen.getByLabelText('step_file'), workbookFile());
    await waitFor(() => expect(screen.getByLabelText('اسم الصنف')).toBeTruthy());

    // فك ربط عمود الاسم الإلزامي في وضع الإنشاء يحجب المعاينة.
    await user.selectOptions(screen.getByLabelText('اسم الصنف'), '');
    expect((screen.getByRole('button', { name: 'run_preview' }) as HTMLButtonElement).disabled).toBe(true);

    await user.selectOptions(screen.getByLabelText('اسم الصنف'), 'name');
    await user.click(screen.getByRole('button', { name: 'run_preview' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy());

    const form = api.mock.calls.find((call) => call[0] === '/products/workbook/preview')?.[1]?.body as FormData;
    expect(form.get('mapping[0]')).toBe('name');
    expect(form.get('mapping[1]')).toBe('sale_price');
    // العمود الذي لا اقتراح له يُرسَل تجاهلاً صريحاً فلا تعيد المطابقة التلقائية ربطه.
    expect(form.get('mapping[2]')).toBe('ignore');
  });

  it('فشل الفحص لا يمنع المعاينة ولا يرسل مطابقة (سلوك ما قبل H2-S3)', async () => {
    api.mockImplementation((path: string) => {
      if (path === '/price-lists') return Promise.resolve({ data: priceLists });
      if (path === '/products/workbook/inspect') return Promise.reject(new Error('boom'));
      if (path === '/products/workbook/preview') return Promise.resolve({ data: cleanPreview });
      return Promise.resolve({ data: {} });
    });
    const user = userEvent.setup();
    render(<ProductWorkbookImportPage />);

    await waitFor(() => expect(screen.getByLabelText('price_list')).toBeTruthy());
    await user.selectOptions(screen.getByLabelText('price_list'), 'pl-1');
    await user.upload(screen.getByLabelText('step_file'), workbookFile());
    await waitFor(() => expect((screen.getByRole('button', { name: 'run_preview' }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole('button', { name: 'run_preview' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy());

    const form = api.mock.calls.find((call) => call[0] === '/products/workbook/preview')?.[1]?.body as FormData;
    expect([...form.keys()].some((key) => key.startsWith('mapping'))).toBe(false);
  });

  it('يعرض أخطاء الورقة كاملةً عند التوسيع ويوفّر تنزيل التقرير', async () => {
    const errors = Array.from({ length: 8 }, (_, i) => ({ row: i + 2, messages: [`bad ${i + 2}`] }));
    api.mockImplementation((path: string) => {
      if (path === '/price-lists') return Promise.resolve({ data: priceLists });
      if (path === '/products/workbook/preview') {
        return Promise.resolve({ data: { ...cleanPreview, ready: false, products: { total_rows: 8, error_rows: 8, errors } } });
      }
      return Promise.resolve({ data: {} });
    });
    const user = userEvent.setup();
    render(<ProductWorkbookImportPage />);

    await waitFor(() => expect(screen.getByLabelText('price_list')).toBeTruthy());
    await user.selectOptions(screen.getByLabelText('price_list'), 'pl-1');
    await user.upload(screen.getByLabelText('step_file'), workbookFile());
    await waitFor(() => expect((screen.getByRole('button', { name: 'run_preview' }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole('button', { name: 'run_preview' }));

    await waitFor(() => expect(screen.getByText('sheet_row:2: bad 2')).toBeTruthy());
    expect(screen.queryByText('sheet_row:9: bad 9')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'errors_show_more:8' }));
    expect(screen.getByText('sheet_row:9: bad 9')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'download_errors' })).toBeTruthy();
  });

  it('معاينة متأخرة لمطابقة سابقة لا تُعرض بعد تغيير المطابقة أثناء الطلب', async () => {
    let release: (value: unknown) => void = () => {};
    api.mockImplementation((path: string) => {
      if (path === '/price-lists') return Promise.resolve({ data: priceLists });
      if (path === '/products/workbook/inspect') return Promise.resolve({ data: inspectionFixture });
      if (path === '/products/workbook/preview') return new Promise((resolve) => { release = resolve; });
      return Promise.resolve({ data: {} });
    });
    const user = userEvent.setup();
    render(<ProductWorkbookImportPage />);

    await waitFor(() => expect(screen.getByLabelText('price_list')).toBeTruthy());
    await user.selectOptions(screen.getByLabelText('price_list'), 'pl-1');
    await user.upload(screen.getByLabelText('step_file'), workbookFile());
    await waitFor(() => expect(screen.getByLabelText('اسم الصنف')).toBeTruthy());
    await user.click(screen.getByRole('button', { name: 'run_preview' }));

    // أثناء الطلب: يتعطّل الزر (لا معاينتان متوازيتان)، وتغيير المطابقة يُبطل الرد القادم.
    expect((screen.getByRole('button', { name: 'run_preview' }) as HTMLButtonElement).disabled).toBe(true);
    await user.selectOptions(screen.getByLabelText('عمود غريب'), 'sku');
    release({ data: cleanPreview });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.queryByRole('button', { name: 'apply' })).toBeNull();
    expect((screen.getByRole('button', { name: 'run_preview' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
