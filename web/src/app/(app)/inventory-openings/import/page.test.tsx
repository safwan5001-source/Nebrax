// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InventoryOpeningImportPage from './page';
import { ApiError } from '@/lib/api';

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
  { key: 'sku', label_ar: 'رمز الصنف', label_en: 'SKU', type: 'text', required: false },
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

const cleanPreview = {
  opening_date: '2026-01-01',
  allow_zero_cost: false,
  mapping: { 0: 'sku', 1: 'warehouse', 2: 'opening_quantity', 3: 'opening_unit_cost' },
  counters: {
    total_rows: 1, valid_rows: 1, error_rows: 0, duplicate_rows: 0,
    products_not_found: 0, warehouses_not_found: 0, products_with_movements: 0,
    total_quantity: 120, total_value: 222000,
  },
  rows: [{
    row: 2, status: 'valid', sku: 'SKU-1001', barcode: null, product_name: 'قهوة عربية',
    warehouse: 'المخزن الرئيسي', quantity: 120, unit_cost: 1850, total_cost: 222000,
    notes: null, issues: [],
  }],
  rows_shown: 1,
  rows_truncated: false,
  errors: [],
};

function openingsCsv(): File {
  return new File(['sku,warehouse,opening_quantity,opening_unit_cost\nSKU-1001,WH-1,120,18.50\n'], 'openings.csv', { type: 'text/csv' });
}

function jobFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    domain: 'inventory_opening',
    status: 'ready',
    original_filename: 'openings.csv',
    extension: 'csv',
    byte_size: 40,
    content_sha256: 'x',
    row_count: 1,
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

async function uploadAndPreview(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByLabelText('choose_file'), openingsCsv());
  await waitFor(() => expect(screen.getByLabelText('opening_date')).toBeTruthy());
  await user.click(screen.getByRole('button', { name: 'run_preview' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'create_draft' })).toBeTruthy());
}

beforeEach(() => {
  window.history.replaceState({}, '', '/inventory-openings/import');
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
    return Promise.resolve({ data: {} });
  });
});

afterEach(cleanup);

describe('استيراد الرصيد الافتتاحي — المحرّك الدائم (مسودة فقط)', () => {
  /**
   * PR-DUR-HARDEN-1 (Part B) — زرّ إنشاء المسودة داخل شريط إجراءاتٍ ملتصق
   * وآمن الحافّة السفلية على الجوال (`FormActions`/`pb-safe`)، لا صفٍّ عاديّ
   * داخل البطاقة قد يقع تحت شريط Safari السفلي على iPhone.
   */
  it('زرّ إنشاء المسودة داخل شريط إجراءاتٍ ملتصق وآمن الحافّة السفلية', async () => {
    const user = userEvent.setup();
    render(<InventoryOpeningImportPage />);
    await uploadAndPreview(user);

    const createDraftButton = screen.getByRole('button', { name: 'create_draft' });
    const actionsBar = createDraftButton.closest('.pb-safe');
    expect(actionsBar).toBeTruthy();
    expect(actionsBar?.className).toContain('fixed');
  });

  it('التطبيق ذرّيٌّ: قطعةٌ واحدة تُنجز المستند كله، ولا شريط تقدّم مزيَّف', async () => {
    const user = userEvent.setup();
    render(<InventoryOpeningImportPage />);
    await uploadAndPreview(user);

    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/import-jobs' && options?.method === 'POST') return Promise.resolve({ data: jobFixture() });
      if (path === '/import-jobs/job-1/apply') {
        return Promise.resolve({
          data: jobFixture({
            status: 'completed',
            processed_rows: 1,
            apply_result: { inventory_opening_id: 'opn-1', number: 'OPN-2026-00001', status: 'draft', total_quantity: 120, total_value: 222000, lines_count: 1 },
          }),
        });
      }
      return Promise.resolve({ data: {} });
    });

    await user.click(screen.getByRole('button', { name: 'create_draft' }));

    await waitFor(() => expect(screen.getByText('draft_created:OPN-2026-00001')).toBeTruthy());
    // لا شريط تقدّمٍ (progressbar) في أي لحظة — المصنّف/الافتتاحي ذرّيان.
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('نصّ الاكتمال يوضّح صراحةً أن المستند مسودة ولم يُرحَّل، ولا يُستدعى أي مسار ترحيل', async () => {
    const user = userEvent.setup();
    render(<InventoryOpeningImportPage />);
    await uploadAndPreview(user);

    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/import-jobs' && options?.method === 'POST') return Promise.resolve({ data: jobFixture() });
      if (path === '/import-jobs/job-1/apply') {
        return Promise.resolve({
          data: jobFixture({
            status: 'completed',
            processed_rows: 1,
            apply_result: { inventory_opening_id: 'opn-1', number: 'OPN-2026-00001', status: 'draft', total_quantity: 120, total_value: 222000, lines_count: 1 },
          }),
        });
      }
      return Promise.resolve({ data: {} });
    });

    await user.click(screen.getByRole('button', { name: 'create_draft' }));

    // "draft_created"/"draft_next_step" يوضّحان صراحةً أنه مسودةٌ فقط، وأن
    // الترحيل (الذي يحرّك المخزون ويولّد القيد) فعلٌ منفصل لاحق.
    await waitFor(() => expect(screen.getByText('draft_next_step')).toBeTruthy());
    expect(screen.getByText('draft_created:OPN-2026-00001')).toBeTruthy();

    // لا نداء لأي مسار ترحيل (`/post`) في أي وقت من هذا التدفّق.
    const postCalls = api.mock.calls.filter((call) => String(call[0]).includes('/post'));
    expect(postCalls).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'open_draft' }));
    expect(push).toHaveBeenCalledWith('/inventory-openings/opn-1');
  });

  it('تستأنف تشغيلةً موجودة من رابط الصفحة بلا إعادة رفع الملف', async () => {
    window.history.replaceState({}, '', '/inventory-openings/import?job=job-1');
    api.mockImplementation((path: string) => {
      if (path === '/import-jobs/job-1') return Promise.resolve({ data: jobFixture({ status: 'ready' }) });
      return Promise.resolve({ data: {} });
    });

    render(<InventoryOpeningImportPage />);

    await waitFor(() => expect(screen.getByText('resumed_title')).toBeTruthy());
    expect(api).not.toHaveBeenCalledWith('/inventory-openings/import/inspect', expect.anything());
  });

  it('حالة الفشل تعرض رسالة الخادم الفعلية', async () => {
    const user = userEvent.setup();
    render(<InventoryOpeningImportPage />);
    await uploadAndPreview(user);

    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/import-jobs' && options?.method === 'POST') return Promise.resolve({ data: jobFixture() });
      if (path === '/import-jobs/job-1/apply') return Promise.reject(new ApiError(422, 'لا يوجد صنف بهذا الرمز.', {}));
      if (path === '/import-jobs/job-1') return Promise.resolve({ data: jobFixture({ status: 'failed', error_message: 'لا يوجد صنف بهذا الرمز.' }) });
      return Promise.resolve({ data: {} });
    });

    await user.click(screen.getByRole('button', { name: 'create_draft' }));

    await waitFor(() => expect(screen.getByText('لا يوجد صنف بهذا الرمز.')).toBeTruthy());
  });
});
