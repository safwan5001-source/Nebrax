// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProductImportPage from './page';
import { ApiError } from '@/lib/api';

const { api, downloadFile, downloadCsv, translate, toast, toastSuccess } = vi.hoisted(() => {
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
    toast: vi.fn(),
    toastSuccess: vi.fn(),
  };
});

vi.mock('next-intl', () => ({ useTranslations: () => translate, useLocale: () => 'ar' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api, downloadFile };
});
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
  { key: 'nebrax_id', label_ar: 'معرّف نبراكس', label_en: 'Nebrax ID', type: 'identifier', required: false, clearable: false, update_locked: true, writable: false },
  { key: 'sku', label_ar: 'رمز الصنف', label_en: 'SKU', type: 'text', required: false, clearable: false, update_locked: false, writable: true },
  { key: 'name', label_ar: 'الاسم', label_en: 'Name', type: 'text', required: true, clearable: false, update_locked: false, writable: true },
  { key: 'type', label_ar: 'النوع', label_en: 'Type', type: 'enum', required: true, clearable: false, update_locked: true, writable: true },
  { key: 'sale_price', label_ar: 'سعر البيع', label_en: 'Sale price', type: 'money', required: true, clearable: false, update_locked: false, writable: true },
];

const inspection = {
  columns: [
    { index: 0, header: 'Code', samples: ['SKU-1'], suggested_field: 'sku' },
    { index: 1, header: 'Product Name', samples: ['قهوة'], suggested_field: 'name' },
    { index: 2, header: 'Price', samples: ['35.00'], suggested_field: 'sale_price' },
    { index: 3, header: 'Kind', samples: ['good'], suggested_field: 'type' },
  ],
  total_rows: 3,
  fields,
};

const cleanPreview = {
  mode: 'create', blank_policy: 'ignore', master_data_policy: 'match_or_error',
  total_rows: 3, create_rows: 3, update_rows: 0, skipped_rows: 0, warning_rows: 0, error_rows: 0,
  rows: [
    { row: 2, action: 'create', status: 'ok', valid: true, sku: 'SKU-1', name: 'قهوة', type: 'good', barcode: null, messages: [] },
  ],
  rows_shown: 1, rows_truncated: false, errors: [],
};

function csvFile(name = 'products.csv'): File {
  return new File(['sku,name\nSKU-1,قهوة\n'], name, { type: 'text/csv' });
}

function jobFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    domain: 'product_catalog',
    status: 'ready',
    original_filename: 'products.csv',
    extension: 'csv',
    byte_size: 20,
    content_sha256: 'x',
    row_count: 3,
    column_count: 4,
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

/** يرفع الملف ويصل بالتدفّق حتى شاشة المعاينة. */
async function uploadAndPreview(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByLabelText('import_file'), csvFile());
  await waitFor(() => expect(screen.getByLabelText('import_mode_create')).toBeTruthy());
  await user.click(screen.getByRole('button', { name: 'import_run_preview' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'import_apply' })).toBeTruthy());
}

beforeEach(() => {
  window.history.replaceState({}, '', '/products/import');
  api.mockReset();
  downloadFile.mockReset();
  downloadFile.mockResolvedValue('downloaded');
  downloadCsv.mockReset();
  toast.mockReset();
  toastSuccess.mockReset();
  api.mockImplementation((path: string) => {
    if (path === '/products/import/inspect') return Promise.resolve({ data: inspection });
    if (path === '/products/import/preview') return Promise.resolve({ data: cleanPreview });
    if (path === '/import-jobs') return Promise.resolve({ data: jobFixture() });
    return Promise.resolve({ data: {} });
  });
});

afterEach(cleanup);

describe('شاشة استيراد المنتجات — المحرّك الدائم', () => {
  it('الخطوة الأولى مدمجة: الملف والوضع والمطابقة والقواعد معاً بلا تنقّل بينها', async () => {
    const user = userEvent.setup();
    render(<ProductImportPage />);

    await user.upload(screen.getByLabelText('import_file'), csvFile());
    await waitFor(() => expect(screen.getByLabelText('import_mode_create')).toBeTruthy());

    // كلّها ظاهرة معاً في نفس الشاشة — لا خطوة منفصلة لكل قرار.
    expect(screen.getByText('import_step_mapping')).toBeTruthy();
    expect(screen.getByLabelText('import_blank_policy')).toBeTruthy();
  });

  it('الرفع الفعلي إلى تشغيلة دائمة يحدث مرّة واحدة فقط عند التأكيد النهائي', async () => {
    const user = userEvent.setup();
    render(<ProductImportPage />);
    await uploadAndPreview(user);

    // لم يُرفع الملف إلى `/import-jobs` بعد — ذاك فقط عند التأكيد.
    expect(api).not.toHaveBeenCalledWith('/import-jobs', expect.anything());

    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/import-jobs' && options?.method === 'POST') return Promise.resolve({ data: jobFixture() });
      if (path === '/import-jobs/job-1/apply') {
        return Promise.resolve({
          data: jobFixture({ status: 'completed', processed_rows: 3, apply_result: { created: 3, updated: 0, skipped: 0, results: [] } }),
        });
      }
      return Promise.resolve({ data: {} });
    });

    await user.click(screen.getByRole('button', { name: 'import_apply' }));

    await waitFor(() => expect(api).toHaveBeenCalledWith('/import-jobs', expect.objectContaining({ method: 'POST' })));
    // هوية التشغيلة تُحفَظ في رابط الصفحة فوراً — تحديثٌ لاحق يستعيدها بلا رفعٍ ثانٍ.
    await waitFor(() => expect(window.location.search).toContain('job=job-1'));
  });

  it('يعرض تقدّماً حقيقياً من الخادم عبر عدّة قطع حتى الاكتمال، ثم شاشة النتيجة', async () => {
    const user = userEvent.setup();
    render(<ProductImportPage />);
    await uploadAndPreview(user);

    let call = 0;
    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/import-jobs' && options?.method === 'POST') return Promise.resolve({ data: jobFixture() });
      if (path === '/import-jobs/job-1/apply') {
        call += 1;
        if (call === 1) return Promise.resolve({ data: jobFixture({ status: 'processing', processed_rows: 1 }) });
        if (call === 2) return Promise.resolve({ data: jobFixture({ status: 'processing', processed_rows: 2 }) });
        return Promise.resolve({
          data: jobFixture({ status: 'completed', processed_rows: 3, apply_result: { created: 3, updated: 0, skipped: 0, results: [] } }),
        });
      }
      return Promise.resolve({ data: {} });
    });

    await user.click(screen.getByRole('button', { name: 'import_apply' }));

    await waitFor(() => expect(screen.getByText('import_result_title')).toBeTruthy());
    expect(call).toBe(3);
  });

  it('تستأنف تشغيلةً موجودة من رابط الصفحة بلا إعادة رفع الملف', async () => {
    window.history.replaceState({}, '', '/products/import?job=job-1');
    api.mockImplementation((path: string) => {
      if (path === '/import-jobs/job-1') return Promise.resolve({ data: jobFixture({ status: 'processing', processed_rows: 1 }) });
      return Promise.resolve({ data: {} });
    });

    render(<ProductImportPage />);

    await waitFor(() => expect(screen.getByText('import_resumed_title')).toBeTruthy());
    expect(api).not.toHaveBeenCalledWith('/products/import/inspect', expect.anything());
  });

  /**
   * PR-DUR-HARDEN-1 — الصفحة لا تستدعي مسار التطبيق المتزامن إطلاقاً
   * (تعتمد حصراً على `/import-jobs`)، فترسل `for_durable=1` على الفحص
   * والمعاينة معاً كي يستعمل الخادم سقف الاستيراد الدائم الأعلى
   * (`DURABLE_MAX_ROWS`) بدل سقف المسار المتزامن القديم.
   */
  it('يرسل for_durable=1 على نداءي الفحص والمعاينة كليهما', async () => {
    const user = userEvent.setup();
    render(<ProductImportPage />);
    await uploadAndPreview(user);

    const inspectBody = api.mock.calls.find((call) => call[0] === '/products/import/inspect')?.[1]?.body as FormData;
    const previewBody = api.mock.calls.find((call) => call[0] === '/products/import/preview')?.[1]?.body as FormData;

    expect(inspectBody.get('for_durable')).toBe('1');
    expect(previewBody.get('for_durable')).toBe('1');
  });

  /**
   * PR-DUR-HARDEN-1 (Part B) — الأزرار الأساسية تستعمل `FormActions` (شريطٌ
   * ملتصق بأسفل الجوال مع `pb-safe`) بدل صفٍّ عاديّ داخل البطاقة، فلا يقع
   * زرّ التطبيق تحت شريط Safari السفلي على iPhone.
   */
  it('زرّ التطبيق داخل شريط إجراءاتٍ ملتصق وآمن الحافّة السفلية على الجوال', async () => {
    const user = userEvent.setup();
    render(<ProductImportPage />);
    await uploadAndPreview(user);

    const applyButton = screen.getByRole('button', { name: 'import_apply' });
    const actionsBar = applyButton.closest('.pb-safe');
    expect(actionsBar).toBeTruthy();
    expect(actionsBar?.className).toContain('fixed');
  });

  it('حالة الفشل تعرض رسالة الخادم الفعلية لا رسالة عامّة', async () => {
    const user = userEvent.setup();
    render(<ProductImportPage />);
    await uploadAndPreview(user);

    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/import-jobs' && options?.method === 'POST') return Promise.resolve({ data: jobFixture() });
      if (path === '/import-jobs/job-1/apply') {
        return Promise.reject(new ApiError(422, 'رمز الصنف مكرر داخل الملف.', {}));
      }
      if (path === '/import-jobs/job-1') return Promise.resolve({ data: jobFixture({ status: 'failed', error_message: 'رمز الصنف مكرر داخل الملف.' }) });
      return Promise.resolve({ data: {} });
    });

    await user.click(screen.getByRole('button', { name: 'import_apply' }));

    await waitFor(() => expect(screen.getByText('رمز الصنف مكرر داخل الملف.')).toBeTruthy());
  });
});
