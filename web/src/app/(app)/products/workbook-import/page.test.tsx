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

vi.mock('next-intl', () => ({ useTranslations: () => translate }));
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
});
